// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Continuous Learning & Instinct Pipeline: Pattern extraction without privilege escalation

import { randomUUID } from "node:crypto";
import type { InstinctRecord, SkillDescriptor } from "./types";
import { EccStore } from "./store";
import { redactSecrets } from "./audit";

export interface TaskOutcome {
  taskId: string;
  goal: string;
  success: boolean;
  stepsExecuted: number;
  filesChanged: string[];
  testPassed: boolean;
  warningsCount: number;
  criticalIssuesCount: number;
}

export class ContinuousLearningEngine {
  private readonly store: EccStore;
  private readonly promotionThreshold = 0.85;
  private readonly minSuccessCountForPromotion = 5;

  constructor(store?: EccStore) {
    this.store = store ?? new EccStore();
    this.seedBaselineInstincts();
  }

  private seedBaselineInstincts(): void {
    const existing = this.store.listInstincts(5);
    if (existing.length === 0) {
      this.registerInstinct({
        trigger: "dependency_upgrade",
        pattern: "Run documentation and breaking changes research prior to editing package manifests.",
        confidence: 0.82,
        successCount: 6,
        failureCount: 0,
      });

      this.registerInstinct({
        trigger: "high_risk_edit",
        pattern: "Execute focused unit test baseline before modifying shared subsystem files.",
        confidence: 0.90,
        successCount: 12,
        failureCount: 1,
      });

      this.registerInstinct({
        trigger: "file_creation",
        pattern: "Ensure new source files strictly conform to local TypeScript strict types and noEmit check.",
        confidence: 0.88,
        successCount: 8,
        failureCount: 0,
      });
    }
  }

  /**
   * Evaluates a completed task execution to extract potential learned patterns.
   * Safety invariant: Extracted patterns are advisory recommendations only.
   */
  evaluateCompletedTask(outcome: TaskOutcome): InstinctRecord | null {
    if (!outcome.success || !outcome.testPassed || outcome.criticalIssuesCount > 0) {
      // Failed runs do not generate positive candidate instincts
      return null;
    }

    const { text: cleanGoal } = redactSecrets(outcome.goal);

    let trigger = "general_task";
    let pattern = `Follow proven verification loop: baseline -> edit (${outcome.filesChanged.length} files) -> test pass.`;

    const lower = cleanGoal.toLowerCase();
    if (lower.includes("test") || lower.includes("coverage")) {
      trigger = "test_expansion";
      pattern = "Formulate unit test assertions covering edge-case boundary conditions.";
    } else if (lower.includes("security") || lower.includes("policy")) {
      trigger = "security_patch";
      pattern = "Mandate Reviewer Council inspection and zero secret exposure check.";
    } else if (lower.includes("refactor") || lower.includes("cleanup")) {
      trigger = "refactoring";
      pattern = "Preserve existing behavioral contracts and verify import graph dependencies.";
    }

    // Check if an instinct with this trigger exists; if so, reinforce it
    const all = this.store.listInstincts(100);
    const existing = all.find(i => i.trigger === trigger);

    if (existing) {
      const updated: InstinctRecord = {
        ...existing,
        successCount: existing.successCount + 1,
        confidence: Math.min(0.99, existing.confidence + 0.03),
        promotable: existing.successCount + 1 >= this.minSuccessCountForPromotion && existing.confidence >= this.promotionThreshold,
        lastUsedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.upsertInstinct(updated);
      return updated;
    }

    const newInstinct: InstinctRecord = {
      id: `instinct_${randomUUID().slice(0, 10)}`,
      trigger,
      pattern,
      confidence: 0.70,
      successCount: 1,
      failureCount: 0,
      promotable: false,
      candidateSkillId: `skill-candidate-${trigger}`,
      promotedToSkill: false,
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.upsertInstinct(newInstinct);
    return newInstinct;
  }

  registerInstinct(params: {
    trigger: string;
    pattern: string;
    confidence?: number;
    successCount?: number;
    failureCount?: number;
  }): InstinctRecord {
    const { text: cleanPattern } = redactSecrets(params.pattern);
    const confidence = params.confidence ?? 0.6;
    const successCount = params.successCount ?? 1;
    const failureCount = params.failureCount ?? 0;

    const record: InstinctRecord = {
      id: `instinct_${randomUUID().slice(0, 10)}`,
      trigger: params.trigger,
      pattern: cleanPattern,
      confidence,
      successCount,
      failureCount,
      promotable: successCount >= this.minSuccessCountForPromotion && confidence >= this.promotionThreshold,
      candidateSkillId: `skill-candidate-${params.trigger}`,
      promotedToSkill: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.upsertInstinct(record);
    return record;
  }

  /**
   * Promotes a qualified instinct to a reusable candidate skill.
   * HARD SAFETY INVARIANT: Requires operator authorization (approvedByOperator = true).
   * No automatic self-promotion to privileged tools is permitted.
   */
  promoteToSkill(instinctId: string, approvedByOperator: boolean): SkillDescriptor {
    if (!approvedByOperator) {
      throw new Error(
        `Safety Violation: Instinct '${instinctId}' cannot be promoted without explicit human operator approval. Automatic privilege escalation is blocked.`,
      );
    }

    const all = this.store.listInstincts(100);
    const instinct = all.find(i => i.id === instinctId);
    if (!instinct) {
      throw new Error(`Instinct '${instinctId}' not found.`);
    }

    const skillId = instinct.candidateSkillId ?? `skill-instinct-${instinct.trigger}`;
    const newSkill: SkillDescriptor = {
      id: skillId,
      name: `Learned: ${instinct.trigger.replace(/_/g, " ")}`,
      source: "project",
      version: "1.0.0",
      description: `Promoted from verified instinct: ${instinct.pattern}`,
      tags: ["learned", "instinct", instinct.trigger],
      risk: "low",
      requiredTools: ["read_file"],
      supportedHarnesses: ["codex", "claude"],
      enabled: true,
      trusted: true,
      loadMode: "on_demand",
    };

    this.store.upsertSkill(newSkill, `# Learned Skill: ${instinct.trigger}\n${instinct.pattern}`);

    // Mark instinct promoted
    instinct.promotedToSkill = true;
    instinct.updatedAt = new Date().toISOString();
    this.store.upsertInstinct(instinct);

    return newSkill;
  }

  listInstincts(limit = 50): InstinctRecord[] {
    return this.store.listInstincts(limit);
  }
}
