// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Central Facade & Ponytail Governance Gate

export * from "./types";
export * from "./config";
export * from "./mode-router";
export * from "./task-classifier";
export * from "./reuse-scanner";
export * from "./dependency-guard";
export * from "./diff-guard";
export * from "./council-trigger";
export * from "./reporter";
export * from "./debt-ledger";

import type {
  GovernanceConfig,
  GovernanceDecision,
  GovernanceMode,
  GovernanceRung,
  TaskType,
} from "./types";
import { getGovernanceConfig } from "./config";
import { getModeRouter } from "./mode-router";
import { getTaskClassifier } from "./task-classifier";
import { getReuseScanner } from "./reuse-scanner";
import { getDependencyGuard } from "./dependency-guard";
import { getDiffGuard } from "./diff-guard";
import { getCouncilTrigger } from "./council-trigger";
import { getGovernanceReporter } from "./reporter";

export class PonytailGovernanceGate {
  private workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  getConfig(): GovernanceConfig {
    return getGovernanceConfig();
  }

  /**
   * Evaluates an incoming task through the 7-rung decision ladder.
   */
  evaluateTask(
    prompt: string,
    options?: {
      explicitMode?: GovernanceMode;
      agentType?: string;
      affectedFiles?: string[];
      isDestructive?: boolean;
    },
  ): GovernanceDecision {
    const config = this.getConfig();
    const modeRouter = getModeRouter();
    const taskClassifier = getTaskClassifier();
    const reuseScanner = getReuseScanner(this.workspaceRoot);
    const councilTrigger = getCouncilTrigger();

    // 1. Classify Task & Risk
    const classification = taskClassifier.classify(prompt, {
      affectedFiles: options?.affectedFiles,
      isDestructive: options?.isDestructive,
    });

    // 2. Resolve Effective Mode
    const mode = modeRouter.resolveMode({
      explicitMode: options?.explicitMode,
      agentType: options?.agentType,
      taskType: classification.taskType,
    });

    if (mode === "off") {
      return {
        mode: "off",
        taskType: classification.taskType,
        risk: classification.risk,
        selectedRung: "rung_7_new_subsystem",
        existingCandidates: [],
        newDependencyRequired: false,
        expectedChangeScope: { files: 1, kind: "incremental" },
        requiresReviewerCouncil: false,
        reasoningSummary: "Governance is disabled for this agent/task type.",
        evaluatedAt: new Date().toISOString(),
      };
    }

    // 3. Evaluate 7-Rung Ladder
    let selectedRung: GovernanceRung = "rung_6_local_patch";
    let existingCandidates: string[] = [];
    let reasoningSummary = "";

    // Extract keywords from prompt for reuse scan
    const words = prompt
      .replace(/[^a-zA-Z0-9_\-\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const reuseScanResult = config.reuseScan
      ? reuseScanner.scan(words, { maxResults: 5 })
      : { hasExistingEquivalent: false, candidates: [], suggestedRung: "rung_6_local_patch" as const, recommendation: "" };

    if (reuseScanResult.hasExistingEquivalent && reuseScanResult.candidates.length > 0) {
      selectedRung = "rung_2_reuse";
      existingCandidates = reuseScanResult.candidates.map((c) => c.filePath);
      reasoningSummary = `Found existing equivalent module(s): ${existingCandidates[0]}. Prefer reuse or extension.`;
    } else if (classification.taskType === "bugfix") {
      selectedRung = "rung_6_local_patch";
      reasoningSummary = "Bugfix classified for minimal local patch rather than abstraction.";
    } else if (mode === "ultra") {
      selectedRung = "rung_1_skip";
      reasoningSummary = "Ultra mode: Verify if requirement is truly necessary before creating any new code.";
    } else {
      selectedRung = "rung_6_local_patch";
      reasoningSummary = "Proceeding with smallest local implementation required.";
    }

    // 4. Council Requirement
    const requiresReviewerCouncil =
      config.reviewerCouncil &&
      councilTrigger.shouldTriggerCouncil({
        risk: classification.risk,
        sensitiveAreas: classification.sensitiveAreas,
        mode,
      });

    return {
      mode,
      taskType: classification.taskType,
      risk: classification.risk,
      selectedRung,
      existingCandidates,
      newDependencyRequired: false,
      expectedChangeScope: {
        files: selectedRung === "rung_6_local_patch" ? 2 : 4,
        kind: classification.taskType === "refactor" ? "refactor" : "incremental",
      },
      requiresReviewerCouncil,
      reasoningSummary,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Formats a system prompt instruction snippet based on the evaluated governance decision.
   */
  buildGovernanceSystemPrompt(decision: GovernanceDecision): string {
    if (decision.mode === "off") return "";

    return [
      "=== PAO-HUBPRO MINIMAL-CODE GOVERNANCE (PONYTAIL) ===",
      `Mode: ${decision.mode.toUpperCase()} | Task: ${decision.taskType.toUpperCase()} | Risk: ${decision.risk.toUpperCase()}`,
      `Selected Rung: ${decision.selectedRung}`,
      `Guidance: ${decision.reasoningSummary}`,
      "",
      "MANDATORY CODING RULES:",
      "1. Explicit requirements supremacy: Minimal code never overrides user specifications.",
      "2. Safety is non-negotiable: Never remove auth, permissions, validation, or error handling to save lines.",
      "3. Reuse before creation: Reuse existing Pao-hubPro modules before introducing new abstractions.",
      "4. No dependencies for cosmetic LOC reduction: Do not add packages just for cleaner syntax.",
      "5. Minimal diff: Prefer patch > refactor > rewrite for incremental changes.",
      "6. Reviewer Council: High/critical risk modifications require multi-model safety authorization.",
      "=======================================================",
    ].join("\n");
  }
}

let defaultGovernanceGate: PonytailGovernanceGate | null = null;
export function getPonytailGovernanceGate(workspaceRoot?: string): PonytailGovernanceGate {
  if (!defaultGovernanceGate || workspaceRoot) {
    defaultGovernanceGate = new PonytailGovernanceGate(workspaceRoot);
  }
  return defaultGovernanceGate;
}
