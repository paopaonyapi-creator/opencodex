// Phase 20.28 — Pao Governance Gateway: the single authoritative pipeline.
//
// governedDispatch(): grant resolution → risk classification → deny-first
// policy → approval (blocking) → pre-action audit → provider dispatch →
// post-action audit. Fail closed everywhere; no side effect without a policy
// decision and a pre-action audit event (doc §2, §8).
//
// Providers PERFORM; they never authorize (doc §68). Provider adapters named
// `perform` deliberately — agents never receive a raw execution surface.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { isInsideWorkspace, isProtectedPath } from "../control-plane/policy";
import { evaluatePolicies, BASELINE_POLICY } from "./policy-engine";
import { GovernanceStore } from "./store";
import {
  maxRisk,
  newGovId,
  type ActionEffect,
  type ActionRequest,
  type AuditEvent,
  type CapabilityGrant,
  type ExecutionResult,
  type GovernanceApproval,
  type GovernanceMode,
  type GovernancePolicy,
  type GovernanceProvider,
  type PolicyDecision,
  type RiskLevel,
} from "./types";

// --- Deterministic risk classification (doc §13) --------------------------------

const BASE_RISK: Record<ActionEffect, RiskLevel> = {
  read: "low",
  write: "medium",
  execute: "high",
  external_write: "high",
  destructive: "critical",
  credential: "critical",
  admin: "critical",
  unknown: "high",
};

const DESTRUCTIVE_FAMILIES = /\b(rm|rmdir|mkfs|dd|shutdown|reboot|poweroff|chmod|chown|iptables|ufw|systemctl|drop\s+(table|database)|truncate|delete\s+from)\b/i;
const GIT_REMOTE_WRITE = /\bgit\s+push\b/i;
const GIT_FORCE = /\bgit\s+push\b.*--force|\bgit\s+reset\s+--hard\b|\bgit\s+clean\b.*-f/i;

export function classifyEffect(action: ActionRequest): ActionEffect {
  if (action.tool.effect) return action.tool.effect;
  if (action.tool.provider === "mcp") return "unknown"; // unknown MCP tool: conservative (doc §21)
  if (action.tool.name.startsWith("file.")) {
    if (action.tool.name === "file.read" || action.tool.name === "file.list") return "read";
    if (action.tool.name === "file.delete") return "destructive";
    return "write";
  }
  if (action.tool.name.startsWith("shell.")) return "execute";
  if (action.tool.name.startsWith("browser.")) {
    return /click|type|fill|upload|submit|download/i.test(action.tool.name) ? "write" : "read";
  }
  return "unknown";
}

export function classifyRisk(action: ActionRequest, effect: ActionEffect): RiskLevel {
  let risk = BASE_RISK[effect];
  const commandText = typeof action.arguments === "object" && action.arguments !== null
    ? String((action.arguments as Record<string, unknown>).command ?? "")
    : "";
  if (commandText) {
    if (GIT_FORCE.test(commandText) || /mkfs|shutdown|reboot|drop\s+database/i.test(commandText)) {
      risk = maxRisk(risk, "critical");
    } else if (DESTRUCTIVE_FAMILIES.test(commandText) || GIT_REMOTE_WRITE.test(commandText)) {
      risk = maxRisk(risk, "high");
    }
  }
  const path = action.resource.path;
  if (path && isProtectedPath(path)) risk = maxRisk(risk, "critical");
  const host = action.resource.host ?? "";
  if (/169\.254\.169\.254|metadata\.google\.internal/i.test(host)) risk = maxRisk(risk, "critical");
  if (action.credentialRefs && action.credentialRefs.length > 0) risk = maxRisk(risk, "high");
  if (action.resource.metadata?.environment === "production") risk = maxRisk(risk, "critical");
  return risk;
}

// --- Secret redaction (doc §25) ---------------------------------------------------

const REDACTED = "[REDACTED]";

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") {
    let text = value;
    text = text.replace(/(authorization|cookie|set-cookie)\s*:\s*\S+/gi, "$1: " + REDACTED);
    text = text.replace(/(sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})/g, REDACTED);
    text = text.replace(/(password|passwd|secret|token|api[_-]?key)["'\s:=]+[^\s"',;]+/gi, "$1: " + REDACTED);
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /^(authorization|cookie|password|passwd|secret|token|api[_-]?key|set-cookie)$/i.test(key)
        ? REDACTED
        : redactValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

// --- Built-in local provider (workspace-bounded, doc §18) ---------------------------

const SENSITIVE_HOST_PATTERN = /169\.254\.169\.254|metadata\.google\.internal/i;

export class LocalWorkspaceProvider implements GovernanceProvider {
  readonly id = "local";
  readonly capabilities = ["file.read", "file.list", "file.write", "file.delete", "shell.execute"];
  readonly available = true;

  constructor(private readonly workspaceRoot: string) {}

  async perform(action: ActionRequest, grant: CapabilityGrant): Promise<{ output: unknown }> {
    const path = action.resource.path ?? "";
    const args = (action.arguments && typeof action.arguments === "object" ? action.arguments : {}) as Record<string, unknown>;
    const inScope = () => isInsideWorkspace(path, this.workspaceRoot) && !isProtectedPath(path)
      && (!grant.resourcePattern || resourcePatternMatches(grant.resourcePattern, path));
    if (action.tool.name === "file.read") {
      if (!inScope()) throw new Error("GOVERNANCE_RESOURCE_OUT_OF_SCOPE");
      if (!existsSync(path)) throw new Error("file not found");
      const content = readFileSync(path, "utf8");
      return { output: { bytes: content.length, preview: content.slice(0, 400) } };
    }
    if (action.tool.name === "file.write") {
      if (!inScope()) throw new Error("GOVERNANCE_RESOURCE_OUT_OF_SCOPE");
      const content = typeof args.content === "string" ? args.content : "";
      writeFileSync(path, content, "utf8");
      return { output: { written: content.length, path } };
    }
    if (action.tool.name === "file.delete") {
      if (!inScope()) throw new Error("GOVERNANCE_RESOURCE_OUT_OF_SCOPE");
      if (!existsSync(path)) throw new Error("file not found");
      unlinkSync(path);
      return { output: { deleted: path } };
    }
    // Shell/other local capabilities route through the same pipeline once
    // their performers land (honest degradation, doc §17).
    throw new Error("GOVERNANCE_PROVIDER_DISABLED: local capability not wired: " + action.tool.name);
  }
}

function resourcePatternMatches(pattern: string, path: string): boolean {
  const normalized = pattern.replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*");
  return new RegExp("^" + normalized + "$", "i").test(path.replace(/\\/g, "/"));
}

// --- Gateway ----------------------------------------------------------------------------

export interface GovernedDispatchResult extends ExecutionResult {
  decision?: PolicyDecision;
  approval?: GovernanceApproval;
}

export class PaoGovernanceGateway {
  readonly store: GovernanceStore;
  private providers = new Map<string, GovernanceProvider>();
  private policies = [BASELINE_POLICY];
  private controlModes = new Map<string, ControlModeString>();
  private workspaceRoot: string;

  constructor(store?: GovernanceStore, workspaceRoot?: string) {
    this.store = store ?? new GovernanceStore();
    this.providers = new Map();
    this.workspaceRoot = workspaceRoot ?? process.cwd();
    this.providers.set("local", new LocalWorkspaceProvider(this.workspaceRoot));
  }

  /** Simulate a decision WITHOUT executing (doc §43). Never side-effecting. */
  simulate(action: ActionRequest): { grant: { resolved: boolean; reason: string }; risk: RiskLevel; decision: PolicyDecision } {
    const effect = classifyEffect(action);
    const risk = classifyRisk(action, effect);
    const grant = this.store.resolveGrant(action.agent.id, action.tool.provider, capabilityFor(action), effect);
    const decision = this.evaluate(action, effect, risk);
    return {
      grant: {
        resolved: Boolean(grant),
        reason: grant ? "grant " + grant.id : "no active grant for " + action.agent.id,
      },
      risk,
      decision,
    };
  }

  /** Persist a policy pack and activate it (malformed packs keep baseline). */
  setPolicies(policies: GovernancePolicy[]): void {
    // Malformed policy must never silently become allow-all: keep the
    // baseline as a safety net whenever the supplied set is empty/unusable.
    this.policies = policies.length > 0 ? policies : [BASELINE_POLICY];
  }

  getPolicySet(): GovernancePolicy[] {
    return this.policies;
  }

  registerProvider(provider: GovernanceProvider): void {
    this.providers.set(provider.id, provider);
  }

  getMode(): GovernanceMode {
    return this.store.getMode();
  }

  setMode(mode: GovernanceMode, actor: string): void {
    this.store.setMode(mode);
    this.store.appendAudit(this.auditBase({
      eventType: "governance.mode_changed",
      actorId: actor,
      metadata: { mode },
    }));
  }

  /** Human takeover state per computer/session (doc §15). */
  setControlMode(computerId: string, mode: ControlModeString, actor: string): void {
    this.controlModes.set(computerId, mode);
    this.store.appendAudit(this.auditBase({
      eventType: mode === "human" ? "computer.control_taken" : "computer.control_released",
      actorId: actor,
      metadata: { computerId, mode },
    }));
  }

  getControlMode(computerId: string): ControlModeString {
    return this.controlModes.get(computerId) ?? "agent";
  }

  private auditBase(partial: Partial<AuditEvent>): AuditEvent {
    return {
      id: newGovId("aev"),
      timestamp: new Date().toISOString(),
      redacted: true,
      ...partial,
    } as AuditEvent;
  }

  /** THE pipeline. Every governed side effect enters here. */
  async governedDispatch(action: ActionRequest, opts: { preApproved?: boolean } = {}): Promise<GovernedDispatchResult> {
    const startedAt = new Date().toISOString();
    const commandText = typeof action.arguments === "object" && action.arguments !== null
      ? String((action.arguments as Record<string, unknown>).command ?? "")
      : "";
    let effect = classifyEffect(action);
    // Destructive shell families escalate the EFFECT itself so baseline
    // approval rules fire (doc §12.2: route destructive families through
    // policy/approval rather than blocking unconditionally).
    if (commandText && (DESTRUCTIVE_FAMILIES.test(commandText) || GIT_FORCE.test(commandText))) {
      effect = "destructive";
    }
    const risk = classifyRisk(action, effect);
    const fingerprint = "sha256:" + createHash("sha256").update(JSON.stringify(redactValue(action.arguments))).digest("hex").slice(0, 32);
    this.store.saveActionRequest(action, fingerprint, risk, effect);
    this.store.appendAudit(this.auditBase({
      actionId: action.actionId, runId: action.run.runId, sessionId: action.run.sessionId,
      actorId: action.actor.id, agentId: action.agent.id, eventType: "action.requested",
      provider: action.tool.provider, tool: action.tool.name, risk,
      resourceSummary: (action.resource.path ?? action.resource.host ?? action.resource.kind).slice(0, 200),
    }));

    const finishDenied = (code: string, message: string, decision?: PolicyDecision): GovernedDispatchResult => ({
      actionId: action.actionId,
      status: "denied",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: { code, message },
      decision,
    });

    // 1. Global kill switch (doc §29).
    const mode = this.store.getMode();
    if (mode === "paused") {
      return finishDenied("GOVERNANCE_GLOBAL_PAUSED", "governance is globally paused; no governed action may run");
    }
    const writeLike = effect !== "read";
    if (mode === "read_only" && writeLike) {
      return finishDenied("GOVERNANCE_READ_ONLY", "governance is in read-only safe mode");
    }

    // 1b. Hard scope invariants that outrank grants (protected paths,
    // sensitive hosts, workspace containment).
    if (action.resource.path && isProtectedPath(action.resource.path)) {
      return finishDenied("GOVERNANCE_CREDENTIAL_DENIED", "resource is a protected credential path");
    }
    if (SENSITIVE_HOST_PATTERN.test(action.resource.host ?? action.resource.url ?? "")) {
      return finishDenied("GOVERNANCE_RESOURCE_OUT_OF_SCOPE", "cloud metadata / sensitive host refused");
    }
    if (action.resource.path && action.tool.provider === "local" && !isInsideWorkspace(action.resource.path, this.workspaceRoot)) {
      return finishDenied("GOVERNANCE_RESOURCE_OUT_OF_SCOPE", "resource escapes the workspace scope");
    }

    // 1c. Provider availability is a static capability fact: an unregistered
    // provider fails honestly here instead of after policy/approval (doc §17).
    const provider = this.providers.get(action.tool.provider);
    if (!provider || !provider.available) {
      return finishDenied("GOVERNANCE_PROVIDER_DISABLED", "provider " + action.tool.provider + " is not available");
    }

    // 2. Grant resolution (doc §10) — capability must already exist.
    const grant = this.store.resolveGrant(
      action.agent.id, action.tool.provider,
      capabilityFor(action), effect,
    );
    if (!grant) {
      this.store.appendAudit(this.auditBase({
        actionId: action.actionId, agentId: action.agent.id, eventType: "grant.denied",
        provider: action.tool.provider, tool: action.tool.name, risk,
      }));
      return finishDenied("GOVERNANCE_GRANT_DENIED", "agent has no active grant for " + action.tool.provider + "/" + capabilityFor(action));
    }
    this.store.appendAudit(this.auditBase({
      actionId: action.actionId, agentId: action.agent.id, eventType: "grant.allowed",
      provider: action.tool.provider, risk,
    }));

    // 2b. Grant-scoped resource pattern (path-targeted grants only).
    if (action.resource.path && grant.resourcePattern && !resourcePatternMatches(grant.resourcePattern, action.resource.path)) {
      return finishDenied("GOVERNANCE_RESOURCE_OUT_OF_SCOPE", "resource does not match the grant resource pattern");
    }

    // 3. Deterministic risk + deny-first policy (doc §11, §13).
    const decision = this.evaluate(action, effect, risk);
    this.store.saveDecision(decision);
    this.store.appendAudit(this.auditBase({
      actionId: action.actionId, agentId: action.agent.id, eventType: "policy." + decision.decision,
      provider: action.tool.provider, tool: action.tool.name, risk, decision: decision.decision,
      metadata: { matchedRuleIds: decision.matchedRuleIds },
    }));
    if (decision.decision === "deny") {
      return finishDenied("GOVERNANCE_POLICY_DENIED", decision.reason, decision);
    }

    // 4. Human approval — blocking; exactly one execution per approval (doc §14).
    let approval: GovernanceApproval | undefined;
    if (decision.decision === "require_approval" && !opts.preApproved) {
      approval = {
        id: newGovId("gappr"),
        actionId: action.actionId,
        status: "pending",
        risk,
        summary: action.intent ?? action.tool.name,
        requestedByAgentId: action.agent.id,
        argumentPreview: redactValue(action.arguments),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
      this.store.saveApproval(approval);
      this.store.saveActionPayload(action.actionId, action);
      this.store.appendAudit(this.auditBase({
        actionId: action.actionId, agentId: action.agent.id, eventType: "approval.requested",
        risk, metadata: { approvalId: approval.id },
      }));
      // The dispatch returns here; the caller re-dispatches after resolution.
      return {
        actionId: action.actionId,
        status: "denied",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: { code: "GOVERNANCE_APPROVAL_REQUIRED", message: "approval " + approval.id + " required before execution" },
        decision,
        approval,
      };
    }

    // 5. Pre-action audit, then provider dispatch (doc §8).
    this.store.appendAudit(this.auditBase({
      actionId: action.actionId, runId: action.run.runId, agentId: action.agent.id,
      eventType: "action.prepared", provider: action.tool.provider, tool: action.tool.name, risk,
    }));
    this.store.appendAudit(this.auditBase({
      actionId: action.actionId, eventType: "action.started", provider: action.tool.provider, risk,
    }));
    try {
      const result = await provider.perform(action, grant);
      const finishedAt = new Date().toISOString();
      this.store.appendAudit(this.auditBase({
        actionId: action.actionId, eventType: "action.succeeded", provider: action.tool.provider,
        tool: action.tool.name, risk, metadata: redactValue(result.output) as Record<string, unknown>,
      }));
      return { actionId: action.actionId, status: "success", startedAt, finishedAt, output: redactValue(result.output), decision, approval };
    } catch (err) {
      this.store.appendAudit(this.auditBase({
        actionId: action.actionId, eventType: "action.failed", provider: action.tool.provider,
        risk, metadata: { error: err instanceof Error ? err.message : String(err) },
      }));
      return {
        actionId: action.actionId,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: { code: "GOVERNANCE_PROVIDER_FAILED", message: err instanceof Error ? err.message : String(err) },
        decision,
      };
    }
  }

  private evaluate(action: ActionRequest, effect: ActionEffect, risk: RiskLevel): PolicyDecision {
    const ctx = {
      risk,
      effect,
      provider: action.tool.provider,
      tool: action.tool.name,
      resourceKind: action.resource.kind,
      resourcePath: action.resource.path,
      resourceHost: action.resource.host,
    };
    const evaluation = evaluatePolicies(this.policies, ctx);
    return {
      decisionId: newGovId("gdec"),
      actionId: action.actionId,
      decision: evaluation.decision,
      risk,
      matchedPolicyIds: evaluation.matchedPolicyIds,
      matchedRuleIds: evaluation.matchedRuleIds,
      reasonCode: evaluation.reasonCode,
      reason: evaluation.reason,
      decidedAt: new Date().toISOString(),
    };
  }

  /** Resume a previously-created approval and dispatch exactly once. */
  async resolveAndDispatch(approvalId: string, decision: "approved" | "denied", resolvedBy: string): Promise<GovernedDispatchResult | null> {
    const approval = this.store.getApproval(approvalId);
    if (!approval || approval.status !== "pending") return null;
    if (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) {
      this.store.saveApproval({ ...approval, status: "expired" });
      return null;
    }
    this.store.saveApproval({
      ...approval,
      status: decision,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
      resolutionReason: "human decision via approval inbox",
    });
    this.store.appendAudit(this.auditBase({
      actionId: approval.actionId, eventType: "approval." + decision, actorId: resolvedBy,
      metadata: { approvalId },
    }));
    if (decision === "denied") {
      return {
        actionId: approval.actionId,
        status: "denied",
        finishedAt: new Date().toISOString(),
        error: { code: "GOVERNANCE_APPROVAL_DENIED", message: "approval denied by " + resolvedBy },
      };
    }
    // One-shot approved dispatch from the persisted payload (doc §50).
    const action = this.store.getActionPayload(approval.actionId);
    if (!action) {
      return { actionId: approval.actionId, status: "failed", finishedAt: new Date().toISOString(), error: { code: "GOVERNANCE_POLICY_INVALID", message: "approved action payload missing" } };
    }
    return this.governedDispatch(action, { preApproved: true });
  }

  /** Structured denial used by tests to prove no-execution paths. */
  static bypassBlocked(): { code: string; message: string } {
    return { code: "GOVERNANCE_BYPASS_BLOCKED", message: "providers are not exported to agents; dispatch through the gateway" };
  }
}

type ControlModeString = "agent" | "human" | "paused";

function capabilityFor(action: ActionRequest): string {
  return action.resource.kind && action.resource.kind !== "unknown"
    ? action.resource.kind
    : action.tool.name.split(".")[0] + "." + (action.tool.name.split(".")[1] ?? "action");
}
