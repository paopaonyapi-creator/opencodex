import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { openAgentOsDb } from "../db";
import { defaultAdapters } from "./adapters";
import { classifySource, primarySource } from "./classify";
import { acquisitionEnabled, acquisitionMockForced, acquisitionRoot } from "./flags";
import { decideAcquisitionPolicy } from "./policy";
import { buildPlan } from "./planner";
import type {
  AcquisitionAdapter,
  AcquisitionPlan,
  AcquisitionRequest,
  AdapterHealth,
  CapabilityDescriptor,
  JobState,
  PolicyDecision,
  SessionRef,
} from "./types";
import { AcquisitionError, redactAcquisitionText } from "./types";

function now(): string { return new Date().toISOString(); }
function newId(prefix: string): string { return prefix + randomUUID().replace(/-/g, "").slice(0, 12); }

export interface JobRecord {
  id: string;
  state: JobState;
  intent: string;
  sourceHost: string | null;
  adapter: string | null;
  policyDecision: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export class AcquisitionGateway {
  constructor(
    private readonly adapters: AcquisitionAdapter[] = defaultAdapters(),
    private readonly root = acquisitionRoot(),
  ) {
    mkdirSync(this.root, { recursive: true });
  }

  async health(): Promise<{ ok: boolean; phase: string; adapters: AdapterHealth[] }> {
    const adapters = [];
    for (const a of this.adapters) adapters.push(await a.probe());
    return { ok: acquisitionEnabled(), phase: "20.95", adapters };
  }

  async capabilities(): Promise<CapabilityDescriptor[]> {
    const out: CapabilityDescriptor[] = [];
    for (const a of this.adapters) out.push(...await a.capabilities());
    return out;
  }

  async doctor(): Promise<Record<string, unknown>> {
    const health = await this.health();
    mkdirSync(this.root, { recursive: true });
    return {
      ok: health.ok,
      adapters: health.adapters,
      outputWritable: existsSync(this.root),
      notes: [
        "OmniGet is a worker behind adapters; GPL source is not vendored.",
        "Set PAO_OMNIGET_MCP_URL when the local MCP bridge is running.",
        "Authenticated retrieval requires an opaque session ref, never cookies.",
        "Mock adapter is an honest fallback when OmniGet MCP/CLI are unconfigured.",
      ],
    };
  }

  async plan(req: AcquisitionRequest): Promise<{ plan: AcquisitionPlan; policy: PolicyDecision }> {
    if (!acquisitionEnabled()) throw new AcquisitionError("DISABLED", 403, "acquisition gateway disabled");
    let usable: AcquisitionAdapter[];
    if (acquisitionMockForced()) {
      usable = this.adapters.filter((a) => a.id === "mock");
    } else {
      const probed: AcquisitionAdapter[] = [];
      for (const a of this.adapters) {
        const h = await a.probe();
        if (h.status === "healthy" || a.id === "mock") probed.push(a);
      }
      usable = probed.filter((a) => a.id !== "mock" || probed.every((x) => x.id === "mock" || x.id === "legacy_20_24"));
    }
    const plan = buildPlan(req, usable.length ? usable : this.adapters.filter((a) => a.id === "mock"));
    const policy = decideAcquisitionPolicy(req, plan);
    return { plan, policy };
  }

  async submit(req: AcquisitionRequest, actor = "operator"): Promise<{ job: JobRecord; plan: AcquisitionPlan; policy: PolicyDecision }> {
    const { plan, policy } = await this.plan(req);
    const id = newId("acq");
    const ts = now();
    const state: JobState = policy.decision === "deny" ? "BLOCKED" : policy.decision === "require_approval" ? "WAITING_APPROVAL" : "QUEUED";
    openAgentOsDb().run(
      "INSERT INTO acq_jobs (id, workspace_id, project_id, request_id, actor_type, actor_id, intent, source_kind, source_value_json, source_host, selected_adapter, selected_capability, auth_class, policy_decision, state, attempt_count, error_class, error_message_redacted, created_at, updated_at, started_at, completed_at, request_json, plan_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, NULL, NULL, ?, ?)",
      [id, req.policyContext.workspaceId, req.policyContext.projectId ?? null, plan.requestId, req.actor.type, req.actor.id, req.intent, req.source.kind, JSON.stringify(req.source.value), plan.sourceHost ?? null, plan.selectedAdapter, plan.selectedCapability ?? null, plan.authClass, policy.decision, state, ts, ts, JSON.stringify(req), JSON.stringify(plan)],
    );
    this.event(id, state === "BLOCKED" ? "acquisition.policy.blocked" : state === "WAITING_APPROVAL" ? "acquisition.approval.required" : "acquisition.queued", actor, { policy, plan: { adapter: plan.selectedAdapter, host: plan.sourceHost } });
    if (state === "QUEUED") {
      await this.runJob(id, req, plan, actor);
    }
    return { job: this.requireJob(id), plan, policy };
  }

  async runJob(jobId: string, req: AcquisitionRequest, plan: AcquisitionPlan, actor: string): Promise<JobRecord> {
    const existing = this.requireJob(jobId);
    const attemptNo = Number((openAgentOsDb().query("SELECT attempt_count FROM acq_jobs WHERE id = ?").get(jobId) as { attempt_count: number } | undefined)?.attempt_count ?? 0) + 1;
    openAgentOsDb().run("UPDATE acq_jobs SET attempt_count = ?, started_at = COALESCE(started_at, ?) WHERE id = ?", [attemptNo, now(), jobId]);
    const attemptId = newId("att");
    openAgentOsDb().run(
      "INSERT INTO acq_attempts (id, job_id, attempt_no, adapter, external_job_ref, started_at, ended_at, status, error_class, diagnostics_json) VALUES (?, ?, ?, ?, NULL, ?, NULL, 'running', NULL, '{}')",
      [attemptId, jobId, attemptNo, plan.selectedAdapter, now()],
    );
    this.setState(jobId, "ACQUIRING");
    this.event(jobId, "acquisition.started", actor, { adapter: plan.selectedAdapter, attemptNo, previous: existing.state });
    const adapter = this.adapters.find((a) => a.id === plan.selectedAdapter) ?? this.adapters.find((a) => a.id === "mock")!;
    const outputRoot = join(this.root, jobId);
    mkdirSync(outputRoot, { recursive: true });
    try {
      const ref = await adapter.submit({ jobId, plan, request: req, outputRoot, sessionRef: req.authContext?.browserSessionRef });
      openAgentOsDb().run("UPDATE acq_attempts SET external_job_ref = ? WHERE id = ?", [ref.externalId, attemptId]);
      const status = await adapter.status(ref);
      if (status.state !== "completed") {
        openAgentOsDb().run("UPDATE acq_attempts SET ended_at = ?, status = 'failed', error_class = ? WHERE id = ?", [now(), status.errorClass ?? "UNKNOWN", attemptId]);
        this.fail(jobId, status.errorClass ?? "UNKNOWN", status.errorMessage ?? "adapter failed");
        return this.requireJob(jobId);
      }
      this.setState(jobId, "VERIFYING");
      this.intakeArtifacts(jobId, outputRoot, req, plan);
      if (plan.postProcessors.includes("knowledge_ingest")) {
        this.setState(jobId, "INGESTING");
        this.event(jobId, "artifact.knowledge_ingested", actor, { optIn: true, untrusted: true, trust: "untrusted_external_content" });
      }
      openAgentOsDb().run("UPDATE acq_attempts SET ended_at = ?, status = 'completed' WHERE id = ?", [now(), attemptId]);
      this.setState(jobId, "COMPLETED", { completedAt: now() });
      this.event(jobId, "acquisition.completed", actor, { adapter: adapter.id });
    } catch (err) {
      const message = redactAcquisitionText(err instanceof Error ? err.message : String(err));
      openAgentOsDb().run("UPDATE acq_attempts SET ended_at = ?, status = 'failed', error_class = 'UNKNOWN', diagnostics_json = ? WHERE id = ?", [now(), JSON.stringify({ message }), attemptId]);
      this.fail(jobId, "UNKNOWN", message);
    }
    return this.requireJob(jobId);
  }

  pause(jobId: string, actor = "operator"): JobRecord {
    this.setState(jobId, "PAUSED");
    this.event(jobId, "acquisition.paused", actor, {});
    return this.requireJob(jobId);
  }

  resume(jobId: string, actor = "operator"): JobRecord {
    this.setState(jobId, "QUEUED");
    this.event(jobId, "acquisition.resumed", actor, {});
    return this.requireJob(jobId);
  }

  cancel(jobId: string, actor = "operator"): JobRecord {
    this.setState(jobId, "CANCELLED", { completedAt: now() });
    this.event(jobId, "acquisition.cancelled", actor, {});
    return this.requireJob(jobId);
  }

  async retry(jobId: string, actor = "operator"): Promise<JobRecord> {
    const stored = this.loadStored(jobId);
    if (!stored) throw new AcquisitionError("JOB_NOT_FOUND", 409, "cannot retry without a stored request");
    this.setState(jobId, "QUEUED");
    this.event(jobId, "acquisition.retry_scheduled", actor, {});
    return this.runJob(jobId, stored.request, stored.plan, actor);
  }

  async decideApproval(jobId: string, approve: boolean, actor: string): Promise<JobRecord> {
    const job = this.requireJob(jobId);
    if (job.state !== "WAITING_APPROVAL") throw new AcquisitionError("JOB_NOT_FOUND", 409, "job is not waiting for approval");
    if (!approve) {
      this.setState(jobId, "BLOCKED");
      this.event(jobId, "acquisition.policy.blocked", actor, { deniedBy: actor });
      return this.requireJob(jobId);
    }
    const stored = this.loadStored(jobId);
    this.setState(jobId, "QUEUED");
    this.event(jobId, "acquisition.queued", actor, { approvedBy: actor });
    if (!stored) return this.requireJob(jobId);
    return this.runJob(jobId, stored.request, stored.plan, actor);
  }

  getJob(jobId: string): { job: JobRecord; events: Array<{ type: string; payload: unknown; createdAt: string }>; artifacts: Array<Record<string, unknown>> } {
    const job = this.requireJob(jobId);
    const events = openAgentOsDb().query("SELECT event_type, payload_json, created_at FROM acq_events WHERE job_id = ? ORDER BY created_at").all(jobId) as Array<{ event_type: string; payload_json: string; created_at: string }>;
    const artifacts = openAgentOsDb().query("SELECT * FROM acq_artifacts WHERE job_id = ?").all(jobId) as Array<Record<string, unknown>>;
    return {
      job,
      events: events.map((e) => ({ type: e.event_type, payload: JSON.parse(e.payload_json || "{}"), createdAt: e.created_at })),
      artifacts: artifacts.map((row) => ({
        id: row.id,
        type: row.artifact_type,
        relativePath: row.relative_path,
        sha256: row.sha256,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        commercialRights: row.commercial_rights,
        sourceHost: row.source_host,
        metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
      })),
    };
  }

  listJobs(limit = 50): JobRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM acq_jobs ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToJob);
  }

  listSessions(): SessionRef[] {
    const rows = openAgentOsDb().query("SELECT * FROM acq_session_refs ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      domainScope: JSON.parse(String(row.domain_scope_json || "[]")) as string[],
      ownerActorId: String(row.owner_actor_id),
      secretRef: String(row.external_secret_ref),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
      createdAt: String(row.created_at),
    }));
  }

  issueSession(input: { provider: string; domains: string[]; ownerActorId: string; secretRef: string; ttlMs?: number }): SessionRef {
    if (!input.secretRef.startsWith("secret://")) {
      throw new AcquisitionError("SECRET_IN_REQUEST", 400, "session refs must point at secret:// identifiers, never raw cookies");
    }
    const id = newId("sess");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? 30 * 60 * 1000)).toISOString();
    openAgentOsDb().run(
      "INSERT INTO acq_session_refs (id, provider, domain_scope_json, owner_actor_id, external_secret_ref, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
      [id, input.provider, JSON.stringify(input.domains), input.ownerActorId, input.secretRef, expiresAt, createdAt],
    );
    return { id, provider: input.provider, domainScope: input.domains, ownerActorId: input.ownerActorId, secretRef: input.secretRef, expiresAt, revokedAt: null, createdAt };
  }

  revokeSession(id: string): void {
    const row = openAgentOsDb().query("SELECT id FROM acq_session_refs WHERE id = ?").get(id) as { id: string } | undefined;
    if (!row) throw new AcquisitionError("SESSION_NOT_FOUND", 404, "session ref not found");
    openAgentOsDb().run("UPDATE acq_session_refs SET revoked_at = ? WHERE id = ?", [now(), id]);
  }

  private loadStored(jobId: string): { request: AcquisitionRequest; plan: AcquisitionPlan } | null {
    const row = openAgentOsDb().query("SELECT request_json, plan_json FROM acq_jobs WHERE id = ?").get(jobId) as { request_json?: string | null; plan_json?: string | null } | undefined;
    if (!row?.request_json || !row.plan_json) return null;
    return { request: JSON.parse(row.request_json) as AcquisitionRequest, plan: JSON.parse(row.plan_json) as AcquisitionPlan };
  }

  private intakeArtifacts(jobId: string, outputRoot: string, req: AcquisitionRequest, plan: AcquisitionPlan): void {
    const files = listFiles(outputRoot);
    const classified = classifySource(primarySource(req));
    for (const file of files) {
      const abs = resolveAcquisitionPath(outputRoot, file);
      const buf = readFileSync(abs);
      const sha256 = createHash("sha256").update(buf).digest("hex");
      const id = newId("art");
      openAgentOsDb().run(
        "INSERT INTO acq_artifacts (id, job_id, parent_artifact_id, artifact_type, relative_path, mime_type, size_bytes, sha256, source_url, source_host, source_id, authenticated, commercial_rights, metadata_json, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'unknown', ?, ?)",
        [id, jobId, typeOf(file), file.replace(/\\/g, "/"), mimeOf(file), buf.length, sha256, primarySource(req), classified.host, JSON.stringify({ trust: "untrusted_external_content", adapter: plan.selectedAdapter }), now()],
      );
      this.event(jobId, "artifact.acquired", "system", { artifactId: id, sha256, path: file, commercialRights: "unknown" });
    }
  }

  private fail(jobId: string, errorClass: string, message: string): void {
    openAgentOsDb().run("UPDATE acq_jobs SET state = 'FAILED', error_class = ?, error_message_redacted = ?, updated_at = ?, completed_at = ? WHERE id = ?", [errorClass, redactAcquisitionText(message), now(), now(), jobId]);
    this.event(jobId, "acquisition.failed", "system", { errorClass, message: redactAcquisitionText(message) });
  }

  private setState(jobId: string, state: JobState, extra?: { completedAt?: string }): void {
    const sets = ["state = ?", "updated_at = ?"];
    const args: Array<string | number | null> = [state, now()];
    if (extra?.completedAt) { sets.push("completed_at = ?"); args.push(extra.completedAt); }
    args.push(jobId);
    openAgentOsDb().run("UPDATE acq_jobs SET " + sets.join(", ") + " WHERE id = ?", args);
  }

  event(jobId: string, type: string, actor: string, payload: unknown): void {
    openAgentOsDb().run(
      "INSERT INTO acq_events (id, job_id, event_type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [newId("evt"), jobId, type, actor, redactAcquisitionText(JSON.stringify(payload ?? {})), now()],
    );
  }

  requireJob(id: string): JobRecord {
    const row = openAgentOsDb().query("SELECT * FROM acq_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AcquisitionError("JOB_NOT_FOUND", 404, "job not found: " + id);
    return rowToJob(row);
  }
}

function rowToJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    state: String(row.state) as JobState,
    intent: String(row.intent),
    sourceHost: row.source_host ? String(row.source_host) : null,
    adapter: row.selected_adapter ? String(row.selected_adapter) : null,
    policyDecision: row.policy_decision ? String(row.policy_decision) : null,
    errorClass: row.error_class ? String(row.error_class) : null,
    errorMessage: row.error_message_redacted ? String(row.error_message_redacted) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function listFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) return out;
  for (const name of readdirSync(root)) {
    const rel = prefix ? prefix + "/" + name : name;
    const full = join(root, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

function typeOf(file: string): string {
  if (file.endsWith(".md")) return file.includes("research") ? "research" : "transcript";
  if (file.endsWith(".vtt") || file.endsWith(".srt")) return "subtitle";
  if (file.endsWith(".json")) return "manifest";
  return "binary";
}

function mimeOf(file: string): string {
  if (file.endsWith(".md")) return "text/markdown";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
}

export function resolveAcquisitionPath(root: string, rel: string): string {
  if (rel.includes("..") || rel.includes("\0")) {
    throw new AcquisitionError("PATH_ESCAPE", 403, "path escapes acquisition root");
  }
  const abs = resolve(root, rel);
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.toLowerCase().startsWith(rootAbs.toLowerCase() + sep)) {
    throw new AcquisitionError("PATH_ESCAPE", 403, "path escapes acquisition root");
  }
  return abs;
}

let singleton: AcquisitionGateway | null = null;
export function getAcquisitionGateway(): AcquisitionGateway {
  if (!singleton) singleton = new AcquisitionGateway();
  return singleton;
}
export function resetAcquisitionGatewayForTests(): void {
  singleton = null;
}
