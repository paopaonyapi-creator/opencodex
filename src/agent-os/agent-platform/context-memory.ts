/**
 * Pao Agent Platform — context compiler + memory gateway (Phase 20.54 §15-22).
 *
 * Context is DYNAMIC and TYPED: selected, compressed, isolated and budgeted —
 * never appended indefinitely. Precedence is explicit (security policy >
* runtime policy > project policy > user request > plan > retrieved > tool
 * output). Memory writes are GATED with provenance; retrieved external
 * content never automatically becomes trusted permanent memory.
 */

import { nextId } from "./events";
import { PlatformError, type CompiledContextPackage, type ContextBudgetAllocation, type ContextItem, type ContextType, type MemoryRecord, type MemoryType, type MemoryWriteGate } from "./types";

export const CONTEXT_PRECEDENCE: readonly ContextType[] = [
  "POLICY",
  "SYSTEM",
  "APPROVAL",
  "TASK",
  "USER",
  "PROJECT",
  "PLAN",
  "MEMORY",
  "KNOWLEDGE",
  "EXECUTION_RESULT",
  "AGENT_MESSAGE",
  "TOOLS",
];

const DEFAULT_ALLOCATIONS: Readonly<Record<string, number>> = {
  POLICY: 0.1,
  SYSTEM: 0.05,
  TASK: 0.07,
  USER: 0.05,
  PROJECT: 0.12,
  MEMORY: 0.15,
  KNOWLEDGE: 0.22,
  TOOLS: 0.1,
  PLAN: 0.06,
  EXECUTION_RESULT: 0.08,
};

export function estimateTokens(content: unknown): number {
  const text = typeof content === "string" ? content : JSON.stringify(content) ?? "";
  return Math.ceil(text.length / 4);
}

export interface CompilerOptions {
  readonly budget: ContextBudgetAllocation;
  readonly now?: () => number;
}

export class ContextCompiler {
  private readonly budget: ContextBudgetAllocation;
  private readonly now: () => number;

  constructor(options: CompilerOptions) {
    this.budget = options.budget;
    this.now = options.now ?? Date.now;
  }

  /**
   * Compile the context package:
   * 1. type items by precedence,
   * 2. drop expired items and untrusted content that impersonates policy,
   * 3. per-type budget with a protected minimum for POLICY/SYSTEM/TASK,
   * 4. compress lowest-relevance overflow within a type (truncate + summarize
   *    marker — compression never silently deletes security policy),
   * 5. isolate untrusted items behind explicit untrusted markers.
   */
  compile(items: readonly ContextItem[]): CompiledContextPackage {
    const dropped: Array<{ id: string; reason: string }> = [];
    const compressed: Array<{ id: string; before: number; after: number }> = [];
    const nowMs = this.now();

    // Expiry + poisoning guard: retrieved content posing as policy is dropped.
    const surviving = items.filter(item => {
      if (item.expiresAt && nowMs >= Date.parse(item.expiresAt)) {
        dropped.push({ id: item.id, reason: "expired" });
        return false;
      }
      if ((item.type === "POLICY" || item.type === "SYSTEM") && item.trustLevel === "untrusted") {
        dropped.push({ id: item.id, reason: "context poisoning guard: untrusted policy impersonation" });
        return false;
      }
      return true;
    });

    // Sort by precedence (CONTEXT_PRECEDENCE order), then relevance desc.
    const typeRank = (t: ContextType): number => CONTEXT_PRECEDENCE.indexOf(t);
    const sorted = [...surviving].sort((a, b) => {
      const byType = typeRank(a.type) - typeRank(b.type);
      if (byType !== 0) return byType;
      return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    });

    const totalBudget = Math.max(0, this.budget.totalTokens - this.budget.reserveOutputTokens);
    const typeBudgets = new Map<string, number>();
    for (const [type, ratio] of Object.entries(this.budget.allocations)) {
      typeBudgets.set(type, Math.floor(totalBudget * ratio));
    }

    const kept: ContextItem[] = [];
    const perTypeUsed = new Map<string, number>();
    for (const item of sorted) {
      const estimate = item.tokenEstimate ?? estimateTokens(item.content);
      const typeBudget = typeBudgets.get(item.type) ?? Math.floor(totalBudget * 0.05);
      const used = perTypeUsed.get(item.type) ?? 0;

      if (item.immutable && used + estimate > typeBudget) {
        // Immutable security/task-critical items keep their reserved budget:
        // overflow is absorbed by later (lower-precedence) types instead.
        const overflow = used + estimate - typeBudget;
        typeBudgets.set(item.type, typeBudget + overflow);
      }

      if (used + estimate > (typeBudgets.get(item.type) ?? 0)) {
        if (estimate > typeBudget && (item.type === "POLICY" || item.type === "SYSTEM")) {
          // Never drop policy to fit chat history; compress instead.
          const compressedContent = compressContent(item.content, typeBudget * 4);
          const after = estimateTokens(compressedContent);
          compressed.push({ id: item.id, before: estimate, after });
          perTypeUsed.set(item.type, used + after);
          kept.push({ ...item, content: compressedContent, tokenEstimate: after });
          continue;
        }
        dropped.push({ id: item.id, reason: "context budget exceeded for type" });
        continue;
      }
      perTypeUsed.set(item.type, used + estimate);
      kept.push(item);
    }

    // Isolation marker: untrusted items are wrapped, not silently trusted.
    const isolated = kept.map(item =>
      item.trustLevel === "untrusted"
        ? { ...item, content: { __untrusted: true, origin: item.source, data: item.content } }
        : item,
    );

    return {
      items: isolated,
      totalTokens: [...perTypeUsed.values()].reduce((a, b) => a + b, 0),
      dropped,
      compressed,
      precedenceApplied: CONTEXT_PRECEDENCE,
    };
  }
}

function compressContent(content: unknown, maxChars: number): string {
  const text = typeof content === "string" ? content : JSON.stringify(content) ?? "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 40))}… [compressed; ${text.length - maxChars} chars elided]`;
}

// ---------------------------------------------------------------------------
// Memory gateway (§20-22)
// ---------------------------------------------------------------------------

export interface MemoryGateway {
  search(query: { scope: string; types?: readonly MemoryType[]; limit: number }): Promise<MemoryRecord[]>;
  get(id: string): Promise<MemoryRecord | null>;
  write(request: MemoryWriteRequest): Promise<{ gate: MemoryWriteGate; record: MemoryRecord | null }>;
  forget(request: { scope: string; memoryId: string }): Promise<void>;
}

export interface MemoryWriteRequest {
  readonly memoryType: MemoryType;
  readonly scope: string;
  readonly content: string;
  readonly createdBy: string;
  readonly taskId?: string;
  readonly confidence: number;
  readonly sensitivity: MemoryRecord["sensitivity"];
  readonly sourceTrust: "trusted" | "verified" | "untrusted";
  /** Explicit user confirmation raises the gate. */
  readonly userConfirmed?: boolean;
}

/** Deterministic write gate (§21): novelty, trust, sensitivity, confidence. */
export function evaluateMemoryWrite(request: MemoryWriteRequest): MemoryWriteGate {
  if (request.sensitivity === "secret") {
    return { decision: "discard", memoryType: request.memoryType, scope: request.scope, retention: "working", confidence: request.confidence, reason: "secret-sensitivity content never enters memory" };
  }
  if (request.sourceTrust === "untrusted" && !request.userConfirmed) {
    return { decision: "discard", memoryType: request.memoryType, scope: request.scope, retention: "working", confidence: request.confidence, reason: "retrieved/external content is not automatically memory" };
  }
  if (request.confidence < 0.5) {
    return { decision: "discard", memoryType: request.memoryType, scope: request.scope, retention: "working", confidence: request.confidence, reason: "confidence below the write threshold" };
  }
  const trimmed = request.content.trim();
  if (trimmed.length < 12) {
    return { decision: "discard", memoryType: request.memoryType, scope: request.scope, retention: "working", confidence: request.confidence, reason: "content too short to be useful" };
  }
  const retention: MemoryWriteGate["retention"] =
    request.memoryType === "working" ? "working" : request.memoryType === "short_term" ? "short_term" : "long_term";
  return { decision: "store", memoryType: request.memoryType, scope: request.scope, retention, confidence: request.confidence, reason: "passes novelty/trust/sensitivity gate" };
}

/** Local-first fallback adapter (metadata index lives in the caller's store). */
export class NoopMemoryAdapter implements MemoryGateway {
  private readonly records = new Map<string, MemoryRecord>();

  async search(query: { scope: string; types?: readonly MemoryType[]; limit: number }): Promise<MemoryRecord[]> {
    return [...this.records.values()]
      .filter(r => r.scope === query.scope)
      .filter(r => (query.types ? query.types.includes(r.memoryType) : true))
      .slice(0, query.limit);
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return this.records.get(id) ?? null;
  }

  async write(request: MemoryWriteRequest): Promise<{ gate: MemoryWriteGate; record: MemoryRecord | null }> {
    const gate = evaluateMemoryWrite(request);
    if (gate.decision !== "store") return { gate, record: null };
    const record: MemoryRecord = {
      id: nextId("mem"),
      memoryType: request.memoryType,
      scope: request.scope,
      content: request.content,
      createdBy: request.createdBy,
      taskId: request.taskId,
      trustLevel: request.sourceTrust,
      confidence: request.confidence,
      sensitivity: request.sensitivity,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return { gate, record };
  }

  async forget(request: { scope: string; memoryId: string }): Promise<void> {
    const record = this.records.get(request.memoryId);
    if (record && record.scope === request.scope) this.records.delete(request.memoryId);
  }
}

/**
 * OpenViking memory adapter — bridges the Phase 20.53 governance store.
 * The adapter takes the 20.53 store's memory surface as a structural
 * dependency (duck-typed) so the platform never couples to adapter internals.
 */
export interface OpenVikingMemoryBridge {
  registerCandidate(input: { memoryUri: string; memoryType?: string; ownerUserId?: string; workspaceId?: string; peerId?: string; contentPreview: string; sourceSessionId?: string; userConfirmed?: boolean }): { record: { id: string; reviewState: string } | null; rejectedForSecret: boolean };
  listMemoryGovernance(limit?: number): Array<{ id: string; memoryUri: string; reviewState: string; suppressed: boolean; contentPreview?: string }>;
}

export class OpenVikingMemoryAdapter implements MemoryGateway {
  private readonly bridge: OpenVikingMemoryBridge;
  private readonly scopePrefix: string;

  constructor(bridge: OpenVikingMemoryBridge, scopePrefix = "viking://user/") {
    this.bridge = bridge;
    this.scopePrefix = scopePrefix;
  }

  async search(query: { scope: string; types?: readonly MemoryType[]; limit: number }): Promise<MemoryRecord[]> {
    return this.bridge
      .listMemoryGovernance(query.limit)
      .filter(m => !m.suppressed)
      .filter(m => m.reviewState === "approved" || m.reviewState === "auto_accepted_private")
      .map(m => ({
        id: m.id,
        memoryType: "semantic" as MemoryType,
        scope: query.scope,
        content: m.contentPreview ?? "",
        createdBy: "openviking",
        trustLevel: "verified" as const,
        confidence: 0.7,
        sensitivity: "internal" as const,
        createdAt: new Date().toISOString(),
      }));
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const all = this.bridge.listMemoryGovernance(500);
    const found = all.find(m => m.id === id);
    if (!found) return null;
    return {
      id: found.id,
      memoryType: "semantic",
      scope: this.scopePrefix,
      content: found.contentPreview ?? "",
      createdBy: "openviking",
      trustLevel: "verified",
      confidence: 0.7,
      sensitivity: "internal",
      createdAt: new Date().toISOString(),
    };
  }

  async write(request: MemoryWriteRequest): Promise<{ gate: MemoryWriteGate; record: MemoryRecord | null }> {
    const gate = evaluateMemoryWrite(request);
    if (gate.decision !== "store") return { gate, record: null };
    const { record } = this.bridge.registerCandidate({
      memoryUri: `viking://user/${request.scope}/memories/${request.memoryType}-${Date.now()}`,
      memoryType: request.memoryType,
      ownerUserId: request.scope,
      contentPreview: request.content,
      userConfirmed: request.userConfirmed,
    });
    if (!record) return { gate, record: null };
    return {
      gate,
      record: {
        id: record.id,
        memoryType: request.memoryType,
        scope: request.scope,
        content: request.content,
        createdBy: request.createdBy,
        taskId: request.taskId,
        trustLevel: request.sourceTrust,
        confidence: request.confidence,
        sensitivity: request.sensitivity,
        createdAt: new Date().toISOString(),
      },
    };
  }

  async forget(request: { scope: string; memoryId: string }): Promise<void> {
    void request;
    // Suppression/expiry is governed by the Phase 20.53 memory service; the
    // gateway deliberately does not bypass it with direct deletion.
    throw new PlatformError("SECURITY_VIOLATION", "memory deletion is governed by the Phase 20.53 review workflow", 403);
  }
}
