// Deterministic review rule registry + resolver (Phase 20.81 blueprint §12-13).
//
// Rule selection is deterministic: path patterns map to rules and a risk
// level via a fixed priority chain (explicit project > security > path >
// language > global). Nothing here consults a model. The registry content
// is hashed into the review session's rule snapshot so a gate decision can
// be reproduced later.

import type { DiffFile } from "./types";

export const REVIEW_POLICY_VERSION = "20.81-slice1";

export interface ReviewRule {
  id: string;
  /** Glob-like patterns (`src/auth/**`) matched against the repo-relative path. */
  matchPaths: string[];
  riskLevel: "low" | "medium" | "high";
  /** Deterministic checker ids that run for files matching this rule. */
  checkers: string[];
  priority: number;
}

/** Protected paths per blueprint §37 — changes here can never auto-pass. */
export const DEFAULT_PROTECTED_PATHS = [
  "src/security/**",
  "src/auth/**",
  "src/credentials/**",
  "src/policy/**",
  "src/mcp/**",
  "src/agent-permissions/**",
  ".github/workflows/**",
  "docker/**",
  "infra/**",
  "terraform/**",
];

/** Files that never enter review units (deterministic exclusion, §80 heuristics). */
export const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules/**",
  "dist/**",
  "build/**",
  "target/**",
  "vendor/**",
  "coverage/**",
  ".pao/**",
  "*.lock",
  "package-lock.json",
  "bun.lockb",
  "*.min.js",
  "*.min.css",
  "*.snap",
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".tgz", ".tar", ".br", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4",
  ".mov", ".webm", ".mp3", ".wav", ".wasm", ".exe", ".dll", ".dylib", ".so",
  ".sqlite", ".db", ".jsonl.bak",
]);

export function isProtectedPath(path: string, protectedPaths: string[] = DEFAULT_PROTECTED_PATHS): boolean {
  return matchAny(path, protectedPaths);
}

export function isExcludablePath(path: string, excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS): boolean {
  if (matchAny(path, excludePatterns)) return true;
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/** Minimal glob match: `**` crosses directories, `*` stays within one. */
export function matchAny(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return patterns.some((pattern) => globMatch(pattern.replace(/\\/g, "/"), normalized));
}

export function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    "^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "(?:.*/)?")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]") + "$",
  );
  return regex.test(value);
}

export const REVIEW_RULES: ReviewRule[] = [
  { id: "security/auth", matchPaths: ["src/auth/**", "src/security/**", "src/credentials/**"], riskLevel: "high", checkers: ["secrets", "conflict-markers"], priority: 40 },
  { id: "security/global", matchPaths: ["**"], riskLevel: "medium", checkers: ["secrets", "conflict-markers"], priority: 20 },
  { id: "path/infra", matchPaths: [".github/workflows/**", "docker/**", "infra/**", "terraform/**"], riskLevel: "high", checkers: ["secrets", "conflict-markers"], priority: 30 },
  { id: "lang/ts-js", matchPaths: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs"], riskLevel: "low", checkers: ["debugger"], priority: 10 },
  { id: "global/default", matchPaths: ["**"], riskLevel: "low", checkers: [], priority: 0 },
];

export function resolveRules(path: string): { rules: string[]; riskLevel: "low" | "medium" | "high"; checkers: string[] } {
  const matched = REVIEW_RULES.filter((rule) => matchAny(path, rule.matchPaths))
    .sort((a, b) => b.priority - a.priority);
  const checkers = new Set<string>();
  let risk: "low" | "medium" | "high" = "low";
  for (const rule of matched) {
    for (const checker of rule.checkers) checkers.add(checker);
    if (rule.riskLevel === "high") risk = "high";
    else if (rule.riskLevel === "medium" && risk !== "high") risk = "medium";
  }
  return { rules: matched.map((r) => r.id), riskLevel: risk, checkers: [...checkers] };
}

/** Highest applicable risk across the change set (preview + session risk). */
export function changeSetRisk(files: DiffFile[]): "low" | "medium" | "high" {
  let risk: "low" | "medium" | "high" = "low";
  for (const file of files) {
    if (file.protectedPath) return "high";
    const resolved = resolveRules(file.path);
    if (resolved.riskLevel === "high") risk = "high";
    else if (resolved.riskLevel === "medium" && risk === "low") risk = "medium";
  }
  return risk;
}

export function ruleRegistryHashInput(): string {
  return JSON.stringify({ policyVersion: REVIEW_POLICY_VERSION, rules: REVIEW_RULES, protected: DEFAULT_PROTECTED_PATHS, exclude: DEFAULT_EXCLUDE_PATTERNS });
}
