/**
 * Pao AI Gateway — Adaptive router v2: task classification, route levels, and the
 * escalation ladder.
 *
 * This EXTENDS routing/router.ts rather than replacing it. v1 resolves an alias the
 * caller already chose; v2 decides WHICH alias the work needs, then hands off to v1
 * for resolution. Keeping the two separate means the deterministic resolution rules
 * stay testable in isolation, and a change to policy cannot silently alter how an
 * alias maps to a model.
 *
 * Same inputs + same health state + same config = same decision. Always.
 */

import type { GatewayConfig, ProviderHealth, RoutingRequest } from "../types";
import type { ProviderRegistry } from "../providers/registry";
import { isPaoAlias } from "../aliases";

/**
 * Route levels, cheapest first. The level is a property of the CANDIDATE, not of
 * the request: the same alias can offer candidates at different levels, and the
 * budget and privacy filters decide which are reachable.
 *
 *  L0 local/free    no marginal cost, no data leaves the machine
 *  L1 cheap         small paid models
 *  L2 standard      normal production models
 *  L3 premium       frontier models
 *  L4 reviewer      independence-critical, may be premium
 */
export const ROUTE_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type RouteLevel = (typeof ROUTE_LEVELS)[number];

export function routeLevelRank(level: RouteLevel): number {
  return ROUTE_LEVELS.indexOf(level);
}

/**
 * Task sensitivity. The four labels exist because "private or not" is too coarse:
 * a strategy discussion is not a secret, but it is also not the same as a public
 * doc lookup, and collapsing them forces either over-restriction or leakage.
 */
export type Sensitivity = "public" | "normal" | "private" | "restricted";

export type TaskKind =
  | "coding"
  | "research"
  | "reasoning"
  | "review"
  | "vision"
  | "stock"
  | "browser"
  | "general";

export interface ClassificationInput {
  readonly agentId: string;
  readonly taskType?: string;
  /** 1..5. Absent means unknown, which is treated as 3 rather than as trivial. */
  readonly complexity?: number;
  readonly sensitivity?: Sensitivity;
  readonly requiredCapabilities?: RoutingRequest["requiredCapabilities"];
  readonly costPreference?: "minimize" | "balance" | "quality";
  readonly latencyPreference?: "minimize" | "balance" | "quality";
  /** Caller's explicit hint. Honoured only if the agent is permitted to use it. */
  readonly preferredAlias?: string;
}

export interface Classification {
  readonly agentId: string;
  readonly kind: TaskKind;
  readonly complexity: number;
  readonly sensitivity: Sensitivity;
  readonly suggestedAlias: string;
  /** Alias ladder, cheapest first, used for escalation. */
  readonly ladder: readonly string[];
  readonly reasons: readonly string[];
  readonly localOnly: boolean;
}

/** Keyword sets are deliberately small and explicit. A fuzzy classifier would make
 *  a routing decision hard to explain to the operator who has to debug it, and the
 *  spec asks for rule-based first. */
const KIND_KEYWORDS: Readonly<Record<TaskKind, readonly string[]>> = {
  coding: ["code", "coding", "refactor", "debug", "implement", "patch", "test", "compile", "bugfix", "migration"],
  research: ["research", "investigate", "compare", "survey", "sources", "latest", "trend", "market", "competitor"],
  reasoning: ["architecture", "design", "reason", "analyse", "analyze", "plan", "strategy", "tradeoff", "review the design"],
  review: ["review", "audit", "critique", "verify", "challenge", "second opinion"],
  vision: ["image", "vision", "screenshot", "photo", "ocr", "diagram", "render"],
  stock: ["stock", "adobe", "vector", "illustration", "asset", "metadata", "keywords", "caption"],
  browser: ["browser", "navigate", "click", "scrape", "automation", "page"],
  general: [],
};

const SENSITIVE_KEYWORDS: readonly string[] = [
  "credential",
  "secret",
  "api key",
  "private key",
  "password",
  ".env",
  "customer data",
  "personal data",
  "pii",
  "confidential",
  "internal only",
];

export function classifyTask(input: ClassificationInput): Classification {
  const reasons: string[] = [];
  const haystack = `${input.taskType ?? ""} ${input.agentId}`.toLowerCase();

  // 1. Task kind, from the declared task type first, then the agent's nature.
  let kind: TaskKind = "general";
  let bestScore = 0;
  for (const [candidate, keywords] of Object.entries(KIND_KEYWORDS) as [TaskKind, readonly string[]][]) {
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      kind = candidate;
    }
  }
  if (bestScore === 0) {
    // Agent identity is the fallback signal: a coding agent's unlabelled work is
    // still coding, and guessing "general" would route it to a generalist model.
    if (input.agentId.includes("codex") || input.agentId.includes("claude-code")) kind = "coding";
    else if (input.agentId.includes("review")) kind = "review";
    else if (input.agentId.includes("research")) kind = "research";
    else if (input.agentId.includes("stock")) kind = "stock";
    else if (input.agentId.includes("browser")) kind = "browser";
  }
  reasons.push(`classified as ${kind}`);

  // 2. Complexity. An absent value is NOT treated as trivial: defaulting to 1
  // would send unlabelled work down the cheapest route, which is the one place a
  // wrong guess is expensive to notice.
  const complexity = clampComplexity(input.complexity);
  if (input.complexity === undefined) {
    reasons.push("complexity unspecified; assuming 3 rather than trivial");
  }

  // 3. Sensitivity. A keyword hit ESCALATES and never de-escalates: text
  // mentioning a credential is treated as sensitive even if the caller said
  // otherwise, because under-classifying is the direction that leaks.
  let sensitivity: Sensitivity = input.sensitivity ?? "normal";
  const declared = sensitivity;
  if (typeof input.taskType === "string") {
    const lowered = input.taskType.toLowerCase();
    for (const keyword of SENSITIVE_KEYWORDS) {
      if (lowered.includes(keyword)) {
        sensitivity = sensitivityMax(sensitivity, "private");
        reasons.push(`task text mentions "${keyword}"; sensitivity raised to ${sensitivity}`);
      }
    }
  }
  if (sensitivity !== declared) {
    reasons.push(`sensitivity raised from ${declared} to ${sensitivity} by content`);
  }
  const localOnly = sensitivity === "restricted";

  // 4. Alias suggestion and ladder.
  const suggested = suggestAlias(kind, complexity, sensitivity, input, reasons);
  const ladder = buildLadder(suggested, sensitivity, kind);
  reasons.push(`ladder: ${ladder.join(" -> ")}`);

  return { agentId: input.agentId, kind, complexity, sensitivity, suggestedAlias: suggested, ladder, reasons, localOnly };
}

function clampComplexity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function sensitivityMax(a: Sensitivity, b: Sensitivity): Sensitivity {
  const order: Sensitivity[] = ["public", "normal", "private", "restricted"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/**
 * Choose the alias the work should START at.
 *
 * The free-first rule is the point of the ladder: easy work must not burn premium
 * spend. But free is never chosen for its own sake — the capability and health
 * filters run afterwards and will move the request up if the free candidate cannot
 * actually do the job.
 */
function suggestAlias(
  kind: TaskKind,
  complexity: number,
  sensitivity: Sensitivity,
  input: ClassificationInput,
  reasons: string[],
): string {
  if (sensitivity === "restricted") {
    reasons.push("restricted sensitivity pins the route to pao-local");
    return "pao-local";
  }
  if (input.preferredAlias && isPaoAlias(input.preferredAlias)) {
    reasons.push(`caller preference honoured: ${input.preferredAlias}`);
    return input.preferredAlias;
  }
  if (input.costPreference === "minimize") {
    reasons.push("cost preference is minimize; starting at pao-free");
    return "pao-free";
  }
  if (sensitivity === "private") {
    reasons.push("private sensitivity prefers a local route");
    return "pao-local";
  }
  if (complexity <= 2) {
    reasons.push(`complexity ${complexity} is low; starting cheap`);
    return "pao-free";
  }
  if (kind === "coding") return "pao-code";
  if (kind === "research") return "pao-research";
  if (kind === "review") return "pao-review";
  if (kind === "vision") return "pao-vision";
  if (kind === "stock") return "pao-stock";
  if (kind === "browser") return "pao-browser";
  if (kind === "reasoning" || complexity >= 4) return "pao-reasoning";
  return "pao-fast";
}

/**
 * The escalation order for a starting alias.
 *
 * Escalation moves toward QUALITY, never toward a cheaper option, and never toward
 * a public route for a request that must stay local. The ladder is bounded so a
 * failing request cannot climb forever.
 */
function buildLadder(start: string, sensitivity: Sensitivity, kind: TaskKind): string[] {
  if (sensitivity === "restricted") return ["pao-local"];
  if (start === "pao-local") {
    // Local-first may escalate only if the data classification allows leaving the
    // machine. A private task that locally fails must fail, not silently go public.
    return sensitivity === "private" ? ["pao-local"] : ["pao-local", "pao-free", "pao-auto"];
  }
  const ladder = [start];
  if (start !== "pao-auto") ladder.push("pao-auto");
  if (kind === "coding") ladder.push("pao-code");
  ladder.push("pao-reasoning");
  if (kind === "review" || kind === "reasoning") ladder.push("pao-critical");
  // De-duplicate while preserving order. The first entry is what the request
  // starts at; later entries are only reached on a failed attempt.
  // NOTE: `pao-critical` may not exist in config; resolveAlias returns nothing for
  // an unknown alias and the caller skips it rather than failing the request.
  return [...new Set(ladder)];
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Five provider health states, as the phase requires. The distinction between
 * DEGRADED and RATE_LIMITED matters: a rate limit clears on its own after a
 * cooldown, while degradation needs a successful probe to clear.
 */
export type HealthState = "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "UNAVAILABLE" | "DISABLED";

export interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  health: HealthState;
  lastErrorCode: string | null;
}

export interface CircuitBreakerOptions {
  /** Failures before the circuit opens. Default 3. */
  readonly failureThreshold?: number;
  /** How long an OPEN circuit waits before probing. Default 30s. */
  readonly cooldownMs?: number;
  /** Rate-limit cooldown, which is typically shorter than a hard failure. */
  readonly rateLimitCooldownMs?: number;
  readonly now?: () => number;
}

export class CircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly rateLimitCooldownMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.rateLimitCooldownMs = options.rateLimitCooldownMs ?? 15_000;
    this.now = options.now ?? (() => Date.now());
  }

  private record(key: string): CircuitRecord {
    let existing = this.records.get(key);
    if (!existing) {
      existing = { state: "CLOSED", consecutiveFailures: 0, openedAt: null, health: "HEALTHY", lastErrorCode: null };
      this.records.set(key, existing);
    }
    return existing;
  }

  /**
   * Whether a call may proceed. Transitions OPEN -> HALF_OPEN once the cooldown
   * has elapsed, so a recovering provider is probed rather than kept dead.
   */
  canAttempt(key: string): boolean {
    const record = this.record(key);
    if (record.state === "CLOSED" || record.state === "HALF_OPEN") return true;
    const cooldown = record.health === "RATE_LIMITED" ? this.rateLimitCooldownMs : this.cooldownMs;
    if (record.openedAt !== null && this.now() - record.openedAt >= cooldown) {
      record.state = "HALF_OPEN";
      return true;
    }
    return false;
  }

  recordSuccess(key: string): void {
    const record = this.record(key);
    record.state = "CLOSED";
    record.consecutiveFailures = 0;
    record.openedAt = null;
    record.health = "HEALTHY";
    record.lastErrorCode = null;
  }

  /**
   * Record a failure and advance the state machine.
   *
   * An auth failure opens the circuit IMMEDIATELY rather than counting toward a
   * threshold: a wrong credential cannot fix itself, and retrying it is how an
   * account gets locked or rate-limited for no reason.
   */
  recordFailure(key: string, errorCode: string): CircuitRecord {
    const record = this.record(key);
    record.consecutiveFailures += 1;
    record.lastErrorCode = errorCode;

    if (errorCode === "auth_failure") {
      record.health = "UNAVAILABLE";
      this.open(record);
      return record;
    }
    if (errorCode === "provider_429") {
      record.health = "RATE_LIMITED";
      this.open(record);
      return record;
    }

    if (record.consecutiveFailures >= this.failureThreshold) {
      record.health = "UNAVAILABLE";
      this.open(record);
    } else {
      record.health = "DEGRADED";
    }
    return record;
  }

  private open(record: CircuitRecord): void {
    record.state = "OPEN";
    record.openedAt = this.now();
  }

  /** Mark a provider dead for reasons outside the breaker (config-disabled). */
  disable(key: string): void {
    const record = this.record(key);
    record.health = "DISABLED";
    record.state = "OPEN";
    record.openedAt = this.now();
  }

  getState(key: string): CircuitRecord {
    return { ...this.record(key) };
  }

  /** Test seam. */
  reset(): void {
    this.records.clear();
  }

  snapshot(): Record<string, CircuitRecord> {
    const out: Record<string, CircuitRecord> = {};
    for (const [key, record] of this.records.entries()) out[key] = { ...record };
    return out;
  }
}

// ---------------------------------------------------------------------------
// Shared process-wide breaker
// ---------------------------------------------------------------------------

let defaultBreaker: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!defaultBreaker) defaultBreaker = new CircuitBreaker();
  return defaultBreaker;
}

export function resetCircuitBreaker(): void {
  defaultBreaker = null;
}

// ---------------------------------------------------------------------------
// Health projection
// ---------------------------------------------------------------------------

/**
 * Combine the registry's health snapshot with the breaker's live state.
 *
 * The breaker wins on disagreement: it holds the more recent observation, and a
 * cached "healthy" from a check that ran minutes ago is exactly the stale answer
 * that routes a request into a dead provider.
 */
export function projectHealthState(
  providerId: string,
  registry: ProviderRegistry,
  breaker: CircuitBreaker,
): HealthState {
  const circuit = breaker.getState(providerId);
  if (circuit.health === "DISABLED") return "DISABLED";
  if (circuit.state === "OPEN") return circuit.health === "HEALTHY" ? "UNAVAILABLE" : circuit.health;
  const cached: ProviderHealth | undefined = registry.getCachedHealth(providerId);
  if (!cached) return circuit.health;
  if (!cached.healthy) return circuit.health === "HEALTHY" ? "DEGRADED" : circuit.health;
  return circuit.health;
}

/** Whether a health state permits a request. DEGRADED still serves: it is a warning. */
export function isPermitting(state: HealthState): boolean {
  return state === "HEALTHY" || state === "DEGRADED";
}

export interface AdaptiveRouterContext {
  readonly config: GatewayConfig;
  readonly providerRegistry: ProviderRegistry;
  readonly breaker: CircuitBreaker;
}

