// Phase 20.94 — BYOK model marketplace adapter over Phase 20.85 OmniRoute gateway.
// Does not create a second router.

import { getModelGateway } from "../model-gateway/gateway";
import { OmniRouteGatewayAdapter } from "../model-gateway/adapters/omniroute";
import { PolicyEnvelopeBuilder } from "../model-gateway/envelope";
import { BudgetGovernanceEngine } from "../model-gateway/budget";
import type { ModelDefinition, ProviderDefinition } from "../model-gateway/types";
import type { ModelRecord, ModelRouteDecision, ModelRouteRequest } from "./types";

export function listMarketplaceModels(): ModelRecord[] {
  const gw = getModelGateway();
  const providers = new Map(gw.registry.listProviders().map((p) => [p.id, p]));
  return gw.registry.listModels().map((m) => toRecord(m, providers.get(m.providerId)));
}

export function routeModel(req: ModelRouteRequest): ModelRouteDecision {
  const all = listMarketplaceModels();
  const deny = new Set((req.denyProviders ?? []).map((s) => s.toLowerCase()));
  const allow = req.allowProviders?.map((s) => s.toLowerCase());
  let pool = all.filter((m) => {
    if (deny.has(m.provider.toLowerCase())) return false;
    if (allow && allow.length && !allow.includes(m.provider.toLowerCase())) return false;
    if (req.localOnly && m.privacyClass !== "local") return false;
    if (req.tools && !m.supportsTools) return false;
    if (req.structuredOutput && !m.supportsStructuredOutput) return false;
    if (req.reasoning && !m.supportsReasoning) return false;
    if (req.modalities?.length && !req.modalities.every((mod) => m.modalities.includes(mod))) return false;
    if (req.requirements?.length && !req.requirements.every((cap) => m.capabilities.includes(cap) || capabilityAlias(m, cap))) return false;
    if (req.maxCostUsd != null && costFloor(m) > req.maxCostUsd) return false;
    return true;
  });

  if (req.requestedId) {
    const requested = pool.find((m) => m.id === req.requestedId);
    if (requested && requested.health === "healthy") {
      return decision(req.requestedId, requested, "requested healthy model", []);
    }
  }

  const healthy = pool.filter((m) => m.health === "healthy");
  const usable = healthy.length ? healthy : pool.filter((m) => m.health !== "offline");
  usable.sort((a, b) => rank(a) - rank(b));
  const chosen = usable[0];
  if (!chosen) {
    const fallback = all.find((m) => m.privacyClass === "local") ?? all[0];
    if (!fallback) {
      return {
        actualId: "unconfigured/none",
        provider: "none",
        reason: "no models registered in OmniRoute gateway",
        fallbacks: [],
        configured: false,
        health: "unknown",
      };
    }
    return decision(req.requestedId, fallback, "no compatible model; using fallback", []);
  }
  const fallbacks = usable.slice(1, req.maxAttempts ?? 3).map((m) => m.id);
  const reason = req.requestedId && req.requestedId !== chosen.id
    ? "requested model unhealthy or filtered; routed to healthy compatible model"
    : "capability/policy/health/cost ranking";
  return decision(req.requestedId, chosen, reason, fallbacks);
}

function toRecord(model: ModelDefinition, provider?: ProviderDefinition): ModelRecord {
  const health = mapHealth(provider?.healthStatus);
  const cost = model.pricing.inputPerMillion + model.pricing.outputPerMillion;
  return {
    id: model.id,
    provider: model.providerId,
    displayName: model.modelName,
    modalities: model.capabilities.includes("vision") ? ["text", "vision"] : ["text"],
    capabilities: model.capabilities,
    contextWindow: model.contextWindow,
    supportsTools: model.capabilities.includes("structured_output") || model.capabilities.includes("coding"),
    supportsStructuredOutput: model.capabilities.includes("structured_output"),
    supportsReasoning: model.capabilities.includes("reasoning"),
    supportsStreaming: true,
    latencyClass: model.isLocal ? "low" : "normal",
    costClass: cost === 0 ? "free" : cost < 5 ? "low" : cost < 20 ? "medium" : "high",
    privacyClass: model.isLocal ? "local" : "gateway",
    health,
    healthCheckedAt: new Date().toISOString(),
    trustScore: model.status === "approved" ? 0.9 : 0.4,
    tags: [model.modelFamily, model.isLocal ? "local" : "remote"],
    configured: Boolean(provider && provider.healthStatus !== "unknown"),
    estimatedCostPerMillionUsd: cost,
  };
}

function mapHealth(status?: ProviderDefinition["healthStatus"]): ModelRecord["health"] {
  if (status === "healthy") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "unhealthy") return "offline";
  return "unknown";
}

function capabilityAlias(model: ModelRecord, cap: string): boolean {
  if (cap === "text.chat") return model.capabilities.includes("text.chat") || model.modalities.includes("text");
  if (cap === "code" || cap === "coding") return model.capabilities.includes("coding");
  if (cap === "structured_output") return model.supportsStructuredOutput;
  return false;
}

function costFloor(model: ModelRecord): number {
  return (model.estimatedCostPerMillionUsd ?? 0) / 1000;
}

function rank(model: ModelRecord): number {
  const healthPenalty = model.health === "healthy" ? 0 : model.health === "degraded" ? 20 : 50;
  const cost = model.estimatedCostPerMillionUsd ?? 99;
  const localBonus = model.privacyClass === "local" ? -1 : 0;
  return healthPenalty + cost + localBonus;
}

function decision(requestedId: string | undefined, model: ModelRecord, reason: string, fallbacks: string[]): ModelRouteDecision {
  return {
    requestedId,
    actualId: model.id,
    provider: model.provider,
    reason,
    fallbacks,
    configured: model.configured,
    health: model.health,
  };
}

/** Test seam: mark a provider unhealthy in the live gateway registry. */
export function setProviderHealthForTests(providerId: string, healthStatus: ProviderDefinition["healthStatus"]): void {
  const gw = getModelGateway();
  const existing = gw.registry.getProvider(providerId);
  if (!existing) return;
  gw.registry.registerProvider({ ...existing, healthStatus });
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export async function probeOmniRouteBaseUrl(): Promise<{ baseUrl: string; reachable: boolean; healthStatus: number | null; latencyMs: number | null }> {
  const candidates = [process.env.PAO_OMNIROUTE_BASE_URL, "http://127.0.0.1:20128", "http://127.0.0.1:9090"].filter((u): u is string => Boolean(u && u.trim()));
  for (const raw of candidates) {
    const baseUrl = raw.replace(/\/+$/, "");
    const started = performance.now();
    try {
      const res = await fetch(baseUrl + "/healthz", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { baseUrl, reachable: true, healthStatus: res.status, latencyMs: Math.round(performance.now() - started) };
    } catch {
      // try next candidate
    }
  }
  return { baseUrl: (candidates[0] ?? "http://127.0.0.1:9090").replace(/\/+$/, ""), reachable: false, healthStatus: null, latencyMs: null };
}

export type RuntimeState = "AVAILABLE" | "UNCONFIGURED" | "DEGRADED" | "FALLBACK" | "ERROR";

export interface OmniRouteCompletion {
  state: RuntimeState;
  real: boolean;
  adapter: "omniroute" | "direct" | "none";
  route: ModelRouteDecision;
  output?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  health?: unknown;
  error?: string;
  reason: string;
}

export async function completeViaOmniRoute(input: {
  prompt: string;
  actor?: string;
  requirements?: string[];
  maxCostUsd?: number;
  execute?: (req: import("../model-gateway/types").GatewayRequest) => Promise<import("../model-gateway/types").GatewayResponse>;
  health?: () => Promise<unknown>;
}): Promise<OmniRouteCompletion> {
  const route = routeModel({
    requirements: input.requirements ?? ["text.chat"],
    tools: false,
    maxCostUsd: input.maxCostUsd,
  });
  const probe = input.execute ? { baseUrl: "injected", reachable: true, healthStatus: 200, latencyMs: 0 } : await probeOmniRouteBaseUrl();
  const apiKey = process.env.PAO_OMNIROUTE_API_KEY || process.env.OMNIROUTE_API_KEY || (probe.reachable && isLoopback(probe.baseUrl) ? "sk_omniroute" : "");
  const gw = getModelGateway();
  let health: unknown = { omniroute: probe };
  try {
    health = input.health ? await input.health() : { omniroute: probe };
  } catch (err) {
    health = { omniroute: probe, error: err instanceof Error ? err.message : "health failed" };
  }
  if (!input.execute && !probe.reachable) {
    return {
      state: "UNCONFIGURED",
      real: false,
      adapter: "none",
      route,
      health,
      reason: "OmniRoute daemon is not reachable on PAO_OMNIROUTE_BASE_URL, :20128, or :9090",
    };
  }
  const requestId = "enzo_" + Date.now().toString(36);
  try {
    const request: import("../model-gateway/types").GatewayRequest = {
      requestId,
      actorId: input.actor ?? "enzo-workspace",
      taskType: "chat",
      prompt: input.prompt,
      capabilityRequirements: input.requirements ?? ["text.chat"],
      policy: { routeGroup: "fast-decision", unknownPriceBehavior: "allow" },
      budget: { maxCostUsd: input.maxCostUsd ?? 0.05, maxAttempts: 2 },
    };
    if (input.execute) {
    const response = await input.execute(request);
    const adapter = response.gateway.adapter;
    const simulated = /^\[[^\]]+\] Response to:/.test(response.output || "") || /DirectAdapter/.test(response.output || "");
    const real = adapter === "omniroute" && !simulated;
    return {
      state: real ? "AVAILABLE" : "FALLBACK",
      real,
      adapter,
      route: {
        ...route,
        actualId: response.routing.resolvedProvider + "/" + response.routing.resolvedModel,
        provider: response.routing.resolvedProvider,
        reason: real ? "omniroute adapter completed" : "gateway used simulated direct adapter; not a live OmniRoute completion",
      },
      output: response.output?.slice(0, 500),
      latencyMs: response.performance.totalLatencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: response.usage.totalTaskCostUsd,
      health,
      reason: real ? "live OmniRoute completion" : "direct adapter is in-process simulation",
    };
    }
    const envelope = new PolicyEnvelopeBuilder(gw.registry).build(request);
    const omni = new OmniRouteGatewayAdapter(gw.registry, new BudgetGovernanceEngine(), {
      baseUrl: probe.baseUrl,
      apiKey,
      timeoutMs: 15000,
      fastFailOnUnreachable: false,
    });
    const candidate = gw.registry.getRouteGroup("fast-decision")?.candidates[0] ?? route.actualId;
    const started = performance.now();
    const result = await omni.executeCandidate(candidate, request, envelope);
    const model = gw.registry.getModel(candidate);
    return {
      state: "AVAILABLE",
      real: true,
      adapter: "omniroute",
      route: {
        ...route,
        actualId: candidate,
        provider: model?.providerId ?? route.provider,
        reason: "omniroute adapter completed via " + probe.baseUrl,
      },
      output: result.output?.slice(0, 500),
      latencyMs: result.latencyMs ?? Math.round(performance.now() - started),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.actualCostUsd,
      health,
      reason: "live OmniRoute completion",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unconfigured = /401|403|api key|invalid_api_key|no active credentials|not set|unreachable|ECONNREFUSED|disabled/i.test(message);
    return {
      state: unconfigured ? "UNCONFIGURED" : "ERROR",
      real: false,
      adapter: "omniroute",
      route,
      health,
      error: message.slice(0, 300),
      reason: unconfigured ? "OmniRoute credential or daemon is not configured" : "OmniRoute execution failed",
    };
  }
}
