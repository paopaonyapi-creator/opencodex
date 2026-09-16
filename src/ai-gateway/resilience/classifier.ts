/**
 * Pao AI Gateway — Gateway failure classifier (Phase 20.51).
 *
 * One classifier, consulted before any retry or fallback logic runs. Maps a
 * thrown error or HTTP status onto a stable failure class plus the policy
 * table that decides whether the same route may be retried, whether fallback
 * to another route is permitted, and whether the route must be quarantined.
 *
 * Anti-abuse rule (Phase 20.51 spec §12): auth and permission failures never
 * retry and never provider-hop on the same identity; quota exhaustion cools
 * down until a known reset rather than rotating accounts.
 */

import type { GatewayFailureClass } from "../types";

export type RetrySameRoute = "no" | "once" | "bounded";

export interface FailureBehavior {
  readonly failureClass: GatewayFailureClass;
  readonly retrySameRoute: RetrySameRoute;
  readonly fallbackAllowed: boolean;
  /** Only routes at or below the failed route's cost tier may be tried. */
  readonly cheaperFallbackOnly: boolean;
  readonly quarantineRoute: boolean;
  /** Cooldown lasts until a known quota reset instead of a fixed window. */
  readonly cooldownUntilReset: boolean;
  readonly reasonCode: string;
}

const AUTH_MESSAGE_HINTS = [
  "invalid api key",
  "invalid_api_key",
  "unauthorized",
  "authentication",
  "invalid token",
  "expired token",
  "401",
];

const PERMISSION_MESSAGE_HINTS = ["forbidden", "permission", "not allowed", "403", "access denied"];

const CONTENT_MESSAGE_HINTS = [
  "content filter",
  "content_filter",
  "safety",
  "moderation",
  "flagged",
  "policy violation",
];

const QUOTA_MESSAGE_HINTS = [
  "quota exceeded",
  "quota_exhausted",
  "insufficient_quota",
  "billing limit",
  "exceeded your current quota",
];

export const FAILURE_BEHAVIORS: Readonly<Record<GatewayFailureClass, Omit<FailureBehavior, "failureClass">>> = {
  auth_invalid: {
    retrySameRoute: "no",
    fallbackAllowed: false,
    cheaperFallbackOnly: false,
    quarantineRoute: true,
    cooldownUntilReset: false,
    reasonCode: "CONNECTION_QUARANTINED_AUTH",
  },
  permission_denied: {
    retrySameRoute: "no",
    fallbackAllowed: false,
    cheaperFallbackOnly: false,
    quarantineRoute: true,
    cooldownUntilReset: false,
    reasonCode: "CONNECTION_QUARANTINED_PERMISSION",
  },
  quota_exhausted: {
    retrySameRoute: "no",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: true,
    reasonCode: "FALLBACK_QUOTA_EXHAUSTED",
  },
  rate_limited: {
    retrySameRoute: "no",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_RATE_LIMIT",
  },
  provider_overloaded: {
    retrySameRoute: "bounded",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_UPSTREAM_ERROR",
  },
  provider_unavailable: {
    retrySameRoute: "bounded",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_UPSTREAM_ERROR",
  },
  network_timeout: {
    retrySameRoute: "bounded",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_TIMEOUT",
  },
  protocol_error: {
    retrySameRoute: "once",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_PROTOCOL_ERROR",
  },
  model_unavailable: {
    retrySameRoute: "no",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_MODEL_UNAVAILABLE",
  },
  capability_mismatch: {
    retrySameRoute: "no",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "ROUTE_REJECTED_CAPABILITY",
  },
  budget_blocked: {
    retrySameRoute: "no",
    fallbackAllowed: true,
    cheaperFallbackOnly: true,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "ROUTE_REJECTED_BUDGET",
  },
  policy_blocked: {
    retrySameRoute: "no",
    fallbackAllowed: false,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "ROUTE_REJECTED_POLICY",
  },
  content_rejected: {
    retrySameRoute: "no",
    // Content the provider refused is usually refused by all providers with
    // similar policies; automatic provider-hopping must be an explicit policy
    // decision, so the default is no hop.
    fallbackAllowed: false,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "CONTENT_REJECTED",
  },
  unknown: {
    retrySameRoute: "bounded",
    fallbackAllowed: true,
    cheaperFallbackOnly: false,
    quarantineRoute: false,
    cooldownUntilReset: false,
    reasonCode: "FALLBACK_UNKNOWN_ERROR",
  },
};

function messageHints(message: string, hints: readonly string[]): boolean {
  const lowered = message.toLowerCase();
  return hints.some(h => lowered.includes(h));
}

/**
 * Classify a failure from everything the caller knows about it: the error
 * object (its `code` property is the legacy gateway code when present), the
 * HTTP status if the failure surfaced as a status, and the message text.
 */
export function classifyGatewayFailure(input: {
  readonly error?: unknown;
  readonly status?: number;
  readonly legacyCode?: string;
}): FailureBehavior {
  const { status } = input;
  const legacyCode = input.legacyCode ?? (input.error as { code?: string } | undefined)?.code ?? "";
  const message =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === "string"
        ? input.error
        : "";

  const behaviorFor = (failureClass: GatewayFailureClass): FailureBehavior => ({
    failureClass,
    ...FAILURE_BEHAVIORS[failureClass],
  });

  // 1. Explicit legacy codes from the adapter layer are the strongest signal.
  if (legacyCode === "provider_429") return behaviorFor("rate_limited");
  if (legacyCode === "provider_5xx") return behaviorFor(status === 529 ? "provider_overloaded" : "provider_unavailable");
  if (legacyCode === "auth_failure") return behaviorFor("auth_invalid");
  if (legacyCode === "timeout") return behaviorFor("network_timeout");
  if (legacyCode === "network_error") return behaviorFor("provider_unavailable");
  if (legacyCode === "model_unavailable") return behaviorFor("model_unavailable");
  if (legacyCode === "budget_denial") return behaviorFor("budget_blocked");
  if (legacyCode === "policy_denial") return behaviorFor("policy_blocked");

  // 2. HTTP status.
  if (status === 401) return behaviorFor("auth_invalid");
  if (status === 403) {
    if (messageHints(message, QUOTA_MESSAGE_HINTS)) return behaviorFor("quota_exhausted");
    return behaviorFor("permission_denied");
  }
  if (status === 402) return behaviorFor("quota_exhausted");
  if (status === 404) return behaviorFor("model_unavailable");
  if (status === 408) return behaviorFor("network_timeout");
  if (status === 413) return behaviorFor("capability_mismatch");
  if (status === 429) {
    if (messageHints(message, QUOTA_MESSAGE_HINTS)) return behaviorFor("quota_exhausted");
    return behaviorFor("rate_limited");
  }
  if (status === 400 || status === 422) {
    if (messageHints(message, CONTENT_MESSAGE_HINTS)) return behaviorFor("content_rejected");
    if (messageHints(message, ["context length", "too long", "maximum context"])) {
      return behaviorFor("capability_mismatch");
    }
    return behaviorFor("protocol_error");
  }
  if (status !== undefined && status >= 500) {
    if (status === 529 || messageHints(message, ["overloaded", "capacity"])) {
      return behaviorFor("provider_overloaded");
    }
    return behaviorFor("provider_unavailable");
  }

  // 3. Message-only signals (no status, no recognized code).
  if (messageHints(message, AUTH_MESSAGE_HINTS)) return behaviorFor("auth_invalid");
  if (messageHints(message, PERMISSION_MESSAGE_HINTS)) return behaviorFor("permission_denied");
  if (messageHints(message, QUOTA_MESSAGE_HINTS)) return behaviorFor("quota_exhausted");
  if (messageHints(message, CONTENT_MESSAGE_HINTS)) return behaviorFor("content_rejected");
  if (messageHints(message, ["timeout", "timed out", "abort"])) return behaviorFor("network_timeout");
  if (messageHints(message, ["json", "unexpected end", "malformed", "parse"])) {
    return behaviorFor("protocol_error");
  }
  if (messageHints(message, ["model", "not found", "decommissioned"])) {
    return behaviorFor("model_unavailable");
  }

  return behaviorFor("unknown");
}
