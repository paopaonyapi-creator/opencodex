// Phase 20.62 — Repository scope + path policy (spec §9, §36, §37).
//
// Every code-intelligence request resolves to an explicit effective scope.
// Default deny: sensitive prefixes are always denied regardless of the
// registered scope, .gitignore is never treated as a security boundary, and
// cross-repository access is denied unless the workspace explicitly allows it.

import { realpathSync } from "node:fs";
import { CodeIntelError, type RepositoryScope } from "./types";
import type { CodeIntelConfig } from "./config";

export const DEFAULT_DENIED_PREFIXES = [
  ".env", ".env.", "secrets/", "credentials/", "private-keys/",
  "*.pem", "*.key", "*.p12", "*.pfx", "vault/", "backups/", "production-dumps/",
];

/**
 * Canonicalize a repository root via realpath: symlink escapes resolve to a
 * different absolute root than registered, which the registry comparison
 * then rejects (operators register the canonical path).
 */
export function canonicalizeRepositoryPath(root: string): string {
  try {
    return realpathSync(root).replace(/\\/g, "/");
  } catch {
    throw new CodeIntelError("CODEINTEL_INVALID_INPUT", 400, "repository path does not exist or is inaccessible");
  }
}

function globPrefixMatches(prefix: string, path: string): boolean {
  if (prefix.endsWith("/**")) {
    return path.startsWith(prefix.slice(0, -3) + "/");
  }
  if (prefix.endsWith("*")) {
    return path.startsWith(prefix.slice(0, -1));
  }
  return path === prefix || path.startsWith(prefix + "/");
}

/** True when a repository-relative path hits a denied sensitive prefix. */
export function isDeniedPath(relativePath: string, deniedPrefixes: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const prefix of deniedPrefixes) {
    if (prefix.includes("*")) {
      const star = prefix.indexOf("*");
      const base = prefix.slice(0, star);
      const suffix = prefix.slice(star + 1);
      const segment = normalized.split("/").pop() ?? normalized;
      if (prefix.endsWith("/**")) {
        if (base && normalized.startsWith(base)) return true;
        continue;
      }
      if (base === "") {
        // "*.ext" — match the file-name suffix only, never the whole path.
        if (segment.endsWith(suffix)) return true;
        continue;
      }
      if (segment.startsWith(base) && segment.endsWith(suffix)) return true;
      continue;
    }
    if (normalized === prefix || normalized.startsWith(prefix) || normalized.endsWith("/" + prefix)) return true;
  }
  return false;
}

export function defaultDeniedPrefixes(): string[] {
  return [...DEFAULT_DENIED_PREFIXES];
}

/**
 * Effective scope check for a repository-relative path. Combines the scope's
 * allowed/denied prefixes with the always-denied sensitive set. Relative
 * traversal (../) anywhere is rejected outright.
 */
export function assertPathInScope(relativePath: string, scope: RepositoryScope, config: Pick<CodeIntelConfig, "defaultDeniedPrefixes">): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("../") || normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..")) {
    throw new CodeIntelError("CODEINTEL_SCOPE_VIOLATION", 403, "path traversal rejected");
  }
  const clean = normalized.replace(/^\//, "");
  const deniedSets = [...(config.defaultDeniedPrefixes ?? DEFAULT_DENIED_PREFIXES), ...scope.deniedPathPrefixes];
  if (isDeniedPath(clean, deniedSets)) {
    throw new CodeIntelError("CODEINTEL_SCOPE_VIOLATION", 403, "path is outside the permitted scope");
  }
  const allowed = scope.allowedPathPrefixes;
  if (allowed.length > 0 && !allowed.some((prefix) => globPrefixMatches(prefix.replace(/\\/g, "/"), clean))) {
    throw new CodeIntelError("CODEINTEL_SCOPE_VIOLATION", 403, "path is outside the caller's authorized scope");
  }
  return clean;
}

/** Validate CLI-bound user inputs: never allow option-shaped or traversal values. */
export function assertSafeCliArg(value: string, label: string): string {
  if (!value || value.startsWith("-") || value.includes("..") || /[\0\r\n]/.test(value)) {
    throw new CodeIntelError("CODEINTEL_INVALID_INPUT", 400, label + " is not a safe query argument");
  }
  return value;
}

/** Cross-repo policy: denied unless the workspace membership explicitly allows it (spec §37). */
export function assertCrossRepoAllowed(membership: { crossRepoTraceEnabled: boolean } | null): void {
  if (!membership || !membership.crossRepoTraceEnabled) {
    throw new CodeIntelError("CODEINTEL_SCOPE_VIOLATION", 403, "cross-repository access is denied for this workspace");
  }
}
