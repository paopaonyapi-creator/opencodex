// Phase 20.64 — Resource budget engine + policy (spec §19-§21, §48).
//
// Hard caps are pre-GPU: clearly unsafe requests are rejected before any
// runtime sees them. Risk classes map to decisions: LOW auto-allow, MEDIUM
// allow within quota, HIGH require approval, BLOCKED deny with no approval
// path. Agents cannot override limits — the config is the only source.

import type { VisualComputeConfig } from "./config";
import type { VisualPolicyDecision, VisualResourceRequest, VisualRisk } from "./types";

export interface ResourceEstimate {
  textureBytes: number;
  bufferBytes: number;
  readbackBytes: number;
  totalGpuBytes: number;
  artifactBytes: number;
}

/** Estimate GPU + readback + artifact memory for a job (spec §19). */
export function estimateResources(input: { width: number; height: number; bufferBytes: number; outputBytes: number }): ResourceEstimate {
  const textureBytes = input.width * input.height * 4; // RGBA8
  const readbackBytes = textureBytes;
  return {
    textureBytes,
    bufferBytes: input.bufferBytes,
    readbackBytes,
    totalGpuBytes: textureBytes + input.bufferBytes,
    artifactBytes: input.outputBytes,
  };
}

interface BudgetRuleResult {
  ruleId: string;
  result: "pass" | "fail";
  reason: string;
}

/** Hard-cap evaluation. Any fail is BLOCKED — no approval path. */
export function evaluateBudget(input: {
  request: VisualResourceRequest;
  estimate: ResourceEstimate;
  config: VisualComputeConfig;
}): BudgetRuleResult[] {
  const results: BudgetRuleResult[] = [];
  const check = (ruleId: string, ok: boolean, reason: string) => {
    results.push({ ruleId, result: ok ? "pass" : "fail", reason: ok ? "" : reason });
  };
  check("vc.budget.texture_width", input.request.width <= input.config.maxTextureWidth, "width " + input.request.width + " exceeds cap " + input.config.maxTextureWidth);
  check("vc.budget.texture_height", input.request.height <= input.config.maxTextureHeight, "height " + input.request.height + " exceeds cap " + input.config.maxTextureHeight);
  check("vc.budget.single_buffer", input.request.bufferBytes <= input.config.maxSingleBufferBytes, "buffer request exceeds single-buffer cap");
  check("vc.budget.total_gpu", input.estimate.totalGpuBytes <= input.config.maxTotalEstimatedGpuBytes, "estimated GPU memory " + input.estimate.totalGpuBytes + " exceeds cap");
  check("vc.budget.readback", input.request.readbackBytes <= input.config.maxReadbackBytes, "readback exceeds cap");
  return results;
}

/**
 * Risk classification (spec §20). Validation/docs/capability/mock = LOW;
 * bounded render/compute = MEDIUM; large memory/dimensions/long budget or
 * experimental runtime = HIGH; hard-cap violations and unsafe shapes BLOCKED.
 */
export function classifyJobRisk(input: {
  jobType: "render" | "compute" | "validate" | "readback" | "preview";
  estimate: ResourceEstimate;
  request: VisualResourceRequest;
  runtime: "browser" | "node" | "mock" | "native-experimental";
  executionMsBudget: number;
  config: VisualComputeConfig;
}): VisualRisk {
  if (input.runtime === "native-experimental") {
    // Native is only reachable when the flag is on; risk stays HIGH.
    return "high";
  }
  if (input.jobType === "validate" || input.jobType === "readback") return "low";
  if (input.runtime === "mock") return "low";
  if (input.jobType === "preview" && input.request.width <= 512 && input.request.height <= 512) return "low";

  const budget = evaluateBudget({ request: input.request, estimate: input.estimate, config: input.config });
  if (budget.some((r) => r.result === "fail")) return "blocked";

  const largeMemory = input.estimate.totalGpuBytes > input.config.thresholdHighMemoryBytes;
  const largeDimensions = input.request.width > input.config.thresholdHighDimensions || input.request.height > input.config.thresholdHighDimensions;
  const longBudget = input.executionMsBudget > input.config.maxExecutionMs;
  if (largeMemory || largeDimensions || longBudget) return "high";
  return input.jobType === "render" || input.jobType === "compute" ? "medium" : "low";
}

export interface PolicyInput {
  risk: VisualRisk;
  budgetResults: BudgetRuleResult[];
  actorType: "user" | "agent" | "system";
  agentExecuteFlagEnabled: boolean;
  publicExecutionRequested: boolean;
  publicExecutionFlagEnabled: boolean;
  queuedJobsByActor: number;
  maxQueuedJobsPerActor: number;
  runtimeRequested: "browser" | "node" | "mock" | "native-experimental";
  nativeFlagEnabled: boolean;
}

/** Decision contract (spec §21): allow | deny | require_approval. */
export function decidePolicy(input: PolicyInput): VisualPolicyDecision {
  const reasons: string[] = [];
  const evaluatedRules: VisualPolicyDecision["evaluatedRules"] = [];
  let effect: VisualPolicyDecision["effect"] = "allow";
  let risk: VisualRisk = input.risk;

  const record = (ruleId: string, result: "pass" | "fail" | "skip", reason: string) => {
    evaluatedRules.push({ ruleId, result });
    if (result === "fail") reasons.push(reason);
  };

  // BLOCKED: hard caps and unsafe shapes deny outright (spec §48).
  const budgetFails = input.budgetResults.filter((r) => r.result === "fail");
  for (const fail of budgetFails) {
    record(fail.ruleId, "fail", fail.reason);
  }
  if (budgetFails.length > 0 || input.risk === "blocked") {
    return {
      id: "",
      jobId: null,
      effect: "deny",
      risk: "blocked",
      reasons: reasons.length > 0 ? reasons : ["request is blocked by policy"],
      evaluatedRules,
      actorId: "",
      createdAt: "",
    };
  }

  // Native experimental requires the explicit flag (spec §53).
  if (input.runtimeRequested === "native-experimental") {
    record("vc.policy.native_flag", input.nativeFlagEnabled ? "pass" : "fail", "native-experimental runtime is disabled by default");
    if (!input.nativeFlagEnabled) {
      return { id: "", jobId: null, effect: "deny", risk: "blocked", reasons, evaluatedRules, actorId: "", createdAt: "" };
    }
    risk = "high";
  }

  // Public anonymous execution (spec §8).
  if (input.publicExecutionRequested) {
    record("vc.policy.public_execution", input.publicExecutionFlagEnabled ? "pass" : "fail", "public anonymous execution is disabled");
    if (!input.publicExecutionFlagEnabled) {
      return { id: "", jobId: null, effect: "deny", risk: "blocked", reasons, evaluatedRules, actorId: "", createdAt: "" };
    }
  }

  // Actor quota (spec §19).
  record("vc.policy.actor_quota", input.queuedJobsByActor <= input.maxQueuedJobsPerActor ? "pass" : "fail", "actor queue quota exceeded (" + input.queuedJobsByActor + " active jobs)");
  if (input.queuedJobsByActor > input.maxQueuedJobsPerActor) {
    return { id: "", jobId: null, effect: "deny", risk: input.risk, reasons, evaluatedRules, actorId: "", createdAt: "" };
  }

  // Agent execution gate: agents may only execute when the operator flag is on.
  if (input.actorType === "agent") {
    record("vc.policy.agent_execute", input.agentExecuteFlagEnabled ? "pass" : "fail", "agent shader execution is disabled (VGPU_AGENT_SHADER_EXECUTE_ENABLED)");
    if (!input.agentExecuteFlagEnabled && (input.risk === "medium" || input.risk === "high" || risk === "high")) {
      return { id: "", jobId: null, effect: "require_approval", risk: risk === "high" ? "high" : input.risk, reasons, evaluatedRules, actorId: "", createdAt: "" };
    }
  }

  // HIGH always requires human approval (spec §48).
  if (risk === "high") {
    reasons.push("high-risk job requires human approval");
    effect = "require_approval";
  }

  if (reasons.length === 0) reasons.push("within limits; risk " + risk);
  return { id: "", jobId: null, effect, risk, reasons, evaluatedRules, actorId: "", createdAt: "" };
}
