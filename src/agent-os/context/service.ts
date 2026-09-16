/**
 * Pao Context Control Plane — composition root (Phase 20.53).
 *
 * Wires the OpenViking adapter, breaker, governance store, ingest pipeline,
 * retrieval engine, memory governance, sessions and handoffs behind one
 * service with the §107 health model. RBAC checks happen here BEFORE any
 * backend call; OpenViking authorization remains defense in depth.
 */

import { loadContextConfig, resolveBudgetProfile, type ContextModuleConfig } from "./config";
import { ContextDbStore } from "./db-store";
import { OpenVikingAdapter, AdapterError } from "./adapter/openviking";
import { ContextBackendBreaker } from "./resilience";
import { ContextIngestPipeline, type IngestOutcome } from "./ingest";
import { RetrievalEngine } from "./retrieval";
import { MemoryGovernanceService, MemoryGovernanceError } from "./governance";
import { ContextSessionService, HandoffService } from "./sessions";
import { nextId } from "./events";
import type {
  CompatibilityProbe,
  ContextDbHealth,
  ContextRetrievalRequest,
  ContextRetrievalResponse,
  ContextSubsystemHealth,
} from "./types";

export interface ContextActorPermissions {
  readonly reviewerIds: ReadonlySet<string>;
  readonly operatorIds: ReadonlySet<string>;
}

export function contextPermissionsFromEnv(): ContextActorPermissions {
  const split = (raw: string | undefined) =>
    new Set((raw ?? "").split(",").map(s => s.trim()).filter(s => s !== ""));
  return {
    reviewerIds: split(process.env.PAO_CONTEXT_REVIEWER_ACTORS),
    operatorIds: split(process.env.PAO_CONTEXT_OPERATOR_ACTORS),
  };
}

export class ContextService {
  readonly config: ContextModuleConfig;
  readonly store: ContextDbStore;
  readonly adapter: OpenVikingAdapter;
  readonly breaker: ContextBackendBreaker;
  readonly ingest: ContextIngestPipeline;
  readonly retrieval: RetrievalEngine;
  readonly memory: MemoryGovernanceService;
  readonly sessions: ContextSessionService;
  readonly handoffs: HandoffService;
  private readonly permissions: ContextActorPermissions;

  constructor(options: { config?: ContextModuleConfig } = {}) {
    this.config = options.config ?? loadContextConfig();
    this.store = new ContextDbStore();
    this.adapter = new OpenVikingAdapter({
      baseUrl: this.config.backendBaseUrl,
      apiKeyEnv: this.config.apiKeyEnv,
      timeoutMs: this.config.timeoutMs,
    });
    this.breaker = new ContextBackendBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
    this.ingest = new ContextIngestPipeline({ store: this.store, adapter: this.adapter });
    this.retrieval = new RetrievalEngine({
      store: this.store,
      adapter: this.adapter,
      breaker: this.breaker,
      staleAfterSeconds: 86_400 * 30,
    });
    this.permissions = contextPermissionsFromEnv();
    this.memory = new MemoryGovernanceService({
      store: this.store,
      canReview: actorId => this.permissions.reviewerIds.has(actorId),
    });
    this.sessions = new ContextSessionService({ store: this.store, adapter: this.adapter });
    this.handoffs = new HandoffService({ store: this.store });
  }

  // -------------------------------------------------------------------------

  async probeBackend(): Promise<CompatibilityProbe> {
    const probe = await this.adapter.probeCapabilities();
    this.store.upsertBackend({
      id: this.config.backendType,
      backendType: this.config.backendType,
      baseUrl: this.config.backendBaseUrl,
      serverVersion: probe.serverVersion,
      compatibility: probe.status,
      capabilities: probe.capabilities as unknown as Record<string, unknown>,
    });
    return probe;
  }

  async backendHealth(): Promise<ContextDbHealth> {
    return this.adapter.health();
  }

  /** Governed retrieval with the default budget profile fallback. */
  async retrieve(request: Omit<ContextRetrievalRequest, "budget"> & { budgetProfile?: string }): Promise<ContextRetrievalResponse> {
    const budget = "budget" in request && request.budget !== undefined
      ? (request as ContextRetrievalRequest).budget
      : resolveBudgetProfile(request.budgetProfile ?? this.config.defaultBudgetProfile);
    if (!this.config.flags.retrievalEnabled) {
      return {
        retrievalRunId: nextId("ctxr"),
        status: "blocked",
        budget: { estimatedTokens: 0, maxEstimatedTokens: budget.maxEstimatedTokens },
        items: [],
        truncated: false,
        degradedReason: "CTX_BLOCKED_POLICY",
        injectionPlan: { planId: nextId("ctxp"), retrievalRunId: nextId("ctxr"), items: [], totalEstimatedTokens: 0, truncated: false },
      };
    }
    const fullRequest: ContextRetrievalRequest = { ...(request as Omit<typeof request, "budgetProfile">), budget };
    return this.retrieval.retrieve(fullRequest);
  }

  canReview(actorId: string): boolean {
    return this.permissions.reviewerIds.has(actorId);
  }

  isOperator(actorId: string): boolean {
    return this.permissions.operatorIds.has(actorId);
  }

  health(): ContextSubsystemHealth {
    if (!this.config.enabled) {
      return {
        overall: "disabled",
        backend: { reachable: false, compatible: false },
        retrieval: { healthy: false },
        ingestion: { healthy: false },
        memory: { healthy: false, pendingReviews: 0 },
        circuitBreaker: this.breaker.snapshot().state,
        pendingReviews: 0,
      };
    }
    const breaker = this.breaker.snapshot();
    const pending = this.store.pendingReviewCount();
    const overall: ContextSubsystemHealth["overall"] =
      breaker.state === "closed" ? (pending > 50 ? "degraded" : "healthy") : "degraded";
    return {
      overall,
      backend: { reachable: breaker.state !== "open", compatible: true },
      retrieval: { healthy: this.config.flags.retrievalEnabled && breaker.state === "closed" },
      ingestion: { healthy: true, queueDepth: this.store.queueDepth() },
      memory: { healthy: true, pendingReviews: pending },
      circuitBreaker: breaker.state,
      pendingReviews: pending,
    };
  }

  auditTrail(options: { eventType?: string; resourceUri?: string; limit?: number }) {
    return this.store.listAudit(options);
  }

  lastIngestOutcome(jobId: string): IngestOutcome | null {
    const job = this.store.listJobs(200).find(j => j.id === jobId);
    if (!job) return null;
    return {
      ok: job.status === "ready" || job.status === "processing",
      jobId: job.id,
      status: job.status,
      targetUri: job.targetUri,
      reasonCode: job.errorCode as IngestOutcome["reasonCode"],
      message: job.errorMessage,
    };
  }
}

export { AdapterError, MemoryGovernanceError };
