/**
 * Pao Context Control Plane — resource ingestion pipeline (Phase 20.53 §14-17).
 *
 * classify -> sanitize (deterministic secret scan) -> checksum ->
 * idempotency check -> submit to OpenViking -> wait for processing -> ready.
 *
 * Blocked sources never reach the backend. Ingestion is idempotent via stable
 * source identity (type + locator + target uri) plus content checksum.
 */

import { checksum, scanSource } from "./security/secret-scan";
import { isForbiddenTarget } from "./namespace";
import type { ContextClass, Sensitivity } from "./types";
import type { ContextDbStore, IngestJobRow, SourceRow } from "./db-store";
import type { OpenVikingAdapter } from "./adapter/openviking";
import { nextId } from "./events";

// ---------------------------------------------------------------------------
// Classification rules (spec §16)
// ---------------------------------------------------------------------------

interface ClassificationRule {
  readonly match: RegExp;
  readonly contextClass: ContextClass;
  readonly sensitivity: Sensitivity;
  readonly destinationPrefix: string;
  readonly action: "ingest" | "deny" | "require_review";
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    match: /docs\/phases\//i,
    contextClass: "phase_spec",
    sensitivity: "internal",
    destinationPrefix: "viking://resources/pao-hubpro/phases/",
    action: "ingest",
  },
  {
    match: /docs\/runbooks\//i,
    contextClass: "runbook",
    sensitivity: "internal",
    destinationPrefix: "viking://resources/pao-hubpro/docs/runbooks/",
    action: "ingest",
  },
  {
    match: /docs\/architecture\//i,
    contextClass: "architecture",
    sensitivity: "internal",
    destinationPrefix: "viking://resources/pao-hubpro/project/architecture/",
    action: "ingest",
  },
  {
    match: /(^|\/)SKILL\.md$/i,
    contextClass: "skill",
    sensitivity: "internal",
    destinationPrefix: "viking://agent/skills/",
    action: "require_review",
  },
  {
    match: /adr/i,
    contextClass: "decision_record",
    sensitivity: "internal",
    destinationPrefix: "viking://resources/pao-hubpro/docs/adr/",
    action: "ingest",
  },
];

export interface SourceClassification {
  readonly action: "ingest" | "deny" | "require_review";
  readonly contextClass: ContextClass;
  readonly sensitivity: Sensitivity;
  readonly targetUri: string;
  readonly reason: string;
}

/** Deterministic classification: first matching rule wins; default is project knowledge. */
export function classifySource(path: string): SourceClassification {
  for (const rule of CLASSIFICATION_RULES) {
    if (!rule.match.test(path)) continue;
    if (rule.action === "deny") {
      return { action: "deny", contextClass: "restricted_context", sensitivity: "restricted", targetUri: "", reason: "path denied by policy" };
    }
    const fileName = path.split("/").pop() ?? "document";
    return {
      action: rule.action,
      contextClass: rule.contextClass,
      sensitivity: rule.sensitivity,
      targetUri: `${rule.destinationPrefix}${fileName}`,
      reason: `matched ${rule.match.source}`,
    };
  }
  const fileName = path.split("/").pop() ?? "document";
  return {
    action: "ingest",
    contextClass: "project_knowledge",
    sensitivity: "internal",
    targetUri: `viking://resources/pao-hubpro/project/${fileName}`,
    reason: "default project knowledge rule",
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface IngestPipelineDeps {
  readonly store: ContextDbStore;
  readonly adapter: OpenVikingAdapter;
  readonly now?: () => Date;
}

export interface IngestRequest {
  readonly sourceType: string;
  readonly sourceLocator: string;
  readonly sourceRevision?: string;
  readonly path: string;
  readonly content: string;
  readonly workspaceId?: string;
  readonly ownerUserId?: string;
  /** Explicit overrides win over rule classification. */
  readonly targetUriOverride?: string;
  readonly sensitivityOverride?: Sensitivity;
  readonly isSkill?: boolean;
  readonly skillName?: string;
  readonly skillDescription?: string;
}

export interface IngestOutcome {
  readonly ok: boolean;
  readonly sourceId?: string;
  readonly jobId: string;
  readonly status: IngestJobRow["status"] | "duplicate_blocked" | "skipped_idempotent";
  readonly targetUri?: string;
  readonly reasonCode?: "CTX_BLOCKED_SECRET" | "CTX_BLOCKED_POLICY" | "CTX_BACKEND_UNAVAILABLE";
  readonly findings?: ReadonlyArray<{ code: string; detail: string }>;
  readonly message?: string;
}

export class ContextIngestPipeline {
  private readonly store: ContextDbStore;
  private readonly adapter: OpenVikingAdapter;
  private readonly now: () => Date;

  constructor(deps: IngestPipelineDeps) {
    this.store = deps.store;
    this.adapter = deps.adapter;
    this.now = deps.now ?? (() => new Date());
  }

  async ingest(request: IngestRequest): Promise<IngestOutcome> {
    const correlationId = `ctxing-${Date.now()}`;
    const classification = classifySource(request.path);
    const targetUri = request.targetUriOverride ?? classification.targetUri;
    const sensitivity = request.sensitivityOverride ?? classification.sensitivity;

    const jobId = nextId("ctxj");

    // 1. Forbidden targets (spec §8: no invented writable agent memories).
    if (targetUri === "" || isForbiddenTarget(targetUri)) {
      this.store.createJob({ id: jobId, sourceId: "", correlationId });
      this.store.updateJob(jobId, { status: "blocked", errorCode: "CTX_BLOCKED_POLICY", errorMessage: "target URI is forbidden by namespace policy" });
      return { ok: false, jobId, status: "duplicate_blocked", reasonCode: "CTX_BLOCKED_POLICY", message: "Target URI forbidden by namespace policy" };
    }

    // 2. Deterministic secret/sensitivity gate BEFORE anything else.
    const scan = scanSource(request.path, request.content);
    const sourceId = this.ensureSource(request, classification, sensitivity, targetUri);
    const contentChecksum = checksum(request.content);

    // Idempotency FIRST: an active job with the same source+checksum means
    // this content is already ingested or in flight.
    const existing = this.store.findActiveJobForChecksum(sourceId, contentChecksum);
    if (existing) {
      this.store.createJob({ id: jobId, sourceId, checksum: contentChecksum, correlationId });
      this.store.updateJob(jobId, { status: "cancelled", targetUri, errorMessage: "superseded by idempotency check" });
      return { ok: true, sourceId, jobId, status: "skipped_idempotent", targetUri, message: "Identical content already ingested or in flight" };
    }

    this.store.createJob({ id: jobId, sourceId, checksum: contentChecksum, correlationId });

    if (scan.blocked) {
      this.store.updateJob(jobId, { status: "blocked", errorCode: "CTX_BLOCKED_SECRET", errorMessage: "secret scan blocked the source" });
      this.audit(correlationId, "context.ingest.blocked", undefined, targetUri, "CTX_BLOCKED_SECRET", { path: request.path, findings: scan.findings.map(f => f.code) });
      return { ok: false, sourceId, jobId, status: "blocked", targetUri, reasonCode: "CTX_BLOCKED_SECRET", findings: scan.findings, message: "Secret scan blocked this source" };
    }
    if (classification.action === "deny") {
      this.store.updateJob(jobId, { status: "blocked", errorCode: "CTX_BLOCKED_POLICY", errorMessage: classification.reason });
      return { ok: false, sourceId, jobId, status: "blocked", targetUri, reasonCode: "CTX_BLOCKED_POLICY", message: classification.reason };
    }
    if (scan.requiresReview || classification.action === "require_review") {
      this.store.updateJob(jobId, { status: "blocked", errorCode: "CTX_BLOCKED_POLICY", errorMessage: "source requires review before ingestion" });
      return { ok: false, sourceId, jobId, status: "blocked", targetUri, reasonCode: "CTX_BLOCKED_POLICY", message: "Source requires review before ingestion", findings: scan.findings };
    }

    // 4. Submit.
    this.store.updateJob(jobId, { status: "submitted" });
    try {
      const handle = request.isSkill
        ? await this.adapter.addSkill({
            name: request.skillName ?? request.path,
            description: request.skillDescription ?? "",
            content: request.content,
            targetUri,
          })
        : await this.adapter.addResource({
            path: request.path,
            content: request.content,
            targetUri,
            metadata: { sourceType: request.sourceType, sourceLocator: request.sourceLocator, revision: request.sourceRevision ?? null, checksum: contentChecksum },
          });
      this.store.updateJob(jobId, { status: "processing", openVikingTaskId: handle.taskId, targetUri });

      // 5. Wait for processing (bounded).
      const result = await this.adapter.waitProcessed(handle);
      if (result.status === "ready") {
        this.store.updateJob(jobId, { status: "ready", openVikingTaskId: handle.taskId, targetUri });
        this.store.setSourceIngested(sourceId, contentChecksum);
        this.audit(correlationId, "context.ingest.completed", undefined, targetUri, undefined, { sourceId });
        return { ok: true, sourceId, jobId, status: "ready", targetUri };
      }
      if (result.status === "failed") {
        this.store.updateJob(jobId, { status: "failed", errorCode: "CTX_BACKEND_UNAVAILABLE", errorMessage: result.error });
        return { ok: false, sourceId, jobId, status: "failed", targetUri, reasonCode: "CTX_BACKEND_UNAVAILABLE", message: result.error };
      }
      return { ok: true, sourceId, jobId, status: "processing", targetUri, message: "Still processing; poll job status" };
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : "backend failure";
      this.store.updateJob(jobId, { status: "failed", errorCode: "CTX_BACKEND_UNAVAILABLE", errorMessage: message });
      return { ok: false, sourceId, jobId, status: "failed", targetUri, reasonCode: "CTX_BACKEND_UNAVAILABLE", message };
    }
  }

  private ensureSource(
    request: IngestRequest,
    classification: SourceClassification,
    sensitivity: Sensitivity,
    targetUri: string,
  ): string {
    const existing = this.store.findSourceByIdentity(request.sourceType, request.sourceLocator, targetUri);
    if (existing) return existing.id;
    const id = nextId("ctxsrc");
    this.store.upsertSource({
      id,
      sourceType: request.sourceType,
      sourceLocator: request.sourceLocator,
      sourceRevision: request.sourceRevision,
      contextClass: classification.contextClass,
      sensitivity,
      targetUri,
      workspaceId: request.workspaceId,
      ownerUserId: request.ownerUserId,
      metadata: { path: request.path },
    });
    return id;
  }

  private audit(correlationId: string, eventType: string, actor: { type: "system"; id: string } | undefined, resourceUri: string, reasonCode: string | undefined, metadata: Record<string, unknown>): void {
    try {
      this.store.appendAudit({
        id: nextId("ctxa"),
        eventType,
        actorType: "system",
        actorId: actor?.id ?? "context-ingest",
        resourceUri,
        reasonCode: reasonCode as never,
        metadata,
        correlationId,
        createdAt: this.now().toISOString(),
      });
    } catch {
      // Audit failures surface via health.
    }
  }
}
