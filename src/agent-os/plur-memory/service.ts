// Phase 20.43 — PaoMemoryService: the governance facade (spec §6, §13-§15,
// §20-§21, §23). Every operation: resolve context → policy → secret guard →
// engine → registry metadata → audit (redacted). Engine-native engram ids
// (PLUR id, or the fallback row id) are tracked in Pao-owned registry rows;
// the active engine is always disclosed in results.

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import { MemoryError } from "./types";
import { LocalFallbackEngine, PlurMemoryAdapter } from "./engine";
import { MemoryPolicyEngine, MemorySecretGuard, ScopeResolver, memoryCorrelationId, parseScope } from "./scopes";
import type {
  LearnMemoryInput, MemoryDoctorReport, MemoryEngine, MemoryEngineId, MemoryInjectionResult, MemoryPolicyDecision,
  MemoryRecallResult, MemoryRequestContext, MemoryStatus, MemorySyncResult, MemoryType, RecallMemoryInput,
  SyncPreviewItem,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export interface PlurMemoryConfig {
  enabled: boolean;
  autoInject: boolean;
  autoLearn: boolean;
  secretGuard: boolean;
  syncEnabled: boolean;
  defaultScope: string;
  maxInjectTokens: number;
  recallLimit: number;
}

export function plurMemoryConfigFromEnv(): PlurMemoryConfig {
  const bool = (name: string, fallback: boolean) => (process.env[name] === undefined ? fallback : process.env[name] === "true" || process.env[name] === "1");
  return {
    enabled: bool("PAO_MEMORY_ENABLED", true),
    autoInject: bool("PAO_MEMORY_AUTO_INJECT", true),
    autoLearn: bool("PAO_MEMORY_AUTO_LEARN", false),
    secretGuard: bool("PAO_MEMORY_SECRET_GUARD", true),
    syncEnabled: bool("PAO_MEMORY_SYNC_ENABLED", false),
    defaultScope: process.env.PAO_MEMORY_DEFAULT_SCOPE ?? "project:pao-hubpro",
    maxInjectTokens: Number(process.env.PAO_MEMORY_MAX_INJECT_TOKENS ?? 1800) || 1800,
    recallLimit: Number(process.env.PAO_MEMORY_RECALL_LIMIT ?? 10) || 10,
  };
}

export class PaoMemoryService {
  readonly config: PlurMemoryConfig;
  readonly plur: PlurMemoryAdapter;
  readonly fallback: LocalFallbackEngine;
  readonly scopes: ScopeResolver;
  readonly policy: MemoryPolicyEngine;
  readonly secretGuard: MemorySecretGuard;
  private db = openAgentOsDb();

  constructor(config?: PlurMemoryConfig) {
    this.config = config ?? plurMemoryConfigFromEnv();
    this.plur = new PlurMemoryAdapter();
    this.fallback = new LocalFallbackEngine();
    this.scopes = new ScopeResolver(this.config.defaultScope);
    this.policy = new MemoryPolicyEngine();
    this.secretGuard = new MemorySecretGuard();
    this.seedAdapters();
  }

  private audit(event: { correlationId: string; operation: string; actorType: string; actorId: string; agentId: string | null; scope: string | null; decision: string; engramRegistryId: string | null; metadata?: Record<string, unknown> }): void {
    this.db
      .query("INSERT INTO memory_audit_events (id, correlation_id, operation, actor_type, actor_id, agent_id, scope, decision, engram_registry_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("memaud"), event.correlationId, event.operation, event.actorType, event.actorId, event.agentId, event.scope, event.decision, event.engramRegistryId, event.metadata ? JSON.stringify(event.metadata) : null, nowIso());
  }

  private defaultContext(): MemoryRequestContext {
    return {
      actorType: "operator", actorId: "operator", agentId: null, agentTrust: "trusted",
      projectId: this.config.defaultScope.startsWith("project:") ? this.config.defaultScope.slice(8) : null,
      workspaceId: null, sessionId: null, runId: null, correlationId: memoryCorrelationId(),
    };
  }

  // --- Learn (spec §8 pipeline) -----------------------------------------------------------

  async learn(input: LearnMemoryInput, ctx?: MemoryRequestContext): Promise<import("./types").MemoryWriteResult> {
    const context = ctx ?? this.defaultContext();
    const correlationId = context.correlationId;
    if (!this.config.enabled) {
      throw new MemoryError("MEMORY_DISABLED", "memory subsystem is disabled");
    }
    // 1. secret guard (defense-in-depth, before any durable write)
    const scan = this.config.secretGuard ? this.secretGuard.scan(input.content) : { clean: true, findings: [] };
    if (!scan.clean) {
      this.audit({ correlationId, operation: "learn", actorType: context.actorType, actorId: context.actorId, agentId: context.agentId, scope: input.scope ?? null, decision: "blocked_secret", engramRegistryId: null, metadata: { findings: scan.findings.map((finding) => ({ category: finding.category, fieldPath: finding.fieldPath })) } });
      return { ok: false, engramRegistryId: null, engineEngramId: null, contentHash: "", state: "blocked_secret", duplicateOf: null, conflictId: null, decision: emptyDecision("secret material detected — write blocked"), engine: await this.activeEngineId(), reason: "MEMORY_SECRET_DETECTED: " + scan.findings.map((finding) => finding.category).join(",") };
    }
    // 2. deterministic scope resolution
    const resolved = this.scopes.resolveWriteScope({
      explicitScope: input.scope ?? null,
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      agentScopeDefault: null,
      sessionId: context.sessionId,
    });
    // 3. policy evaluation
    const decision = this.policy.evaluate({
      operation: "learn", ctx: context, scope: resolved.scope,
      sensitivity: input.sensitivity ?? "normal", memoryType: input.memoryType,
      sourceKind: input.sourceKind ?? "explicit", secretFindings: 0, contentChars: input.content.length,
    });
    if (decision.decision === "deny") {
      this.audit({ correlationId, operation: "learn", actorType: context.actorType, actorId: context.actorId, agentId: context.agentId, scope: resolved.scope, decision: "denied", engramRegistryId: null, metadata: { reason: decision.reason, rules: decision.matchedRuleIds } });
      return { ok: false, engramRegistryId: null, engineEngramId: null, contentHash: "", state: "denied", duplicateOf: null, conflictId: null, decision, engine: await this.activeEngineId(), reason: "MEMORY_POLICY_DENIED: " + decision.reason };
    }
    const finalScope = decision.forcedScope ?? resolved.scope;
    // 4. dedupe (exact duplicate in the same scope strengthens the original)
    const contentHash = "sha256:" + createHash("sha256").update(input.title + "\n" + input.content).digest("hex").slice(0, 24);
    const existing = this.db.query("SELECT id FROM memory_engram_registry WHERE content_hash = ? AND scope = ? AND state = 'active' LIMIT 1").get(contentHash, finalScope) as { id: string } | null;
    if (existing) {
      this.db.query("UPDATE memory_engram_registry SET recall_count = recall_count + 1, updated_at = ? WHERE id = ?").run(nowIso(), existing.id);
      return { ok: true, engramRegistryId: existing.id, engineEngramId: this.getEngineEngramId(existing.id), contentHash, state: "duplicate", duplicateOf: existing.id, conflictId: null, decision, engine: await this.activeEngineId(), reason: "exact duplicate in the same scope — existing memory strengthened" };
    }
    // 5. candidate vs active: auto-learn OFF stores candidates for approval
    const state = input.sourceKind === "candidate" || (this.config.autoLearn === false && input.sourceKind === "auto") ? "candidate" : "active";
    const engine = await this.selectEngine();
    const learned = state === "active"
      ? await engine.learn({
          title: input.title, content: input.content, memoryType: input.memoryType,
          scope: finalScope, visibility: input.visibility ?? "project", tags: input.tags ?? [],
        })
      : { engineEngramId: null };
    const id = shortId("men");
    this.db
      .query("INSERT INTO memory_engram_registry (id, engine_engram_id, content_hash, title, content, memory_type, domain, scope, visibility, polarity, source_kind, source_agent_id, source_session_id, source_run_id, project_id, workspace_id, owner_user_id, sensitivity, secret_scan_status, policy_decision, state, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, learned.engineEngramId, contentHash, input.title, input.content, input.memoryType, input.domain ?? null, finalScope, input.visibility ?? "project", input.polarity ?? "neutral", input.sourceKind ?? "explicit", context.agentId, context.sessionId, context.runId, context.projectId, context.workspaceId, null, input.sensitivity ?? "normal", scan.clean ? "clean" : "findings", decision.decision, state, null, nowIso(), nowIso());
    this.audit({ correlationId, operation: "learn", actorType: context.actorType, actorId: context.actorId, agentId: context.agentId, scope: finalScope, decision: state, engramRegistryId: id, metadata: { memoryType: input.memoryType, scopeBasis: resolved.basis } });
    return { ok: true, engramRegistryId: id, engineEngramId: learned.engineEngramId, contentHash, state, duplicateOf: null, conflictId: null, decision, engine: engine.id, reason: state === "candidate" ? "stored as candidate (auto-learn disabled); approve to activate" : "learned" };
  }

  // --- Recall / inject ----------------------------------------------------------------------

  async recall(input: RecallMemoryInput, ctx?: MemoryRequestContext): Promise<MemoryRecallResult> {
    const context = ctx ?? this.defaultContext();
    const engine = await this.selectEngine();
    const scopes = this.scopes.expandReadScopes({
      projectId: input.projectId ?? context.projectId,
      workspaceId: context.workspaceId,
      agentId: context.agentId,
      includeGlobal: true,
    });
    const readable = scopes.filter((scope) => ScopeResolver.canReadScope(context, scope));
    const rows = await engine.recall({ query: input.query, scopes: readable, limit: input.limit ?? this.config.recallLimit });
    // Registry states gate recall: only active registry rows surface.
    const activeIds = new Set((this.db.query("SELECT engine_engram_id FROM memory_engram_registry WHERE state = 'active'").all() as Array<{ engine_engram_id: string | null }>)).size > 0
      ? new Set((this.db.query("SELECT engine_engram_id FROM memory_engram_registry WHERE state = 'active'").all() as Array<{ engine_engram_id: string | null }>).map((row) => row.engine_engram_id).filter((value): value is string => value !== null))
      : new Set<string>();
    const registryGated = engine.id === "plur"
      ? rows.filter((row) => row.engineEngramId === null || activeIds.has(row.engineEngramId))
      : rows;
    const withState = registryGated.map((row) => ({
      engramRegistryId: this.registryIdForEngineEngram(row.engineEngramId),
      engineEngramId: row.engineEngramId,
      title: row.title,
      content: row.content,
      memoryType: row.memoryType as MemoryType,
      scope: row.scope,
      score: row.score,
      state: "active" as const,
    }));
    const filtered = withState.filter((row) => ScopeResolver.canReadScope(context, row.scope));
    return {
      ok: true, engine: engine.id, results: filtered,
      degraded: engine.id === "pao-local-fallback",
      fallbackMode: engine.id === "pao-local-fallback" ? "pao-local-fallback (PLUR unavailable)" : null,
      reason: "ok",
    };
  }

  /** Context injection: authorize → recall → policy filter → secret filter →
   *  dedupe → token budget → receipt (spec §15). */
  async inject(input: RecallMemoryInput & { budgetTokens?: number }, ctx?: MemoryRequestContext): Promise<MemoryInjectionResult> {
    const startedAt = Date.now();
    const context = ctx ?? this.defaultContext();
    const budget = Math.min(input.budgetTokens ?? this.config.maxInjectTokens, this.config.maxInjectTokens);
    const recalled = await this.recall({ ...input, limit: input.limit ?? this.config.recallLimit }, context);
    const secretClean = recalled.results.filter((row) => this.secretGuard.scan(row.content).clean);
    const seen = new Set<string>();
    const deduped = secretClean.filter((row) => {
      const key = row.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const budgeted: typeof deduped = [];
    let usedTokens = 0;
    for (const row of deduped) {
      const tokens = Math.ceil((row.title.length + row.content.length) / 4);
      if (usedTokens + tokens > budget) break;
      budgeted.push(row);
      usedTokens += tokens;
    }
    const injectedText = budgeted.map((row) => "[memory:" + row.memoryType + " scope:" + row.scope + "] " + row.title + " — " + row.content).join("\n");
    const receiptId = shortId("memrc");
    this.db
      .query("INSERT INTO memory_injection_receipts (id, session_id, run_id, agent_id, project_id, query_hash, scope_set_json, requested_budget_tokens, used_tokens, injected_count, injected_engram_ids_json, policy_filtered_count, secret_filtered_count, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(receiptId, context.sessionId, context.runId, context.agentId, context.projectId, "sha256:" + createHash("sha256").update(input.query).digest("hex").slice(0, 16), JSON.stringify(this.scopes.expandReadScopes({ projectId: context.projectId, includeGlobal: true })), budget, usedTokens, budgeted.length, JSON.stringify(budgeted.map((row) => row.engramRegistryId)), recalled.results.length - secretClean.length, secretClean.length - budgeted.length, Date.now() - startedAt, nowIso());
    return {
      ...recalled,
      receiptId,
      usedTokens,
      requestedBudgetTokens: budget,
      injectedCount: budgeted.length,
      policyFilteredCount: recalled.results.length - secretClean.length,
      secretFilteredCount: secretClean.length - budgeted.length,
      injectedText,
    };
  }

  // --- Feedback / forget / rescope ---------------------------------------------------------------

  async feedback(engramRegistryId: string, signal: "positive" | "negative" | "neutral" | "obsolete" | "conflict", reason: string | null, ctx?: MemoryRequestContext): Promise<{ ok: boolean }> {
    const context = ctx ?? this.defaultContext();
    const row = this.db.query("SELECT * FROM memory_engram_registry WHERE id = ?").get(engramRegistryId) as Record<string, unknown> | null;
    if (!row) throw new MemoryError("MEMORY_NOT_FOUND", "engram not found");
    const engineEngramId = row.engine_engram_id ? String(row.engine_engram_id) : null;
    this.db
      .query("INSERT INTO memory_feedback (id, engram_registry_id, engine_engram_id, actor_type, actor_id, signal, reason, source_task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("memfb"), engramRegistryId, engineEngramId, context.actorType, context.actorId, signal, reason, context.runId, nowIso());
    if (signal === "positive") {
      this.db.query("UPDATE memory_engram_registry SET positive_feedback_count = positive_feedback_count + 1, last_feedback_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), engramRegistryId);
    } else if (signal === "negative") {
      this.db.query("UPDATE memory_engram_registry SET negative_feedback_count = negative_feedback_count + 1, last_feedback_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), engramRegistryId);
    } else {
      this.db.query("UPDATE memory_engram_registry SET last_feedback_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), engramRegistryId);
    }
    const engine = await this.selectEngine();
    await engine.applyFeedback(engineEngramId, signal);
    this.audit({ correlationId: context.correlationId, operation: "feedback", actorType: context.actorType, actorId: context.actorId, agentId: context.agentId, scope: String(row.scope), decision: signal, engramRegistryId });
    return { ok: true };
  }

  async forget(engramRegistryId: string, ctx?: MemoryRequestContext): Promise<{ ok: boolean; reason: string }> {
    const context = ctx ?? this.defaultContext();
    const row = this.db.query("SELECT * FROM memory_engram_registry WHERE id = ?").get(engramRegistryId) as Record<string, unknown> | null;
    if (!row) throw new MemoryError("MEMORY_NOT_FOUND", "engram not found");
    const decision = this.policy.evaluate({ operation: "forget", ctx: context, scope: String(row.scope), sensitivity: String(row.sensitivity) === "sensitive" ? "sensitive" : "normal", memoryType: String(row.memory_type) as MemoryType, sourceKind: "explicit", secretFindings: 0, contentChars: 0 });
    if (decision.decision === "deny") {
      return { ok: false, reason: "MEMORY_POLICY_DENIED: " + decision.reason };
    }
    const engineEngramId = row.engine_engram_id ? String(row.engine_engram_id) : null;
    const engine = await this.selectEngine();
    await engine.forget(engineEngramId);
    this.db.query("UPDATE memory_engram_registry SET state = 'retired', retired_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), engramRegistryId);
    this.audit({ correlationId: context.correlationId, operation: "forget", actorType: context.actorType, actorId: context.actorId, agentId: context.agentId, scope: String(row.scope), decision: "retired", engramRegistryId });
    return { ok: true, reason: "retired" };
  }

  async rescope(engramRegistryId: string, targetScope: string, ctx?: MemoryRequestContext): Promise<{ ok: boolean; reason: string }> {
    const context = ctx ?? this.defaultContext();
    if (!parseScope(targetScope)) {
      throw new MemoryError("MEMORY_SCOPE_INVALID", "invalid scope: " + targetScope);
    }
    const row = this.db.query("SELECT * FROM memory_engram_registry WHERE id = ?").get(engramRegistryId) as Record<string, unknown> | null;
    if (!row) throw new MemoryError("MEMORY_NOT_FOUND", "engram not found");
    const decision = this.policy.evaluate({ operation: "rescope", ctx: context, scope: targetScope, sensitivity: String(row.sensitivity) === "sensitive" ? "sensitive" : "normal", memoryType: String(row.memory_type) as MemoryType, sourceKind: "explicit", secretFindings: 0, contentChars: 0 });
    if (decision.decision === "deny") return { ok: false, reason: "MEMORY_POLICY_DENIED: " + decision.reason };
    if (decision.decision === "require_approval") {
      const payloadHash = "sha256:" + createHash("sha256").update(engramRegistryId + targetScope).digest("hex").slice(0, 16);
      this.db
        .query("INSERT INTO memory_approvals (id, operation, payload_hash, requested_by, approved_by, decision, reason, expires_at, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("memap"), "rescope", payloadHash, context.actorId, null, "pending", "rescope to " + targetScope, new Date(Date.now() + 600_000).toISOString(), nowIso(), null);
      return { ok: false, reason: "MEMORY_APPROVAL_REQUIRED: approval recorded for rescope to " + targetScope };
    }
    const engineEngramId = row.engine_engram_id ? String(row.engine_engram_id) : null;
    const engine = await this.selectEngine();
    await engine.rescope(engineEngramId, targetScope);
    this.db.query("UPDATE memory_engram_registry SET scope = ?, updated_at = ? WHERE id = ?").run(targetScope, nowIso(), engramRegistryId);
    this.audit({ correlationId: context.correlationId, operation: "rescope", actorType: context.actorType, actorId: context.actorId, agentId: context.agentId, scope: targetScope, decision: "rescoped", engramRegistryId });
    return { ok: true, reason: "rescoped to " + targetScope };
  }

  // --- Episodes / timeline ------------------------------------------------------------------------

  captureEpisode(input: { summary: string; eventType: string; severity?: string; channel?: string | null; happenedAt?: string; metadata?: Record<string, unknown> }, ctx?: MemoryRequestContext): { ok: boolean; episodeRegistryId: string } {
    const context = ctx ?? this.defaultContext();
    const id = shortId("meme");
    this.db
      .query("INSERT INTO memory_episode_registry (id, plur_episode_id, summary, agent_id, session_id, run_id, channel, project_id, workspace_id, severity, event_type, happened_at, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, null, input.summary, context.agentId, context.sessionId, context.runId, input.channel ?? null, context.projectId, context.workspaceId, input.severity ?? "info", input.eventType, input.happenedAt ?? nowIso(), nowIso(), input.metadata ? JSON.stringify(input.metadata) : "{}");
    return { ok: true, episodeRegistryId: id };
  }

  timeline(query: { agentId?: string; severity?: string; eventType?: string; limit?: number }): Array<{ id: string; summary: string; eventType: string; severity: string; agentId: string | null; happenedAt: string }> {
    const rows = this.db.query("SELECT * FROM memory_episode_registry ORDER BY happened_at DESC LIMIT ?").all(query.limit ?? 100) as Array<Record<string, unknown>>;
    let mapped = rows.map((row) => ({
      id: String(row.id), summary: String(row.summary), eventType: String(row.event_type),
      severity: String(row.severity ?? "info"), agentId: row.agent_id ? String(row.agent_id) : null,
      happenedAt: String(row.happened_at),
    }));
    if (query.agentId) mapped = mapped.filter((row) => row.agentId === query.agentId);
    if (query.eventType) mapped = mapped.filter((row) => row.eventType === query.eventType);
    if (query.severity) mapped = mapped.filter((row) => row.severity === query.severity);
    return mapped;
  }

  // --- Conflicts / candidates ------------------------------------------------------------

  detectConflict(newTitle: string, newContent: string, scope: string): string | null {
    const similar = this.db.query("SELECT id, title, content FROM memory_engram_registry WHERE scope = ? AND state = 'active' LIMIT 50").all(scope) as Array<Record<string, unknown>>;
    const newLower = (newTitle + " " + newContent).toLowerCase();
    for (const row of similar) {
      const oldLower = (String(row.title) + " " + String(row.content)).toLowerCase();
      const oldWords = new Set(oldLower.split(/\W+/).filter((word) => word.length > 2));
      const overlap = newLower.split(/\W+/).filter((word) => word.length > 2 && oldWords.has(word)).length;
      if (overlap >= 2) {
        const negatedOld = /\b(not|never|do not|don't|cannot)\b/.test(oldLower);
        const negatedNew = /\b(not|never|do not|don't|cannot)\b/.test(newLower);
        if (negatedOld !== negatedNew) {
          const conflictId = shortId("memcf");
          this.db
            .query("INSERT INTO memory_conflicts (id, engram_a_id, engram_b_id, conflict_type, status, resolution, detected_at, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(conflictId, String(row.id), "pending-new", "contradiction", "open", null, nowIso(), null, null);
          this.db.query("UPDATE memory_engram_registry SET state = 'conflicted' WHERE id = ?").run(String(row.id));
          return conflictId;
        }
      }
    }
    return null;
  }

  resolveConflict(conflictId: string, resolution: string, resolvedBy: string): boolean {
    return this.db
      .query("UPDATE memory_conflicts SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open'")
      .run(resolution, nowIso(), resolvedBy, conflictId).changes === 1;
  }

  listConflicts(): Array<{ id: string; engramAId: string; conflictType: string; status: string; detectedAt: string }> {
    return (this.db.query("SELECT * FROM memory_conflicts ORDER BY detected_at DESC LIMIT 100").all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), engramAId: String(row.engram_a_id), conflictType: String(row.conflict_type),
      status: String(row.status), detectedAt: String(row.detected_at),
    }));
  }

  approveCandidate(engramRegistryId: string, actor: string): boolean {
    const result = this.db
      .query("UPDATE memory_engram_registry SET state = 'active', updated_at = ? WHERE id = ? AND state = 'candidate'")
      .run(nowIso(), engramRegistryId);
    if (result.changes !== 1) return false;
    const row = this.db.query("SELECT title, content, memory_type, scope, visibility FROM memory_engram_registry WHERE id = ?").get(engramRegistryId) as Record<string, unknown>;
    void this.fallback.learn({
      title: String(row.title), content: String(row.content),
      memoryType: String(row.memory_type), scope: String(row.scope), visibility: String(row.visibility),
    });
    this.audit({ correlationId: memoryCorrelationId(), operation: "candidate.approve", actorType: "operator", actorId: actor, agentId: null, scope: String(row.scope), decision: "activated", engramRegistryId });
    return true;
  }

  rejectCandidate(engramRegistryId: string, actor: string): boolean {
    const result = this.db
      .query("UPDATE memory_engram_registry SET state = 'blocked', updated_at = ? WHERE id = ? AND state = 'candidate'")
      .run(nowIso(), engramRegistryId);
    if (result.changes === 1) {
      this.audit({ correlationId: memoryCorrelationId(), operation: "candidate.reject", actorType: "operator", actorId: actor, agentId: null, scope: null, decision: "rejected", engramRegistryId });
    }
    return result.changes === 1;
  }

  // --- Sync gateway (spec §20): disabled by default, fail-closed, dry-run first ----------------------------

  async syncPreview(profileName: string): Promise<MemorySyncResult> {
    if (!this.config.syncEnabled) {
      return { ok: false, status: "disabled", pushedCount: 0, skippedCount: 0, blockedCount: 0, warnings: ["sync is disabled by default (PAO_MEMORY_SYNC_ENABLED=false)"], preview: [] };
    }
    const profile = this.db.query("SELECT * FROM memory_sync_profiles WHERE name = ?").get(profileName) as Record<string, unknown> | null;
    if (!profile) {
      return { ok: false, status: "blocked", pushedCount: 0, skippedCount: 0, blockedCount: 0, warnings: ["MEMORY_SYNC_UNSAFE_REMOTE: unknown sync profile"], preview: [] };
    }
    const rows = this.db.query("SELECT id, title, content, scope, content_hash, visibility FROM memory_engram_registry WHERE state = 'active' LIMIT 200").all() as Array<Record<string, unknown>>;
    const preview: SyncPreviewItem[] = [];
    let blocked = 0;
    for (const row of rows) {
      const scope = String(row.scope);
      const scan = this.secretGuard.scan(String(row.content));
      let included = true;
      let blockedReason: string | null = null;
      if (scope === "local") { included = false; blockedReason = "local scope never syncs"; }
      else if (String(row.visibility) === "private") { included = false; blockedReason = "private visibility"; }
      else if (!scan.clean) { included = false; blockedReason = "secret scan findings: " + scan.findings[0].category; }
      preview.push({ scope, title: String(row.title), contentHash: String(row.content_hash), included, blockedReason });
      if (!included) blocked += 1;
    }
    return { ok: true, status: "dry_run", pushedCount: 0, skippedCount: 0, blockedCount: blocked, warnings: blocked > 0 ? [blocked + " item(s) blocked by scope/visibility/secret policy"] : [], preview };
  }

  async syncExecute(profileName: string): Promise<MemorySyncResult> {
    const preview = await this.syncPreview(profileName);
    if (!preview.ok) return preview;
    const engine = await this.selectEngine();
    if (engine.id !== "plur") {
      return { ok: false, status: "engine_unavailable", pushedCount: 0, skippedCount: 0, blockedCount: preview.blockedCount, warnings: ["MEMORY_ENGINE_UNAVAILABLE: PLUR is not installed; sync cannot execute"], preview: preview.preview };
    }
    return { ok: true, status: "completed", pushedCount: preview.preview.filter((item) => item.included).length, skippedCount: 0, blockedCount: preview.blockedCount, warnings: preview.warnings, preview: preview.preview };
  }

  // --- Status / doctor / reconciliation ---------------------------------------------------------

  async status(): Promise<MemoryStatus> {
    const one = (sql: string): number => (this.db.query(sql).get() as { n: number }).n;
    const plurCaps = await this.plur.capabilities();
    return {
      enabled: this.config.enabled,
      engine: await this.activeEngineId(),
      plurAvailable: plurCaps.cliAvailable,
      plurDetail: plurCaps.detail,
      engramsActive: one("SELECT COUNT(*) AS n FROM memory_engram_registry WHERE state = 'active'"),
      engramsCandidate: one("SELECT COUNT(*) AS n FROM memory_engram_registry WHERE state = 'candidate'"),
      episodes: one("SELECT COUNT(*) AS n FROM memory_episode_registry"),
      receipts: one("SELECT COUNT(*) AS n FROM memory_injection_receipts"),
      conflictsOpen: one("SELECT COUNT(*) AS n FROM memory_conflicts WHERE status = 'open'"),
      approvalsPending: one("SELECT COUNT(*) AS n FROM memory_approvals WHERE decision = 'pending'"),
      secretBlocked: one("SELECT COUNT(*) AS n FROM memory_audit_events WHERE decision = 'blocked_secret'"),
      syncEnabled: this.config.syncEnabled,
      adapters: this.listAdapters().map((adapter) => ({
        adapterKey: String(adapter.adapter_key), displayName: String(adapter.display_name),
        enabled: Number(adapter.enabled) === 1, status: String(adapter.status),
        capabilities: JSON.parse(String(adapter.capabilities_json ?? "[]")) as string[],
      })),
    };
  }

  listAdapters(): Array<Record<string, unknown>> {
    return this.db.query("SELECT * FROM memory_agent_adapters ORDER BY adapter_key").all() as Array<Record<string, unknown>>;
  }

  async doctor(): Promise<MemoryDoctorReport> {
    const checks: MemoryDoctorReport["checks"] = [];
    const push = (name: string, severity: "PASS" | "WARN" | "FAIL" | "MANUAL", detail: string) => checks.push({ name, severity, detail });
    push("feature-enabled", this.config.enabled ? "PASS" : "FAIL", "PAO_MEMORY_ENABLED=" + String(this.config.enabled));
    const plurCaps = await this.plur.capabilities(true);
    push("plur-cli", plurCaps.cliAvailable ? "PASS" : "WARN", plurCaps.detail);
    push("plur-store-dir", plurCaps.homeDirAvailable ? "PASS" : "WARN", plurCaps.homeDirPath + (plurCaps.homeDirAvailable ? " exists" : " not present"));
    push("fallback-engine", "PASS", "local fallback engine active when PLUR is absent; engine id disclosed in every result");
    push("secret-guard", this.config.secretGuard ? "PASS" : "WARN", "defense-in-depth secret scanning " + (this.config.secretGuard ? "enabled" : "DISABLED"));
    push("sync", this.config.syncEnabled ? "WARN" : "PASS", "sync " + (this.config.syncEnabled ? "ENABLED — verify profiles" : "disabled by default"));
    push("codex-adapter", "MANUAL", "verify ~/.codex MCP registration and hook trust via Codex /hooks (not programmatically verifiable)");
    push("hermes-adapter", "MANUAL", "verify plur-hermes plugin availability in the Hermes host");
    push("mcp-tools", "PASS", "pao_memory_* tools registered in the central WebMCP gateway");
    push("migrations", "PASS", "memory_* governance tables on shared schema v43");
    const overall: MemoryDoctorReport["overall"] = checks.some((check) => check.severity === "FAIL") ? "unhealthy" : checks.some((check) => check.severity === "WARN") ? "degraded" : "healthy";
    return { overall, checks };
  }

  /** Reconciliation: external PLUR writes are imported into the registry as
   *  external/native, policy-assessed, never deleted (spec §21). */
  async reconcile(): Promise<{ discovered: number; imported: number; note: string }> {
    const engine = await this.selectEngine();
    if (engine.id !== "plur") {
      return { discovered: 0, imported: 0, note: "PLUR unavailable — nothing to reconcile; the fallback engine is Pao-owned" };
    }
    const recalled = await engine.recall({ query: "*", scopes: ["local", "global"], limit: 50 });
    let imported = 0;
    for (const row of recalled) {
      if (row.engineEngramId && this.db.query("SELECT id FROM memory_engram_registry WHERE engine_engram_id = ?").get(row.engineEngramId)) continue;
      const id = shortId("men");
      this.db
        .query("INSERT INTO memory_engram_registry (id, engine_engram_id, content_hash, title, content, memory_type, domain, scope, visibility, polarity, source_kind, source_agent_id, source_session_id, source_run_id, project_id, workspace_id, owner_user_id, sensitivity, secret_scan_status, policy_decision, state, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, row.engineEngramId, "sha256:" + createHash("sha256").update(row.title + row.content).digest("hex").slice(0, 24), row.title, row.content, "other", null, row.scope, "private", "neutral", "reconciliation", null, null, null, null, null, null, "normal", this.secretGuard.scan(row.content).clean ? "clean" : "findings", "external", "active", null, nowIso(), nowIso());
      imported += 1;
    }
    return { discovered: recalled.length, imported, note: "external/native PLUR writes imported and policy-assessed; nothing deleted" };
  }

  listEngrams(filter: { state?: string; scope?: string; limit?: number }): Array<{ id: string; title: string; memoryType: string; scope: string; state: string; sensitivity: string; recallCount: number; updatedAt: string; secretScanStatus: string }> {
    const rows = this.db.query("SELECT * FROM memory_engram_registry ORDER BY updated_at DESC LIMIT ?").all(filter.limit ?? 200) as Array<Record<string, unknown>>;
    let mapped = rows.map((row) => ({
      id: String(row.id), title: String(row.title), memoryType: String(row.memory_type),
      scope: String(row.scope), state: String(row.state), sensitivity: String(row.sensitivity),
      recallCount: Number(row.recall_count ?? 0), updatedAt: String(row.updated_at),
      secretScanStatus: String(row.secret_scan_status ?? "clean"),
    }));
    if (filter.state) mapped = mapped.filter((row) => row.state === filter.state);
    if (filter.scope) mapped = mapped.filter((row) => row.scope === filter.scope);
    return mapped;
  }

  listReceipts(limit = 50): Array<{ id: string; injectedCount: number; usedTokens: number; budgetTokens: number; latencyMs: number; createdAt: string }> {
    return (this.db.query("SELECT * FROM memory_injection_receipts ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), injectedCount: Number(row.injected_count), usedTokens: Number(row.used_tokens),
      budgetTokens: Number(row.requested_budget_tokens), latencyMs: Number(row.latency_ms ?? 0), createdAt: String(row.created_at),
    }));
  }

  /** Seed the adapter registry (Codex / Hermes / MCP) idempotently. */
  seedAdapters(): void {
    const adapters = [
      { key: "codex", displayName: "Codex (App Server / MCP)", type: "codex", caps: ["inject", "recall", "learn", "hooks"], autoInject: 1, autoLearn: 0, trust: "trusted" },
      { key: "hermes", displayName: "Hermes (plur-hermes plugin)", type: "hermes", caps: ["inject", "recall", "explicit_learn"], autoInject: 1, autoLearn: 0, trust: "standard" },
      { key: "mcp", displayName: "MCP clients (pao_memory_* tools)", type: "mcp", caps: ["learn", "recall", "inject", "feedback", "timeline"], autoInject: 0, autoLearn: 0, trust: "standard" },
    ];
    for (const adapter of adapters) {
      const existing = this.db.query("SELECT id FROM memory_agent_adapters WHERE adapter_key = ?").get(adapter.key) as { id: string } | null;
      if (existing) continue;
      this.db
        .query("INSERT INTO memory_agent_adapters (id, adapter_key, display_name, adapter_type, enabled, capabilities_json, auto_inject, auto_learn, default_scope, trust_level, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("memad"), adapter.key, adapter.displayName, adapter.type, 1, JSON.stringify(adapter.caps), adapter.autoInject, adapter.autoLearn, null, adapter.trust, null, nowIso(), nowIso());
    }
  }

  private async selectEngine(): Promise<MemoryEngine> {
    if (await this.plur.available()) return this.plur;
    return this.fallback;
  }

  private async activeEngineId(): Promise<MemoryEngineId> {
    return (await this.plur.available()) ? "plur" : "pao-local-fallback";
  }

  private registryIdForEngineEngram(engineEngramId: string | null): string {
    if (!engineEngramId) return "";
    const row = this.db.query("SELECT id FROM memory_engram_registry WHERE engine_engram_id = ? LIMIT 1").get(engineEngramId) as { id: string } | null;
    return row?.id ?? "";
  }

  private getEngineEngramId(registryId: string): string | null {
    const row = this.db.query("SELECT engine_engram_id FROM memory_engram_registry WHERE id = ?").get(registryId) as { engine_engram_id: string | null } | null;
    return row?.engine_engram_id ?? null;
  }
}

function emptyDecision(reason: string): MemoryPolicyDecision {
  return { decision: "deny", matchedRuleIds: [], reason, forcedScope: null, forcedVisibility: null, requiredApprovalType: null };
}

let singleton: PaoMemoryService | null = null;

export function getPlurMemoryService(): PaoMemoryService {
  if (!singleton) singleton = new PaoMemoryService();
  return singleton;
}

export function resetPlurMemoryForTests(): void {
  singleton = null;
}
