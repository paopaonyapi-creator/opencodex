/**
 * Pao Context Control Plane — retrieval engine (Phase 20.53 §18-21, §32-33,
 * §64, §74, §119).
 *
 * Pipeline: backend search -> Pao policy filter (scope/roots/classes/
 * sensitivity/suppression/freshness — every allow/deny carries a reason code)
 * -> budget packing -> injection plan -> persisted trace.
 *
 * Scope denials fail EARLY: a request outside its allowed roots is never
 * forwarded to OpenViking "to see if the backend would deny it".
 */

import { createHash } from "node:crypto";
import { nextId } from "./events";
import { parseVikingUri, underRoot } from "./namespace";
import type {
  ContextBudget,
  ContextInjectionPlan,
  ContextReasonCode,
  ContextRetrievalRequest,
  ContextRetrievalResponse,
  RetrievalHit,
} from "./types";
import type { ContextDbStore } from "./db-store";
import type { OpenVikingAdapter } from "./adapter/openviking";
import type { ContextBackendBreaker } from "./resilience";
import type { MemoryGovernanceRecord, SuppressionRule } from "./types";

// ---------------------------------------------------------------------------
// Freshness (spec §33)
// ---------------------------------------------------------------------------

export function freshnessStatus(
  refs: { lastVerifiedAt?: string; expiresAt?: string; updatedAt?: string },
  staleAfterSeconds: number,
  now: () => number = Date.now,
): "fresh" | "aging" | "stale" | "expired" | "unknown" {
  if (refs.expiresAt && Number.isFinite(Date.parse(refs.expiresAt)) && now() >= Date.parse(refs.expiresAt)) {
    return "expired";
  }
  const observed = refs.lastVerifiedAt ?? refs.updatedAt;
  if (!observed) return "unknown";
  const observedMs = Date.parse(observed);
  if (!Number.isFinite(observedMs)) return "unknown";
  const ageSec = (now() - observedMs) / 1000;
  if (ageSec < staleAfterSeconds / 2) return "fresh";
  if (ageSec < staleAfterSeconds) return "aging";
  return "stale";
}

// ---------------------------------------------------------------------------
// Suppression matching (spec §31)
// ---------------------------------------------------------------------------

export function matchesSuppression(
  hit: { uri: string; contentPreview?: string },
  governance: MemoryGovernanceRecord | undefined,
  rules: readonly SuppressionRule[],
): boolean {
  if (governance?.suppressed) return true;
  for (const rule of rules) {
    switch (rule.field) {
      case "uri":
        if (hit.uri === rule.pattern || hit.uri.startsWith(rule.pattern)) return true;
        break;
      case "content_pattern":
        // content_pattern rules use simple substring matching — no runtime
        // regex construction from stored data.
        if (hit.contentPreview?.includes(rule.pattern)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface RetrievalEngineDeps {
  readonly store: ContextDbStore;
  readonly adapter: OpenVikingAdapter;
  readonly breaker: ContextBackendBreaker;
  readonly staleAfterSeconds: number;
  readonly now?: () => number;
}

/** Rough deterministic token estimate: ~4 chars per token. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export class RetrievalEngine {
  private readonly store: ContextDbStore;
  private readonly adapter: OpenVikingAdapter;
  private readonly breaker: ContextBackendBreaker;
  private readonly staleAfterSeconds: number;
  private readonly now: () => number;

  constructor(deps: RetrievalEngineDeps) {
    this.store = deps.store;
    this.adapter = deps.adapter;
    this.breaker = deps.breaker;
    this.staleAfterSeconds = deps.staleAfterSeconds;
    this.now = deps.now ?? Date.now;
  }

  async retrieve(request: ContextRetrievalRequest): Promise<ContextRetrievalResponse> {
    const started = this.now();
    const runId = nextId("ctxr");
    const allowed: RetrievalHit[] = [];
    const rejected: RetrievalHit[] = [];

    const fail = (reason: ContextReasonCode): ContextRetrievalResponse => {
      const emptyPlan: ContextInjectionPlan = { planId: nextId("ctxp"), retrievalRunId: runId, items: [], totalEstimatedTokens: 0, truncated: false };
      this.recordRun(request, runId, "blocked", [], 0, 0, started, reason);
      void started;
      return { retrievalRunId: runId, status: "blocked", budget: { estimatedTokens: 0, maxEstimatedTokens: request.budget.maxEstimatedTokens }, items: [], truncated: false, degradedReason: reason, injectionPlan: emptyPlan };
    };

    // 1. Feature flag: retrieval can be disabled for rollback (§113).
    if (!this.breaker.canAttempt()) {
      return fail("CTX_BACKEND_UNAVAILABLE");
    }

    // 2. Early scope check — denied requests never reach the backend (§119).
    const sharedRoot = "viking://resources/";
    const userRootPrefix = `viking://user/${request.userId.toLowerCase()}/`;
    for (const root of request.allowedRoots) {
      const parsed = parseVikingUri(root);
      const userScoped = parsed.scope === "user";
      if (userScoped && !root.startsWith(userRootPrefix)) {
        this.auditDenied(request, root, "CTX_BLOCKED_SCOPE");
        return fail("CTX_BLOCKED_SCOPE");
      }
      if (!userScoped && !root.startsWith(sharedRoot) && parsed.scope !== "agent") {
        this.auditDenied(request, root, "CTX_BLOCKED_SCOPE");
        return fail("CTX_BLOCKED_SCOPE");
      }
    }

    // 3. Backend search (breaker-protected; unreachable -> degraded recall).
    let backendHits: Array<{ uri: string; score: number }>;
    try {
      const hits = await this.adapter.search({ query: request.query, roots: request.allowedRoots, maxResults: request.budget.maxResults * 2 });
      backendHits = hits.map(h => ({ uri: h.uri, score: h.score }));
      this.breaker.recordSuccess();
    } catch {
      this.breaker.recordFailure("unreachable");
      return fail("CTX_BACKEND_UNAVAILABLE");
    }

    // 4. Policy filter with reason codes.
    const suppressionRules = this.store.listSuppressionRules();
    let rank = 0;
    for (const backendHit of backendHits) {
      rank += 1;
      const uri = backendHit.uri;
      const inAllowedRoot = underRoot(uri, request.allowedRoots);
      const inDeniedRoot = request.deniedRoots?.some(r => uri.startsWith(r)) ?? false;
      const parsed = parseVikingUri(uri);

      let reasonCode: ContextReasonCode;
      if (!inAllowedRoot || inDeniedRoot) reasonCode = "CTX_BLOCKED_SCOPE";
      else if (parsed.scope === "user" && !request.allowedScopes.includes("user")) reasonCode = "CTX_BLOCKED_SCOPE";
      else if (parsed.scope === "user" && !uri.startsWith(userRootPrefix)) reasonCode = "CTX_BLOCKED_SCOPE";
      else {
        const governance = this.store.getMemoryGovernanceByUri(uri) ?? undefined;
        if (matchesSuppression({ uri }, governance, suppressionRules)) reasonCode = "CTX_BLOCKED_SUPPRESSED";
        else if (governance?.reviewState === "pending_review" || governance?.reviewState === "rejected") reasonCode = "CTX_BLOCKED_POLICY";
        else if (governance && freshnessStatus({ lastVerifiedAt: governance.lastVerifiedAt, expiresAt: governance.expiresAt }, this.staleAfterSeconds, this.now) === "expired") reasonCode = "CTX_BLOCKED_EXPIRED";
        else reasonCode = parsed.scope === "user" ? "CTX_ALLOWED_USER_MEMORY" : "CTX_ALLOWED_SHARED_RESOURCE";
      }

      if (reasonCode.startsWith("CTX_BLOCKED")) {
        rejected.push({ uri, contextClass: "project_knowledge", level: "L0", score: backendHit.score, rank, allowed: false, exclusionReason: reasonCode, estimatedTokens: 0, reason: reasonCode, chars: 0, trust: "low", freshnessStatus: "unknown" });
        continue;
      }

      // 5. Read the hit's content (defensive: missing content => skipped).
      let content = "";
      try {
        const doc = await this.adapter.read(uri);
        content = doc.content;
      } catch {
        rejected.push({ uri, contextClass: "project_knowledge", level: "L0", score: backendHit.score, rank, allowed: false, exclusionReason: "CTX_BLOCKED_POLICY", estimatedTokens: 0, reason: "CTX_BLOCKED_POLICY", chars: 0, trust: "low", freshnessStatus: "unknown" });
        continue;
      }

      allowed.push({
        uri,
        contextClass: "project_knowledge",
        level: "L0",
        score: backendHit.score,
        rank,
        allowed: true,
        estimatedTokens: estimateTokens(content.length),
        reason: reasonCode,
        chars: content.length,
        trust: "medium",
        freshnessStatus: "fresh",
      });
    }

    // 6. Budget packing.
    const packed = packBudget(allowed, request.budget);

    // 7. Injection plan.
    const plan = buildInjectionPlan(runId, packed.items, request.budget);

    // 8. Trace persistence.
    this.recordRun(request, runId, "ok", [...packed.items, ...rejected], plan.totalEstimatedTokens, packed.items.filter(i => i.level === "L2").length, started, undefined);

    return {
      retrievalRunId: runId,
      status: "ok",
      budget: { estimatedTokens: plan.totalEstimatedTokens, maxEstimatedTokens: request.budget.maxEstimatedTokens },
      items: [...packed.items, ...rejected],
      truncated: packed.truncated,
      injectionPlan: plan,
    };
  }

  private recordRun(
    request: ContextRetrievalRequest,
    runId: string,
    status: string,
    hits: readonly RetrievalHit[],
    estimatedTokens: number,
    l2Count: number,
    started: number,
    degradedReason?: ContextReasonCode,
  ): void {
    try {
      this.store.saveRetrievalRun({
        id: runId,
        requestId: request.requestId,
        userId: request.userId,
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        queryHash: createHash("sha256").update(request.query).digest("hex").slice(0, 24),
        queryPreview: request.query.slice(0, 120),
        budgetProfile: `${request.budget.maxEstimatedTokens}`,
        status,
        resultCount: hits.filter(h => h.allowed).length,
        l2Count,
        estimatedTokens,
        latencyMs: Math.max(0, this.now() - started),
        trace: { degradedReason, excluded: hits.filter(h => !h.allowed).map(h => ({ uri: h.uri, reason: h.exclusionReason })) },
      });
      this.store.saveRetrievalHits(
        runId,
        hits.map(h => ({ uri: h.uri, contextClass: h.contextClass, level: h.level, score: h.score, rank: h.rank, allowed: h.allowed, exclusionReason: h.exclusionReason, reasonCode: h.reason, estimatedTokens: h.estimatedTokens })),
      );
    } catch {
      // Trace failures never break retrieval.
    }
  }

  private auditDenied(request: ContextRetrievalRequest, root: string, reasonCode: ContextReasonCode): void {
    try {
      this.store.appendAudit({
        id: nextId("ctxa"),
        eventType: "context.retrieval.blocked",
        actorType: "agent",
        actorId: request.agentId,
        userId: request.userId,
        workspaceId: request.workspaceId,
        resourceUri: root,
        reasonCode,
        metadata: { requestId: request.requestId },
        correlationId: request.requestId,
        createdAt: new Date(this.now()).toISOString(),
      });
    } catch {
      // Best-effort audit.
    }
  }
}

// ---------------------------------------------------------------------------
// Budget packing + injection plan (spec §20-21)
// ---------------------------------------------------------------------------

export interface PackResult {
  readonly items: readonly RetrievalHit[];
  readonly truncated: boolean;
  readonly truncationReason?: string;
}

export function packBudget(hits: readonly RetrievalHit[], budget: ContextBudget): PackResult {
  const items: RetrievalHit[] = [];
  let totalTokens = 0;
  let l2Count = 0;
  let truncated = false;
  let truncationReason: string | undefined;

  for (const hit of hits) {
    if (items.length >= budget.maxResults) {
      truncated = true;
      truncationReason = "max_results reached";
      break;
    }
    if (totalTokens + hit.estimatedTokens > budget.maxEstimatedTokens) {
      truncated = true;
      truncationReason = "max_estimated_tokens would be exceeded";
      break;
    }
    if (hit.level === "L2") {
      if (l2Count >= budget.maxL2Documents) {
        truncated = true;
        truncationReason = "max_l2_documents reached";
        break;
      }
      l2Count += 1;
    }
    totalTokens += hit.estimatedTokens;
    items.push(hit);
  }
  return { items, truncated, truncationReason };
}

export function buildInjectionPlan(runId: string, hits: readonly RetrievalHit[], budget: ContextBudget): ContextInjectionPlan {
  return {
    planId: nextId("ctxp"),
    retrievalRunId: runId,
    items: hits.map(h => ({
      uri: h.uri,
      level: h.level,
      reason: h.reason,
      estimatedTokens: h.estimatedTokens,
      trust: h.trust,
      freshness: h.freshnessStatus === "fresh" || h.freshnessStatus === "aging" ? "fresh" : h.freshnessStatus === "unknown" ? "unknown" : "stale",
    })),
    totalEstimatedTokens: Math.min(
      hits.reduce((sum, h) => sum + h.estimatedTokens, 0),
      budget.maxEstimatedTokens,
    ),
    truncated: hits.reduce((sum, h) => sum + h.estimatedTokens, 0) > budget.maxEstimatedTokens,
    truncationReason: undefined,
  };
}
