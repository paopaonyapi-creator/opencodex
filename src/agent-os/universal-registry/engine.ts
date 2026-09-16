// Phase 20.25 — Step engine: permission gate, approval gate, fallback engine,
// circuit breaker (doc §19, §24, §69, §70).
//
// Every execution flows through: permission check → approval gate → adapter
// selection → run → fallback on retryable errors. Adapters can never bypass
// policy: they are only reached through this module. Adapter results are
// reduced to validated primitives (whitelisted error codes, sanitized
// summaries) before anything is persisted.

import { randomUUID } from "node:crypto";
import { evaluatePermission } from "./risk";
import { adapterFor } from "./adapters";
import { auditSummary, sanitizeForAudit } from "./util";
import type {
  ExecutionContext,
  PermissionResult,
  RunStepRecord,
  ToolErrorCode,
  ToolRecord,
} from "./types";
import type { UniversalRegistryStore } from "./registry-store";
import { isRetryableErrorCode } from "./types";

export interface RuntimeDeps {
  store: UniversalRegistryStore;
  workspaceRoot: string;
  actor?: string;
  /** Adapter set override (DI for tests and embedders); defaults to DEFAULT_ADAPTERS. */
  adapters?: import("./types").ToolAdapter[];
}

const KNOWN_ERROR_CODES = new Set<string>([
  "AUTH_ERROR", "RATE_LIMIT", "TIMEOUT", "PROVIDER_ERROR", "INVALID_INPUT",
  "POLICY_BLOCK", "APPROVAL_REQUIRED", "TOOL_UNAVAILABLE", "QUALITY_FAILED",
  "SSRF_BLOCK", "UNKNOWN",
]);

/** Minimal circuit breaker per provider (doc §70). */
export class CircuitBreaker {
  private failures = new Map<string, number>();
  private openedAt = new Map<string, number>();
  private readonly threshold = 3;
  private readonly cooldownMs = 60_000;

  allow(provider: string): boolean {
    const opened = this.openedAt.get(provider);
    if (opened === undefined) return true;
    if (Date.now() - opened >= this.cooldownMs) {
      // HALF_OPEN: allow one probe through.
      this.openedAt.delete(provider);
      return true;
    }
    return false;
  }

  recordSuccess(provider: string): "closed" {
    this.failures.delete(provider);
    this.openedAt.delete(provider);
    return "closed";
  }

  recordFailure(provider: string): "closed" | "opened" {
    const count = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, count);
    if (count >= this.threshold) {
      this.openedAt.set(provider, Date.now());
      return "opened";
    }
    return "closed";
  }
}

export interface ExecuteStepOutcome {
  status: "completed" | "failed" | "waiting_approval" | "fallback_used";
  step: RunStepRecord;
  permission: PermissionResult;
  approvalId?: string;
  usedFallbackToolId?: string;
  fallbackTriggered?: boolean;
}

function actionKey(toolId: string, capability: string): string {
  return toolId + "::" + capability;
}

/** Restrict capability labels to the taxonomy alphabet before any persistence. */
function normalizeCapability(raw: string): string {
  return String(raw).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 80);
}

/** Reduce arbitrary caller input to plain JSON before an adapter sees it. */
function toPlainJson(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** Validated primitives extracted from an adapter result. */
interface CleanResult {
  ok: boolean;
  errorCode: ToolErrorCode | undefined;
  latencyMs: number;
  outputSummary: string;
}

/**
 * Execute one planned step: pick the selected tool, check policy, request
 * approval when required, and walk the fallback chain on retryable failures.
 */
export async function executeStep(
  deps: RuntimeDeps,
  breaker: CircuitBreaker,
  args: {
    runId: string;
    step: { id: string; capability: string; selectedToolId?: string; fallbackToolIds: string[] };
    input?: Record<string, unknown>;
    approvedActionKeys?: Set<string>;
  },
): Promise<ExecuteStepOutcome> {
  const { store, workspaceRoot } = deps;
  const actor = deps.actor ?? "agent";
  const startedAt = new Date().toISOString();
  const capability = normalizeCapability(args.step.capability);
  const inputSummary = auditSummary(args.input ?? {});
  const localStepId = sanitizeForAudit(String(args.step.id), 64);
  // Step ROW ids are scoped by run: plan step ids ("step_1") repeat across runs.
  const stepId = args.runId + ":" + localStepId;
  const stepIndex = Number(localStepId.replace(/\D/g, "")) || 0;
  const plainInput = toPlainJson(args.input ?? {});

  const candidates: string[] = [];
  if (args.step.selectedToolId) candidates.push(args.step.selectedToolId);
  for (const fallback of args.step.fallbackToolIds) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }

  const approvedKeys = args.approvedActionKeys ?? new Set<string>();
  const stepRecord: RunStepRecord = {
    id: stepId,
    runId: args.runId,
    stepIndex,
    capability,
    status: "pending",
    inputSummary,
    startedAt,
  };

  let last: CleanResult | null = null;
  let lastTool: ToolRecord | null = null;
  let permission: PermissionResult = { decision: "denied", riskLevel: 0, reason: "no candidate tool registered for this capability" };
  let fallbackTriggered = false;

  for (const toolId of candidates) {
    const tool = store.getTool(toolId);
    if (!tool || tool.status === "disabled") continue;
    lastTool = tool;
    stepRecord.toolId = tool.id;
    stepRecord.toolName = tool.name;

    // 1. Policy engine (outside the LLM, doc §24).
    const approved = approvedKeys.has(actionKey(tool.id, capability));
    permission = evaluatePermission({ tool, capability, args: plainInput, workspaceRoot, approved });
    if (permission.decision === "denied") {
      store.appendAudit({
        runId: args.runId, stepId, toolId: tool.id, actor,
        action: "execute:" + capability, status: "denied",
        inputSummary, permissionClass: tool.risk.permissionClass,
        riskLevel: permission.riskLevel, errorCode: "POLICY_BLOCK",
      });
      last = { ok: false, outputSummary: sanitizeForAudit(permission.reason), errorCode: "POLICY_BLOCK", latencyMs: 0 };
      continue;
    }
    if (permission.decision === "approval_required") {
      const approval = store.createApproval({
        runId: args.runId,
        stepId,
        toolId: tool.id,
        toolName: tool.name,
        action: "execute:" + capability,
        riskLevel: permission.riskLevel,
        reason: permission.reason,
        preview: inputSummary,
        scope: "once",
      });
      permission = { ...permission, approvalId: approval.id };
      stepRecord.status = "awaiting_approval";
      store.saveStep(stepRecord);
      store.appendAudit({
        runId: args.runId, stepId, toolId: tool.id, actor,
        action: "approval_requested:" + capability, status: "ok",
        inputSummary, permissionClass: tool.risk.permissionClass,
        riskLevel: permission.riskLevel, approvalId: approval.id,
      });
      return { status: "waiting_approval", step: stepRecord, permission, approvalId: approval.id };
    }

    // 2. Circuit breaker.
    if (!breaker.allow(tool.provider)) {
      store.appendAudit({
        runId: args.runId, stepId, toolId: tool.id, actor,
        action: "circuit_open", status: "denied",
        inputSummary, errorCode: "TOOL_UNAVAILABLE",
      });
      last = { ok: false, outputSummary: sanitizeForAudit("circuit breaker open for provider " + tool.provider), errorCode: "TOOL_UNAVAILABLE", latencyMs: 0 };
      continue;
    }

    // 3. Adapter dispatch on the JSON-safe input.
    const adapter = adapterFor(tool, deps.adapters);
    if (!adapter) {
      last = { ok: false, outputSummary: sanitizeForAudit("no universal-runtime executor for " + tool.type + " tools"), errorCode: "TOOL_UNAVAILABLE", latencyMs: 0 };
      store.recordToolRun(tool.id, false, 0, "TOOL_UNAVAILABLE");
      store.appendAudit({
        runId: args.runId, stepId, toolId: tool.id, actor,
        action: "executor_missing", status: "error",
        inputSummary, errorCode: "TOOL_UNAVAILABLE",
        permissionClass: tool.risk.permissionClass, riskLevel: tool.risk.level,
      });
      if (candidates.indexOf(toolId) < candidates.length - 1) {
        fallbackTriggered = true;
        continue;
      }
      break;
    }

    const ctx: ExecutionContext = {
      runId: args.runId,
      stepId,
      workspaceRoot,
      approvedActionKeys: approvedKeys,
      actor,
    };
    const raw = await adapter.run(tool, plainInput, ctx);
    // Reduce the adapter result to validated primitives before persisting:
    // the error code must be a known enum value, the summary must pass the
    // audit sanitizer, and the latency must be a finite number.
    const errCode = (raw.errorCode && KNOWN_ERROR_CODES.has(raw.errorCode) ? raw.errorCode : raw.errorCode ? "PROVIDER_ERROR" : undefined) as ToolErrorCode | undefined;
    const clean: CleanResult = {
      ok: raw.ok === true,
      errorCode: errCode,
      latencyMs: Number.isFinite(raw.latencyMs) ? Math.max(0, Math.round(raw.latencyMs)) : 0,
      outputSummary: auditSummary(raw.outputSummary),
    };
    last = clean;

    store.recordToolRun(tool.id, clean.ok, clean.latencyMs, clean.errorCode);
    breaker.recordFailure(tool.provider);
    if (clean.ok) breaker.recordSuccess(tool.provider);
    store.appendAudit({
      runId: args.runId, stepId, toolId: tool.id, actor,
      action: clean.ok ? "step_completed" : "step_error",
      status: clean.ok ? "ok" : "error",
      inputSummary,
      outputSummary: clean.outputSummary,
      errorCode: clean.errorCode,
      permissionClass: tool.risk.permissionClass,
      riskLevel: tool.risk.level,
      latencyMs: clean.latencyMs,
    });

    if (clean.ok) {
      stepRecord.status = fallbackTriggered ? "fallback_used" : "completed";
      stepRecord.outputSummary = clean.outputSummary;
      stepRecord.finishedAt = new Date().toISOString();
      stepRecord.latencyMs = clean.latencyMs;
      store.saveStep(stepRecord);
      return {
        status: fallbackTriggered ? "fallback_used" : "completed",
        step: stepRecord,
        permission,
        usedFallbackToolId: fallbackTriggered ? tool.id : undefined,
        fallbackTriggered,
      };
    }

    // 4. Fallback on retryable errors only (doc §69).
    if (isRetryableErrorCode(clean.errorCode)) {
      const more = candidates.indexOf(toolId) < candidates.length - 1;
      if (more) {
        fallbackTriggered = true;
        continue;
      }
    }
    break;
  }

  stepRecord.status = "failed";
  stepRecord.errorCode = (last?.errorCode ?? "TOOL_UNAVAILABLE") as ToolErrorCode;
  stepRecord.outputSummary = last?.outputSummary;
  stepRecord.finishedAt = new Date().toISOString();
  store.saveStep(stepRecord);
  store.appendAudit({
    runId: args.runId, stepId, toolId: lastTool?.id, actor,
    action: "step_failed", status: "error",
    inputSummary, outputSummary: last?.outputSummary,
    errorCode: stepRecord.errorCode as ToolErrorCode | undefined, permissionClass: lastTool?.risk.permissionClass,
    riskLevel: lastTool?.risk.level,
  });
  return { status: "failed", step: stepRecord, permission, fallbackTriggered };
}

export function newRunId(): string {
  return "run_" + randomUUID().slice(0, 8);
}
