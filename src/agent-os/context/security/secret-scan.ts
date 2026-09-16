/**
 * Pao Context Control Plane — deterministic secret/sensitive-data filter
 * (Phase 20.53 §17, §96-98).
 *
 * Runs BEFORE anything reaches OpenViking: resource ingestion, memory
 * candidates, promotion. Purely deterministic pattern + path rules — an LLM
 * is never the secret detector. Secrets are never echoed: findings carry
 * key names and offsets, not values. All regexes are precompiled literals;
 * nothing is constructed from runtime strings.
 */

import { createHash } from "node:crypto";

export type SecretFindingCode =
  | "SECRET_API_KEY"
  | "SECRET_PRIVATE_KEY_BLOCK"
  | "SECRET_PASSWORD_ASSIGNMENT"
  | "SECRET_BEARER_TOKEN"
  | "SECRET_SESSION_COOKIE"
  | "SECRET_OAUTH_REFRESH"
  | "SECRET_DATABASE_URL"
  | "SECRET_RECOVERY_CODE"
  | "PATH_DENIED"
  | "PATH_REQUIRES_REVIEW";

export interface SecretFinding {
  readonly code: SecretFindingCode;
  readonly detail: string;
  readonly offset: number;
}

export interface SecretScanResult {
  readonly blocked: boolean;
  readonly requiresReview: boolean;
  readonly findings: readonly SecretFinding[];
}

// Precompiled literals (g flag for matchAll; matchAll never mutates them).
const RE_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g;
const RE_API_KEY = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g;
const RE_BEARER = /authorization["']?\s*[:=]\s*["']?bearer\s+\S+/gi;
const RE_SESSION_COOKIE = /\b(?:session[_-]?cookie|set-cookie)\b\s*[:=]\s*\S+/gi;
const RE_OAUTH_REFRESH = /\brefresh[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi;
const RE_DATABASE_URL = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']*:[^\s"']+@[^\s"']+/gi;
const RE_PASSWORD_ASSIGNMENT = /\b(?:password|passwd|secret[_-]?key|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?[^\s"'{}]{8,}/gi;
const RE_RECOVERY = /\brecovery[_ -]?(?:codes?|phrase)\b\s*[:=]\s*\S+/gi;

const CONTENT_PATTERNS: ReadonlyArray<{ code: SecretFindingCode; regex: RegExp; detail: string }> = [
  { code: "SECRET_PRIVATE_KEY_BLOCK", regex: RE_PRIVATE_KEY, detail: "private key block header" },
  { code: "SECRET_API_KEY", regex: RE_API_KEY, detail: "provider/cloud API key token shape" },
  { code: "SECRET_BEARER_TOKEN", regex: RE_BEARER, detail: "authorization header with bearer credential" },
  { code: "SECRET_SESSION_COOKIE", regex: RE_SESSION_COOKIE, detail: "session cookie value" },
  { code: "SECRET_OAUTH_REFRESH", regex: RE_OAUTH_REFRESH, detail: "OAuth refresh token assignment" },
  { code: "SECRET_DATABASE_URL", regex: RE_DATABASE_URL, detail: "database URL with inline credentials" },
  { code: "SECRET_PASSWORD_ASSIGNMENT", regex: RE_PASSWORD_ASSIGNMENT, detail: "credential-like key assignment" },
  { code: "SECRET_RECOVERY_CODE", regex: RE_RECOVERY, detail: "recovery code material" },
];

const PATH_DENY: ReadonlyArray<{ regex: RegExp; code: SecretFindingCode; detail: string }> = [
  { regex: /(^|\/)\.env(\..*)?$/i, code: "PATH_DENIED", detail: "environment file" },
  { regex: /\.(pem|key|p12|pfx|keystore)$/i, code: "PATH_DENIED", detail: "key material file" },
  { regex: /(^|\/)(node_modules|\.git|dist|build|coverage)\//, code: "PATH_DENIED", detail: "build/dependency artifact" },
  { regex: /(^|\/)id_rsa/i, code: "PATH_DENIED", detail: "SSH private key file" },
];

const RE_SECRET_PATH = /secret/i;
const RE_CREDENTIAL_PATH = /credential/i;
const RE_DB_FILE_PATH = /\.sqlite$|\.db$/i;

/** Scan content text for credential-shaped material. */
export function scanContent(content: string): SecretScanResult {
  const findings: SecretFinding[] = [];
  for (const pattern of CONTENT_PATTERNS) {
    for (const match of content.matchAll(pattern.regex)) {
      findings.push({ code: pattern.code, detail: pattern.detail, offset: match.index ?? 0 });
    }
  }
  return {
    blocked: findings.length > 0,
    requiresReview: false,
    findings,
  };
}

/** Scan a source path against deny/review rules. */
export function scanPath(path: string): SecretScanResult {
  const findings: SecretFinding[] = [];
  for (const rule of PATH_DENY) {
    if (rule.regex.test(path)) {
      findings.push({ code: rule.code, detail: rule.detail, offset: 0 });
    }
  }
  const reviewDetail = RE_SECRET_PATH.test(path)
    ? "path contains 'secret'"
    : RE_CREDENTIAL_PATH.test(path)
      ? "path contains 'credential'"
      : RE_DB_FILE_PATH.test(path)
        ? "database file"
        : null;
  if (reviewDetail) {
    findings.push({ code: "PATH_REQUIRES_REVIEW", detail: reviewDetail, offset: 0 });
  }
  return {
    blocked: findings.some(f => f.code === "PATH_DENIED"),
    requiresReview: reviewDetail !== null,
    findings,
  };
}

/** Full gate: path rules then content rules. Either blocking => blocked. */
export function scanSource(path: string, content: string): SecretScanResult {
  const pathResult = scanPath(path);
  const contentResult = scanContent(content);
  const findings = [...pathResult.findings, ...contentResult.findings];
  return {
    blocked: pathResult.blocked || contentResult.blocked,
    requiresReview: pathResult.requiresReview,
    findings,
  };
}

/** Stable content checksum for provenance/idempotency. */
export function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Check a MEMORY CANDIDATE against the same rules. Spec §103: a conversation
 * revealing a secret must produce NO memory write.
 */
export function scanMemoryCandidate(text: string): SecretScanResult {
  return scanContent(text);
}

/**
 * Prompt-injection defense (§97): retrieved content is DATA. This helper
 * flags instruction-shaped text so the injection layer can wrap it in
 * delimiters — it never strips or executes anything.
 */
const RE_IGNORE_INSTRUCTIONS = /ignore (?:all )?(?:previous |system )?instructions/i;
const RE_DISABLE_SAFETY = /disable (?:safety|guardrails)/i;
const RE_EXFILTRATE = /(?:send|upload|exfiltrate) (?:the )?(?:secrets|credentials|api keys?)/i;
const RE_RUN_COMMAND = /run this command/i;

export function containsInstructionPattern(content: string): boolean {
  return (
    RE_IGNORE_INSTRUCTIONS.test(content) ||
    RE_DISABLE_SAFETY.test(content) ||
    RE_EXFILTRATE.test(content) ||
    RE_RUN_COMMAND.test(content)
  );
}
