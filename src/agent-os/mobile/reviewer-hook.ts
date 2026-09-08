// Reviewer Council verification hook for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import type { MobileTask, MobileTrace, ReviewerEvaluation } from "./types";

export class MobileReviewerCouncil {
  /**
   * Performs read-only evaluation of completed mobile automation evidence.
   * Ensures agent actions adhered to safety policies, achieved the target goal,
   * and provided visual and trace evidence without side effects.
   */
  public evaluateTask(task: MobileTask, trace: MobileTrace | null): ReviewerEvaluation {
    const issues: string[] = [];
    let goalComplete = true;
    let safetyOk = true;
    let evidenceOk = true;

    // 1. Evidence Check
    if (!trace || !trace.steps || trace.steps.length === 0) {
      issues.push("No execution trace steps recorded for the task.");
      evidenceOk = false;
      goalComplete = false;
    } else {
      const hasScreenshots = trace.steps.some((s) => s.screenshotBefore || s.screenshotAfter);
      if (!hasScreenshots && task.verificationLevel !== "off") {
        issues.push("Visual screenshot evidence missing from trace steps.");
        evidenceOk = false;
      }
    }

    // 2. Safety & Error Check
    if (trace?.errors && trace.errors.length > 0) {
      issues.push(...trace.errors.map((e) => `Trace error reported: ${e}`));
      safetyOk = false;
    }

    if (task.errorMessage) {
      issues.push(`Task encountered error: ${task.errorMessage}`);
      goalComplete = false;
    }

    // 3. Goal Alignment Check
    if (trace?.checkerResults) {
      for (const checker of trace.checkerResults) {
        if (!checker.pass) {
          issues.push(`Checker failure: ${checker.name} (${checker.details || "failed"})`);
          goalComplete = false;
        }
      }
    }

    // Formulate final consensus decision
    let decision: "PASS" | "FAIL" | "NEEDS_REVIEW" = "PASS";
    let confidence = 0.95;

    if (!goalComplete || !safetyOk) {
      decision = "FAIL";
      confidence = 0.90;
    } else if (!evidenceOk) {
      decision = "NEEDS_REVIEW";
      confidence = 0.75;
    }

    return {
      decision,
      confidence,
      goalComplete,
      safetyOk,
      evidenceOk,
      issues,
      evaluatedAt: Date.now(),
    };
  }
}

let reviewerCouncilInstance: MobileReviewerCouncil | null = null;
export function getMobileReviewerCouncil(): MobileReviewerCouncil {
  if (!reviewerCouncilInstance) {
    reviewerCouncilInstance = new MobileReviewerCouncil();
  }
  return reviewerCouncilInstance;
}
