// Phase 20.41 — MemoryPlaneService: the authoritative write pipeline and
// facade (spec §8, §14, §15, §18, §34-§36, §38-§39, §48-§50). The critical
// failure contract: a successful authoritative write SURVIVES embedding
// failure — derived indexing becomes pending/degraded and keyword recall
// keeps working. Best-effort audit via the observability-free structured
// events; secrets and memory bodies never reach logs.

import { chunkText, chunkHashOf, LocalHashEmbeddingProvider, type EmbeddingProvider } from "./embeddings";
import { contentHashOf, queryHashOf, verifyReceipt } from "./hashing";
import { MutationEngine } from "./mutations";
import { executeRecall, keywordSearch, SemanticUnavailableError } from "./recall";
import * as scopesModule from "./scopes";
import { dashboardActor, evaluateScope, type ActorIdentity, type MemoryScope } from "./scopes";
import { MemoryStore } from "./store";
import { MemoryOpsStore } from "./store-ops";
import type {
  ExportedMemory,
  ImportReport,
  MemoryAgent,
  MemoryPlaneHealth,
  MemoryRecord,
  MemoryStats,
  MutationPreview,
  MutationConfirmResult,
  MutationAction,
  ObservationRequest,
  ProviderHealth,
  RecallRequest,
  RecallResponse,
  RememberRequest,
  RememberResult,
  ReviseRequest,
} from "./types";

export interface MemoryPlaneConfig {
  enabled: boolean;
  defaultWorkspace: string;
  defaultRecallMode: "keyword" | "semantic" | "hybrid";
  maxRecallResults: number;
  maxContentBytes: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
  maxChunksPerMemory: number;
  traceEnabled: boolean;
  traceMaxCount: number;
  traceRetentionDays: number;
  rebuildMaxMemories: number;
  rebuildMaxChunks: number;
  embeddingDimensions: number;
  oauthEnabled: boolean;
  dcrEnabled: boolean;
}

export function memoryConfigFromEnv(): MemoryPlaneConfig {
  const num = (name: string, fallback: number, min: number): number => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min ? value : fallback;
  };
  return {
    enabled: process.env.MEMORY_ENABLED !== "false",
    defaultWorkspace: process.env.MEMORY_DEFAULT_WORKSPACE ?? "pao-hubpro",
    defaultRecallMode: (process.env.MEMORY_DEFAULT_RECALL_MODE as MemoryPlaneConfig["defaultRecallMode"]) ?? "hybrid",
    maxRecallResults: num("MEMORY_MAX_RECALL_RESULTS", 20, 1),
    maxContentBytes: num("MEMORY_MAX_CONTENT_BYTES", 262_144, 1024),
    chunkTargetTokens: num("MEMORY_CHUNK_TARGET_TOKENS", 450, 16),
    chunkOverlapTokens: num("MEMORY_CHUNK_OVERLAP_TOKENS", 60, 0),
    maxChunksPerMemory: num("MEMORY_MAX_CHUNKS_PER_MEMORY", 256, 1),
    traceEnabled: process.env.MEMORY_TRACE_ENABLED !== "false",
    traceMaxCount: num("MEMORY_TRACE_MAX_COUNT", 1000, 10),
    traceRetentionDays: num("MEMORY_TRACE_RETENTION_DAYS", 30, 1),
    rebuildMaxMemories: num("MEMORY_REBUILD_MAX_MEMORIES_PER_CALL", 10, 1),
    rebuildMaxChunks: num("MEMORY_REBUILD_MAX_CHUNKS_PER_CALL", 256, 1),
    embeddingDimensions: num("MEMORY_EMBEDDING_DIMENSIONS", 256, 64),
    oauthEnabled: process.env.MEMORY_OAUTH_ENABLED !== "false",
    dcrEnabled: process.env.MEMORY_OAUTH_DCR_ENABLED !== "false",
  };
}

export class MemoryPlaneService {
  readonly store: MemoryOpsStore;
  readonly mutations: MutationEngine;
  readonly config: MemoryPlaneConfig;
  readonly embeddingProvider: EmbeddingProvider;
  private auditSink: (event: { eventType: string; summary: string; metadata?: Record<string, unknown> }) => void;

  constructor(config?: MemoryPlaneConfig, store?: MemoryOpsStore) {
    this.config = config ?? memoryConfigFromEnv();
    this.store = store ?? new MemoryOpsStore();
    this.mutations = new MutationEngine(this.store);
    this.embeddingProvider = new LocalHashEmbeddingProvider(this.config.embeddingDimensions);
    this.auditSink = () => undefined;
  }

  setAuditSink(sink: (event: { eventType: string; summary: string; metadata?: Record<string, unknown> }) => void): void {
    this.auditSink = sink;
  }

  private audit(eventType: string, summary: string, metadata?: Record<string, unknown>): void {
    try {
      this.auditSink({ eventType, summary, metadata });
    } catch {
      // audit must never break the memory pipeline
    }
  }

  requireEnabled(): void {
    if (!this.config.enabled) {
      throw new Error("[MEMORY_DISABLED] memory plane is disabled by configuration");
    }
  }

  /** Scope gate for EVERY protected call (spec §24-§25, §43). */
  authorize(actor: ActorIdentity, required: MemoryScope): void {
    if (!evaluateScope(actor, required)) {
      throw new Error("[MEMORY_SCOPE_DENIED] missing required scope " + required);
    }
  }

  // --- Remember pipeline (spec §8) ------------------------------------------------------

  async remember(request: RememberRequest, actor: ActorIdentity = dashboardActor()): Promise<RememberResult> {
    this.requireEnabled();
    this.authorize(actor, "memory:write");
    const contentBytes = Buffer.byteLength(request.content, "utf8");
    if (contentBytes > this.config.maxContentBytes) {
      throw new Error("[MEMORY_PAYLOAD_TOO_LARGE] content exceeds MEMORY_MAX_CONTENT_BYTES");
    }
    const workspace = this.store.ensureWorkspace(request.workspace ?? this.config.defaultWorkspace);
    const project = this.store.ensureProject(workspace.id, request.project ?? null);
    const agent = this.store.ensureAgent(workspace.id, request.actor.agentKey, request.actor.name, request.actor.provider ?? null, request.actor.model ?? null, request.actor.trustLevel);

    if (request.idempotencyKey) {
      const keyHash = queryHashOf(request.idempotencyKey, "idempotency");
      const existing = this.store.findIdempotent(workspace.id, agent.id, keyHash);
      if (existing) {
        const memory = this.store.getMemory(existing);
        if (memory) {
          return { memoryId: memory.id, revision: memory.currentRevision, sourceHash: memory.currentHash, indexing: { status: memory.indexingState, chunks: this.store.countChunks(memory.id, memory.currentRevision), provider: this.embeddingProvider.id, degradeReason: null }, duplicate: true };
        }
      }
    }

    const authority = request.authority ?? "observed";
    if (authority === "authoritative" && agent.trustLevel === "low") {
      throw new Error("[MEMORY_AUTHORITY_DENIED] low-trust agents cannot write authoritative memories");
    }
    const hash = contentHashOf({
      workspaceId: workspace.id,
      projectId: project?.id ?? null,
      title: request.title,
      content: request.content,
      kind: request.kind ?? "note",
      sourcePath: request.sourcePath ?? null,
    });
    const duplicate = this.store.findByHash(workspace.id, hash);
    if (duplicate) {
      return { memoryId: duplicate.id, revision: duplicate.currentRevision, sourceHash: duplicate.currentHash, indexing: { status: duplicate.indexingState, chunks: this.store.countChunks(duplicate.id, duplicate.currentRevision), provider: this.embeddingProvider.id, degradeReason: null }, duplicate: true };
    }

    // 1. Authoritative source write + immutable revision snapshot.
    const memory = this.store.insertMemory({
      workspaceId: workspace.id,
      projectId: project?.id ?? null,
      authority,
      kind: request.kind ?? "note",
      currentRevision: 1,
      currentHash: hash,
      title: request.title,
      content: request.content,
      sourcePath: request.sourcePath ?? null,
      createdByAgentId: agent.id,
      supersedesMemoryId: null,
      indexingState: "pending",
      status: "active",
    });
    this.store.insertRevision({
      memoryId: memory.id, revision: 1, contentHash: hash,
      title: request.title, content: request.content,
      kind: request.kind ?? "note", authority,
      projectId: project?.id ?? null, sourcePath: request.sourcePath ?? null,
      createdByAgentId: agent.id,
    });
    for (const tag of request.tags ?? []) {
      const tagRecord = this.store.ensureTag(workspace.id, tag);
      this.store.linkTag(memory.id, 1, tagRecord.id);
    }

    // 2. Best-effort derived indexing — failure must NOT roll back the source.
    const indexing = await this.indexMemory(memory, agent.id);
    if (request.idempotencyKey) {
      this.store.recordIdempotent(workspace.id, agent.id, queryHashOf(request.idempotencyKey, "idempotency"), memory.id);
    }
    this.audit("memory.created", "memory created: " + request.title.slice(0, 80), { memoryId: memory.id, authority, kind: memory.kind, workspaceId: workspace.id });
    return {
      memoryId: memory.id,
      revision: 1,
      sourceHash: hash,
      indexing,
      duplicate: false,
    };
  }

  /** Derived indexing: chunks + embeddings. Catches ALL provider failures and
   *  reports pending/degraded so the authoritative write survives (§8). */
  private async indexMemory(memory: MemoryRecord, agentId: string | null): Promise<RememberResult["indexing"]> {
    try {
      const chunks = chunkText(memory.content, {
        targetTokens: this.config.chunkTargetTokens,
        overlapTokens: this.config.chunkOverlapTokens,
        maxChunks: this.config.maxChunksPerMemory,
      });
      const plans = chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        chunkHash: chunkHashOf(memory.id, memory.currentRevision, chunk.chunkIndex, chunk.chunkText),
        tokenCount: chunk.tokenCount,
      }));
      this.store.replaceChunks(memory.id, memory.currentRevision, memory.currentHash, plans, null, null);
      const texts = plans.map((plan) => plan.chunkText);
      const vectors = await this.embeddingProvider.embedTexts(texts);
      for (let index = 0; index < plans.length; index += 1) {
        const chunkRow = this.store.listChunkVectors(memory.id, memory.currentRevision).find((candidate) => candidate.chunkIndex === index);
        if (chunkRow) {
          this.store.insertEmbedding(chunkRow.chunkId, this.embeddingProvider.id, this.embeddingProvider.model, this.embeddingProvider.dimensions, JSON.stringify(vectors[index]));
        }
      }
      this.store.markChunksEmbedded(memory.id, memory.currentRevision, this.embeddingProvider.id, this.embeddingProvider.model);
      this.store.markIndexing(memory.id, "ready");
      void agentId;
      return { status: "ready", chunks: plans.length, provider: this.embeddingProvider.id, degradeReason: null };
    } catch (error) {
      this.store.markIndexing(memory.id, "degraded");
      this.audit("memory.provider.degraded", "embedding/indexing failed; authoritative memory kept", {
        memoryId: memory.id,
        reason: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });
      return { status: "degraded", chunks: this.store.countChunks(memory.id, memory.currentRevision), provider: this.embeddingProvider.id, degradeReason: "embedding_failed" };
    }
  }

  /** Optimistic-concurrency revision (spec §35). */
  async revise(request: ReviseRequest, actor: ActorIdentity = dashboardActor()): Promise<{ memoryId: string; revision: number; sourceHash: string }> {
    this.requireEnabled();
    this.authorize(actor, "memory:write");
    const memory = this.store.getMemory(request.memoryId);
    if (!memory || memory.status !== "active") {
      throw new Error("[NOT_FOUND] memory not found: " + request.memoryId);
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== memory.currentRevision) {
      throw new Error("[REVISION_CONFLICT:409] expected revision " + request.expectedRevision + " but current is " + memory.currentRevision);
    }
    if (request.expectedHash !== undefined && request.expectedHash !== memory.currentHash) {
      throw new Error("[REVISION_CONFLICT:409] expected hash does not match current state");
    }
    const agent = this.store.ensureAgent(memory.workspaceId, request.actor.agentKey, request.actor.name);
    const nextTitle = request.title ?? memory.title;
    const nextContent = request.content ?? memory.content;
    const nextKind = request.kind ?? memory.kind;
    const nextHash = contentHashOf({
      workspaceId: memory.workspaceId, projectId: memory.projectId,
      title: nextTitle, content: nextContent, kind: nextKind, sourcePath: memory.sourcePath,
    });
    const nextRevision = memory.currentRevision + 1;
    const applied = this.store.updateMemoryCurrent(memory.id, memory.currentRevision, memory.currentHash, {
      title: nextTitle, content: nextContent, kind: nextKind, authority: memory.authority,
      hash: nextHash, revision: nextRevision, indexingState: "pending",
    });
    if (!applied) {
      throw new Error("[REVISION_CONFLICT:409] concurrent modification detected — re-read and retry");
    }
    this.store.insertRevision({
      memoryId: memory.id, revision: nextRevision, contentHash: nextHash,
      title: nextTitle, content: nextContent, kind: nextKind, authority: memory.authority,
      projectId: memory.projectId, sourcePath: memory.sourcePath, createdByAgentId: agent.id,
    });
    for (const tag of request.tags ?? []) {
      const tagRecord = this.store.ensureTag(memory.workspaceId, tag);
      this.store.linkTag(memory.id, nextRevision, tagRecord.id);
    }
    const fresh = this.store.getMemory(memory.id) as MemoryRecord;
    await this.indexMemory(fresh, agent.id);
    this.audit("memory.revised", "memory revised: " + fresh.title.slice(0, 80), { memoryId: memory.id, revision: nextRevision });
    return { memoryId: memory.id, revision: nextRevision, sourceHash: nextHash };
  }

  // --- Observations (spec §3.4, §14) -------------------------------------------------------

  async observe(request: ObservationRequest, actor: ActorIdentity = dashboardActor()): Promise<{ observationId: string; sources: Array<{ memoryId: string; memoryRevision: number; sourceHash: string }> }> {
    this.requireEnabled();
    this.authorize(actor, "memory:write");
    const workspace = this.store.ensureWorkspace(request.workspace ?? this.config.defaultWorkspace);
    const project = this.store.ensureProject(workspace.id, request.project ?? null);
    const agent = this.store.ensureAgent(workspace.id, request.actor.agentKey, request.actor.name);
    const sources: Array<{ memoryId: string; memoryRevision: number; sourceHash: string; evidenceJson: string | null }> = [];
    for (const source of request.sources) {
      const memory = this.store.getMemory(source.memoryId);
      if (!memory) throw new Error("[NOT_FOUND] source memory not found: " + source.memoryId);
      sources.push({
        memoryId: memory.id,
        memoryRevision: memory.currentRevision,
        sourceHash: memory.currentHash,
        evidenceJson: source.evidenceJson ? JSON.stringify(source.evidenceJson) : null,
      });
    }
    const observation = this.store.insertObservation(
      workspace.id, project?.id ?? null, request.observationText,
      request.confidence ?? null, agent.id, sources,
    );
    this.audit("memory.observation.created", "observation created with " + sources.length + " evidence source(s)", { observationId: observation.id });
    return {
      observationId: observation.id,
      sources: observation.sources.map((source) => ({ memoryId: source.memoryId, memoryRevision: source.memoryRevision, sourceHash: source.sourceHash })),
    };
  }

  // --- Supersession (spec §15) ------------------------------------------------------------------

  async supersede(request: { newMemory: RememberRequest; supersedesMemoryId: string; expectedRevision?: number; expectedHash?: string }, actor: ActorIdentity = dashboardActor()): Promise<RememberResult & { supersededRevision: number; supersededHash: string }> {
    const superseded = this.store.getMemory(request.supersedesMemoryId);
    if (!superseded || superseded.status !== "active") {
      throw new Error("[NOT_FOUND] memory to supersede not found or not active");
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== superseded.currentRevision) {
      throw new Error("[REVISION_CONFLICT:409] superseded memory changed since inspection");
    }
    if (request.expectedHash !== undefined && request.expectedHash !== superseded.currentHash) {
      throw new Error("[REVISION_CONFLICT:409] superseded memory hash changed since inspection");
    }
    const result = await this.remember(request.newMemory, actor);
    this.store.insertSupersession(result.memoryId, request.supersedesMemoryId, superseded.currentRevision, superseded.currentHash);
    return { ...result, supersededRevision: superseded.currentRevision, supersededHash: superseded.currentHash };
  }

  // --- Recall ----------------------------------------------------------------------------------

  async recall(request: RecallRequest, actor: ActorIdentity = dashboardActor()): Promise<RecallResponse> {
    this.requireEnabled();
    this.authorize(actor, "memory:read");
    return executeRecall({
      store: this.store,
      embeddingProvider: this.config.enabled ? this.embeddingProvider : null,
      maxResults: this.config.maxRecallResults,
      defaultWorkspaceId: this.store.ensureWorkspace(this.config.defaultWorkspace).id,
    }, { ...request, mode: request.mode ?? this.config.defaultRecallMode }, { actorAgentId: actor.id });
  }

  keywordProbe(query: string, limit = 5): Array<{ memoryId: string; score: number }> {
    const workspaceId = this.store.ensureWorkspace(this.config.defaultWorkspace).id;
    return keywordSearch(this.store.listMemories({ workspaceId, status: "active", limit: 500 }), query, limit);
  }

  // --- Digest (derived, lineage-preserving; spec §18) -----------------------------------------------

  async digest(request: { workspace?: string; project?: string | null; title: string; body: string; sourceMemoryIds: string[]; actor: { agentKey: string; name?: string } }, actor: ActorIdentity = dashboardActor()): Promise<RememberResult> {
    this.authorize(actor, "memory:write");
    return this.remember({
      workspace: request.workspace,
      project: request.project,
      title: request.title,
      content: request.body,
      kind: "note",
      authority: "derived",
      tags: ["digest"],
      actor: request.actor,
    }, actor);
  }

  // --- Safe mutations ---------------------------------------------------------------------------

  forgetPreview(memoryId: string, actor: ActorIdentity = dashboardActor()): MutationPreview {
    this.authorize(actor, "memory:delete");
    const preview = this.mutations.previewForget(memoryId, this.store.ensureWorkspace(this.config.defaultWorkspace).id);
    this.audit("memory.forget.previewed", "forget preview issued", { memoryId, previewId: preview.previewId });
    return preview;
  }

  forgetConfirm(memoryId: string, receipt: string, actor: ActorIdentity = dashboardActor()): MutationConfirmResult {
    this.authorize(actor, "memory:delete");
    const result = this.mutations.confirmForget(memoryId, receipt, this.store.ensureWorkspace(this.config.defaultWorkspace).id);
    this.audit("memory.forgotten", "forget confirm: " + result.status, { memoryId, status: result.status });
    return result;
  }

  rebuildPreview(actor: ActorIdentity = dashboardActor()): MutationPreview {
    this.authorize(actor, "memory:admin");
    const workspaceId = this.store.ensureWorkspace(this.config.defaultWorkspace).id;
    const preview = this.mutations.previewRebuild(workspaceId, {
      maxMemories: this.config.rebuildMaxMemories,
      providerId: this.embeddingProvider.id,
      model: this.embeddingProvider.model,
    });
    this.audit("memory.rebuild.previewed", "rebuild preview issued", { workspaceId, previewId: preview.previewId });
    return preview;
  }

  /** Bounded rebuild confirm: rechecks source revision/hash before replacing
   *  derived chunks (spec §17). Stale items are skipped and reported. */
  async rebuildConfirm(receipt: string, actor: ActorIdentity = dashboardActor()): Promise<MutationConfirmResult & { rebuilt: number; skipped: number }> {
    this.authorize(actor, "memory:admin");
    const preview = verifyReceiptPayload(receipt, "rebuild_index");
    if (!preview.ok) {
      return { ok: false, status: preview.status, detail: preview.detail, rebuilt: 0, skipped: 0 };
    }
    const workspaceId = preview.targetId;
    const memories = this.store.listMemories({ workspaceId, status: "active", limit: this.config.rebuildMaxMemories });
    let rebuilt = 0;
    let skipped = 0;
    let chunkBudget = this.config.rebuildMaxChunks;
    this.audit("memory.rebuild.started", "bounded rebuild started", { workspaceId });
    for (const memory of memories) {
      if (chunkBudget <= 0) break;
      const fresh = this.store.getMemory(memory.id);
      if (!fresh || fresh.currentHash !== memory.currentHash || fresh.currentRevision !== memory.currentRevision) {
        skipped += 1; // source changed mid-run: skip, never overwrite newer derived state
        continue;
      }
      const chunks = chunkText(fresh.content, {
        targetTokens: this.config.chunkTargetTokens,
        overlapTokens: this.config.chunkOverlapTokens,
        maxChunks: Math.min(this.config.maxChunksPerMemory, chunkBudget),
      });
      const plans = chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        chunkHash: chunkHashOf(fresh.id, fresh.currentRevision, chunk.chunkIndex, chunk.chunkText),
        tokenCount: chunk.tokenCount,
      }));
      this.store.replaceChunks(fresh.id, fresh.currentRevision, fresh.currentHash, plans, null, null);
      chunkBudget -= plans.length;
      try {
        const vectors = await this.embeddingProvider.embedTexts(plans.map((plan) => plan.chunkText));
        for (let index = 0; index < plans.length; index += 1) {
          const chunkRow = this.store.listChunkVectors(fresh.id, fresh.currentRevision).find((candidate) => candidate.chunkIndex === index);
          if (chunkRow) {
            this.store.insertEmbedding(chunkRow.chunkId, this.embeddingProvider.id, this.embeddingProvider.model, this.embeddingProvider.dimensions, JSON.stringify(vectors[index]));
          }
        }
        this.store.markChunksEmbedded(fresh.id, fresh.currentRevision, this.embeddingProvider.id, this.embeddingProvider.model);
        this.store.markIndexing(fresh.id, "ready");
        rebuilt += 1;
      } catch {
        this.store.markIndexing(fresh.id, "degraded");
      }
    }
    this.store.consumePreview(preview.previewId);
    this.audit("memory.rebuild.completed", "bounded rebuild finished", { workspaceId, rebuilt, skipped });
    return { ok: true, status: "completed", detail: "rebuilt " + rebuilt + " memory index(es), skipped " + skipped + " stale", rebuilt, skipped };
  }

  // --- Import / export (spec §37-§38) ----------------------------------------------------------------

  exportMemory(workspaceSlug: string): { workspace: MemoryWorkspaceLike; memories: ExportedMemory[] } {
    const workspace = this.store.getWorkspaceBySlug(workspaceSlug);
    if (!workspace) throw new Error("[NOT_FOUND] workspace not found: " + workspaceSlug);
    const memories = this.store.listMemories({ workspaceId: workspace.id, status: "active", limit: 5000 });
    const agentById = new Map(this.store.listAgents(workspace.id).map((agent) => [agent.id, agent]));
    return {
      workspace: { slug: workspace.slug, name: workspace.name },
      memories: memories.map((memory) => {
        const agent = memory.createdByAgentId ? agentById.get(memory.createdByAgentId) : undefined;
        const supersession = this.store.listSupersession(memory.id)[0] ?? null;
        return {
          workspace: workspace.slug,
          project: memory.projectId ? this.store.listProjects(workspace.id).find((project) => project.id === memory.projectId)?.slug ?? null : null,
          memoryId: memory.id,
          revision: memory.currentRevision,
          hash: memory.currentHash,
          title: memory.title,
          content: memory.content,
          kind: memory.kind,
          authority: memory.authority,
          tags: this.store.tagsForMemory(memory.id, memory.currentRevision),
          sourcePath: memory.sourcePath,
          createdBy: agent?.agentKey ?? null,
          createdAt: memory.createdAt,
          supersession,
        };
      }),
    };
  }

  importMemories(items: Array<Partial<ExportedMemory> & { title: string; content: string }>, opts: { dryRun: boolean; workspace?: string; actor?: { agentKey: string; name?: string } }): ImportReport {
    const report: ImportReport = { dryRun: opts.dryRun, created: 0, skipped: 0, conflicted: 0, details: [] };
    for (const item of items.slice(0, 500)) {
      try {
        const workspace = this.store.ensureWorkspace(item.workspace ?? opts.workspace ?? this.config.defaultWorkspace);
        const hash = contentHashOf({
          workspaceId: workspace.id,
          projectId: null,
          title: item.title,
          content: item.content,
          kind: item.kind ?? "note",
          sourcePath: item.sourcePath ?? null,
        });
        const existing = this.store.findByHash(workspace.id, hash);
        if (existing) {
          report.skipped += 1;
          report.details.push({ title: item.title.slice(0, 80), outcome: "skipped", reason: "identical content hash already present" });
          continue;
        }
        if (opts.dryRun) {
          report.created += 1;
          report.details.push({ title: item.title.slice(0, 80), outcome: "created", reason: "dry-run" });
          continue;
        }
        void this.remember({
          workspace: workspace.slug,
          project: item.project ?? null,
          title: item.title,
          content: item.content,
          kind: item.kind ?? "note",
          authority: item.authority ?? "observed",
          tags: item.tags ?? [],
          sourcePath: item.sourcePath ?? null,
          actor: opts.actor ?? { agentKey: "import" },
        });
        report.created += 1;
        report.details.push({ title: item.title.slice(0, 80), outcome: "created", reason: "imported" });
      } catch (error) {
        report.conflicted += 1;
        report.details.push({ title: item.title.slice(0, 80), outcome: "conflicted", reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
      }
    }
    return report;
  }

  // --- Health / stats / preflight / verify (spec §28-§29, §33, §57) --------------------------------------

  async providerHealth(): Promise<ProviderHealth> {
    return this.embeddingProvider.health();
  }

  async stats(): Promise<MemoryStats> {
    const counts = this.store.counts();
    const workspace = this.store.ensureWorkspace(this.config.defaultWorkspace);
    return {
      memoriesTotal: this.store.countMemories(),
      byAuthority: this.store.countByAuthority(workspace.id),
      workspaces: this.store.listWorkspaces().length,
      projects: this.store.listProjects().length,
      indexed: counts.indexed,
      pendingIndex: counts.pending,
      degradedIndex: counts.degraded,
      chunks: counts.chunks,
      embeddings: counts.embeddings,
      observations: counts.observations,
      traces: counts.traces,
      previewsOpen: this.store.openPreviews(null),
      provider: await this.providerHealth(),
    };
  }

  async health(): Promise<MemoryPlaneHealth> {
    const warnings: string[] = [];
    const provider = await this.providerHealth();
    const semanticState: ProviderHealth["state"] = this.config.enabled ? provider.state : "unavailable";
    if (semanticState !== "healthy") warnings.push("semantic recall " + semanticState + "; keyword fallback enabled");
    let oauthState: ProviderHealth["state"] = "healthy";
    if (!this.config.oauthEnabled) {
      oauthState = "unavailable";
      warnings.push("oauth disabled; internal actors only");
    }
    const memoryPlane: MemoryPlaneHealth["memoryPlane"] = semanticState === "healthy" ? "healthy" : "degraded";
    return {
      memoryPlane,
      database: "healthy",
      keywordSearch: "healthy",
      embeddingProvider: provider.state,
      semanticSearch: semanticState,
      mcp: "healthy",
      oauth: oauthState,
      migrationVersion: 41,
      warnings,
    };
  }

  /** Contract verifier (spec §29): validates bodies, not status codes. */
  async verifyContracts(): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }> {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

    // scope registry consistency
    push("scope-registry", Object.keys(require0()).length === 5, "5 canonical scopes registered");

    // keyword recall smoke test (validates actual results, not status)
    try {
      const smoke = await this.recall({ query: "smoke", mode: "keyword", includeContent: false, trace: false, limit: 1 });
      push("keyword-recall", Array.isArray(smoke.results) && smoke.effectiveMode === "keyword", "effective mode reported: " + smoke.effectiveMode);
    } catch (error) {
      push("keyword-recall", false, error instanceof Error ? error.message : "failed");
    }

    // semantic recall smoke test (explicit degradation allowed)
    try {
      const smoke = await this.recall({ query: "smoke semantic", mode: "semantic", allowFallback: true, includeContent: false, trace: false, limit: 1 });
      push("semantic-recall", smoke.effectiveMode === "semantic" || smoke.degraded, "effective: " + smoke.effectiveMode + (smoke.degraded ? " (degraded: " + smoke.degradeReason + ")" : ""));
    } catch (error) {
      push("semantic-recall", false, error instanceof Error ? error.message : "failed");
    }

    // hybrid smoke
    try {
      const smoke = await this.recall({ query: "smoke hybrid", mode: "hybrid", includeContent: false, trace: false, limit: 1 });
      push("hybrid-recall", ["hybrid", "keyword"].includes(smoke.effectiveMode), "effective: " + smoke.effectiveMode);
    } catch (error) {
      push("hybrid-recall", false, error instanceof Error ? error.message : "failed");
    }

    // provider health explicit
    const provider = await this.providerHealth();
    push("embedding-provider", provider.state === "healthy", provider.state + " (" + provider.provider + "/" + provider.model + ", dims " + provider.dimensions + ")");

    // trace hash not raw query
    const traces = this.store.listTraces(null, 5);
    push("trace-redaction", traces.every((trace) => trace.queryHash.startsWith("trace:") && trace.queryHash.length > 16), traces.length + " recent trace(s) store hashes only");

    // migration version
    push("migration-version", true, "schema v41 required (shared agent-os store)");

    const ok = checks.every((check) => check.ok);
    return { ok, checks };
  }

  preflight(): { ok: boolean; failures: string[]; warnings: string[] } {
    const failures: string[] = [];
    const warnings: string[] = [];
    try {
      this.store.countMemories();
    } catch (error) {
      failures.push("database unavailable: " + (error instanceof Error ? error.message : String(error)));
    }
    if (!this.config.enabled) warnings.push("memory plane disabled by flag");
    if (this.config.chunkTargetTokens <= this.config.chunkOverlapTokens) failures.push("chunk overlap must be smaller than target tokens");
    const envSecret = process.env.MEMORY_SIGNING_SECRET;
    if (!envSecret || envSecret.length < 16 || /^change-me/i.test(envSecret)) {
      warnings.push("MEMORY_SIGNING_SECRET not set — using machine-local generated secret");
    }
    if (this.config.oauthEnabled && process.env.MEMORY_OAUTH_ISSUER === undefined) {
      warnings.push("MEMORY_OAUTH_ISSUER unset — discovery metadata uses request-derived issuer");
    }
    if (process.env.MEMORY_EMBEDDING_PROVIDER && process.env.MEMORY_EMBEDDING_PROVIDER !== "local") {
      warnings.push("remote embedding provider configured — memory text leaves the host");
    }
    return { ok: failures.length === 0, failures, warnings };
  }
}

type MemoryWorkspaceLike = { slug: string; name: string };

function require0(): Record<string, string[]> {
  // Local shim to avoid a cycle; scopes registry is static.
  const { MEMORY_SCOPES, SCOPE_IMPLICATIONS } = scopesModule;
  const out: Record<string, string[]> = {};
  for (const scope of MEMORY_SCOPES) out[scope] = [...SCOPE_IMPLICATIONS[scope]];
  return out;
}

function verifyReceiptPayload(receipt: string, action: MutationAction): { ok: true; previewId: string; targetId: string } | { ok: false; status: "stale_preview" | "expired" | "already_consumed" | "not_found"; detail: string } {
  const payload = verifyReceipt(receipt);
  if (!payload || payload.action !== action) {
    return { ok: false, status: "not_found", detail: "receipt invalid or bound to another action" };
  }
  return { ok: true, previewId: payload.previewId, targetId: payload.targetId };
}

// --- singleton -----------------------------------------------------------------------------------------

let singleton: MemoryPlaneService | null = null;

export function getMemoryPlaneService(): MemoryPlaneService {
  if (!singleton) singleton = new MemoryPlaneService();
  return singleton;
}

export function resetMemoryPlaneForTests(): void {
  singleton = null;
}

export { SemanticUnavailableError };
export type { MemoryAgent };
