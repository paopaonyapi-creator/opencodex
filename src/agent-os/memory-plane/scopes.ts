// Phase 20.41 — Canonical scope registry (spec §24), scope hierarchy,
// server-side policy evaluation, and tool risk classes (spec §22). One
// source of truth for MCP tools, OAuth metadata, docs and policies.
// write NEVER implies delete.

export const MEMORY_SCOPES = ["memory:read", "memory:write", "memory:delete", "memory:trace", "memory:admin"] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/** admin ⊇ everything; delete ⊉ write; write ⊉ delete. */
export const SCOPE_IMPLICATIONS: Record<MemoryScope, readonly MemoryScope[]> = {
  "memory:admin": ["memory:read", "memory:write", "memory:delete", "memory:trace", "memory:admin"],
  "memory:delete": ["memory:delete"],
  "memory:write": ["memory:write"],
  "memory:trace": ["memory:trace"],
  "memory:read": ["memory:read"],
};

export type ToolRiskClass =
  | "READ_ONLY"
  | "WRITE_REVERSIBLE"
  | "DESTRUCTIVE_PREVIEW"
  | "DESTRUCTIVE_CONFIRM"
  | "ADMIN";

/** Minimum scope required per risk class (spec §22). */
export const RISK_CLASS_SCOPE: Record<ToolRiskClass, MemoryScope> = {
  READ_ONLY: "memory:read",
  WRITE_REVERSIBLE: "memory:write",
  DESTRUCTIVE_PREVIEW: "memory:delete",
  DESTRUCTIVE_CONFIRM: "memory:delete",
  ADMIN: "memory:admin",
};

export function isMemoryScope(value: string): value is MemoryScope {
  return (MEMORY_SCOPES as readonly string[]).includes(value);
}

/** Parse a client-requested scope string into canonical scopes only —
 *  alternative spellings are rejected, not normalized (spec §24). */
export function parseScopeList(scope: string | null | undefined): MemoryScope[] {
  if (!scope) return [];
  const out = new Set<MemoryScope>();
  for (const token of scope.split(/[\s+]+/).filter((part) => part.length > 0)) {
    if (isMemoryScope(token)) out.add(token);
  }
  return [...out];
}

export function grantedScopesInclude(granted: readonly MemoryScope[], required: MemoryScope): boolean {
  return granted.some((scope) => SCOPE_IMPLICATIONS[scope].includes(required));
}

export interface ActorIdentity {
  kind: "oauth" | "system" | "dashboard";
  id: string;
  scopes: MemoryScope[];
}

/** Server-side scope evaluation for EVERY protected call (spec §25, §43):
 *  system/dashboard actors carry canonical scopes too and never bypass audit. */
export function evaluateScope(actor: ActorIdentity, required: MemoryScope): boolean {
  return grantedScopesInclude(actor.scopes, required);
}

export function systemActor(): ActorIdentity {
  return { kind: "system", id: "system", scopes: [...MEMORY_SCOPES] };
}

export function dashboardActor(): ActorIdentity {
  return { kind: "dashboard", id: "operator", scopes: [...MEMORY_SCOPES] };
}
