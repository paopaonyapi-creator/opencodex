// Phase 20.91b — Engineering Skill Runtime: Progressive Context Packager (L0–L4).
//
// Preserves upstream progressive-disclosure semantics (source §12): the context
// window never becomes a dumping ground. L0 catalog metadata loads always; L1
// full SKILL.md only after selection; L2 references on demand; L3 repository
// context scoped to the task; L4 runtime evidence only into verification/review
// contexts. Deterministic truncation preserves task/spec first (source §36).

import type { NormalizedSkill } from "./types";

export type ContextLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface ContextBudget {
  metadataCatalog: number;
  selectedSkills: number;
  references: number;
  repositoryContext: number;
  evidence: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  metadataCatalog: 8000,
  selectedSkills: 20000,
  references: 12000,
  repositoryContext: 60000,
  evidence: 30000,
};

export interface ContextBlock {
  level: ContextLevel;
  key: string;
  content: string;
  approxTokens: number;
  truncated: boolean;
}

/** ~4 chars per token — deterministic, provider-independent approximation. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Deterministic truncation with a preserved head and an explicit marker. */
function truncateToBudget(text: string, budgetTokens: number): { content: string; truncated: boolean } {
  const maxChars = budgetTokens * 4;
  if (text.length <= maxChars) return { content: text, truncated: false };
  return { content: `${text.slice(0, maxChars)}\n\n[truncated deterministically at ${budgetTokens}-token budget]`, truncated: true };
}

export interface PackagedContext {
  blocks: ContextBlock[];
  totalApproxTokens: number;
  budget: ContextBudget;
}

export class ContextPackager {
  constructor(private budget: ContextBudget = DEFAULT_CONTEXT_BUDGET) {}

  /** L0: catalog metadata only (id/name/description/triggers/risk). */
  catalog(skills: NormalizedSkill[]): ContextPackagedContext {
    const blocks: ContextBlock[] = [];
    let used = 0;
    for (const skill of skills) {
      const meta = {
        id: skill.id,
        slug: skill.slug,
        pack: skill.packId,
        name: skill.name,
        description: skill.description,
        stages: skill.lifecycleStages,
        risk: skill.riskLevel,
        triggers: skill.triggers,
      };
      const text = JSON.stringify(meta, null, 2);
      const allowance = Math.max(0, this.budget.metadataCatalog - used);
      const cut = truncateToBudget(text, allowance);
      used += approxTokens(cut.content);
      blocks.push({ level: "L0", key: `catalog:${skill.slug}`, content: cut.content, approxTokens: approxTokens(cut.content), truncated: cut.truncated });
    }
    return this.finish(blocks);
  }

  /** L1: the full selected SKILL.md body — only after routing. */
  skillBody(skill: NormalizedSkill, body: string): ContextBlock {
    const cut = truncateToBudget(body, this.budget.selectedSkills);
    return { level: "L1", key: `skill:${skill.slug}`, content: cut.content, approxTokens: approxTokens(cut.content), truncated: cut.truncated };
  }

  /** L2: a reference loaded only when the workflow step needs it. */
  reference(skill: NormalizedSkill, referenceKey: string, body: string): ContextBlock {
    const cut = truncateToBudget(body, this.budget.references);
    return { level: "L2", key: `ref:${skill.slug}:${referenceKey}`, content: cut.content, approxTokens: approxTokens(cut.content), truncated: cut.truncated };
  }

  /** L3: repository context scoped to the task (paths the task touches). */
  repositoryContext(paths: string[], bodies: string[]): ContextBlock {
    const text = bodies.join("\n\n");
    const cut = truncateToBudget(text, this.budget.repositoryContext);
    return { level: "L3", key: `repo:${paths.join(",")}`.slice(0, 160), content: cut.content, approxTokens: approxTokens(cut.content), truncated: cut.truncated };
  }

  /** L4: runtime evidence injected only into verification/review contexts. */
  evidence(items: string[]): ContextBlock {
    const text = items.join("\n");
    const cut = truncateToBudget(text, this.budget.evidence);
    return { level: "L4", key: "evidence", content: cut.content, approxTokens: approxTokens(cut.content), truncated: cut.truncated };
  }

  /**
   * Overflow priority (source §36): 1 task/spec → 2 selected skills → 3 active
   * code context → 4 failed evidence → 5 summarize low-priority history →
   * 6 drop unrelated references.
   */
  enforceOverflow(blocks: ContextBlock[], totalBudgetTokens: number): ContextBlock[] {
    const priority: Record<ContextLevel, number> = { L0: 2, L1: 2, L2: 6, L3: 3, L4: 4 };
    const sorted = [...blocks].sort((a, b) => priority[a.level] - priority[b.level]);
    const kept: ContextBlock[] = [];
    let used = 0;
    for (const block of sorted) {
      if (used + block.approxTokens > totalBudgetTokens) continue;
      kept.push(block);
      used += block.approxTokens;
    }
    return kept.sort((a, b) => priority[a.level] - priority[b.level] || a.key.localeCompare(b.key));
  }

  private finish(blocks: ContextBlock[]): ContextPackagedContext {
    return { blocks, totalApproxTokens: blocks.reduce((sum, b) => sum + b.approxTokens, 0), budget: this.budget };
  }
}

type ContextPackagedContext = PackagedContext;
