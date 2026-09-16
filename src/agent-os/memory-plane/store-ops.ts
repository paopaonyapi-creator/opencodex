// Phase 20.41 — MemoryStore derived + operational layer: chunks,
// embeddings, observations + lineage, search traces + results, mutation
// previews, OAuth clients/codes/tokens/consents. Everything here is
// rebuildable or operational; the authoritative corpus lives in ./store.

import { openAgentOsDb } from "../db";
import { MemoryStore } from "./store";
import type {
  MemoryObservation,
  MemoryWorkspace,
  MemoryProject,
  MemoryAgent,
  MutationPreview,
  ProviderHealth,
  SearchMode,
  TraceRecord,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export class MemoryOpsStore extends MemoryStore {
  // --- Chunks / embeddings (derived, rebuildable) ---------------------------------

  replaceChunks(memoryId: string, revision: number, sourceHash: string, chunks: Array<{ chunkIndex: number; chunkText: string; chunkHash: string; tokenCount: number }>, provider: string | null, model: string | null): number {
    this.db.query("DELETE FROM memory_embeddings WHERE chunk_id IN (SELECT id FROM memory_chunks WHERE memory_id = ? AND memory_revision = ?)").run(memoryId, revision);
    this.db.query("DELETE FROM memory_chunks WHERE memory_id = ? AND memory_revision = ?").run(memoryId, revision);
    for (const chunk of chunks) {
      this.db
        .query("INSERT INTO memory_chunks (id, memory_id, memory_revision, source_hash, chunk_index, chunk_text, chunk_hash, token_count, embedding_provider, embedding_model, embedding_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("mch"), memoryId, revision, sourceHash, chunk.chunkIndex, chunk.chunkText, chunk.chunkHash, chunk.tokenCount, provider, model, provider ? "1" : null, nowIso());
    }
    return chunks.length;
  }

  markChunksEmbedded(memoryId: string, revision: number, provider: string, model: string): void {
    this.db
      .query("UPDATE memory_chunks SET embedding_provider = ?, embedding_model = ?, embedding_version = ? WHERE memory_id = ? AND memory_revision = ?")
      .run(provider, model, "1", memoryId, revision);
  }

  countChunks(memoryId: string | null, revision: number | null): number {
    const row = memoryId && revision !== null
      ? (this.db.query("SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ? AND memory_revision = ?").get(memoryId, revision) as { n: number })
      : (this.db.query("SELECT COUNT(*) AS n FROM memory_chunks").get() as { n: number });
    return row.n;
  }

  insertEmbedding(chunkId: string, provider: string, model: string, dimensions: number, vectorBlob: string): void {
    const existing = this.db.query("SELECT id FROM memory_embeddings WHERE chunk_id = ? AND provider = ? AND model = ?").get(chunkId, provider, model) as Record<string, unknown> | null;
    if (existing) {
      this.db.query("UPDATE memory_embeddings SET vector_blob = ?, dimensions = ? WHERE id = ?").run(vectorBlob, dimensions, String(existing.id));
      return;
    }
    this.db
      .query("INSERT INTO memory_embeddings (id, chunk_id, provider, model, dimensions, vector_ref, vector_blob, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("mem_e"), chunkId, provider, model, dimensions, null, vectorBlob, nowIso());
  }

  listChunkVectors(memoryId: string, revision: number): Array<{ chunkId: string; chunkIndex: number; chunkText: string; vector: number[] | null; provider: string | null }> {
    const rows = this.db.query("SELECT memory_chunks.id, memory_chunks.chunk_index, memory_chunks.chunk_text, memory_chunks.embedding_provider, memory_embeddings.vector_blob FROM memory_chunks LEFT JOIN memory_embeddings ON memory_embeddings.chunk_id = memory_chunks.id WHERE memory_chunks.memory_id = ? AND memory_chunks.memory_revision = ?").all(memoryId, revision) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      chunkId: String(row.id),
      chunkIndex: Number(row.chunk_index),
      chunkText: String(row.chunk_text),
      provider: row.embedding_provider ? String(row.embedding_provider) : null,
      vector: row.vector_blob ? (JSON.parse(String(row.vector_blob)) as number[]) : null,
    }));
  }

  // --- Observations + evidence lineage ------------------------------------------------

  insertObservation(workspaceId: string, projectId: string | null, observationText: string, confidence: number | null, createdByAgentId: string | null, sources: Array<{ memoryId: string; memoryRevision: number; sourceHash: string; evidenceJson: string | null }>): MemoryObservation {
    const id = shortId("mob");
    const now = nowIso();
    this.db
      .query("INSERT INTO memory_observations (id, workspace_id, project_id, observation_text, confidence, created_by_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, workspaceId, projectId, observationText, confidence, createdByAgentId, "active", now, now);
    for (const source of sources) {
      const existing = this.db.query("SELECT observation_id FROM memory_observation_sources WHERE observation_id = ? AND memory_id = ? AND memory_revision = ?").get(id, source.memoryId, source.memoryRevision) as Record<string, unknown> | null;
      if (existing) continue;
      this.db
        .query("INSERT INTO memory_observation_sources (observation_id, memory_id, memory_revision, source_hash, evidence_json) VALUES (?, ?, ?, ?, ?)")
        .run(id, source.memoryId, source.memoryRevision, source.sourceHash, source.evidenceJson);
    }
    return this.getObservation(id);
  }

  getObservation(id: string): MemoryObservation {
    const row = this.db.query("SELECT * FROM memory_observations WHERE id = ?").get(id) as Record<string, unknown>;
    const sources = (this.db.query("SELECT * FROM memory_observation_sources WHERE observation_id = ?").all(id) as Array<Record<string, unknown>>).map((source) => ({
      memoryId: String(source.memory_id),
      memoryRevision: Number(source.memory_revision),
      sourceHash: String(source.source_hash),
      evidenceJson: source.evidence_json ? String(source.evidence_json) : null,
    }));
    return {
      id, workspaceId: String(row.workspace_id), projectId: row.project_id ? String(row.project_id) : null,
      observationText: String(row.observation_text),
      confidence: row.confidence == null ? null : Number(row.confidence),
      createdByAgentId: row.created_by_agent_id ? String(row.created_by_agent_id) : null,
      status: String(row.status) as MemoryObservation["status"],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), sources,
    };
  }

  listObservations(workspaceId: string, limit = 100): MemoryObservation[] {
    const rows = this.db.query("SELECT id FROM memory_observations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, limit) as Array<{ id: string }>;
    return rows.map((row) => this.getObservation(row.id));
  }

  // --- Traces (operational; query hash only, never raw query) -----------------------------

  insertTrace(trace: Omit<TraceRecord, "id" | "createdAt">): string | null {
    try {
      const id = shortId("mtr");
      this.db
        .query("INSERT INTO memory_search_traces (id, workspace_id, project_id, actor_agent_id, requested_mode, actual_mode, query_hash, query_length, provider, model, degraded, degrade_reason, result_count, latency_ms, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, trace.workspaceId, trace.projectId, trace.actorAgentId, trace.requestedMode, trace.actualMode, trace.queryHash, trace.queryLength, trace.provider, trace.model, trace.degraded ? 1 : 0, trace.degradeReason, trace.resultCount, trace.latencyMs, nowIso(), null);
      return id;
    } catch {
      // Trace persistence failure must never mask a successful recall (§13).
      return null;
    }
  }

  insertTraceResults(traceId: string, results: Array<{ memoryId: string; memoryRevision: number; sourceHash: string; rank: number; keywordRank: number | null; semanticRank: number | null; keywordScore: number | null; semanticScore: number | null; fusedScore: number | null }>): void {
    for (const result of results) {
      this.db
        .query("INSERT INTO memory_search_trace_results (id, trace_id, memory_id, memory_revision, source_hash, rank, keyword_rank, semantic_rank, keyword_score, semantic_score, fused_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("mtsr"), traceId, result.memoryId, result.memoryRevision, result.sourceHash, result.rank, result.keywordRank, result.semanticRank, result.keywordScore, result.semanticScore, result.fusedScore, nowIso());
    }
  }

  getTrace(traceId: string): { trace: TraceRecord; results: Array<{ memoryId: string; memoryRevision: number; sourceHash: string; rank: number; keywordRank: number | null; semanticRank: number | null; keywordScore: number | null; semanticScore: number | null; fusedScore: number | null }> } | null {
    const row = this.db.query("SELECT * FROM memory_search_traces WHERE id = ?").get(traceId) as Record<string, unknown> | null;
    if (!row) return null;
    const trace: TraceRecord = {
      id: String(row.id), workspaceId: String(row.workspace_id), projectId: row.project_id ? String(row.project_id) : null,
      actorAgentId: row.actor_agent_id ? String(row.actor_agent_id) : null,
      requestedMode: String(row.requested_mode) as SearchMode,
      actualMode: String(row.actual_mode) as SearchMode,
      queryHash: String(row.query_hash), queryLength: row.query_length == null ? null : Number(row.query_length),
      provider: row.provider ? String(row.provider) : null, model: row.model ? String(row.model) : null,
      degraded: Number(row.degraded ?? 0) === 1,
      degradeReason: row.degrade_reason ? String(row.degrade_reason) : null,
      resultCount: Number(row.result_count ?? 0),
      latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
      createdAt: String(row.created_at),
    };
    const results = (this.db.query("SELECT * FROM memory_search_trace_results WHERE trace_id = ? ORDER BY rank ASC").all(traceId) as Array<Record<string, unknown>>).map((item) => ({
      memoryId: String(item.memory_id), memoryRevision: Number(item.memory_revision), sourceHash: String(item.source_hash),
      rank: Number(item.rank),
      keywordRank: item.keyword_rank == null ? null : Number(item.keyword_rank),
      semanticRank: item.semantic_rank == null ? null : Number(item.semantic_rank),
      keywordScore: item.keyword_score == null ? null : Number(item.keyword_score),
      semanticScore: item.semantic_score == null ? null : Number(item.semantic_score),
      fusedScore: item.fused_score == null ? null : Number(item.fused_score),
    }));
    return { trace, results };
  }

  listTraces(workspaceId: string | null, limit = 50): TraceRecord[] {
    const rows = workspaceId
      ? (this.db.query("SELECT * FROM memory_search_traces WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, limit) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM memory_search_traces ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    return rows.map((row) => ({
      id: String(row.id), workspaceId: String(row.workspace_id), projectId: row.project_id ? String(row.project_id) : null,
      actorAgentId: row.actor_agent_id ? String(row.actor_agent_id) : null,
      requestedMode: String(row.requested_mode) as SearchMode,
      actualMode: String(row.actual_mode) as SearchMode,
      queryHash: String(row.query_hash), queryLength: row.query_length == null ? null : Number(row.query_length),
      provider: row.provider ? String(row.provider) : null, model: row.model ? String(row.model) : null,
      degraded: Number(row.degraded ?? 0) === 1,
      degradeReason: row.degrade_reason ? String(row.degrade_reason) : null,
      resultCount: Number(row.result_count ?? 0),
      latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
      createdAt: String(row.created_at),
    }));
  }

  retainTraces(nowMs: number, maxCount: number, retentionDays: number): number {
    const cutoff = new Date(nowMs - retentionDays * 86_400_000).toISOString();
    const byAge = this.db.query("DELETE FROM memory_search_trace_results WHERE trace_id IN (SELECT id FROM memory_search_traces WHERE created_at < ?)").run(cutoff).changes;
    this.db.query("DELETE FROM memory_search_traces WHERE created_at < ?").run(cutoff);
    const overage = this.db.query("SELECT id FROM memory_search_traces ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(maxCount) as Array<{ id: string }>;
    for (const row of overage) {
      this.db.query("DELETE FROM memory_search_trace_results WHERE trace_id = ?").run(row.id);
      this.db.query("DELETE FROM memory_search_traces WHERE id = ?").run(row.id);
    }
    return byAge;
  }

  // --- Mutation previews ------------------------------------------------------------------------

  insertPreview(workspaceId: string, preview: Omit<MutationPreview, "confirmationReceipt">): MutationPreview {
    this.db
      .query("INSERT INTO memory_mutation_previews (id, workspace_id, action, target_type, target_id, snapshot_hash, expected_revision, expected_source_hash, impact_json, actor_agent_id, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(preview.previewId, workspaceId, preview.action, preview.targetType, preview.targetId, "sha256:na", preview.expectedRevision, preview.expectedSourceHash, JSON.stringify(preview.impact), null, preview.expiresAt, null, preview.createdAt);
    return { ...preview, confirmationReceipt: "" };
  }

  getPreview(previewId: string): { preview: Omit<MutationPreview, "confirmationReceipt">; consumed: boolean; expired: boolean } | null {
    const row = this.db.query("SELECT * FROM memory_mutation_previews WHERE id = ?").get(previewId) as Record<string, unknown> | null;
    if (!row) return null;
    const consumed = row.consumed_at !== null;
    const expired = Date.parse(String(row.expires_at)) < Date.now();
    return {
      preview: {
        previewId: String(row.id),
        action: String(row.action) as MutationPreview["action"],
        targetType: String(row.target_type) as MutationPreview["targetType"],
        targetId: String(row.target_id),
        expectedRevision: row.expected_revision == null ? null : Number(row.expected_revision),
        expectedSourceHash: row.expected_source_hash ? String(row.expected_source_hash) : null,
        impact: JSON.parse(String(row.impact_json)) as Record<string, unknown>,
        expiresAt: String(row.expires_at),
        createdAt: String(row.created_at),
      },
      consumed,
      expired,
    };
  }

  consumePreview(previewId: string): boolean {
    const result = this.db.query("UPDATE memory_mutation_previews SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(nowIso(), previewId);
    return result.changes === 1;
  }

  openPreviews(workspaceId: string | null): number {
    const row = workspaceId
      ? (this.db.query("SELECT COUNT(*) AS n FROM memory_mutation_previews WHERE workspace_id = ? AND consumed_at IS NULL AND expires_at > ?").get(workspaceId, nowIso()) as { n: number })
      : (this.db.query("SELECT COUNT(*) AS n FROM memory_mutation_previews WHERE consumed_at IS NULL AND expires_at > ?").get(nowIso()) as { n: number });
    return row.n;
  }

  // --- OAuth clients / codes / tokens / consents -----------------------------------------------------

  upsertOAuthClient(input: { id: string; clientName: string; clientSecretHash: string | null; redirectUris: string[]; grantTypes: string[]; scope: string; tokenEndpointAuth: string }): void {
    const existing = this.db.query("SELECT id FROM memory_oauth_clients WHERE id = ?").get(input.id) as Record<string, unknown> | null;
    if (existing) {
      this.db
        .query("UPDATE memory_oauth_clients SET client_name = ?, client_secret_hash = ?, redirect_uris_json = ?, grant_types_json = ?, scope = ?, token_endpoint_auth = ?, updated_at = ? WHERE id = ?")
        .run(input.clientName, input.clientSecretHash, JSON.stringify(input.redirectUris), JSON.stringify(input.grantTypes), input.scope, input.tokenEndpointAuth, nowIso(), input.id);
      return;
    }
    this.db
      .query("INSERT INTO memory_oauth_clients (id, client_name, client_secret_hash, redirect_uris_json, grant_types_json, scope, token_endpoint_auth, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.clientName, input.clientSecretHash, JSON.stringify(input.redirectUris), JSON.stringify(input.grantTypes), input.scope, input.tokenEndpointAuth, "active", nowIso(), nowIso());
  }

  getOAuthClient(id: string): { id: string; clientName: string; clientSecretHash: string | null; redirectUris: string[]; grantTypes: string[]; scope: string; tokenEndpointAuth: string; status: string } | null {
    const row = this.db.query("SELECT * FROM memory_oauth_clients WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: String(row.id), clientName: String(row.client_name),
      clientSecretHash: row.client_secret_hash ? String(row.client_secret_hash) : null,
      redirectUris: JSON.parse(String(row.redirect_uris_json)) as string[],
      grantTypes: JSON.parse(String(row.grant_types_json)) as string[],
      scope: String(row.scope),
      tokenEndpointAuth: String(row.token_endpoint_auth),
      status: String(row.status),
    };
  }

  listOAuthClients(): Array<{ id: string; clientName: string; scope: string; status: string; createdAt: string; tokenEndpointAuth: string }> {
    return (this.db.query("SELECT * FROM memory_oauth_clients ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), clientName: String(row.client_name), scope: String(row.scope), status: String(row.status),
      createdAt: String(row.created_at), tokenEndpointAuth: String(row.token_endpoint_auth),
    }));
  }

  setClientStatus(id: string, status: "active" | "disabled" | "revoked"): boolean {
    const result = this.db.query("UPDATE memory_oauth_clients SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
    return result.changes === 1;
  }

  insertAuthorizationCode(input: { codeHash: string; clientId: string; redirectUri: string; scope: string; codeChallenge: string; expiresAt: string }): void {
    this.db
      .query("INSERT INTO memory_oauth_authorization_codes (id, code_hash, client_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("moc"), input.codeHash, input.clientId, input.redirectUri, input.scope, input.codeChallenge, "S256", input.expiresAt, null, nowIso());
  }

  takeAuthorizationCode(codeHash: string): { clientId: string; redirectUri: string; scope: string; codeChallenge: string; consumed: boolean; expired: boolean } | null {
    const row = this.db.query("SELECT * FROM memory_oauth_authorization_codes WHERE code_hash = ?").get(codeHash) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      clientId: String(row.client_id), redirectUri: String(row.redirect_uri), scope: String(row.scope),
      codeChallenge: String(row.code_challenge),
      consumed: row.consumed_at !== null,
      expired: Date.parse(String(row.expires_at)) < Date.now(),
    };
  }

  consumeAuthorizationCode(codeHash: string): void {
    this.db.query("UPDATE memory_oauth_authorization_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL").run(nowIso(), codeHash);
  }

  insertAccessToken(input: { tokenHash: string; clientId: string; scope: string; familyId: string; expiresAt: string }): void {
    this.db
      .query("INSERT INTO memory_oauth_access_tokens (id, token_hash, client_id, scope, family_id, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("moa"), input.tokenHash, input.clientId, input.scope, input.familyId, input.expiresAt, null, nowIso());
  }

  findAccessToken(tokenHash: string): { clientId: string; scope: string; familyId: string; expiresAt: string; revokedAt: string | null } | null {
    const row = this.db.query("SELECT * FROM memory_oauth_access_tokens WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | null;
    if (!row) return null;
    return { clientId: String(row.client_id), scope: String(row.scope), familyId: String(row.family_id), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null };
  }

  insertRefreshToken(input: { tokenHash: string; clientId: string; scope: string; familyId: string; expiresAt: string }): void {
    this.db
      .query("INSERT INTO memory_oauth_refresh_tokens (id, token_hash, client_id, scope, family_id, expires_at, rotated_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("mor"), input.tokenHash, input.clientId, input.scope, input.familyId, input.expiresAt, null, null, nowIso());
  }

  findRefreshToken(tokenHash: string): { id: string; clientId: string; scope: string; familyId: string; expiresAt: string; rotatedAt: string | null; revokedAt: string | null } | null {
    const row = this.db.query("SELECT * FROM memory_oauth_refresh_tokens WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | null;
    if (!row) return null;
    return { id: String(row.id), clientId: String(row.client_id), scope: String(row.scope), familyId: String(row.family_id), expiresAt: String(row.expires_at), rotatedAt: row.rotated_at ? String(row.rotated_at) : null, revokedAt: row.revoked_at ? String(row.revoked_at) : null };
  }

  markRefreshRotated(id: string): void {
    this.db.query("UPDATE memory_oauth_refresh_tokens SET rotated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  revokeTokenFamily(familyId: string): void {
    this.db.query("UPDATE memory_oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").run(nowIso(), familyId);
    this.db.query("UPDATE memory_oauth_access_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").run(nowIso(), familyId);
  }

  revokeClientTokens(clientId: string): void {
    const families = this.db.query("SELECT DISTINCT family_id FROM memory_oauth_refresh_tokens WHERE client_id = ?").all(clientId) as Array<{ family_id: string }>;
    for (const family of families) this.revokeTokenFamily(family.family_id);
  }

  upsertConsent(clientId: string, scope: string, decidedBy: string, status: "approved" | "denied" | "revoked"): void {
    const existing = this.db.query("SELECT id FROM memory_oauth_consents WHERE client_id = ? AND scope = ?").get(clientId, scope) as Record<string, unknown> | null;
    if (existing) {
      this.db.query("UPDATE memory_oauth_consents SET status = ?, decided_by = ?, updated_at = ? WHERE id = ?").run(status, decidedBy, nowIso(), String(existing.id));
      return;
    }
    this.db
      .query("INSERT INTO memory_oauth_consents (id, client_id, scope, decided_by, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("mocn"), clientId, scope, decidedBy, status, nowIso(), nowIso());
  }

  consentStatus(clientId: string, scope: string): string | null {
    const row = this.db.query("SELECT status FROM memory_oauth_consents WHERE client_id = ? AND scope = ?").get(clientId, scope) as { status: string } | null;
    return row ? row.status : null;
  }

  listConsents(): Array<{ clientId: string; scope: string; status: string; decidedBy: string; updatedAt: string }> {
    return (this.db.query("SELECT * FROM memory_oauth_consents ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
      clientId: String(row.client_id), scope: String(row.scope), status: String(row.status), decidedBy: String(row.decided_by), updatedAt: String(row.updated_at),
    }));
  }

  // --- counts / health ---------------------------------------------------------------------------

  counts(): { chunks: number; embeddings: number; observations: number; traces: number; indexed: number; pending: number; degraded: number } {
    const one = (sql: string): number => (this.db.query(sql).get() as { n: number }).n;
    return {
      chunks: one("SELECT COUNT(*) AS n FROM memory_chunks"),
      embeddings: one("SELECT COUNT(*) AS n FROM memory_embeddings"),
      observations: one("SELECT COUNT(*) AS n FROM memory_observations"),
      traces: one("SELECT COUNT(*) AS n FROM memory_search_traces"),
      indexed: one("SELECT COUNT(*) AS n FROM memory_items WHERE indexing_state = 'ready' AND status = 'active'"),
      pending: one("SELECT COUNT(*) AS n FROM memory_items WHERE indexing_state = 'pending' AND status = 'active'"),
      degraded: one("SELECT COUNT(*) AS n FROM memory_items WHERE indexing_state = 'degraded' AND status = 'active'"),
    };
  }

  providerHealthFromEmbedding(health: ProviderHealth): ProviderHealth {
    void this.db;
    return health;
  }
}

export type { MemoryWorkspace, MemoryProject, MemoryAgent };
