// Phase 20.35 — security primitives (§17-§22, §D): workspace permissions with
// default-deny, provider/agent execution classes, the context firewall
// (LOCAL_ONLY never leaves the machine; SECRET/CREDENTIAL redacted), and the
// secret firewall (secret:// references instead of raw keys, masked logging).

import type { ContextEnvelope, ContextItem, ExecutionClass, UnifiedAIRequest, WorkspacePermission, WorkspacePermissionSet } from "./types";

// --- Workspace permissions (§20): default deny --------------------------------

/** Agent-mode capabilities require the matching workspace grant (§H). */
const AGENT_CAPABILITY_GRANTS: Record<string, WorkspacePermission> = {
  "filesystem_access": "READ_FILES",
  "shell_access": "RUN_COMMANDS",
  "mcp_client": "MCP_TOOLS",
};

export function workspaceAllows(grants: WorkspacePermissionSet | null, permission: WorkspacePermission): boolean {
  // Default deny (§20): only an explicit grant enables a permission.
  return grants?.grants[permission] === true;
}

/** AT-05: an agent request without the required workspace grants is denied.
 *  Required capabilities drive the check; a request that names none defaults
 *  to the core agent grant pair (filesystem + shell). */
export function checkAgentExecution(request: UnifiedAIRequest, grants: WorkspacePermissionSet | null): { allowed: boolean; missing: WorkspacePermission[] } {
  if (request.execution?.class !== "agent_mode") return { allowed: true, missing: [] };
  const required = request.routing?.requiredCapabilities ?? ["filesystem_access", "shell_access"];
  const missing: WorkspacePermission[] = [];
  for (const capability of required) {
    const permission = AGENT_CAPABILITY_GRANTS[capability];
    if (permission && !workspaceAllows(grants, permission) && !missing.includes(permission)) missing.push(permission);
  }
  return { allowed: missing.length === 0, missing };
}

export function executionClassFor(request: UnifiedAIRequest): ExecutionClass {
  return request.execution?.class ?? "provider_mode";
}

// --- Secret firewall (§19) ------------------------------------------------------

const SECRET_SHAPES: Array<{ label: string; pattern: RegExp }> = [
  { label: "openai-style key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { label: "github token", pattern: /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { label: "aws access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "bearer token", pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { label: "assignment", pattern: /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi },
];

/** Redacts anything credential-shaped before logging or provider dispatch. */
export function redactSecrets(text: string): string {
  let output = text;
  for (const shape of SECRET_SHAPES) {
    output = output.replace(shape.pattern, `[REDACTED:${shape.label}]`);
  }
  return output;
}

/** Detects `secret://` references — the ONLY sanctioned way to pass a secret
 *  through a request (spec §19). Returns the reference paths; values are
 *  resolved exclusively from the environment at use time. */
export function extractSecretRefs(text: string): string[] {
  return [...text.matchAll(/secret:\/\/[A-Za-z0-9/_.-]+/g)].map((match) => match[0]);
}

/** Resolution rule: the LAST path segment names the environment variable
 *  (`secret://providers/openai/api-key` → env `API_KEY`). Values live only
 *  in the environment and are resolved at call time. */
export function resolveSecretRef(reference: string): string | null {
  const segments = reference.replace("secret://", "").split("/").filter(Boolean);
  const name = segments[segments.length - 1]?.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  if (!name) return null;
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

// --- Context firewall (§18): classify → filter → minimum required --------------

const SENSITIVE_VALUE_SHAPES = SECRET_SHAPES;

/** Assigns a sensitivity tag heuristically; explicit tags win. */
export function classifyContextItem(item: ContextItem): ContextItem {
  if (item.sensitivity !== "PUBLIC") return item; // caller-declared tags are authoritative
  const lowered = item.key.toLowerCase();
  if (/(secret|credential|password|api[_-]?key|token)/.test(lowered)) return { ...item, sensitivity: "CREDENTIAL" };
  for (const shape of SENSITIVE_VALUE_SHAPES) {
    if (shape.pattern.test(item.value)) return { ...item, sensitivity: "SECRET" };
  }
  if (item.namespace === "workspace" || item.namespace === "project") return { ...item, sensitivity: "PRIVATE" };
  if (item.namespace === "preferences" || item.namespace === "long_term") return { ...item, sensitivity: "INTERNAL" };
  return item;
}

export interface FirewallVerdict {
  envelope: ContextEnvelope;
  dropped: Array<{ key: string; sensitivity: string; reason: string }>;
  redactions: number;
}

/** §18 pipeline: LOCAL_ONLY and cloud-forbidden tags never reach a cloud
 *  provider; SECRET/CREDENTIAL values are replaced with redaction markers in
 *  every destination. Raw evidence is preserved only in the local store. */
export function filterContextForProvider(envelope: ContextEnvelope, providerIsLocal: boolean): FirewallVerdict {
  const dropped: FirewallVerdict["dropped"] = [];
  let redactions = 0;
  const items: ContextItem[] = [];
  for (const raw of envelope.items) {
    const item = classifyContextItem(raw);
    if (item.sensitivity === "SECRET" || item.sensitivity === "CREDENTIAL") {
      dropped.push({ key: item.key, sensitivity: item.sensitivity, reason: "secret firewall: never transmitted" });
      items.push({ ...item, value: "[REDACTED]" });
      redactions += 1;
      continue;
    }
    if (item.sensitivity === "LOCAL_ONLY" && !providerIsLocal) {
      dropped.push({ key: item.key, sensitivity: item.sensitivity, reason: "LOCAL_ONLY items never leave the machine (§18)" });
      continue;
    }
    if (item.sensitivity === "PRIVATE" && !providerIsLocal) {
      dropped.push({ key: item.key, sensitivity: item.sensitivity, reason: "private context withheld from cloud provider" });
      continue;
    }
    items.push(item);
  }
  return { envelope: { ...envelope, items }, dropped, redactions };
}
