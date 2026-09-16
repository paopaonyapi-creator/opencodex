// Phase 20.41 — Recall engine (spec §10-§13): keyword, semantic and hybrid
// modes with Reciprocal Rank Fusion, explicit requested-vs-effective mode
// reporting, honest degradation, and trace persistence that can never mask
// a successful recall. Filters (project/kind/tag/authority/date) apply to
// every mode.

import { cosineSimilarity, reciprocalRankFusion, type EmbeddingProvider } from "./embeddings";
import { queryHashOf } from "./hashing";
import type {
  MemoryAuthority,
  MemoryKind,
  MemoryRecord,
  RecallRequest,
  RecallResponse,
  RecallResult,
  SearchMode,
} from "./types";
import type { MemoryOpsStore } from "./store-ops";

interface KeywordHit {
  memoryId: string;
  score: number;
}

/** Deterministic normalized term matching over title (×3 weight) and
 *  content. Repository-supported strategy: SQLite FTS5 availability varies
 *  across bun builds, so P0 uses transparent in-process scoring (spec §10.1
 *  explicitly permits a fallback strategy; documented in operations.md). */
export function keywordSearch(memories: MemoryRecord[], query: string, limit: number): KeywordHit[] {
  const terms = query.toLowerCase().split(/[^a-z0-9_-]+/).filter((term) => term.length > 1);
  if (terms.length === 0) return [];
  const uniqueTerms = [...new Set(terms)];
  const hits: KeywordHit[] = [];
  for (const memory of memories) {
    const title = memory.title.toLowerCase();
    const content = memory.content.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of uniqueTerms) {
      let termScore = 0;
      if (title.includes(term)) termScore += 3;
      const occurrences = content.split(term).length - 1;
      if (occurrences > 0) termScore += Math.min(3, occurrences);
      if (termScore > 0) matched += 1;
      score += termScore;
    }
    if (matched > 0 && score > 0) {
      hits.push({ memoryId: memory.id, score: score / (uniqueTerms.length * 6) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface RecallDependencies {
  store: MemoryOpsStore;
  embeddingProvider: EmbeddingProvider | null;
  maxResults: number;
  defaultWorkspaceId: string;
}

export interface RecallExecutionContext {
  actorAgentId: string | null;
}

export async function executeRecall(deps: RecallDependencies, request: RecallRequest, context: RecallExecutionContext): Promise<RecallResponse> {
  const startedAt = Date.now();
  const requestedMode: SearchMode = request.mode ?? "hybrid";
  const limit = Math.max(1, Math.min(request.limit ?? 8, deps.maxResults));
  const workspaceId = request.workspace ? deps.store.ensureWorkspace(request.workspace).id : deps.defaultWorkspaceId;
  const projectId = request.project ? deps.store.ensureProject(workspaceId, request.project)?.id ?? null : null;

  const candidates = deps.store
    .listMemories({
      workspaceId,
      projectId: projectId ?? undefined,
      kinds: request.kinds,
      authorities: request.authority,
      status: "active",
      createdAfter: request.createdAfter,
      createdBefore: request.createdBefore,
      limit: 2000,
    })
    .filter((memory) => !isSuperseded(deps.store, memory.id));

  const tagFiltered = request.tags && request.tags.length > 0
    ? candidates.filter((memory) => {
        const tags = deps.store.tagsForMemory(memory.id, memory.currentRevision).map((tag) => tag.toLowerCase());
        return request.tags!.some((tag) => tags.includes(tag.toLowerCase()));
      })
    : candidates;

  let effectiveMode: SearchMode = requestedMode;
  let degraded = false;
  let degradeReason: string | undefined;
  const providerInfo: RecallResponse["provider"] = {};

  const keywordHits = keywordSearch(tagFiltered, request.query, Math.max(limit * 3, 24));

  let semanticHits: Array<{ memoryId: string; score: number }> = [];
  if (requestedMode === "semantic" || requestedMode === "hybrid") {
    if (deps.embeddingProvider) {
      try {
        semanticHits = await semanticSearch(deps, tagFiltered, request.query, Math.max(limit * 3, 24));
        providerInfo.embeddingProvider = deps.embeddingProvider.id;
        providerInfo.embeddingModel = deps.embeddingProvider.model;
      } catch (error) {
        const category = "embedding_provider_failure";
        if (requestedMode === "semantic") {
          if (request.allowFallback === true) {
            effectiveMode = "keyword";
            degraded = true;
            degradeReason = category;
          } else {
            throw new SemanticUnavailableError(category, error instanceof Error ? error.message : String(error));
          }
        } else {
          effectiveMode = "keyword";
          degraded = true;
          degradeReason = category;
        }
      }
    } else {
      if (requestedMode === "semantic" && request.allowFallback !== true) {
        throw new SemanticUnavailableError("embedding_provider_unconfigured", "no embedding provider is configured");
      }
      effectiveMode = "keyword";
      degraded = true;
      degradeReason = "embedding_provider_unconfigured";
    }
  }

  // Rank fusion + provenance.
  const keywordRankById = new Map(keywordHits.map((hit, index) => [hit.memoryId, index + 1]));
  const semanticRankById = new Map(semanticHits.map((hit, index) => [hit.memoryId, index + 1]));
  let ordered: Array<{ memoryId: string; scores: RecallResult["scores"]; provenance: RecallResult["rankProvenance"] }>;

  if (requestedMode === "hybrid" && effectiveMode === "hybrid") {
    const fused = reciprocalRankFusion([keywordHits, semanticHits], 60);
    const fusedRank = [...fused.entries()].sort((a, b) => b[1] - a[1]);
    ordered = fusedRank.map(([memoryId, score], index) => ({
      memoryId,
      scores: {
        keyword: keywordHits.find((hit) => hit.memoryId === memoryId)?.score,
        semantic: semanticHits.find((hit) => hit.memoryId === memoryId)?.score,
        fused: score,
      },
      provenance: {
        keywordRank: keywordRankById.get(memoryId),
        semanticRank: semanticRankById.get(memoryId),
        fusedRank: index + 1,
      },
    }));
  } else if (effectiveMode === "semantic") {
    ordered = semanticHits.map((hit, index) => ({
      memoryId: hit.memoryId,
      scores: { semantic: hit.score },
      provenance: { semanticRank: index + 1 },
    }));
  } else {
    ordered = keywordHits.map((hit, index) => ({
      memoryId: hit.memoryId,
      scores: { keyword: hit.score },
      provenance: { keywordRank: index + 1 },
    }));
  }

  const byId = new Map(tagFiltered.map((memory) => [memory.id, memory]));
  const results: RecallResult[] = [];
  for (const entry of ordered.slice(0, limit)) {
    const memory = byId.get(entry.memoryId);
    if (!memory) continue;
    results.push({
      memoryId: memory.id,
      revision: memory.currentRevision,
      sourceHash: memory.currentHash,
      title: memory.title,
      content: request.includeContent === false ? undefined : memory.content,
      kind: memory.kind,
      authority: memory.authority,
      projectId: memory.projectId,
      tags: deps.store.tagsForMemory(memory.id, memory.currentRevision),
      rank: results.length + 1,
      scores: entry.scores,
      rankProvenance: entry.provenance,
    });
  }

  const response: RecallResponse = {
    requestedMode,
    effectiveMode,
    degraded,
    degradeReason,
    provider: providerInfo,
    results,
  };

  // Trace persistence is best-effort: failure never masks recall (§13, §19).
  if (request.trace !== false) {
    const traceId = deps.store.insertTrace({
      workspaceId,
      projectId,
      actorAgentId: context.actorAgentId,
      requestedMode,
      actualMode: effectiveMode,
      queryHash: queryHashOf(request.query),
      queryLength: request.query.length,
      provider: providerInfo.embeddingProvider ?? null,
      model: providerInfo.embeddingModel ?? null,
      degraded,
      degradeReason: degradeReason ?? null,
      resultCount: results.length,
      latencyMs: Date.now() - startedAt,
    });
    if (traceId) {
      deps.store.insertTraceResults(traceId, results.map((result) => ({
        memoryId: result.memoryId,
        memoryRevision: result.revision,
        sourceHash: result.sourceHash,
        rank: result.rank,
        keywordRank: result.rankProvenance.keywordRank ?? null,
        semanticRank: result.rankProvenance.semanticRank ?? null,
        keywordScore: result.scores.keyword ?? null,
        semanticScore: result.scores.semantic ?? null,
        fusedScore: result.scores.fused ?? null,
      })));
      response.traceId = traceId;
    }
  }

  return response;
}

async function semanticSearch(deps: RecallDependencies, memories: MemoryRecord[], query: string, limit: number): Promise<Array<{ memoryId: string; score: number }>> {
  const provider = deps.embeddingProvider;
  if (!provider) return [];
  const queryVector = (await provider.embedTexts([query]))[0];
  const scores: Array<{ memoryId: string; score: number }> = [];
  for (const memory of memories.slice(0, 400)) {
    const vectors = deps.store.listChunkVectors(memory.id, memory.currentRevision);
    let best: number | null = null;
    for (const chunk of vectors) {
      if (!chunk.vector || chunk.vector.length !== queryVector.length) continue;
      const similarity = cosineSimilarity(queryVector, chunk.vector);
      if (best === null || similarity > best) best = similarity;
    }
    if (best !== null && best > 0.01) {
      scores.push({ memoryId: memory.id, score: best });
    }
  }
  return scores.sort((a, b) => b.score - a.score).slice(0, limit);
}

function isSuperseded(store: MemoryOpsStore, memoryId: string): boolean {
  return store.supersededBy(memoryId).length > 0;
}

export class SemanticUnavailableError extends Error {
  readonly category: string;
  constructor(category: string, message: string) {
    super(`[SEMANTIC_UNAVAILABLE:${category}] ${message}`);
    this.name = "SemanticUnavailableError";
    this.category = category;
  }
}

export type { MemoryAuthority, MemoryKind };
