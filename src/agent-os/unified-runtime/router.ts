// Phase 20.35 — capability resolver (§2.2, §E), intent/mode router with the
// weighted score engine (§9-§11), retry classification (§12) and circuit
// breaker (§13). Capability mismatch is a HARD rejection; scoring is
// explainable and its weights are configurable.

import type {
  AIMode,
  CircuitState,
  ProviderCapability,
  ProviderCapabilities,
  ProviderManifest,
  RetryClassification,
  RoutePreviewResult,
  RouteReason,
  UnifiedAIRequest,
  UnifiedAIResponse,
} from "./types";

// --- Capability requirements (hard filter) ---------------------------------

const MODE_REQUIREMENTS: Partial<Record<AIMode, ProviderCapability[]>> = {
  coding: ["text", "reasoning"],
  review: ["text", "reasoning"],
  research: ["text"],
  writing: ["text"],
  general: ["text"],
  image: ["image_generation"],
  video: ["video_generation"],
  audio: ["audio_output"],
  automation: ["text", "tool_calling"],
  adobe_stock: ["text"],
  private_local: ["text"],
};

/** Extracts required capabilities from the request (§9.1 requirement
 *  extraction): attachments imply multimodal input, tools/tool-calls imply
 *  tool_calling, json response formats imply structured output, agent mode
 *  implies workspace-scoped access capabilities. */
export function extractRequirements(request: UnifiedAIRequest): ProviderCapability[] {
  const required = new Set<ProviderCapability>(["text"]);
  const mode = request.mode ?? detectMode(request);
  for (const capability of MODE_REQUIREMENTS[mode] ?? []) required.add(capability);
  if ((request.attachments ?? []).length > 0) {
    required.add("vision"); // image attachments; audio handled per MIME below
    for (const attachment of request.attachments ?? []) {
      if (attachment.mimeHint?.startsWith("audio/")) { required.add("audio_input"); required.delete("vision"); }
      if (attachment.mimeHint?.startsWith("video/")) { required.add("vision"); }
    }
  }
  if (request.tools) required.add("tool_calling");
  if (request.responseFormat === "json_object" || request.responseFormat === "json_schema") {
    required.add("structured_output");
    if (request.responseFormat === "json_schema") required.add("json_schema");
  }
  if (request.routing?.requiredCapabilities) {
    for (const capability of request.routing.requiredCapabilities) required.add(capability);
  }
  if (request.execution?.class === "agent_mode") {
    required.add("filesystem_access");
    required.add("shell_access");
  }
  return [...required];
}

export function meetsRequirements(capabilities: ProviderCapabilities, required: ProviderCapability[], executionClass: string): { ok: boolean; missing: ProviderCapability[] } {
  const missing: ProviderCapability[] = [];
  for (const requirement of required) {
    const value: boolean | string | undefined = (capabilities as unknown as Record<string, unknown>)[requirement] as boolean | string | undefined;
    const satisfied = typeof value === "string" ? value === "agent_only" && executionClass === "agent_mode" : value === true;
    if (!satisfied) missing.push(requirement);
  }
  return { ok: missing.length === 0, missing };
}

// --- Intent / mode detection (deterministic; no model call) ------------------

const MODE_HINTS: Array<{ mode: AIMode; patterns: RegExp[] }> = [
  { mode: "coding", patterns: [/\b(code|fix|refactor|test|bug|compile|repo|function|typescript|python)\b/i, /\bแก้\s*(โค้ด|bug|test)\b/i] },
  { mode: "review", patterns: [/\b(review|audit|check this|approv)/i, /\bรีวิว\b/i] },
  { mode: "research", patterns: [/\b(research|find sources|compare|literature|survey)\b/i] },
  { mode: "writing", patterns: [/\b(write|draft|blog|article|copy|proofread)\b/i] },
  { mode: "image", patterns: [/\b(image|picture|illustration|logo|generate .*image)\b/i] },
  { mode: "video", patterns: [/\b(video|clip|render .*video|footage)\b/i] },
  { mode: "audio", patterns: [/\b(voice|narration|speech|audio|tts|dub)\b/i] },
  { mode: "automation", patterns: [/\b(automate|schedule|workflow|pipeline|batch)\b/i] },
  { mode: "adobe_stock", patterns: [/\b(adobe stock|stock (portfolio|asset))\b/i] },
  { mode: "private_local", patterns: [/\b(private|local only|offline|no cloud)\b/i] },
];

export function detectMode(request: UnifiedAIRequest): AIMode {
  if (request.mode) return request.mode;
  if (request.model === "pao/private") return "private_local";
  if (request.model === "pao/adobe-stock") return "adobe_stock";
  if (request.model === "pao/coding") return "coding";
  if (request.model === "pao/research") return "research";
  if (request.model === "pao/reviewer") return "review";
  if (request.model === "pao/image") return "image";
  if (request.model === "pao/video") return "video";
  if (request.model === "pao/audio") return "audio";
  const text = [request.prompt ?? "", ...(request.messages ?? []).map((message) => message.content)].join(" ");
  for (const hint of MODE_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(text))) return hint.mode;
  }
  return "general";
}

// --- Score engine (§10, configurable weights) --------------------------------

export interface ScoreWeights {
  capability: number;
  mode: number;
  health: number;
  privacy: number;
  preference: number;
  latency: number;
  reliability: number;
  cost: number;
  cooldown: number;
  recentFailure: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  capability: 100, mode: 40, health: 30, privacy: 30,
  preference: 20, latency: 15, reliability: 30, cost: -15,
  cooldown: -50, recentFailure: -25,
};

export interface ScoreInput {
  manifest: ProviderManifest;
  healthScore: number; // 0..1
  latencyMs: number;
  recentFailures: number;
  cooldownPenalty: boolean;
  localPreferred: boolean;
  weights?: Partial<ScoreWeights>;
}

export function scoreProvider(input: ScoreInput, mode: AIMode, executionClass: string): { score: number; reasons: string[] } {
  const w = { ...DEFAULT_WEIGHTS, ...input.weights };
  const reasons: string[] = [];
  const affinity = input.manifest.routing.modes[mode] ?? Math.round(input.manifest.routing.basePriority / 4);
  const capabilityAffinity = Math.min(100, affinity + (input.manifest.isLocal && input.localPreferred ? 15 : 0));
  if (input.manifest.isLocal && input.localPreferred) reasons.push("local preferred");
  const privacy = input.manifest.isLocal ? 1 : input.manifest.capabilities.text ? 0.5 : 0.3;
  const latency = Math.max(0, 1 - input.latencyMs / Math.max(input.manifest.limits.timeoutMs, 1));
  const reliability = input.healthScore;
  const costPenalty = input.manifest.isLocal ? 0 : 0.5;
  const score =
    capabilityAffinity * (w.capability / 100) +
    affinity * (w.mode / 100) +
    input.healthScore * w.health +
    privacy * w.privacy +
    0.5 * w.preference +
    latency * w.latency +
    reliability * w.reliability +
    costPenalty * w.cost +
    (input.cooldownPenalty ? w.cooldown : 0) +
    Math.min(input.recentFailures, 4) * (w.recentFailure / 4);
  if (affinity >= 80) reasons.push(`strong ${mode} affinity (${affinity})`);
  if (input.healthScore < 0.6) reasons.push(`degraded health (${input.healthScore.toFixed(2)})`);
  if (input.recentFailures > 0) reasons.push(`${input.recentFailures} recent failure(s)`);
  if (executionClass === "agent_mode") reasons.push("agent mode: workspace grants enforced");
  return { score: Number(score.toFixed(2)), reasons };
}

/** THE routing decision (§9.1 pipeline): policy/health/capability filters,
 *  then scoring, then ordered fallbacks. Never executes anything. */
export function previewRoute(input: {
  request: UnifiedAIRequest;
  providers: ProviderManifest[];
  healthOf: (providerId: string) => { state: string; healthScore: number; latencyMs: number; recentFailures: number; cooldown: boolean };
  weights?: Partial<ScoreWeights>;
}): RoutePreviewResult {
  const mode = input.request.mode ?? detectMode(input.request);
  const requirements = extractRequirements(input.request);
  const executionClass = input.request.execution?.class ?? "provider_mode";
  const localPreferred = input.request.routing?.preferLocal === true || mode === "private_local";
  const policyDecisions: string[] = [];
  const candidates: RouteReason[] = [];
  const excluded: RouteReason[] = [];

  for (const manifest of input.providers) {
    const health = input.healthOf(manifest.id);
    const reasons: string[] = [];
    let included = manifest.enabled;
    if (!manifest.enabled) reasons.push("provider disabled");
    if (mode === "private_local" && !manifest.isLocal) {
      included = false;
      reasons.push("private_local policy: cloud providers excluded (fail closed)");
      policyDecisions.push(`${manifest.id}: excluded by local-only policy`);
    }
    if (manifest.capabilities.mcp_client === false && executionClass === "agent_mode" && manifest.type === "browser") {
      included = false;
      reasons.push("browser adapters are disabled by default (spec §16)");
      policyDecisions.push(`${manifest.id}: browser adapter disabled by default`);
    }
    const requirementsCheck = meetsRequirements(manifest.capabilities, requirements, executionClass);
    if (included && !requirementsCheck.ok) {
      included = false;
      reasons.push(`capability mismatch: missing ${requirementsCheck.missing.join(", ")}`);
    }
    if (included && (health.state === "offline" || health.state === "disabled" || health.state === "cooldown")) {
      included = false;
      reasons.push(`health=${health.state}`);
    }
    if (health.state === "auth_error" || health.state === "rate_limited") {
      included = false;
      reasons.push(`health=${health.state}`);
    }
    const scored = scoreProvider({ manifest, healthScore: health.healthScore, latencyMs: health.latencyMs, recentFailures: health.recentFailures, cooldownPenalty: health.cooldown, localPreferred, weights: input.weights }, mode, executionClass);
    const entry: RouteReason = { providerId: manifest.id, score: included ? scored.score : 0, included, reasons: [...reasons, ...scored.reasons] };
    if (included) candidates.push(entry); else excluded.push(entry);
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    mode,
    requirements,
    selected: candidates[0]?.providerId ?? null,
    fallbacks: candidates.slice(1).map((entry) => entry.providerId),
    candidates,
    excluded,
    policyDecisions,
    executionClass,
  };
}

// --- Retry classification (§12): never blind --------------------------------

const RETRYABLE = [
  { pattern: /\b(timeout|timed out|etimedout)\b/i, reason: "timeout" },
  { pattern: /\b(econnreset|connection reset|socket hang up)\b/i, reason: "connection reset" },
  { pattern: /\b429\b/, reason: "rate limited (respect provider retry hint)" },
  { pattern: /\b5\d\d\b|internal server error|bad gateway|service unavailable/i, reason: "transient 5xx" },
  { pattern: /\bunavailable\b/i, reason: "provider temporarily unavailable" },
];

const TERMINAL = [
  { pattern: /\b(401|403|auth|unauthorized|invalid api key)\b/i, reason: "authentication failure" },
  { pattern: /\b(policy|denied|forbidden by policy)\b/i, reason: "policy denial" },
  { pattern: /\b(invalid|malformed|validation)\b/i, reason: "invalid input" },
  { pattern: /\b(capability|unsupported)\b/i, reason: "unsupported capability" },
  { pattern: /\b(workspace|permission)\b/i, reason: "workspace permission denial" },
];

export function classifyRetry(err: unknown): RetryClassification {
  const message = err instanceof Error ? err.message : String(err);
  for (const terminal of TERMINAL) {
    if (terminal.pattern.test(message)) return { retryable: false, reason: terminal.reason };
  }
  for (const retryable of RETRYABLE) {
    if (retryable.pattern.test(message)) return { retryable: true, reason: retryable.reason };
  }
  return { retryable: false, reason: "unclassified errors are terminal (fail closed)" };
}

// --- Circuit breaker (§13): per provider, configurable ------------------------

export interface CircuitConfig {
  failureThreshold: number;
  windowMs: number;
  openMs: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitConfig = { failureThreshold: 5, windowMs: 60_000, openMs: 120_000 };

export class ProviderCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: number[] = [];
  private openedAt = 0;
  private lastError: string | null = null;

  constructor(private config: CircuitConfig = DEFAULT_CIRCUIT_CONFIG) {}

  currentState(): CircuitState {
    if (this.state === "OPEN" && Date.now() - this.openedAt >= this.config.openMs) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  lastFailureReason(): string | null {
    return this.lastError;
  }

  /** Returns true when a request may be attempted. */
  canAttempt(): boolean {
    const state = this.currentState();
    if (state === "OPEN") return false;
    if (state === "HALF_OPEN") return true; // single test request
    return true;
  }

  recordSuccess(): void {
    this.failures = [];
    this.state = "CLOSED";
  }

  recordFailure(reason: string): void {
    this.lastError = reason;
    const now = Date.now();
    this.failures = this.failures.filter((timestamp) => now - timestamp < this.config.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.config.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = now;
    }
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = [];
    this.lastError = null;
  }
}

/** Normalizes a provider outcome into a UnifiedAIResponse-shaped object. */
export function toUnifiedResponse(input: {
  id: string;
  providerId: string;
  output: unknown;
  totalMs: number;
  mode: AIMode;
  fallbacksTried?: string[];
  modelId?: string;
  usage?: UnifiedAIResponse["usage"];
}): UnifiedAIResponse {
  return {
    id: input.id,
    providerId: input.providerId,
    modelId: input.modelId,
    output: input.output,
    usage: input.usage,
    timing: { totalMs: input.totalMs },
    routing: { selectedProvider: input.providerId, fallbacksTried: input.fallbacksTried ?? [], mode: input.mode },
  };
}
