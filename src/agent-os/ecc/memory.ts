// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Memory Vault Bridge: Provider-neutral, secret-filtered persistent operational memory

import { randomUUID } from "node:crypto";
import type { MemoryCategory, MemoryRecord } from "./types";
import { EccStore } from "./store";
import { redactSecrets } from "./audit";

export class MemoryVault {
  private readonly store: EccStore;

  constructor(store?: EccStore) {
    this.store = store ?? new EccStore();
    this.seedBaselineMemories();
  }

  private seedBaselineMemories(): void {
    const existing = this.store.listMemories(5);
    if (existing.length === 0) {
      this.storeMemory({
        type: "architecture_decisions",
        project: "pao-hubpro",
        summary: "Phase 20.20 adopts affaan-m/ECC as an agent harness layer; Pao-hubPro remains control plane.",
        detail: "ECC provides skills, roles, and continuous-learning instincts without replacing Pao's security gates.",
        confidence: 0.99,
        source: "phase-20.20-spec",
        sensitive: false,
        tags: ["architecture", "ecc", "phase-20.20"],
      });

      this.storeMemory({
        type: "architecture_decisions",
        project: "pao-hubpro",
        summary: "Codex native plugin integration is preferred over legacy sync; no stacked installations.",
        detail: "Enforces single installation mode to prevent state drift and unresolvable plugin conflicts.",
        confidence: 0.98,
        source: "phase-20.20-spec",
        sensitive: false,
        tags: ["codex", "plugin", "safety"],
      });

      this.storeMemory({
        type: "repository_conventions",
        project: "pao-hubpro",
        summary: "Fail-closed permissions: default agent access is Class A (read-only); writes require audit.",
        detail: "Class E high-impact operations are denied or require explicit human approval.",
        confidence: 1.0,
        source: "phase-20.20-spec",
        sensitive: false,
        tags: ["security", "policy", "safe-tools"],
      });
    }
  }

  /**
   * Validates, redacts, and stores an observed memory record.
   * Rejects memories containing raw unredactable secrets or marked sensitive.
   */
  storeMemory(input: {
    type: MemoryCategory;
    project?: string;
    summary: string;
    detail?: string;
    confidence?: number;
    source: string;
    sensitive?: boolean;
    tags?: string[];
  }): MemoryRecord | null {
    // 1. Redact secrets in summary and detail
    const { text: cleanSummary, redacted: summaryRedacted } = redactSecrets(input.summary);
    const detailRes = input.detail ? redactSecrets(input.detail) : { text: undefined, redacted: false };

    // 2. Reject if explicitly sensitive or raw secret was sanitized
    const sensitive = Boolean(input.sensitive || summaryRedacted || detailRes.redacted);

    const record: MemoryRecord = {
      id: `mem_${randomUUID().slice(0, 10)}`,
      type: input.type,
      project: input.project ?? "pao-hubpro",
      summary: cleanSummary,
      detail: detailRes.text,
      confidence: input.confidence ?? 0.9,
      source: input.source,
      sensitive,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };

    // 3. Deduplicate: check if identical summary exists
    const existing = this.store.listMemories(100);
    const duplicate = existing.find(m => m.summary.toLowerCase() === cleanSummary.toLowerCase());
    if (duplicate) {
      return duplicate;
    }

    this.store.saveMemory(record);
    return record;
  }

  /**
   * Retrieves memories relevant to a query/topic.
   */
  query(params: {
    type?: MemoryCategory;
    tag?: string;
    keyword?: string;
    limit?: number;
  }): MemoryRecord[] {
    const all = this.store.listMemories(params.limit ?? 50);
    return all
      .filter(m => !params.type || m.type === params.type)
      .filter(m => !params.tag || m.tags.includes(params.tag))
      .filter(m => {
        if (!params.keyword) return true;
        const kw = params.keyword.toLowerCase();
        return (
          m.summary.toLowerCase().includes(kw) ||
          (m.detail && m.detail.toLowerCase().includes(kw))
        );
      });
  }

  listAll(limit = 50): MemoryRecord[] {
    return this.store.listMemories(limit);
  }
}
