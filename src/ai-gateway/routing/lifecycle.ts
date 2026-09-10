/**
 * Pao AI Gateway — router lifecycle and emergency direct bypass.
 *
 * Two things live here that are easy to get wrong in the same way: both are about
 * a MANUAL act being required before something becomes live.
 *
 * 1. A learned router produced by upstream optimization is a candidate, not a
 *    deployment. The lifecycle states make the gate explicit, and promotion to
 *    ACTIVE is refused from any state except CANARY — so no code path can jump a
 *    fresh artifact straight into production routing.
 *
 * 2. Direct provider bypass exists so an operator can keep working when the gateway
 *    is down. It is off by default, requires explicit enablement, is limited to a
 *    configured provider allowlist, and records an audit event every time it is
 *    used. It bypasses the GATEWAY, never a permission: MCP, file, shell, and
 *    browser approvals are enforced elsewhere and are untouched by it.
 */

export const ROUTER_LIFECYCLE_STATES = [
  "DRAFT",
  "OFFLINE_TESTED",
  "REVIEWED",
  "CANARY",
  "ACTIVE",
  "DEPRECATED",
  "ROLLED_BACK",
] as const;

export type RouterLifecycleState = (typeof ROUTER_LIFECYCLE_STATES)[number];

/** Legal transitions. Anything absent here is refused. */
const ALLOWED_TRANSITIONS: Readonly<Record<RouterLifecycleState, readonly RouterLifecycleState[]>> = {
  DRAFT: ["OFFLINE_TESTED", "ROLLED_BACK"],
  OFFLINE_TESTED: ["REVIEWED", "DRAFT", "ROLLED_BACK"],
  REVIEWED: ["CANARY", "DRAFT", "ROLLED_BACK"],
  // ACTIVE is reachable only from CANARY. That single edge is the promotion gate.
  CANARY: ["ACTIVE", "ROLLED_BACK", "REVIEWED"],
  ACTIVE: ["DEPRECATED", "ROLLED_BACK"],
  DEPRECATED: ["ROLLED_BACK", "REVIEWED"],
  ROLLED_BACK: ["DRAFT"],
};

export interface RouterArtifact {
  readonly id: string;
  readonly state: RouterLifecycleState;
  readonly upstreamVersion: string;
  /** Why this artifact is where it is. Required so a state is never unexplained. */
  readonly note: string;
  readonly updatedAt: string;
  readonly history: readonly { from: RouterLifecycleState; to: RouterLifecycleState; at: string; by: string; note: string }[];
}

export function createRouterArtifact(input: {
  id: string;
  upstreamVersion: string;
  note?: string;
}): RouterArtifact {
  return {
    id: input.id,
    state: "DRAFT",
    upstreamVersion: input.upstreamVersion,
    note: input.note ?? "created; not yet tested",
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

export interface TransitionResult {
  readonly ok: boolean;
  readonly artifact: RouterArtifact;
  readonly reason: string;
}

/**
 * Attempt a lifecycle transition.
 *
 * Refusals are returned rather than thrown, so a dashboard can render why a
 * promotion is unavailable instead of presenting a disabled button with no cause.
 */
export function transitionRouter(
  artifact: RouterArtifact,
  to: RouterLifecycleState,
  by: string,
  note = "",
): TransitionResult {
  const allowed = ALLOWED_TRANSITIONS[artifact.state];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      artifact,
      reason:
        `Transition ${artifact.state} -> ${to} is not permitted. ` +
        `Allowed from ${artifact.state}: ${allowed.join(", ") || "none"}.`,
    };
  }
  const at = new Date().toISOString();
  return {
    ok: true,
    artifact: {
      ...artifact,
      state: to,
      note: note || artifact.note,
      updatedAt: at,
      history: [...artifact.history, { from: artifact.state, to, at, by, note }],
    },
    reason: `Transitioned ${artifact.state} -> ${to}.`,
  };
}

/** True only when the artifact is the one actually serving traffic. */
export function isServing(artifact: RouterArtifact): boolean {
  return artifact.state === "ACTIVE";
}

// ---------------------------------------------------------------------------
// Emergency direct bypass
// ---------------------------------------------------------------------------

export interface DirectBypassConfig {
  readonly enabled: boolean;
  /** Provider ids the bypass may reach. Empty means none, even when enabled. */
  readonly allowedProviders: readonly string[];
  /** True when an operator set this deliberately rather than inheriting a default. */
  readonly explicitlyEnabled: boolean;
}

export interface BypassDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly auditRequired: boolean;
}

/**
 * Decide whether a direct-provider call may proceed.
 *
 * Three independent gates, each of which must pass: the feature is on, it was
 * turned on deliberately, and the target provider is on the allowlist. An empty
 * allowlist denies everything, so enabling the bypass without naming providers
 * still routes nothing.
 */
export function evaluateDirectBypass(config: DirectBypassConfig, providerId: string): BypassDecision {
  if (!config.enabled) {
    return { allowed: false, reason: "Direct bypass is disabled.", auditRequired: false };
  }
  if (!config.explicitlyEnabled) {
    return {
      allowed: false,
      reason: "Direct bypass was enabled by a default rather than an explicit configuration; refusing.",
      auditRequired: false,
    };
  }
  if (config.allowedProviders.length === 0) {
    return {
      allowed: false,
      reason: "Direct bypass is enabled but no providers are allowlisted; refusing.",
      auditRequired: false,
    };
  }
  if (!config.allowedProviders.includes(providerId)) {
    return {
      allowed: false,
      reason: `Provider ${providerId} is not on the direct-bypass allowlist.`,
      auditRequired: false,
    };
  }
  return {
    allowed: true,
    reason: `Direct bypass permitted for ${providerId}; this is an emergency path.`,
    auditRequired: true,
  };
}

/**
 * True when the gateway's own failure justifies the emergency path.
 *
 * Only a total gateway outage qualifies. A single provider error, a rate limit, or
 * a capability mismatch is what the normal fallback and escalation paths are for,
 * and routing those through an emergency bypass would make the exception routine.
 */
export function bypassJustified(gatewayFailureCode: string | null): boolean {
  if (!gatewayFailureCode) return false;
  return (
    gatewayFailureCode === "provider_unreachable" ||
    gatewayFailureCode === "provider_timeout" ||
    gatewayFailureCode === "provider_5xx"
  );
}
