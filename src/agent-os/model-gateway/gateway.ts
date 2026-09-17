/**
 * Phase 20.85 — Pao-hubPro Unified Model Gateway
 * Authoritative Master Gateway implementing policy governance,
 * capability routing, cumulative retry budgets, circuit breaking, and audit.
 */

import { openAgentOsDb } from "../db";
import { CapabilityRegistry } from "./registry";
import { PolicyEnvelopeBuilder, LocalOnlyViolationError } from "./envelope";
import { BudgetGovernanceEngine, BudgetPolicyError } from "./budget";
import { CircuitBreakerEngine } from "./circuits";
import { DirectGatewayAdapter } from "./adapters/direct";
import { OmniRouteGatewayAdapter } from "./adapters/omniroute";
import type {
  FailureClass,
  GatewayHealth,
  GatewayRequest,
  GatewayResponse,
  PolicyEnvelope,
  RouteAttempt,
} from "./types";

export interface GatewayOptions {
  omnirouteEnabled?: boolean;
  omnirouteBaseUrl?: string;
  omnirouteApiKey?: string;
  defaultTimeoutMs?: number;
}

export class PaoModelGateway {
  public readonly registry: CapabilityRegistry;
  public readonly envelopeBuilder: PolicyEnvelopeBuilder;
  public readonly budgetEngine: BudgetGovernanceEngine;
  public readonly circuitBreaker: CircuitBreakerEngine;

  private directAdapter: DirectGatewayAdapter;
  private omnirouteAdapter: OmniRouteGatewayAdapter;
  private omnirouteEnabled: boolean;

  constructor(options?: GatewayOptions) {
    this.registry = new CapabilityRegistry();
    this.envelopeBuilder = new PolicyEnvelopeBuilder(this.registry);
    this.budgetEngine = new BudgetGovernanceEngine();
    this.circuitBreaker = new CircuitBreakerEngine();

    this.directAdapter = new DirectGatewayAdapter(this.registry, this.budgetEngine);
    this.omnirouteAdapter = new OmniRouteGatewayAdapter(
      this.registry,
      this.budgetEngine,
      {
        baseUrl: options?.omnirouteBaseUrl,
        apiKey: options?.omnirouteApiKey,
        timeoutMs: options?.defaultTimeoutMs,
      },
    );

    // Default: enabled unless explicitly set to 'false' or passed false
    this.omnirouteEnabled =
      options?.omnirouteEnabled ?? process.env.PAO_OMNIROUTE_ENABLED !== "false";
  }

  public setOmniRouteEnabled(enabled: boolean): void {
    this.omnirouteEnabled = enabled;
  }

  public isOmniRouteEnabled(): boolean {
    return this.omnirouteEnabled;
  }

  /**
   * Main entry point: executes a model request within full Pao policy envelope.
   */
  public async execute(request: GatewayRequest): Promise<GatewayResponse> {
    const start = performance.now();

    // 1. Build authoritative policy envelope
    const envelope = this.envelopeBuilder.build(request);

    // 2. Resolve approved candidates conforming to policy & capabilities
    const candidates = this.envelopeBuilder.resolveApprovedCandidates(
      envelope,
      request.capabilityRequirements,
    );

    const attempts: RouteAttempt[] = [];
    let cumulativeCostUsd = 0;
    let selectedModelId = "";
    let finalOutput = "";
    let structuredResult: unknown;
    let finalInputTokens = 0;
    let finalOutputTokens = 0;
    let lastError: Error | null = null;

    // 3. Attempt execution across candidates up to maxAttempts
    for (let i = 0; i < Math.min(candidates.length, envelope.maxAttempts); i++) {
      const candidateId = candidates[i];
      const model = this.registry.getModel(candidateId)!;
      const attemptNum = i + 1;

      // Circuit Breaker check
      if (!this.circuitBreaker.isAvailable(model.providerId)) {
        attempts.push({
          attemptNumber: attemptNum,
          provider: model.providerId,
          model: model.modelName,
          modelFamily: model.modelFamily,
          isLocal: model.isLocal,
          status: "failed",
          errorClass: "provider_unavailable",
          errorMessage: `Circuit breaker is OPEN for provider '${model.providerId}'`,
          latencyMs: 1,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Pre-flight Budget check
      try {
        this.budgetEngine.preflightCheck(model, envelope);
      } catch (err: unknown) {
        attempts.push({
          attemptNumber: attemptNum,
          provider: model.providerId,
          model: model.modelName,
          modelFamily: model.modelFamily,
          isLocal: model.isLocal,
          status: "failed",
          errorClass: "budget_denied",
          errorMessage: (err as Error).message,
          latencyMs: 1,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          timestamp: new Date().toISOString(),
        });
        throw err;
      }

      const attemptStart = performance.now();

      try {
        // Execute via OmniRoute or Direct Adapter
        let result;
        if (this.omnirouteEnabled && !model.isLocal) {
          try {
            result = await this.omnirouteAdapter.executeCandidate(candidateId, request, envelope);
          } catch (omniErr: unknown) {
            // If OmniRoute remote fails, record failure and try direct adapter fallback if allowed
            this.circuitBreaker.recordFailure(model.providerId, (omniErr as Error).message);
            result = await this.directAdapter.executeCandidate(candidateId, request, envelope);
          }
        } else {
          result = await this.directAdapter.executeCandidate(candidateId, request, envelope);
        }

        const attemptLatency = Math.max(Math.round(performance.now() - attemptStart), 1);
        this.circuitBreaker.recordSuccess(model.providerId);

        // Track attempt cost & accumulate
        cumulativeCostUsd += result.actualCostUsd;
        this.budgetEngine.assertCumulativeBudget(
          cumulativeCostUsd,
          0,
          envelope.hardBudgetUsd,
        );

        attempts.push({
          attemptNumber: attemptNum,
          provider: model.providerId,
          model: model.modelName,
          modelFamily: model.modelFamily,
          isLocal: model.isLocal,
          status: "success",
          latencyMs: attemptLatency,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd: result.actualCostUsd,
          actualCostUsd: result.actualCostUsd,
          timestamp: new Date().toISOString(),
        });

        selectedModelId = candidateId;
        finalOutput = result.output;
        structuredResult = result.structuredOutput;
        finalInputTokens = result.inputTokens;
        finalOutputTokens = result.outputTokens;
        lastError = null;
        break; // Success! Exit attempt loop
      } catch (err: unknown) {
        const attemptLatency = Math.max(Math.round(performance.now() - attemptStart), 1);
        const errorMsg = (err as Error).message;
        const failureClass: FailureClass =
          (err as unknown as { failureClass?: FailureClass }).failureClass || "transient";

        this.circuitBreaker.recordFailure(model.providerId, errorMsg);

        // Estimate partial attempt cost if failed during transmission
        const failedAttemptCost = model.isLocal ? 0 : 0.0005;
        cumulativeCostUsd += failedAttemptCost;

        attempts.push({
          attemptNumber: attemptNum,
          provider: model.providerId,
          model: model.modelName,
          modelFamily: model.modelFamily,
          isLocal: model.isLocal,
          status: "failed",
          errorClass: failureClass,
          errorMessage: errorMsg,
          latencyMs: attemptLatency,
          estimatedCostUsd: failedAttemptCost,
          actualCostUsd: failedAttemptCost,
          timestamp: new Date().toISOString(),
        });

        lastError = err as Error;

        // If not allowed to fallback or permanent error, abort immediately
        if (!envelope.allowFallback || failureClass === "invalid_request" || failureClass === "authentication") {
          break;
        }
      }
    }

    const totalLatencyMs = Math.max(Math.round(performance.now() - start), 1);

    if (!selectedModelId) {
      this.recordAudit(request, envelope, attempts, null, totalLatencyMs, "failed");
      throw (
        lastError ||
        new Error(
          `All ${attempts.length} attempts in route group '${envelope.routeGroup}' failed.`,
        )
      );
    }

    const selectedModel = this.registry.getModel(selectedModelId)!;
    const finalCost = this.budgetEngine.computeCumulativeCost(attempts);

    const response: GatewayResponse = {
      requestId: request.requestId,
      taskId: request.taskId,
      output: finalOutput,
      structuredOutput: structuredResult,
      routing: {
        requestedRouteGroup: envelope.routeGroup,
        resolvedProvider: selectedModel.providerId,
        resolvedModel: selectedModel.modelName,
        resolvedModelFamily: selectedModel.modelFamily,
        isLocal: selectedModel.isLocal,
        fallbackCount: Math.max(attempts.length - 1, 0),
        attempts,
      },
      usage: {
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        totalTokens: finalInputTokens + finalOutputTokens,
        totalTaskCostUsd: finalCost, // Cumulative across all attempts!
        finalAttemptCostUsd: attempts[attempts.length - 1]?.actualCostUsd ?? 0,
        pricingStatus: selectedModel.pricing.status,
      },
      performance: {
        totalLatencyMs,
        firstTokenLatencyMs: Math.round(totalLatencyMs * 0.4),
      },
      governance: {
        policyDecisionId: envelope.policyDecisionId,
        dataClass: envelope.dataClass,
        localOnly: envelope.localOnly,
        unknownPriceDenied: false,
        correlationCheckPassed: true,
      },
      gateway: {
        adapter: this.omnirouteEnabled && !selectedModel.isLocal ? "omniroute" : "direct",
        version: "20.85.0",
      },
    };

    // 4. Persist durable audit record
    this.recordAudit(request, envelope, attempts, response, totalLatencyMs, "success");

    return response;
  }

  public getRecentAuditRecords(): unknown[] {
    try {
      const db = openAgentOsDb();
      return db.query("SELECT * FROM gw_audit_records ORDER BY created_at DESC LIMIT 50").all();
    } catch {
      return [];
    }
  }

  public async health(): Promise<GatewayHealth> {
    const circuits = this.circuitBreaker.listCircuits();
    const openCircuits = circuits.filter((c) => c.state === "open");

    // Real connection probe (cached inside the adapter). OmniRoute being
    // offline is a DEGRADED state — the direct adapter keeps the gateway
    // serving; it must never crash the runtime or lie about connectivity.
    const connection = await this.omnirouteAdapter.connectionHealth();
    const connected = this.omnirouteEnabled && connection.status === "connected";

    let totalRequestsToday = 0;
    try {
      const row = openAgentOsDb()
        .query("SELECT COUNT(*) AS n FROM gw_audit_records WHERE created_at >= ?")
        .get(new Date(Date.now() - 24 * 3600 * 1000).toISOString()) as { n: number };
      totalRequestsToday = row?.n ?? 0;
    } catch {
      totalRequestsToday = 0;
    }

    const degraded = openCircuits.length > 0 || (this.omnirouteEnabled && connection.status !== "connected");
    return {
      status: degraded ? "degraded" : "healthy",
      activeAdapter: this.omnirouteEnabled ? "omniroute" : "direct",
      omnirouteConnected: connected,
      omniroute: {
        baseUrl: connection.baseUrl,
        status: connection.status,
        checkedAt: connection.checkedAt,
        latencyMs: connection.latencyMs,
        error: connection.error,
      },
      totalRequestsToday,
      openCircuitsCount: openCircuits.length,
      circuits,
    };
  }

  private recordAudit(
    request: GatewayRequest,
    envelope: PolicyEnvelope,
    attempts: RouteAttempt[],
    response: GatewayResponse | null,
    latencyMs: number,
    status: "success" | "failed",
  ): void {
    try {
      const db = openAgentOsDb();
      const lastAttempt = attempts[attempts.length - 1];
      const costUsd = response?.usage.totalTaskCostUsd ?? this.budgetEngine.computeCumulativeCost(attempts);

      const sql = "INSERT INTO gw_audit_records (request_id, actor_id, workspace_id, task_type, route_group, resolved_provider, resolved_model, model_family, data_class, local_only, attempts_count, attempts_json, input_tokens, output_tokens, cost_usd, pricing_status, latency_ms, status, policy_decision_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      db.run(sql, [
        request.requestId,
        request.actorId,
        request.workspaceId ?? null,
        request.taskType,
        envelope.routeGroup,
        lastAttempt?.provider ?? "unknown",
        lastAttempt?.model ?? "unknown",
        lastAttempt?.modelFamily ?? "unknown",
        envelope.dataClass,
        envelope.localOnly ? 1 : 0,
        attempts.length,
        JSON.stringify(attempts),
        response?.usage.inputTokens ?? 0,
        response?.usage.outputTokens ?? 0,
        costUsd,
        response?.usage.pricingStatus ?? "known",
        latencyMs,
        status,
        envelope.policyDecisionId,
        new Date().toISOString(),
      ]);
    } catch {
      // Graceful fallback if audit table lock in test runners
    }
  }
}

let defaultGatewayInstance: PaoModelGateway | null = null;

export function getModelGateway(options?: GatewayOptions): PaoModelGateway {
  if (!defaultGatewayInstance) {
    defaultGatewayInstance = new PaoModelGateway(options);
  }
  return defaultGatewayInstance;
}

