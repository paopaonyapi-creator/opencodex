/**
 * Pao AI Gateway — Connection state machine (Phase 20.51).
 *
 * Deterministic transitions per the Phase 20.51 spec §11:
 *
 *   UNKNOWN -> HEALTHY                     (first success)
 *   HEALTHY -> DEGRADED                    (soft failure)
 *   DEGRADED -> COOLDOWN                   (repeated transient failure)
 *   HEALTHY/DEGRADED -> COOLDOWN           (rate limit / quota exhaustion)
 *   HEALTHY/DEGRADED -> QUARANTINED        (auth, permission, permanent)
 *   any -> DISABLED                        (operator action)
 *   COOLDOWN -> RECOVERING -> HEALTHY      (validated probe successes)
 *   RECOVERING -> COOLDOWN / QUARANTINED   (probe failure)
 *
 * Every transition is reported through the event sink so the audit trail
 * records WHY a route entered or left each state. In this repository a
 * "connection" is a gateway provider route (`providerId`); 9Router's own
 * upstream connections stay inside the 9Router process.
 */

import type { ConnectionState } from "../types";
import type { GatewayEventRecord } from "../types";

export interface ConnectionRecord {
  state: ConnectionState;
  consecutiveSoftFailures: number;
  cooldownUntil: number | null;
  quarantineReason: string | null;
  lastHealthyAt: string | null;
  lastFailureAt: string | null;
  probeSuccesses: number;
}

export interface ConnectionStoreOptions {
  /** Soft failures within one window before DEGRADED becomes COOLDOWN. */
  readonly cooldownAfterSoftFailures?: number;
  readonly now?: () => number;
  /** Audit sink; called once per transition. Must not throw into routing. */
  readonly onEvent?: (event: GatewayEventRecord) => void;
}

export type SoftFailureKind = "transient" | "rate_limit" | "quota_exhausted" | "permanent";

export interface SoftFailureInput {
  readonly kind: SoftFailureKind;
  /** Failure class name, for the audit event. */
  readonly failureClass: string;
  /** Known quota reset timestamp; pins the cooldown for quota exhaustion. */
  readonly resetAt?: string;
}

const DEFAULT_COOLDOWN_MS = 300_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 1_800_000;

export class ConnectionStore {
  private readonly records = new Map<string, ConnectionRecord>();
  private readonly cooldownAfterSoftFailures: number;
  private readonly now: () => number;
  private readonly onEvent: ((event: GatewayEventRecord) => void) | undefined;

  constructor(options: ConnectionStoreOptions = {}) {
    this.cooldownAfterSoftFailures = options.cooldownAfterSoftFailures ?? 3;
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
  }

  get(routeKey: string): ConnectionRecord {
    let record = this.records.get(routeKey);
    if (!record) {
      record = {
        state: "unknown",
        consecutiveSoftFailures: 0,
        cooldownUntil: null,
        quarantineReason: null,
        lastHealthyAt: null,
        lastFailureAt: null,
        probeSuccesses: 0,
      };
      this.records.set(routeKey, record);
    }
    return record;
  }

  snapshot(): Record<string, ConnectionRecord> {
    const out: Record<string, ConnectionRecord> = {};
    for (const [key, record] of this.records) out[key] = { ...record };
    return out;
  }

  /**
   * Routes eligible for a recovery probe right now: cooldowns whose window
   * has elapsed, plus routes already in RECOVERING that still owe probe
   * successes before they take full traffic again.
   */
  probeDue(): string[] {
    const t = this.now();
    return [...this.records.entries()]
      .filter(([, r]) => {
        if (r.state === "recovering") return true;
        return r.state === "cooldown" && r.cooldownUntil !== null && r.cooldownUntil <= t;
      })
      .map(([key]) => key);
  }

  /** Operator or governance action: route refuses traffic until recovered. */
  quarantine(routeKey: string, reason: string, reasonCode: string): void {
    const record = this.get(routeKey);
    this.transition(routeKey, record, "quarantined", reasonCode, { quarantineReason: reason });
  }

  /** Operator action: route refuses traffic until explicitly re-enabled. */
  disable(routeKey: string): void {
    const record = this.get(routeKey);
    this.transition(routeKey, record, "disabled", "CONNECTION_MANUALLY_DISABLED");
  }

  /** Operator action after re-auth: route returns to recovery, not straight to healthy. */
  beginRecovery(routeKey: string): void {
    const record = this.get(routeKey);
    this.transition(routeKey, record, "recovering", "CONNECTION_RECOVERY_REQUESTED");
    record.probeSuccesses = 0;
  }

  recordSuccess(routeKey: string): void {
    const record = this.get(routeKey);
    const from = record.state;
    record.consecutiveSoftFailures = 0;
    record.cooldownUntil = null;
    record.quarantineReason = null;
    record.lastHealthyAt = new Date(this.now()).toISOString();

    if (from === "recovering") {
      record.probeSuccesses += 1;
      // Two validated probes close a recovery; a single success just keeps it
      // in RECOVERING so a flapping route does not take full traffic back.
      if (record.probeSuccesses >= 2) {
        record.probeSuccesses = 0;
        this.transition(routeKey, record, "healthy", "RECOVERY_PROBE_SUCCESS");
      }
      return;
    }
    record.probeSuccesses = 0;
    if (from !== "healthy") this.transition(routeKey, record, "healthy", "ROUTE_RECOVERED");
  }

  recordFailure(routeKey: string, failure: SoftFailureInput): void {
    const record = this.get(routeKey);
    record.lastFailureAt = new Date(this.now()).toISOString();

    if (failure.kind === "permanent") {
      record.consecutiveSoftFailures = 0;
      this.transition(routeKey, record, "quarantined", `CONNECTION_QUARANTINED_${failure.failureClass.toUpperCase()}`, {
        quarantineReason: failure.failureClass,
      });
      return;
    }

    if (failure.kind === "quota_exhausted") {
      const cooldown = cooldownForReset(failure.resetAt, this.now()) ?? DEFAULT_COOLDOWN_MS;
      record.consecutiveSoftFailures = 0;
      this.enterCooldown(routeKey, record, cooldown, "ROUTE_REJECTED_QUOTA_EXHAUSTED");
      return;
    }

    if (failure.kind === "rate_limit") {
      record.consecutiveSoftFailures = 0;
      this.enterCooldown(routeKey, record, RATE_LIMIT_COOLDOWN_MS, "CB_RATE_LIMIT");
      return;
    }

    // Transient: soft-failure ladder HEALTHY -> DEGRADED -> COOLDOWN.
    record.consecutiveSoftFailures += 1;
    if (record.consecutiveSoftFailures >= this.cooldownAfterSoftFailures) {
      this.enterCooldown(routeKey, record, DEFAULT_COOLDOWN_MS, "CB_UPSTREAM_5XX");
      return;
    }
    if (record.state !== "degraded") {
      this.transition(routeKey, record, "degraded", `CONNECTION_DEGRADED_${failure.failureClass.toUpperCase()}`);
    }
  }

  /**
   * Probe result from the recovery worker. The first success moves a cooled
   * route into RECOVERING rather than straight back to full traffic; a second
   * validated success closes the recovery.
   */
  recordProbe(routeKey: string, success: boolean, failureClass?: string): void {
    if (!success) {
      const record = this.get(routeKey);
      record.probeSuccesses = 0;
      this.enterCooldown(
        routeKey,
        record,
        DEFAULT_COOLDOWN_MS,
        `RECOVERY_PROBE_FAILED${failureClass ? `_${failureClass.toUpperCase()}` : ""}`,
      );
      return;
    }
    const record = this.get(routeKey);
    if (record.state === "recovering") {
      record.probeSuccesses += 1;
      if (record.probeSuccesses >= 2) {
        record.probeSuccesses = 0;
        record.cooldownUntil = null;
        this.transition(routeKey, record, "healthy", "RECOVERY_PROBE_SUCCESS");
      }
      return;
    }
    record.consecutiveSoftFailures = 0;
    record.cooldownUntil = null;
    record.probeSuccesses = 1;
    this.transition(routeKey, record, "recovering", "RECOVERY_PROBE_SUCCESS");
  }

  /** Test seam. */
  reset(): void {
    this.records.clear();
  }

  private enterCooldown(routeKey: string, record: ConnectionRecord, cooldownMs: number, reasonCode: string): void {
    record.cooldownUntil = this.now() + cooldownMs;
    this.transition(routeKey, record, "cooldown", reasonCode, {
      cooldownUntilMs: record.cooldownUntil,
    });
  }

  private transition(
    routeKey: string,
    record: ConnectionRecord,
    to: ConnectionState,
    reasonCode: string,
    extra: { cooldownUntilMs?: number; quarantineReason?: string } = {},
  ): void {
    const from = record.state;
    record.state = to;
    if (extra.cooldownUntilMs !== undefined) record.cooldownUntil = extra.cooldownUntilMs;
    if (extra.quarantineReason !== undefined) record.quarantineReason = extra.quarantineReason;
    if (to === "healthy") record.cooldownUntil = null;
    if (to !== "quarantined") record.quarantineReason = null;

    if (from === to) return;
    try {
      this.onEvent?.({
        timestamp: new Date(this.now()).toISOString(),
        severity: to === "quarantined" ? "error" : to === "healthy" ? "info" : "warning",
        eventType: "CONNECTION_STATE_CHANGED",
        providerId: routeKey.split("/")[0],
        modelId: routeKey.split("/")[1],
        reasonCode,
        details: { from, to, routeKey },
      });
    } catch {
      // Audit must never break routing.
    }
  }
}

function cooldownForReset(resetAt: string | undefined, now: number): number | null {
  if (!resetAt) return null;
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset)) return null;
  // Slightly past the reported reset so the provider has actually rolled the
  // window over, and bounded so a far-future reset cannot freeze the route.
  const guarded = reset + 30_000 - now;
  return Math.min(Math.max(guarded, 0), MAX_COOLDOWN_MS);
}
