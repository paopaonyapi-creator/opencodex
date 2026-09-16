// Phase 20.30 — Pao-hubPro × FCC-inspired Universal AI Coding Gateway:
// alias/policy/cost/budget control plane.
//
// IMPORTANT ARCHITECTURAL MAPPING (doc §59 — no duplicate subsystems): this
// repository IS already a universal provider proxy (src/router.ts,
// src/providers/, src/adapters/, src/compatibility/) with Anthropic Messages
// + OpenAI Responses compatibility, provider adapters, health, quotas, and
// fallback. Phase 20.30 therefore adds the MISSING governance layer on top of
// that existing routing core — Pao aliases, task/cost/budget policies, and
// explainable route preview — instead of a second gateway. Execution stays in
// the existing proxy; this module decides WHICH route is eligible and WHY.

import { randomUUID } from "node:crypto";

export type RoutingMode =
  | "free_first" | "cheapest_first" | "balanced"
  | "quality_first" | "local_first" | "paid_only" | "manual";

export type TaskType =
  | "chat" | "coding" | "debugging" | "repo_analysis" | "reasoning"
  | "review" | "vision" | "summarization" | "metadata" | "automation"
  | "tool_heavy" | "long_context" | "fast_simple";

export interface ModelCandidate {
  /** provider/model canonical id, e.g. "openrouter/deepseek-chat". */
  id: string;
  provider: string;
  capabilities: {
    text: boolean;
    vision: boolean;
    tools: boolean;
    reasoning: boolean;
    streaming: boolean;
    structured_output: boolean;
  };
  /** Estimated cost in USD per million tokens (input+output blend). */
  costPerMillionUsd: number;
  isLocal: boolean;
  isFreeTier: boolean;
  tags: string[];
  /** Health score 0..1 (from existing provider health/compatibility data). */
  healthScore: number;
  /** Remaining quota fraction 0..1; undefined = unknown/unmetered. */
  quotaRemaining?: number;
}

export interface RoutingPolicy {
  id: string;
  name: string;
  mode: RoutingMode;
  taskType?: TaskType;
  /** Hard ceiling for paid spend per request (USD). 0 = free/local only. */
  maxPaidCostPerRequestUsd: number;
  allowedProviders?: string[];
  deniedProviders?: string[];
  requireTools?: boolean;
  requireVision?: boolean;
  requireReasoning?: boolean;
  requireLocal?: boolean;
  requireFree?: boolean;
  distinctProviderFamilies?: boolean;
  enabled: boolean;
}

export interface AliasDefinition {
  alias: string;
  policyId: string;
  description?: string;
}

export interface RouteCandidate {
  candidate: ModelCandidate;
  score: number;
  reasons: string[];
  rejectedReason?: string;
}

export interface RoutePreview {
  alias?: string;
  taskType?: TaskType;
  mode: RoutingMode;
  selected?: RouteCandidate;
  candidates: RouteCandidate[];
  rejected: RouteCandidate[];
  estimatedCostPerRequestUsd?: number;
  note: string;
}

export function newRouteId(): string {
  return "route_" + randomUUID().slice(0, 12);
}
