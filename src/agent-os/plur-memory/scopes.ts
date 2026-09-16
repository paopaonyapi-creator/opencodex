// Phase 20.43 — ScopeResolver (spec §4) + SecretGuard (spec §11) + PolicyEngine
// (spec §12). Deterministic, fail-closed: ambiguous scope inference never
// falls back to global; secret-bearing writes are blocked with only
// category/fingerprint metadata retained; policy decisions are explainable
// with matched rule ids.

import { createHash } from "node:crypto";
import { redactText } from "../coding-cockpit/redaction";
import { MemoryError } from "./types";
import type { MemoryOperation, MemoryPolicyDecision, MemoryRequestContext, MemoryType, ScopeFamily } from "./types";

// --- Scope resolver -----------------------------------------------------------------

const BARE_SCOPES = new Set(["local", "global"]);

export function parseScope(scope: string): ScopeFamily | null {
  if (BARE_SCOPES.has(scope)) return { family: scope as "local" | "global", id: null, scope };
  return matchScope(scope);
}

function matchScope(scope: string): ScopeFamily | null {
  const colon = scope.indexOf(":");
  if (colon <= 0) return null;
  const family = scope.slice(0, colon);
  const id = scope.slice(colon + 1);
  if (!["user", "project", "workspace", "agent", "service", "environment", "group"].includes(family)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(id)) return null;
  return { family: family as ScopeFamily["family"], id, scope };
}

export class ScopeResolver {
  constructor(private readonly defaultScope: string) {}

  /** Write-scope precedence (spec §4): explicit approved scope → project
   *  policy → adapter default → session → configured default → local.
   *  NEVER global on ambiguity. */
  resolveWriteScope(input: {
    explicitScope?: string | null;
    projectId?: string | null;
    workspaceId?: string | null;
    agentScopeDefault?: string | null;
    sessionId?: string | null;
  }): { scope: string; basis: string } {
    const candidates: Array<{ scope: string | null; basis: string }> = [
      { scope: input.explicitScope ?? null, basis: "explicit" },
      { scope: input.projectId ? "project:" + input.projectId : null, basis: "project policy" },
      { scope: input.workspaceId ? "workspace:" + input.workspaceId : null, basis: "workspace policy" },
      { scope: input.agentScopeDefault ?? null, basis: "adapter default" },
      { scope: input.sessionId ? "local" : null, basis: "session scope" },
      { scope: this.defaultScope, basis: "configured default" },
      { scope: "local", basis: "safe local fallback" },
    ];
    for (const candidate of candidates) {
      if (!candidate.scope) continue;
      const parsed = parseScope(candidate.scope);
      if (parsed) return { scope: parsed.scope, basis: candidate.basis };
    }
    return { scope: "local", basis: "safe local fallback" };
  }

  /** Read-scope expansion: exact project scope + explicit workspace + agent
   *  scope + configured default; global/user ONLY when policy permits;
   *  never unrelated project scopes. */
  expandReadScopes(input: { projectId?: string | null; workspaceId?: string | null; agentId?: string | null; includeGlobal: boolean }): string[] {
    const scopes = new Set<string>();
    if (input.projectId) scopes.add("project:" + input.projectId);
    if (input.workspaceId) scopes.add("workspace:" + input.workspaceId);
    if (input.agentId) scopes.add("agent:" + input.agentId);
    scopes.add(this.defaultScope);
    scopes.add("local");
    if (input.includeGlobal) scopes.add("global");
    return [...scopes];
  }

  /** Project isolation: a project actor may not read another project's scope. */
  static canReadScope(actor: MemoryRequestContext, scope: string): boolean {
    const parsed = parseScope(scope);
    if (!parsed) return false;
    if (parsed.family === "local" || parsed.family === "global") return true;
    if (parsed.family === "project" && actor.projectId && parsed.id !== actor.projectId) return false;
    if (parsed.family === "workspace" && actor.workspaceId && parsed.id !== actor.workspaceId) return false;
    return true;
  }
}

// --- Secret guard ------------------------------------------------------------------------

const SECRET_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "openai_key", pattern: /sk-[A-Za-z0-9_-]{12,}/g },
  { category: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9_-]{12,}/g },
  { category: "github_token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { category: "slack_token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { category: "jwt", pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { category: "bearer", pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { category: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { category: "env_assignment", pattern: /^\s*[A-Z0-9_]*?(KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*\S{6,}/gm },
  { category: "json_secret_field", pattern: /"(password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key)"\s*:\s*"[^"]{6,}"/gi },
  { category: "db_url", pattern: /(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s"']+/gi },
  { category: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
];

export interface SecretFinding {
  category: string;
  fieldPath: string;
  fingerprint: string;
}

export function fingerprintOf(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class MemorySecretGuard {
  /** Defense-in-depth scan before durable writes and before sync. Returns
   *  category + field path + fingerprint only — never the raw value. */
  scan(content: string, fieldPath = "content"): { clean: boolean; findings: SecretFinding[] } {
    const findings: SecretFinding[] = [];
    for (const detector of SECRET_PATTERNS) {
      const matches = content.match(detector.pattern);
      if (matches) {
        for (const matched of matches.slice(0, 8)) {
          findings.push({ category: detector.category, fieldPath, fingerprint: fingerprintOf(matched) });
        }
      }
    }
    return { clean: findings.length === 0, findings };
  }

  /** Redact-then-keep: return content safe for storage. */
  redact(content: string): string {
    return redactText(content);
  }
}

// --- Policy engine -----------------------------------------------------------------------

export interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  action: "allow" | "deny" | "require_approval" | "redact" | "force_scope" | "force_visibility";
  operation: MemoryOperation | "any";
  matcherJson: string;
  effectJson: string;
}

export interface PolicyEvaluationInput {
  operation: MemoryOperation;
  ctx: MemoryRequestContext;
  scope: string;
  sensitivity: "normal" | "sensitive";
  memoryType: MemoryType;
  sourceKind: string;
  secretFindings: number;
  contentChars: number;
}

export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  { id: "deny_secrets", name: "deny-durable-secret-material", enabled: true, priority: 100, action: "deny", operation: "learn", matcherJson: JSON.stringify({ secretFindingsGreaterThan: 0 }), effectJson: "{}" },
  { id: "deny_sync_when_disabled", name: "deny-unknown-remote-sync", enabled: true, priority: 100, action: "deny", operation: "sync", matcherJson: JSON.stringify({ syncDisabled: true }), effectJson: "{}" },
  { id: "approval_rescope_private_to_shared", name: "approval-rescope-to-shared", enabled: true, priority: 80, action: "require_approval", operation: "rescope", matcherJson: JSON.stringify({ targetScopePrefix: "group:" }), effectJson: "{}" },
  { id: "approval_bulk_forget", name: "approval-bulk-forget", enabled: true, priority: 80, action: "require_approval", operation: "forget", matcherJson: JSON.stringify({ bulk: true }), effectJson: "{}" },
  { id: "allow_project_rules_from_trusted", name: "allow-project-rules-trusted-agents", enabled: true, priority: 20, action: "allow", operation: "learn", matcherJson: JSON.stringify({ scopeFamily: "project", trust: ["trusted", "system"], sourceKinds: ["explicit", "candidate"] }), effectJson: "{}" },
  { id: "deny_cross_project_read", name: "deny-unrelated-project-scope", enabled: true, priority: 90, action: "deny", operation: "recall", matcherJson: JSON.stringify({ crossProject: true }), effectJson: "{}" },
  { id: "local_only_machine_quirks", name: "force-local-for-machine-quirks", enabled: true, priority: 40, action: "force_scope", operation: "learn", matcherJson: JSON.stringify({ memoryTypes: ["temporary_context"] }), effectJson: JSON.stringify({ scope: "local" }) },
  { id: "redact_sensitive_content", name: "redact-sensitive-then-approve", enabled: true, priority: 60, action: "redact", operation: "learn", matcherJson: JSON.stringify({ sensitivity: "sensitive" }), effectJson: "{}" },
];

export class MemoryPolicyEngine {
  private rules: PolicyRule[];

  constructor(rules?: PolicyRule[]) {
    this.rules = rules ?? DEFAULT_POLICY_RULES;
  }

  listRules(): PolicyRule[] {
    return this.rules;
  }

  setRules(rules: PolicyRule[]): void {
    this.rules = rules;
  }

  evaluate(input: PolicyEvaluationInput): MemoryPolicyDecision {
    const applicable = this.rules
      .filter((rule) => rule.enabled && (rule.operation === "any" || rule.operation === input.operation))
      .sort((a, b) => b.priority - a.priority);

    const matched: PolicyRule[] = [];
    for (const rule of applicable) {
      if (this.ruleMatches(rule, input)) matched.push(rule);
    }

    let decision: MemoryPolicyDecision = {
      decision: "allow", matchedRuleIds: [], reason: "no restrictive rule matched",
      forcedScope: null, forcedVisibility: null, requiredApprovalType: null,
    };

    for (const rule of matched) {
      if (rule.action === "deny") {
        return {
          decision: "deny", matchedRuleIds: [rule.id], reason: "denied by rule " + rule.name,
          forcedScope: null, forcedVisibility: null, requiredApprovalType: null,
        };
      }
      if (rule.action === "require_approval") {
        decision = {
          decision: "require_approval", matchedRuleIds: [...decision.matchedRuleIds, rule.id],
          reason: "approval required by rule " + rule.name, forcedScope: decision.forcedScope,
          forcedVisibility: null, requiredApprovalType: rule.name,
        };
      } else if (rule.action === "force_scope") {
        const effect = JSON.parse(rule.effectJson) as { scope?: string };
        decision = { ...decision, matchedRuleIds: [...decision.matchedRuleIds, rule.id], forcedScope: effect.scope ?? decision.forcedScope, reason: "scope forced by rule " + rule.name };
      } else if (rule.action === "redact") {
        decision = {
          decision: decision.decision === "deny" ? "deny" : decision.decision === "require_approval" ? "require_approval" : "redact",
          matchedRuleIds: [...decision.matchedRuleIds, rule.id],
          reason: "redaction required by rule " + rule.name, forcedScope: decision.forcedScope,
          forcedVisibility: decision.forcedVisibility, requiredApprovalType: decision.requiredApprovalType,
        };
      }
    }
    return decision;
  }

  private ruleMatches(rule: PolicyRule, input: PolicyEvaluationInput): boolean {
    let matcher: Record<string, unknown>;
    try {
      matcher = JSON.parse(rule.matcherJson) as Record<string, unknown>;
    } catch {
      return false;
    }
    if (matcher.secretFindingsGreaterThan !== undefined && input.secretFindings <= Number(matcher.secretFindingsGreaterThan)) return false;
    if (matcher.syncDisabled === true && process.env.PAO_MEMORY_SYNC_ENABLED !== "true") return true;
    if (matcher.syncDisabled === true) return false;
    if (matcher.targetScopePrefix !== undefined && !(input.scope.startsWith(String(matcher.targetScopePrefix)))) return false;
    if (matcher.bulk === true && input.operation !== "forget") return false;
    if (matcher.scopeFamily !== undefined) {
      const parsed = parseScope(input.scope);
      if (!parsed || parsed.family !== matcher.scopeFamily) return false;
    }
    if (Array.isArray(matcher.trust) && !matcher.trust.includes(input.ctx.agentTrust)) return false;
    if (Array.isArray(matcher.sourceKinds) && !matcher.sourceKinds.includes(input.sourceKind)) return false;
    if (matcher.crossProject === true) {
      if (!ScopeResolver.canReadScope(input.ctx, input.scope)) return true;
      return false;
    }
    if (Array.isArray(matcher.memoryTypes) && !matcher.memoryTypes.includes(input.memoryType)) return false;
    if (matcher.sensitivity !== undefined && matcher.sensitivity !== input.sensitivity) return false;
    return true;
  }
}

export function memoryCorrelationId(): string {
  return "memcorr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function requireEnabled(flag: boolean): void {
  if (!flag) {
    throw new MemoryError("MEMORY_DISABLED", "memory subsystem is disabled by configuration");
  }
}
