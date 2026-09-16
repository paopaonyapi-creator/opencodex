// Phase 20.25 — Toolchain planner (doc §17, §18, §37).
//
// Deterministic, rule-based goal decomposition over the capability taxonomy.
// The planner REQUESTS tools; it never grants permissions — every step's risk
// and approval point come from risk.ts, and execution re-checks them.

import { randomUUID } from "node:crypto";
import { decomposeGoal } from "./taxonomy";
import { rankForCapability } from "./ranking";
import { permissionClassFor, requiresApprovalFor, riskLevelFor } from "./risk";
import type {
  PlanStep,
  RankedTool,
  RegistryRiskLevel,
  ToolchainPlan,
  ToolRecord,
} from "./types";
import type { UniversalRegistryStore } from "./registry-store";

export interface PlanOptions {
  profile?: ToolchainPlan["profile"];
  /** Dry run produces the same plan but marks the run as dry_run (doc §37). */
  dryRun?: boolean;
}

export interface PlanStepSelection {
  step: PlanStep;
  candidates: RankedTool[];
  note?: string;
}

export interface PlanResult {
  plan: ToolchainPlan;
  runId: string;
  selections: PlanStepSelection[];
}

function planTitle(capability: string): string {
  return capability
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

/**
 * Build a toolchain plan for a goal. Each step picks the top-ranked candidate
 * for its capability plus up to two fallbacks; steps default to sequential
 * dependency (each depends on the previous one).
 */
export function createPlan(store: UniversalRegistryStore, goal: string, options: PlanOptions = {}): PlanResult {
  const profile = options.profile ?? "balanced";
  const { templateId, capabilities, notes } = decomposeGoal(goal);
  if (templateId) notes.unshift(`matched toolchain template: ${templateId}`);

  const preferences = new Map<string, number>();
  const selections: PlanStepSelection[] = [];
  const steps: PlanStep[] = [];
  let previousStepId: string | undefined;
  let maxRisk: RegistryRiskLevel = 0;

  for (const capability of capabilities) {
    const ranked = rankForCapability(store, capability, { profile, preferences });
    const executableRanked = ranked.filter((r) => r.tool.executable);
    const pool = executableRanked.length > 0 ? executableRanked : ranked;
    const top = pool[0];
    const fallbacks = pool.slice(1, 3).map((r) => r.tool.id);
    const permissionClass = permissionClassFor(capability);
    const riskLevel = riskLevelFor(capability);
    maxRisk = Math.max(maxRisk, riskLevel) as RegistryRiskLevel;

    const step: PlanStep = {
      id: `step_${steps.length + 1}`,
      capability,
      title: planTitle(capability),
      selectedToolId: top?.tool.id,
      selectedToolName: top?.tool.name,
      fallbackToolIds: fallbacks,
      riskLevel,
      permissionClass,
      approvalRequired: requiresApprovalFor(riskLevel),
      dependsOn: previousStepId ? [previousStepId] : [],
    };
    if (!top) {
      notes.push(`no registered tool serves ${capability}; step will require a future integration`);
      step.selectedToolId = undefined;
      step.selectedToolName = undefined;
    } else if (executableRanked.length === 0) {
      notes.push(`only metadata-only candidates for ${capability}; execution will fail with TOOL_UNAVAILABLE until an adapter exists`);
    }
    steps.push(step);
    selections.push({ step, candidates: ranked.slice(0, 5), note: top ? undefined : "no candidate" });
    previousStepId = step.id;
  }

  // Cost estimate: honest "unknown" unless every selected tool has a known
  // cost model (doc §38 — never invent pricing).
  const selectedTools: ToolRecord[] = steps
    .map((s) => (s.selectedToolId ? store.getTool(s.selectedToolId) : null))
    .filter((t): t is ToolRecord => Boolean(t));
  const knownCost = selectedTools.length > 0
    && selectedTools.every((t) => t.cost.model === "free" || t.cost.model === "fixed");
  const estimatedCost = knownCost
    ? selectedTools.every((t) => t.cost.model === "free") ? "free" : "fixed (per provider pricing)"
    : "unknown";

  const approvalRequired = steps.some((s) => s.approvalRequired);
  const plan: ToolchainPlan = {
    id: `plan_${randomUUID().slice(0, 8)}`,
    goal,
    profile,
    steps,
    riskLevel: maxRisk,
    approvalRequired,
    estimatedCost,
    notes,
  };
  return { plan, runId: plan.id, selections };
}
