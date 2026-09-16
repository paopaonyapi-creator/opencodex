/**
 * Pao AI Gateway — Autonomous recovery worker (Phase 20.51).
 *
 * Periodically probes routes whose cooldown has elapsed. Recovery rules:
 *
 * - Honor a known quota reset before probing an exhausted route.
 * - Jitter each cycle so many routes do not refresh in a synchronized storm.
 * - A probe is a cheap health check, never a billable inference call.
 * - Two successful probes (via ConnectionStore) return a route to full
 *   traffic; a failed probe re-enters cooldown.
 *
 * Quarantined routes are deliberately NOT probed: they need an operator or
 * an explicit beginRecovery() call first.
 */

import type { GatewayEventRecord } from "../types";
import type { ConnectionStore } from "./connection-state";

export interface RecoveryWorkerOptions {
  readonly intervalMs?: number;
  /** Fractional jitter applied per cycle (0.15 = ±15%). */
  readonly jitter?: number;
  readonly now?: () => number;
  readonly onEvent?: (event: GatewayEventRecord) => void;
}

export interface RecoveryWorkerDeps {
  readonly connections: ConnectionStore;
  /** Cheap, non-billable probe. Returns true on success. */
  readonly probe: (routeKey: string) => Promise<boolean>;
}

export interface RecoveryWorkerHandle {
  stop(): void;
}

export function startRecoveryWorker(
  deps: RecoveryWorkerDeps,
  options: RecoveryWorkerOptions = {},
): RecoveryWorkerHandle {
  const intervalMs = options.intervalMs ?? 60_000;
  const jitter = options.jitter ?? 0.15;
  const onEvent = options.onEvent;

  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const due = deps.connections.probeDue();
    for (const routeKey of due) {
      if (stopped) return;
      try {
        const success = await deps.probe(routeKey);
        if (success) {
          deps.connections.recordProbe(routeKey, true);
          onEvent?.({
            timestamp: new Date().toISOString(),
            severity: "info",
            eventType: "RECOVERY_PROBE",
            providerId: routeKey.split("/")[0],
            modelId: routeKey.split("/")[1],
            reasonCode: "RECOVERY_PROBE_SUCCESS",
            details: { routeKey },
          });
        } else {
          deps.connections.recordProbe(routeKey, false, "provider_unavailable");
          onEvent?.({
            timestamp: new Date().toISOString(),
            severity: "warning",
            eventType: "RECOVERY_PROBE",
            providerId: routeKey.split("/")[0],
            modelId: routeKey.split("/")[1],
            reasonCode: "RECOVERY_PROBE_FAILED",
            details: { routeKey },
          });
        }
      } catch {
        deps.connections.recordProbe(routeKey, false, "provider_unavailable");
      }
    }
  };

  const schedule = (): void => {
    // Jitter only shapes probe timing to avoid synchronized refresh storms;
    // it has no security purpose, but crypto-grade randomness costs nothing
    // and keeps random-number linters quiet.
    const jitterFactor = 1 + ((globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32) * 2 - 1) * jitter;
    // The anti-hot-loop floor must never exceed the configured interval.
    const floorMs = Math.min(1_000, intervalMs);
    const delay = Math.max(floorMs, Math.round(intervalMs * jitterFactor));
    const timer = setTimeout(() => {
      void tick().finally(schedule);
    }, delay);
    // Never hold the process open for the worker.
    timer.unref?.();
  };

  schedule();

  return {
    stop() {
      stopped = true;
    },
  };
}
