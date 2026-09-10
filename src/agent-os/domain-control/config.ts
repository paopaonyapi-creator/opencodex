// Phase 20.15 — Domain Control Plane: environment configuration + secret masking.
//
// Credentials are read from the environment on demand and are NEVER written to
// config, the database, a log line, an MCP result, or the dashboard. The store
// keeps only a reference and a masked preview.

import type { DomainControlConfig, DomainEnvironment } from "./types";

/** Placeholder that replaces every credential value on an outbound surface. */
export const REDACTED = "[redacted]";

type EnvView = Record<string, string | undefined>;

function envString(env: EnvView, name: string, fallback = ""): string {
  const raw = env[name];
  return raw === undefined ? fallback : raw.trim();
}

function envBool(env: EnvView, name: string, fallback: boolean): boolean {
  const raw = envString(env, name).toLowerCase();
  if (raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(env: EnvView, name: string, fallback: number): number {
  const raw = envString(env, name);
  if (raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envList(env: EnvView, name: string, fallback: readonly string[] = []): string[] {
  const raw = envString(env, name);
  if (raw === "") return [...fallback];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Mask a credential for display. Keeps at most the leading 4 and trailing 4
 * characters of long values and shows nothing but a fixed mask for short ones, so
 * a short secret cannot be recovered by counting asterisks.
 */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  const trimmed = String(secret).trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 12) return "*".repeat(8);
  return `${trimmed.slice(0, 4)}${"*".repeat(16)}${trimmed.slice(-4)}`;
}

/**
 * Remove credential-looking material from free text before it reaches a log, an
 * audit row, or an MCP response. Deliberately broad: a false positive costs a
 * redacted substring, a false negative leaks a live token.
 */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, `$1 ${REDACTED}`)
    // Separator is a HYPHEN or an underscore, because both occur in the wild:
    // OpenAI-style keys use sk-.../sk-proj-..., while several providers and
    // GitHub tokens use prefix_... . Matching only one form leaves the other
    // entirely unredacted.
    .replace(/\b(dp|sk|pk|ghp|gho|ghs|glpat|xox[baprs])[-_][A-Za-z0-9_-]{6,}/gi, REDACTED)
    .replace(/([?&](?:api[_-]?key|token|access[_-]?token|key)=)[^&\s]+/gi, `$1${REDACTED}`);
}

/** Redact every string value in a nested structure (bounded depth, cycle-safe). */
export function redactDeep(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // Key-name based redaction: a field CALLED token/api_key/secret is masked even
    // when its value does not match a known credential prefix.
    out[key] = /(secret|token|password|api[_-]?key|authorization|credential)/i.test(key)
      ? REDACTED
      : redactDeep(entry, depth + 1, seen);
  }
  return out;
}

function readSecret(env: EnvView, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * Resolve the Domain-OSS bearer token. Read from the environment on every call —
 * never cached into module state, so a rotated token takes effect without a
 * restart and no copy lingers in memory beyond the request.
 */
export function resolveDomainOssApiKey(env: EnvView = process.env): string | undefined {
  return readSecret(env, "DOMAIN_OSS_API_KEY");
}

export function resolveCaddyApiToken(env: EnvView = process.env): string | undefined {
  return readSecret(env, "CADDY_API_TOKEN");
}

/** Environment of a zone, from DOMAIN_CONTROL_PRODUCTION_ZONES. */
export function environmentForZone(
  zone: string,
  config: DomainControlConfig,
): DomainEnvironment {
  const match = config.productionZones.some(
    (entry) => zone === entry || zone.endsWith(`.${entry}`),
  );
  return match ? "production" : "development";
}

/**
 * Read the control plane's configuration.
 *
 * Note the default posture: disabled, and with an EMPTY allowlist. A fresh install
 * therefore cannot mutate anything, and enabling the feature still requires naming
 * the zones it may touch.
 */
export function loadDomainControlConfig(env: EnvView = process.env): DomainControlConfig {
  // The env view is passed explicitly rather than swapped onto process.env: the
  // runtime is concurrent, and a temporarily rewritten global environment is
  // visible to every other in-flight request.
  return {
    enabled: envBool(env, "DOMAIN_CONTROL_ENABLED", false),
    defaultProvider: envString(env, "DOMAIN_DEFAULT_PROVIDER", "domain_oss") || "domain_oss",
    allowlist: envList(env, "DOMAIN_CONTROL_ALLOWLIST"),
    denylist: envList(env, "DOMAIN_CONTROL_DENYLIST"),
    requireApproval: envBool(env, "DOMAIN_REQUIRE_APPROVAL", true),
    productionZones: envList(env, "DOMAIN_CONTROL_PRODUCTION_ZONES"),
    approvalTtlMs: envInt(env, "DOMAIN_APPROVAL_TTL_MINUTES", 60) * 60_000,
    resolvers: envList(env, "DNS_VERIFY_RESOLVERS", ["1.1.1.1", "8.8.8.8"]),
    verificationTimeoutMs: envInt(env, "DNS_VERIFY_TIMEOUT_SECONDS", 30) * 1_000,
    verificationIntervalMs: envInt(env, "DNS_VERIFY_INTERVAL_SECONDS", 3) * 1_000,
    caddyAdminUrl: envString(env, "CADDY_ADMIN_URL") || null,
  };
}

/** Masked view of the configured providers' credentials, safe for any surface. */
export function describeCredentialState(env: EnvView = process.env): {
  providerId: string;
  configured: boolean;
  masked: string;
}[] {
  const domainOss = resolveDomainOssApiKey(env);
  const caddy = resolveCaddyApiToken(env);
  return [
    {
      providerId: "domain_oss",
      configured: Boolean(domainOss),
      masked: maskSecret(domainOss),
    },
    {
      providerId: "cloudflare",
      configured: Boolean(readSecret(env, "CLOUDFLARE_API_TOKEN")),
      masked: maskSecret(readSecret(env, "CLOUDFLARE_API_TOKEN")),
    },
    {
      providerId: "caddy",
      configured: Boolean(caddy) || Boolean(envString(env, "CADDY_ADMIN_URL")),
      masked: maskSecret(caddy),
    },
  ];
}
