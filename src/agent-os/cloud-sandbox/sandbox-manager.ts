// Phase 20.15 M2 — Cloud Sandbox Plane: sandbox lifecycle manager.
//
// Source spec §8/§11/§12/§46/§60. This is the piece that makes a sandbox a governed object
// rather than a process somebody started: every create goes policy-first, every mutation is
// idempotency-keyed, every sandbox carries a TTL, and destroy has to prove nothing leaked.
//
// Deliberately emulator-agnostic. Everything device-specific arrives through
// `CloudEmulatorAdapter`, so the lifecycle, TTL and idempotency rules below are testable -- and
// proven -- before any real Floci process exists on the host. docs/Phase-20.15 §13 resolved the
// adapter-availability question separately from this.

import { createHash } from "node:crypto";
import { CloudSandboxError } from "./errors";
import type { CloudEmulatorAdapter, CloudEmulatorAdapterRegistry } from "./adapter-spi";
import type { CloudCapabilityRegistry } from "./capability-registry";
import type { CloudSandboxDbStore } from "./db-store";
import type { CloudSandboxFlags } from "./flags";
import { PROFILE_STORAGE_MODE, SANDBOX_TTL_LIMITS } from "./types";
import type {
  CloudPolicyVerdict,
  CloudSandboxRecord,
  CreateSandboxRequest,
  DestroyOutcome,
  SandboxStatus,
} from "./types";

export type CloudAuthorizer = (
  actorId: string,
  capability: "cloud.sandbox" | "cloud.iac.local",
) => Promise<CloudPolicyVerdict> | CloudPolicyVerdict;

export interface SandboxManagerDeps {
  store: CloudSandboxDbStore;
  adapters: CloudEmulatorAdapterRegistry;
  capabilities: CloudCapabilityRegistry;
  flags: CloudSandboxFlags;
  /**
   * Deny by default when not supplied.
   *
   * A caller that forgets to wire policy must end up unable to create sandboxes, not able to
   * create them without a check. The real gate lives in `policy-gate.ts`; injecting it here
   * keeps this module free of the central SQLite handle and testable without one.
   */
  authorize?: CloudAuthorizer;
  now?: () => Date;
}

export interface ReapResult {
  scanned: number;
  destroyed: string[];
  failed: Array<{ sandboxId: string; message: string }>;
}

/** Local endpoint variables for one sandbox, for injection into an isolated runner only. */
export interface SandboxAccess {
  sandboxId: string;
  endpoints: CloudSandboxRecord["endpoints"];
  environment: Record<string, string>;
}

const LOCAL_FAKE_ENV = {
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  AWS_EC2_METADATA_DISABLED: "true",
} as const;

export class SandboxManager {
  private readonly now: () => Date;

  constructor(private readonly deps: SandboxManagerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private clampTtl(requested: number | undefined): number {
    const minutes = requested ?? SANDBOX_TTL_LIMITS.defaultMinutes;
    if (!Number.isFinite(minutes) || minutes < SANDBOX_TTL_LIMITS.minMinutes) {
      throw new CloudSandboxError(
        "SANDBOX_START_FAILED",
        `ttlMinutes ${minutes} is below the ${SANDBOX_TTL_LIMITS.minMinutes}m floor.`,
        { operation: "cloud.sandbox.create" },
      );
    }
    if (minutes > SANDBOX_TTL_LIMITS.maxMinutes) {
      throw new CloudSandboxError(
        "SANDBOX_START_FAILED",
        `ttlMinutes ${minutes} exceeds the ${SANDBOX_TTL_LIMITS.maxMinutes}m ceiling (source spec §5.3).`,
        { operation: "cloud.sandbox.create" },
      );
    }
    return minutes;
  }

  /**
   * Reject unknown or unapprovable services before anything is started.
   *
   * A Docker-backed service is not rejected here -- it is admitted and reported UNAVAILABLE --
   * because §42 wants the fidelity marker to travel with the sandbox rather than have the
   * request disappear. A service whose capability requires approval is refused, since silently
   * downgrading an approval-required service to "started but broken" would hide the gate.
   */
  private screenServices(services: string[]): void {
    for (const service of services) {
      if (!this.deps.capabilities.isKnown(service)) {
        throw new CloudSandboxError(
          "SERVICE_UNSUPPORTED",
          `"${service}" is not a registered cloud capability.`,
          { operation: "cloud.sandbox.create" },
        );
      }
      if (this.deps.capabilities.approvalModeOf(service) === "required") {
        throw new CloudSandboxError(
          "CLOUD_APPROVAL_REQUIRED",
          `"${service}" requires approval before a sandbox may include it.`,
          { operation: "cloud.sandbox.create" },
        );
      }
    }
  }

  private async gate(actorId: string): Promise<CloudPolicyVerdict> {
    if (!this.deps.authorize) {
      return {
        allowed: false,
        decision: "deny",
        code: "CLOUD_POLICY_DENIED",
        reason: "No policy gate is wired, so sandbox creation is denied by default.",
      };
    }
    return this.deps.authorize(actorId, "cloud.sandbox");
  }

  /**
   * Create a governed sandbox.
   *
   * Order matters and is the security property of this method: flag, then policy, then input
   * screening, then the idempotency fence, and only then an adapter call. Anything that can
   * refuse without touching a runtime refuses before anything exists to tear down.
   */
  async create(request: CreateSandboxRequest): Promise<CloudSandboxRecord> {
    if (!this.deps.flags.enabled) {
      throw new CloudSandboxError(
        "FEATURE_DISABLED",
        "Cloud Sandbox Plane is disabled; set PAO_CLOUD_SANDBOX_ENABLED to activate it.",
        { operation: "cloud.sandbox.create" },
      );
    }

    const verdict = await this.gate(request.actorId);
    if (!verdict.allowed) {
      throw new CloudSandboxError(verdict.code, verdict.reason, {
        sandboxId: request.id,
        operation: "cloud.sandbox.create",
      });
    }

    const ttlMinutes = this.clampTtl(request.ttlMinutes);
    this.screenServices(request.services);

    const adapterId = request.adapter ?? "mock-aws";
    const adapter = this.deps.adapters.get(adapterId);
    if (!adapter) {
      throw new CloudSandboxError(
        "ADAPTER_UNAVAILABLE",
        `No adapter registered under "${adapterId}".`,
        { sandboxId: request.id, operation: "cloud.sandbox.create" },
      );
    }

    const createdAt = this.timestamp();
    const record: CloudSandboxRecord = {
      id: request.id,
      workspaceId: request.workspaceId,
      taskId: request.taskId ?? null,
      runId: request.runId ?? null,
      actorId: request.actorId,
      provider: request.provider ?? adapter.provider,
      adapter: adapterId,
      profile: request.profile,
      status: "provisioning",
      endpoints: { base: "", region: "", services: {} },
      config: {
        services: [...request.services],
        storageMode: PROFILE_STORAGE_MODE[request.profile],
        ttlMinutes,
      },
      createdAt,
      expiresAt: null,
      destroyedAt: null,
    };

    const operationKey = request.idempotencyKey ?? null;

    // A replayed key returns the original outcome. Checked before anything is written, because
    // the row below would otherwise take the primary-key hit instead.
    if (operationKey !== null) {
      const replayed = this.deps.store.findOperationByIdempotencyKey(operationKey);
      if (replayed) {
        const existing = this.deps.store.getSandbox(replayed.sandboxId ?? request.id);
        if (existing) return existing;
      }
    }

    // Provisioning state is recorded before the audit row, which references it by foreign key.
    // A create that dies between here and the adapter call therefore leaves a visible
    // `provisioning` sandbox rather than an operation pointing at nothing.
    this.deps.store.insertSandbox(record);

    const begun = this.deps.store.beginOperation({
      id: `op_${request.id}_create`,
      sandboxId: request.id,
      actorId: request.actorId,
      idempotencyKey: operationKey,
      operation: "cloud.sandbox.create",
      riskLevel: "medium",
      policyDecision: verdict.decision,
      inputDigest: digestOf(request),
    });

    try {
      const runtime = await adapter.startSandbox({
        id: request.id,
        workspaceId: request.workspaceId,
        taskId: request.taskId ?? null,
        runId: request.runId ?? null,
        actorId: request.actorId,
        profile: request.profile,
        services: request.services,
        storageMode: record.config.storageMode,
        ttlMinutes,
      });

      this.deps.store.setSandboxEndpoints(request.id, runtime.endpoints);
      this.deps.store.extendSandboxExpiry(
        request.id,
        new Date(Date.parse(createdAt) + ttlMinutes * 60_000).toISOString(),
      );
      this.deps.store.updateSandboxStatus(request.id, "ready");
      this.deps.store.finishOperation(begun.operation.id, "succeeded", { sandboxId: request.id });
      return this.get(request.id);
    } catch (err) {
      this.deps.store.updateSandboxStatus(request.id, "failed");
      this.deps.store.finishOperation(begun.operation.id, "failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof CloudSandboxError) throw err;
      throw new CloudSandboxError("SANDBOX_START_FAILED", `Sandbox start failed: ${String(err)}`, {
        sandboxId: request.id,
        operation: "cloud.sandbox.create",
        cause: err,
      });
    }
  }

  get(sandboxId: string): CloudSandboxRecord {
    const record = this.deps.store.getSandbox(sandboxId);
    if (!record) {
      throw new CloudSandboxError("SANDBOX_NOT_FOUND", `No sandbox "${sandboxId}".`, {
        sandboxId,
        operation: "cloud.sandbox.get",
      });
    }
    return record;
  }

  list(workspaceId?: string): CloudSandboxRecord[] {
    return this.deps.store.listSandboxes(workspaceId);
  }

  /** Endpoint set plus the fake local credential frame, for isolated-runner injection. */
  accessFor(sandboxId: string): SandboxAccess {
    const record = this.get(sandboxId);
    if (record.status === "destroyed" || record.status === "failed") {
      throw new CloudSandboxError("SANDBOX_NOT_READY", `Sandbox "${sandboxId}" is ${record.status}.`, {
        sandboxId,
        operation: "cloud.sandbox.access",
      });
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(this.timestamp())) {
      throw new CloudSandboxError("SANDBOX_EXPIRED", `Sandbox "${sandboxId}" is past its TTL.`, {
        sandboxId,
        operation: "cloud.sandbox.access",
      });
    }
    return {
      sandboxId,
      endpoints: record.endpoints,
      environment: {
        ...LOCAL_FAKE_ENV,
        AWS_ENDPOINT_URL: record.endpoints.base,
        AWS_DEFAULT_REGION: record.endpoints.region,
      },
    };
  }

  /**
   * Extend a TTL, bounded by the same ceiling creation uses.
   *
   * Without the ceiling this is the easiest way for an agent to pin a sandbox open forever,
   * which is exactly what §5.3 exists to prevent.
   */
  extendTtl(sandboxId: string, extraMinutes: number): CloudSandboxRecord {
    const record = this.get(sandboxId);
    if (record.status === "destroyed") {
      throw new CloudSandboxError("SANDBOX_EXPIRED", `Sandbox "${sandboxId}" is destroyed.`, {
        sandboxId,
        operation: "cloud.sandbox.extend_ttl",
      });
    }
    const anchor = Math.max(
      Date.parse(this.timestamp()),
      record.expiresAt ? Date.parse(record.expiresAt) : Date.parse(this.timestamp()),
    );
    const next = new Date(anchor + extraMinutes * 60_000).toISOString();
    const totalFromCreation = (Date.parse(next) - Date.parse(record.createdAt)) / 60_000;
    if (totalFromCreation > SANDBOX_TTL_LIMITS.maxMinutes) {
      throw new CloudSandboxError(
        "SANDBOX_START_FAILED",
        `Extension would reach ${Math.round(totalFromCreation)}m, past the ${SANDBOX_TTL_LIMITS.maxMinutes}m ceiling.`,
        { sandboxId, operation: "cloud.sandbox.extend_ttl" },
      );
    }
    this.deps.store.extendSandboxExpiry(sandboxId, next);
    return this.get(sandboxId);
  }

  markStatus(sandboxId: string, status: SandboxStatus): CloudSandboxRecord {
    this.get(sandboxId);
    this.deps.store.updateSandboxStatus(sandboxId, status);
    return this.get(sandboxId);
  }

  /**
   * Destroy one sandbox and prove it left nothing behind.
   *
   * The order is collect-then-remove: logs and inventory are evidence (§31), so wiping the
   * runtime first destroys the thing the promotion gate needs. A non-empty leak list is
   * reported, not swallowed, because a partially-cleaned sandbox is the state an operator
   * has to be told about.
   */
  async destroy(sandboxId: string, reason = "manual"): Promise<DestroyOutcome> {
    const record = this.get(sandboxId);
    const adapter = this.deps.adapters.get(record.adapter);
    this.deps.store.updateSandboxStatus(sandboxId, "destroying");

    const operation = this.deps.store.beginOperation({
      id: `op_${sandboxId}_destroy_${this.now().getTime()}`,
      sandboxId,
      actorId: record.actorId,
      operation: "cloud.sandbox.destroy",
      riskLevel: "medium",
      policyDecision: reason,
    });

    try {
      await adapter?.stopSandbox(sandboxId);
    } catch {
      // A stop failure never licenses leaving the sandbox registered: destroy below is the
      // authoritative teardown, and refusing to continue would strand the runtime.
    }

    const report = adapter
      ? await adapter.destroy(sandboxId)
      : {
          sandboxId,
          destroyedAt: this.timestamp(),
          resourcesRemoved: 0,
          leaked: [],
          ok: true,
        };

    const resourcesRemoved = this.deps.store.deleteResourcesForSandbox(sandboxId);
    this.deps.store.markSandboxDestroyed(sandboxId, this.timestamp());
    this.deps.store.finishOperation(operation.operation.id, report.ok ? "succeeded" : "failed", {
      resourcesRemoved: report.resourcesRemoved,
      leaked: report.leaked,
    });

    if (!report.ok) {
      throw new CloudSandboxError(
        "LEAK_DETECTED",
        `Sandbox ${sandboxId} destroyed with ${report.leaked.length} leaked resource(s).`,
        { sandboxId, operation: "cloud.sandbox.destroy" },
      );
    }

    return { sandboxId, report, resourcesRemoved };
  }

  /**
   * Destroy everything whose TTL has passed (source spec §46 step 1).
   *
   * Per-sandbox failures are collected rather than thrown: one un-destroyable sandbox must not
   * stop the reaper from cleaning up the rest, or a single stuck container keeps the whole
   * host accumulating sandboxes.
   */
  async reapExpired(): Promise<ReapResult> {
    const expired = this.deps.store.listExpiredSandboxes(this.timestamp());
    const destroyed: string[] = [];
    const failed: ReapResult["failed"] = [];

    for (const record of expired) {
      try {
        await this.destroy(record.id, "ttl_expired");
        destroyed.push(record.id);
      } catch (err) {
        failed.push({ sandboxId: record.id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return { scanned: expired.length, destroyed, failed };
  }
}

function digestOf(request: CreateSandboxRequest): string {
  const canonical = JSON.stringify({
    workspaceId: request.workspaceId,
    actorId: request.actorId,
    provider: request.provider ?? null,
    adapter: request.adapter ?? null,
    profile: request.profile,
    services: [...request.services].sort(),
    ttlMinutes: request.ttlMinutes ?? null,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}
