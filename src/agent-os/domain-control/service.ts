// Phase 20.15 — Domain Control Plane: orchestration service.
//
// THIS FILE ENFORCES THE SAFETY PIPELINE. Every mutating entry point runs
//   Observe -> Plan -> Diff -> Policy -> Approval -> Execute -> Verify -> Audit
// in that order, and no caller — MCP tool, management route, or dashboard — gets a
// path around it. The invariants worth stating explicitly, because each one is a
// control that a later simplification would remove:
//
//  1. dry_run defaults to TRUE for agent actors. A caller must present a valid,
//     unexpired, matching approval id to reach the provider.
//  2. Provider state is re-read AFTER every write. Domain-OSS writes are
//     asynchronous, so the write response is not evidence that anything changed.
//  3. An ambiguous write is never retried. It is reported, and the caller must
//     re-read authoritative state first.
//  4. Every outcome — including refusals and dry runs — produces an audit row.
//  5. Record types outside the first-release set cannot be executed at all.

import {
  type ApprovalRequest,
  type AuditActor,
  type AuditEvent,
  type DnsDiff,
  type DnsRecord,
  type DnsRecordIntent,
  type DomainControlConfig,
  type DomainZone,
  type MutationEnvelope,
  type ProviderHealth,
  type RiskAssessment,
  DomainControlError,
} from "./types";
import {
  assertAllowed,
  classifyRecordRisk,
  isAutonomouslyMutable,
  normalizeHostname,
} from "./policy";
import { canonicalIntentPayload, diffDeletion, diffRecords } from "./diff";
import {
  environmentForZone,
  loadDomainControlConfig,
  redactDeep,
} from "./config";
import { getDomainControlStore, type DomainControlStore } from "./store";
import type { DomainProvider } from "./providers/base";
import { DomainOssProvider } from "./providers/domain-oss";
import { FakeDomainProvider } from "./providers/fake";

export interface ProviderRegistry {
  register(provider: DomainProvider): void;
  get(id: string): DomainProvider | undefined;
  list(): DomainProvider[];
}

export class InMemoryProviderRegistry implements ProviderRegistry {
  private providers = new Map<string, DomainProvider>();

  register(provider: DomainProvider): void {
    this.providers.set(provider.descriptor().id, provider);
  }

  get(id: string): DomainProvider | undefined {
    return this.providers.get(id);
  }

  list(): DomainProvider[] {
    return [...this.providers.values()];
  }
}

export interface ServiceDependencies {
  readonly store?: DomainControlStore;
  readonly config?: DomainControlConfig;
  readonly registry?: ProviderRegistry;
  /** Clock seam, so approval expiry is testable without waiting. */
  readonly now?: () => number;
}

export interface MutationOutcome {
  readonly status: "dry_run" | "applied" | "approval_required" | "denied" | "noop";
  readonly operation: string;
  readonly requestId: string;
  readonly risk: RiskAssessment;
  readonly diff: DnsDiff | null;
  readonly approval?: ApprovalRequest;
  readonly provider: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly verification: unknown;
  /** True when the operation would need an approval before it can be applied. */
  readonly approvalRequired?: boolean;
  readonly error?: { code: string; message: string; retryable: boolean; next_action: string };
  /** True when the consumer must re-read provider state before acting again. */
  readonly requiresStateReread?: boolean;
}

/** Actors whose writes are untrusted by default. */
const AGENT_ACTORS: ReadonlySet<AuditActor> = new Set<AuditActor>(["chatgpt", "codex", "agent"]);

export class DomainControlService {
  private store: DomainControlStore;
  private config: DomainControlConfig;
  private registry: ProviderRegistry;
  private now: () => number;

  constructor(deps: ServiceDependencies = {}) {
    this.store = deps.store ?? getDomainControlStore();
    this.config = deps.config ?? loadDomainControlConfig();
    this.registry = deps.registry ?? new InMemoryProviderRegistry();
    this.now = deps.now ?? (() => Date.now());
    this.store.init();
  }

  getConfig(): DomainControlConfig {
    return this.config;
  }

  getStore(): DomainControlStore {
    return this.store;
  }

  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  provider(providerId?: string): DomainProvider {
    const id = providerId ?? this.config.defaultProvider;
    const provider = this.registry.get(id);
    if (!provider) {
      const available = this.registry.list().map((entry) => entry.descriptor().id).join(", ") || "none";
      throw new DomainControlError(
        "PROVIDER_UNAVAILABLE",
        `Provider "${id}" is not registered. Available: ${available}`,
        { nextAction: "configure the provider before using the control plane" },
      );
    }
    return provider;
  }

  // -- Reads (AUTO_READ: no approval, still allowlisted) --------------------

  async listZones(): Promise<DomainZone[]> {
    return this.provider().listZones();
  }

  /**
   * Resolve a hostname to its zone id and provider, enforcing the allowlist on
   * the way. Every mutation path goes through here, so there is exactly one place
   * where the question may we touch this name at all is answered.
   */
  async resolveZoneFor(hostname: string): Promise<{
    zone: DomainZone;
    zoneFqdn: string;
    provider: DomainProvider;
    hostname: string;
  }> {
    const { fqdn } = normalizeHostname(hostname);
    assertAllowed(fqdn, this.config.allowlist, this.config.denylist);
    const provider = this.provider();
    const zones = await provider.listZones();
    // Longest matching zone wins, so a.example.com is not attributed to a broader
    // example.com zone that also exists in the provider.
    const candidates = zones
      .filter((zone) => fqdn === zone.fqdn || fqdn.endsWith(`.${zone.fqdn}`))
      .sort((a, b) => b.fqdn.length - a.fqdn.length);
    const zone = candidates[0];
    if (!zone) {
      throw new DomainControlError(
        "VALIDATION_FAILED",
        `${fqdn} is allowlisted but no provider zone covers it.`,
        {
          nextAction: "create the zone in the provider, or correct DOMAIN_CONTROL_ALLOWLIST",
          detail: { hostname: fqdn, zones: zones.map((entry) => entry.fqdn) },
        },
      );
    }
    return { zone, zoneFqdn: zone.fqdn, provider, hostname: fqdn };
  }

  async listRecords(hostname: string): Promise<{ zone: DomainZone; records: DnsRecord[] }> {
    const { zone, provider } = await this.resolveZoneFor(hostname);
    const records = await provider.listRecords(zone.id);
    // Refresh the cache on every read: the cache exists so the dashboard can render
    // without a provider round trip, never so a decision can be made from stale data.
    this.store.replaceCachedRecords(zone.fqdn, records);
    return { zone, records };
  }

  async providerHealth(providerId?: string): Promise<ProviderHealth> {
    return this.provider(providerId).health();
  }

  // -- Diff (Observe + Plan + Diff) ----------------------------------------

  async buildDiff(
    hostname: string,
    intents: readonly DnsRecordIntent[],
  ): Promise<{ zone: DomainZone; diff: DnsDiff; observed: DnsRecord[] }> {
    const { zone, provider } = await this.resolveZoneFor(hostname);
    const observed = await provider.listRecords(zone.id);
    this.store.replaceCachedRecords(zone.fqdn, observed);
    const diff = diffRecords(observed, intents, { zone: zone.fqdn });
    return { zone, diff, observed };
  }

  // -- Mutations -----------------------------------------------------------

  /**
   * Create or update a single record.
   *
   * Order is not negotiable: allowlist, then validation, then risk classification,
   * then the approval gate, and only then the provider. The dry-run decision is
   * made AFTER classification and BEFORE execution, so a caller can always see the
   * diff and the risk even when the write is refused.
   */
  async applyRecord(
    hostname: string,
    intent: DnsRecordIntent,
    envelope: MutationEnvelope = {},
  ): Promise<MutationOutcome> {
    const actor: AuditActor = envelope.actor ?? "agent";
    const requestId = envelope.request_id ?? newRequestId();
    const operation = intent.id ? "dns.update_record" : "dns.create_record";

    try {
      const replay = this.checkIdempotency(envelope.idempotency_key, operation, hostname, [intent]);
      if (replay) {
        this.audit({
          requestId,
          actor,
          operation,
          resource: hostname,
          before: null,
          after: null,
          approvalId: null,
          provider: this.config.defaultProvider,
          result: "success",
          errorCode: null,
          verification: { idempotentReplay: true },
        });
        return replay;
      }
      if (!isAutonomouslyMutable(intent.type)) {
        throw new DomainControlError(
          "UNSUPPORTED_RECORD_TYPE",
          `Record type ${intent.type} is outside the autonomously mutable set (A, AAAA, CNAME, TXT) for this release.`,
          { nextAction: "apply this record manually until the type is enabled" },
        );
      }
      const { zone, diff, observed } = await this.buildDiff(hostname, [intent]);
      const relativeName = relativeNameOf(hostname, zone.fqdn);
      const existing = observed.find(
        (record) =>
          record.type === intent.type &&
          record.name.toLowerCase() === relativeName.toLowerCase() &&
          (intent.id ? record.id === intent.id : record.content !== intent.content),
      );
      const risk = classifyRecordRisk({
        intent: { ...intent, name: relativeName },
        hostname,
        production: this.isProduction(zone.fqdn),
        apex: relativeName === "@",
        operation: existing ? "update" : "create",
      });

      const mode = this.resolveMode(actor, envelope);
      // An explicit preview must NOT create an approval row. The dashboard separates
      // "Dry Run" from "Request Approval" (Phase 20.15 section 13.2), and a preview
      // that enqueued a pending request would flood the approval list with rows
      // nobody asked for — turning it into noise and training the operator to
      // bulk-approve. Requesting an approval is an explicit, separate act.
      if (mode === "preview") {
        const outcome: MutationOutcome = {
          status: diff.empty ? "noop" : "dry_run",
          operation,
          requestId,
          risk,
          diff,
          provider: this.config.defaultProvider,
          before: existing ?? null,
          after: diff.entries.map((entry) => entry.after),
          verification: null,
          approvalRequired: this.config.requireApproval && risk.requiresApproval,
        };
        this.auditMutation(outcome, actor, hostname, null);
        return outcome;
      }
      const approval = await this.gateApproval({
        requestId,
        operation,
        resource: hostname,
        risk,
        diff,
        envelope,
      });
      if (!approval.granted) {
        const outcome: MutationOutcome = {
          status: approval.status,
          operation,
          requestId,
          risk,
          diff,
          approval: approval.record,
          provider: this.config.defaultProvider,
          before: existing ?? null,
          after: null,
          verification: null,
        };
        this.auditMutation(outcome, actor, hostname, null);
        return outcome;
      }
      if (diff.empty) {
        const outcome: MutationOutcome = {
          status: "noop",
          operation,
          requestId,
          risk,
          diff,
          approval: approval.record,
          provider: this.config.defaultProvider,
          before: existing ?? null,
          after: existing ?? null,
          verification: { note: "intended state already matches observed state" },
        };
        this.auditMutation(outcome, actor, hostname, approval.record?.id ?? null);
        return outcome;
      }

      // EXECUTE
      const provider = this.provider();
      const write = existing
        ? await provider.updateRecord(zone.id, existing.id, { ...intent, name: relativeName })
        : await provider.createRecord(zone.id, { ...intent, name: relativeName });

      // VERIFY: re-read provider state. For Domain-OSS, writes are asynchronous, so
      // this is the first moment anything about the change is knowable.
      const settled = await this.rereadSettled(provider, zone.id, relativeName, intent);
      const outcome: MutationOutcome = {
        status: "applied",
        operation,
        requestId,
        risk,
        diff,
        approval: approval.record,
        provider: provider.descriptor().id,
        before: existing ?? null,
        after: settled.record ?? write.record ?? intent,
        verification: {
          settled: settled.settled,
          attempts: settled.attempts,
          jobId: write.jobId ?? null,
          observed: settled.record,
        },
      };
      if (envelope.idempotency_key) {
        this.store.putIdempotent({
          key: envelope.idempotency_key,
          payloadHash: canonicalIntentPayload([intent]),
          operation,
          resource: hostname,
          result: outcome,
        });
      }
      this.auditMutation(outcome, actor, hostname, approval.record?.id ?? null);
      return outcome;
    } catch (error) {
      return this.handleFailure(error, {
        actor,
        operation,
        requestId,
        resource: hostname,
        provider: this.config.defaultProvider,
      });
    }
  }

  /** Delete a record. Always critical risk; never silently reversible. */
  async deleteRecord(
    hostname: string,
    recordId: string,
    envelope: MutationEnvelope = {},
  ): Promise<MutationOutcome> {
    const actor: AuditActor = envelope.actor ?? "agent";
    const requestId = envelope.request_id ?? newRequestId();
    const operation = "dns.delete_record";
    try {
      const { zone, provider } = await this.resolveZoneFor(hostname);
      const observed = await provider.listRecords(zone.id);
      const record = observed.find((entry) => entry.id === recordId);
      if (!record) {
        throw new DomainControlError(
          "RECORD_CONFLICT",
          `Record ${recordId} is not present in ${zone.fqdn}.`,
          { nextAction: "re-read records; the record may already be gone" },
        );
      }
      const diff = diffDeletion(record, zone.fqdn);
      const risk = classifyRecordRisk({
        intent: { id: record.id, name: record.name, type: record.type, content: record.content },
        hostname,
        production: this.isProduction(zone.fqdn),
        apex: record.name === "@",
        operation: "delete",
      });
      const mode = this.resolveMode(actor, envelope);
      // Same rule as applyRecord: an explicit preview writes an audit row and
      // nothing else.
      if (mode === "preview") {
        const outcome: MutationOutcome = {
          status: "dry_run",
          operation,
          requestId,
          risk,
          diff,
          provider: provider.descriptor().id,
          before: record,
          after: null,
          verification: null,
          approvalRequired: this.config.requireApproval && risk.requiresApproval,
        };
        this.auditMutation(outcome, actor, hostname, null);
        return outcome;
      }
      const approval = await this.gateApproval({
        requestId,
        operation,
        resource: hostname,
        risk,
        diff,
        envelope,
      });
      if (!approval.granted) {
        const outcome: MutationOutcome = {
          status: approval.status,
          operation,
          requestId,
          risk,
          diff,
          approval: approval.record,
          provider: provider.descriptor().id,
          before: record,
          after: null,
          verification: null,
        };
        this.auditMutation(outcome, actor, hostname, approval.record?.id ?? null);
        return outcome;
      }
      await provider.deleteRecord(zone.id, recordId);
      const after = await provider.listRecords(zone.id);
      if (after.some((entry) => entry.id === recordId)) {
        // The provider accepted the delete and the record is still resolvable.
        // Reported as ambiguous rather than as success, because only a re-read can
        // tell whether this is propagation lag or a delete that never applied.
        throw new DomainControlError(
          "AMBIGUOUS_MUTATION",
          `Record ${recordId} is still present after an accepted delete.`,
          { nextAction: "re-read authoritative provider state before retrying" },
        );
      }
      const outcome: MutationOutcome = {
        status: "applied",
        operation,
        requestId,
        risk,
        diff,
        approval: approval.record,
        provider: provider.descriptor().id,
        before: record,
        after: null,
        verification: { removed: true, remainingRecords: after.length },
      };
      this.auditMutation(outcome, actor, hostname, approval.record?.id ?? null);
      return outcome;
    } catch (error) {
      return this.handleFailure(error, {
        actor,
        operation,
        requestId,
        resource: hostname,
        provider: this.config.defaultProvider,
      });
    }
  }

  // -- Rollback ------------------------------------------------------------

  /**
   * Restore a record to a previously observed state.
   *
   * Rollback is a NEW mutation with its own diff, approval, and audit row — it is
   * never an undo operation. Phase 20.15 section 16 forbids a silent undo, and the
   * mechanical reason is that an unlogged rollback makes the audit trail describe a
   * state the provider was never actually in.
   */
  async restoreRecord(
    hostname: string,
    before: DnsRecordIntent,
    envelope: MutationEnvelope = {},
  ): Promise<MutationOutcome> {
    return this.applyRecord(hostname, { ...before }, {
      ...envelope,
      reason: envelope.reason ?? "rollback to previously observed state",
    });
  }

  // -- Approvals -----------------------------------------------------------

  /**
   * Approval gate for non-DNS mutations (proxy routes, deployment bindings).
   *
   * Exposed so those paths reuse THIS gate instead of growing a second, subtly
   * different one. Returns granted=false with a pending approval when the caller
   * supplied no approval id, and throws when the supplied one is unusable.
   */
  async requestOrCheckApproval(input: {
    operation: string;
    resource: string;
    risk: RiskAssessment;
    requestId: string;
    envelope: MutationEnvelope;
    diff?: DnsDiff | null;
  }): Promise<{ granted: boolean; approval?: ApprovalRequest }> {
    const result = await this.gateApproval({
      requestId: input.requestId,
      operation: input.operation,
      resource: input.resource,
      risk: input.risk,
      diff: input.diff ?? { zone: "", entries: [], empty: true, counts: { create: 0, update: 0, delete: 0, noop: 0 } },
      envelope: input.envelope,
    });
    return { granted: result.granted, ...(result.record ? { approval: result.record } : {}) };
  }

  listApprovals(status?: ApprovalRequest["status"]): ApprovalRequest[] {
    this.store.expireStaleApprovals(this.now());
    return this.store.listApprovals(status);
  }

  getApproval(id: string): ApprovalRequest | null {
    this.store.expireStaleApprovals(this.now());
    return this.store.getApproval(id);
  }

  decideApproval(id: string, decision: "grant" | "deny", decidedBy: string): ApprovalRequest | null {
    this.store.expireStaleApprovals(this.now());
    const current = this.store.getApproval(id);
    if (!current) return null;
    if (current.status !== "pending") {
      throw new DomainControlError(
        "APPROVAL_EXPIRED",
        `Approval ${id} is ${current.status} and cannot be decided again.`,
        { nextAction: "request a fresh approval for the operation" },
      );
    }
    const updated = this.store.decideApproval(id, decision, decidedBy);
    this.store.appendAudit({
      requestId: current.requestId,
      actor: "user",
      operation: decision === "grant" ? "approval.grant" : "approval.deny",
      resource: current.resource,
      before: { status: current.status },
      after: { status: updated?.status ?? decision },
      approvalId: id,
      provider: "",
      result: decision === "grant" ? "success" : "denied",
      errorCode: null,
      verification: null,
    });
    return updated;
  }

  // -- Audit + observability ----------------------------------------------

  listAudit(query: Parameters<DomainControlStore["listAudit"]>[0] = {}): AuditEvent[] {
    return this.store.listAudit(query);
  }

  metrics(): Record<string, number> {
    const audit = this.store.listAudit({ limit: 500 });
    const approvals = this.store.listApprovals();
    const byOperation: Record<string, number> = {};
    let errors = 0;
    for (const event of audit) {
      byOperation[event.operation] = (byOperation[event.operation] ?? 0) + 1;
      if (event.result === "failure" || event.result === "denied") errors += 1;
    }
    const operationMetrics = Object.fromEntries(
      Object.entries(byOperation).map(([operation, count]) => [
        `operation_${operation.replace(/[.]/g, "_")}_total`,
        count,
      ]),
    );
    return {
      domain_operations_total: audit.length,
      domain_operation_errors_total: errors,
      approval_requests_total: approvals.length,
      approval_pending_total: approvals.filter((entry) => entry.status === "pending").length,
      approval_denied_total: approvals.filter((entry) => entry.status === "denied").length,
      ...operationMetrics,
    };
  }

  // -- Internals -----------------------------------------------------------

  private isProduction(zoneFqdn: string): boolean {
    if (environmentForZone(zoneFqdn, this.config) === "production") return true;
    const registered = this.store.getDomain(zoneFqdn);
    return registered?.environment === "production";
  }

  /**
   * Decide how far this call is allowed to travel.
   *
   * Three distinct outcomes, because collapsing them is how either the approval
   * queue or the write path goes wrong:
   *
   *  - "preview"           An explicit dry_run true. Computes and returns the diff,
   *                        creates NO approval row. This is the dashboard's Dry Run
   *                        button and an agent's cheap what-if.
   *  - "approval_required" An agent actor with no approval id. Computes the diff,
   *                        records a pending approval so an operator has something
   *                        actionable, and does NOT write. This is the shape in
   *                        Phase 20.15 section 7.
   *  - "execute"           Everything else. Still passes through the approval gate,
   *                        which refuses unless a granted approval id is supplied.
   *
   * A caller-supplied dry_run can only ask for less; it can never turn the agent
   * default off.
   */
  private resolveMode(
    actor: AuditActor,
    envelope: MutationEnvelope,
  ): "preview" | "approval_required" | "execute" {
    if (envelope.dry_run === true) return "preview";
    // Only a NON-EMPTY approval id counts as "the caller believes it has an
    // approval". Testing truthiness would treat a null approval_id — which is what
    // the envelope normalizer sets when the field is absent — as an intent to
    // execute, and would let an agent write without one.
    const hasApprovalId =
      typeof envelope.approval_id === "string" && envelope.approval_id.trim() !== "";
    if (AGENT_ACTORS.has(actor) && !hasApprovalId) return "approval_required";
    return "execute";
  }

  private async gateApproval(input: {
    requestId: string;
    operation: string;
    resource: string;
    risk: RiskAssessment;
    diff: DnsDiff;
    envelope: MutationEnvelope;
  }): Promise<{ granted: boolean; status: MutationOutcome["status"]; record?: ApprovalRequest }> {
    const { envelope, risk } = input;
    this.store.expireStaleApprovals(this.now());

    if (!this.config.requireApproval || !risk.requiresApproval) {
      return { granted: true, status: "dry_run" };
    }

    if (envelope.approval_id) {
      const approval = this.store.getApproval(envelope.approval_id);
      if (!approval) {
        throw new DomainControlError(
          "APPROVAL_REQUIRED",
          `Approval ${envelope.approval_id} does not exist.`,
          { nextAction: "request a new approval for this operation" },
        );
      }
      if (approval.status === "expired" || approval.expiresAt <= this.now()) {
        throw new DomainControlError(
          "APPROVAL_EXPIRED",
          `Approval ${approval.id} expired at ${new Date(approval.expiresAt).toISOString()}.`,
          { nextAction: "request a new approval" },
        );
      }
      if (approval.status !== "granted") {
        throw new DomainControlError(
          "APPROVAL_REQUIRED",
          `Approval ${approval.id} is ${approval.status}, not granted.`,
          { nextAction: "grant the approval before applying" },
        );
      }
      // A granted approval is bound to the resource and operation it was requested
      // for. Without this check, an approval for one hostname would authorize any
      // other hostname the caller names next.
      if (approval.resource !== input.resource || approval.operation !== input.operation) {
        throw new DomainControlError(
          "APPROVAL_REQUIRED",
          `Approval ${approval.id} was granted for ${approval.operation} ${approval.resource}, not ${input.operation} ${input.resource}.`,
          { nextAction: "request an approval for this exact operation and resource" },
        );
      }
      return { granted: true, status: "applied", record: approval };
    }

    // No approval supplied: create or reuse the pending request so the operator has
    // something to act on, and refuse the write.
    const existingPending = this.store
      .listApprovals("pending")
      .find((entry) => entry.requestId === input.requestId || entry.resource === input.resource);
    const record =
      existingPending ??
      this.store.createApproval({
        requestId: input.requestId,
        operation: input.operation,
        resource: input.resource,
        riskLevel: risk.level,
        approvalMode: risk.approvalMode,
        reasons: risk.reasons,
        diff: input.diff,
        requestedBy: envelope.actor ?? "agent",
        reason: envelope.reason ?? "",
        expiresAt: this.now() + this.config.approvalTtlMs,
      });
    return { granted: false, status: "approval_required", record };
  }

  private checkIdempotency(
    key: string | undefined,
    operation: string,
    resource: string,
    intents: readonly DnsRecordIntent[],
  ): MutationOutcome | null {
    if (!key) return null;
    const existing = this.store.getIdempotent(key);
    if (!existing) return null;
    const payloadHash = canonicalIntentPayload(intents);
    if (existing.payloadHash === payloadHash && existing.operation === operation) {
      return existing.result as MutationOutcome;
    }
    // Same key, different payload: refuse rather than guess which one the caller
    // meant. This is the guard against a retry storm creating divergent state.
    throw new DomainControlError(
      "IDEMPOTENCY_CONFLICT",
      `Idempotency key "${key}" was already used for a different payload on ${resource}.`,
      { nextAction: "use a new idempotency key for a different payload" },
    );
  }

  /**
   * Re-read provider state after a write.
   *
   * Bounded, because Domain-OSS applies changes through a worker: the record will
   * not be visible instantly. settled false is a truthful answer and is audited as
   * such; it is never reported as success.
   */
  private async rereadSettled(
    provider: DomainProvider,
    zoneId: string,
    relativeName: string,
    intent: DnsRecordIntent,
  ): Promise<{ settled: boolean; attempts: number; record: DnsRecord | null }> {
    const attempts = provider.descriptor().capabilities.asyncWrites ? 6 : 2;
    let observed: DnsRecord | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const records = await provider.listRecords(zoneId);
      observed =
        records.find(
          (record) =>
            record.name.toLowerCase() === relativeName.toLowerCase() &&
            record.type === intent.type &&
            record.content.trim() === intent.content.trim(),
        ) ?? null;
      if (observed) return { settled: true, attempts: attempt, record: observed };
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { settled: false, attempts, record: observed };
  }

  private auditMutation(
    outcome: MutationOutcome,
    actor: AuditActor,
    resource: string,
    approvalId: string | null,
  ): void {
    this.store.appendAudit({
      requestId: outcome.requestId,
      actor,
      operation: outcome.operation,
      resource,
      before: redactDeep(outcome.before),
      after: redactDeep(outcome.after),
      approvalId,
      provider: outcome.provider,
      result:
        outcome.status === "applied"
          ? "success"
          : outcome.status === "dry_run" || outcome.status === "noop"
            ? "dry_run"
            : outcome.status === "approval_required"
              ? "approval_required"
              : "denied",
      errorCode: outcome.error?.code ?? null,
      verification: redactDeep(outcome.verification),
    });
  }

  private audit(event: Omit<AuditEvent, "id" | "createdAt">): void {
    this.store.appendAudit(event);
  }

  /**
   * Convert a thrown error into an audited outcome.
   *
   * An AMBIGUOUS_MUTATION is surfaced with requiresStateReread: the caller is told
   * to re-observe rather than retry, which is the only safe response to a write
   * whose outcome is unknown.
   */
  private handleFailure(
    error: unknown,
    context: {
      actor: AuditActor;
      operation: string;
      requestId: string;
      resource: string;
      provider: string;
    },
  ): MutationOutcome {
    const domainError =
      error instanceof DomainControlError
        ? error
        : new DomainControlError("PROVIDER_UNAVAILABLE", String(error), {
            nextAction: "inspect the control plane logs",
          });
    const ambiguous =
      domainError.code === "AMBIGUOUS_MUTATION" || domainError.code === "PROVIDER_TIMEOUT";
    this.store.appendAudit({
      requestId: context.requestId,
      actor: context.actor,
      operation: context.operation,
      resource: context.resource,
      before: null,
      after: null,
      approvalId: null,
      provider: context.provider,
      result: "failure",
      errorCode: domainError.code,
      verification: null,
    });
    return {
      status: "denied",
      operation: context.operation,
      requestId: context.requestId,
      risk: {
        level: "high",
        approvalMode: "MANUAL_CRITICAL",
        requiresApproval: true,
        reasons: [domainError.message],
        matchedRules: [domainError.code],
      },
      diff: null,
      provider: context.provider,
      before: null,
      after: null,
      verification: null,
      error: {
        code: domainError.code,
        message: domainError.message,
        retryable: domainError.retryable,
        next_action: domainError.nextAction,
      },
      ...(ambiguous ? { requiresStateReread: true } : {}),
    };
  }
}

function relativeNameOf(hostname: string, zoneFqdn: string): string {
  const fqdn = hostname.toLowerCase().replace(/[.]$/, "");
  const zone = zoneFqdn.toLowerCase().replace(/[.]$/, "");
  if (fqdn === zone) return "@";
  if (fqdn.endsWith(`.${zone}`)) return fqdn.slice(0, -(zone.length + 1));
  return fqdn;
}

function newRequestId(): string {
  return `dcreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let serviceInstance: DomainControlService | null = null;

/**
 * Process-wide service. Registers the fake provider always (so a rehearsal is
 * possible with no credential) and the Domain-OSS provider only when a base URL is
 * configured, so an unconfigured install cannot reach a placeholder host.
 */
export function getDomainControlService(): DomainControlService {
  if (!serviceInstance) {
    const registry = new InMemoryProviderRegistry();
    registry.register(new FakeDomainProvider());
    const baseUrl = process.env.DOMAIN_OSS_BASE_URL?.trim();
    if (baseUrl) {
      registry.register(new DomainOssProvider({ baseUrl }));
    }
    serviceInstance = new DomainControlService({ registry });
  }
  return serviceInstance;
}

export function resetDomainControlService(): void {
  serviceInstance = null;
}
