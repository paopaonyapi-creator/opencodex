// Phase 20.35 — UnifiedRuntimeService: the control-plane core (§5, §E-§H, §I).
// Route previews are pure decisions. Execution follows the store-boundary
// pattern: the incoming request is sanitized and PERSISTED, then reloaded
// inside executor.ts before any adapter is performed — the same fail-safe
// shape the Phase 20.28 gateway and Phase 20.34 runner use. Circuit breakers,
// retry classification, context/secret firewalls and workspace permissions
// wrap every path.

import { recordAgentEvent } from "../events";
import { LeadError } from "../leads/errors";
import { FakeProvider, builtinProviders, type ProviderAdapterRuntime } from "./adapters";
import { ProviderCircuitBreaker, classifyRetry, detectMode, previewRoute } from "./router";
import { checkAgentExecution, executionClassFor, filterContextForProvider, redactSecrets } from "./security";
import { UnifiedRuntimeStore } from "./registry-store";
import { attemptProvider } from "./executor";
import { validateAttachments, type AttachmentValidation } from "./attachments";
import type {
  AIMode,
  ContextEnvelope,
  ContextItem,
  ProviderManifest,
  RoutePreviewResult,
  UnifiedAIRequest,
  UnifiedAIResponse,
  WorkspacePermissionSet,
} from "./types";

const MAX_FALLBACKS = 2;
const HUMAN_ACTOR = /^(operator|dashboard|user|human|owner)/i;

export class UnifiedRuntimeService {
  private store = new UnifiedRuntimeStore();
  private runtimes = new Map<string, ProviderAdapterRuntime>();
  private circuits = new Map<string, ProviderCircuitBreaker>();
  private recentFailures = new Map<string, number>();

  /** Seeds the registry (idempotent). Deterministic fakes register only under
   *  the test flag — they must never exist in production routing (§68). */
  ensureRegistry(): void {
    for (const runtime of builtinProviders()) {
      this.runtimes.set(runtime.manifest().id, runtime);
      this.store.upsertProvider(runtime.manifest());
    }
    if (process.env.FEATURE_UNIFIED_FAKE_PROVIDERS === "true") {
      for (const kind of ["always-success", "always-fail", "slow", "rate-limited", "vision-provider", "text-only", "high-cost", "local-provider"] as const) {
        const fake = new FakeProvider(kind);
        this.runtimes.set(fake.manifest().id, fake);
        this.store.upsertProvider(fake.manifest());
      }
    }
  }

  registerTestProvider(runtime: ProviderAdapterRuntime): void {
    this.runtimes.set(runtime.manifest().id, runtime);
    this.store.upsertProvider(runtime.manifest());
  }

  private manifests(): ProviderManifest[] {
    this.ensureRegistry();
    return this.store.listProviders();
  }

  providers(): Array<ProviderManifest & { health: { state: string; latencyMs: number; circuitState: string; checkedAt: string | null; message: string | null } }> {
    this.ensureRegistry();
    return this.store.listProviders().map((manifest) => {
      const recorded = this.store.latestProviderHealth(manifest.id);
      const circuit = this.circuits.get(manifest.id);
      return {
        ...manifest,
        health: {
          state: recorded?.state ?? (manifest.enabled ? "healthy" : "disabled"),
          latencyMs: recorded?.latencyMs ?? 0,
          circuitState: circuit?.currentState() ?? "CLOSED",
          checkedAt: recorded?.checkedAt ?? null,
          message: recorded?.message ?? null,
        },
      };
    });
  }

  setProviderEnabled(id: string, enabled: boolean, actor: string): void {
    this.ensureRegistry();
    if (!this.store.getProvider(id)) throw new LeadError("NOT_FOUND", `Provider not found: ${id}`);
    this.store.setProviderEnabled(id, enabled);
    this.store.appendAudit({ actor, event: enabled ? "provider.enabled" : "provider.disabled", risk: "medium", decision: "allowed", metadata: { providerId: id } });
  }

  async testProvider(id: string, actor: string): Promise<Record<string, unknown>> {
    this.ensureRegistry();
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new LeadError("NOT_FOUND", `Provider not found: ${id}`);
    const health = await runtime.healthCheck();
    const circuit = this.circuit(id);
    circuit.recordSuccess();
    this.store.saveProviderHealth(id, health.state, health.latencyMs, circuit.currentState(), health.message);
    this.store.appendAudit({ actor, event: "provider.health_checked", risk: "low", decision: "allowed", metadata: { providerId: id, state: health.state } });
    return { id, health };
  }

  private circuit(providerId: string): ProviderCircuitBreaker {
    let breaker = this.circuits.get(providerId);
    if (!breaker) {
      breaker = new ProviderCircuitBreaker({
        failureThreshold: Number(process.env.UNIFIED_CIRCUIT_FAILURES || 5),
        windowMs: Number(process.env.UNIFIED_CIRCUIT_WINDOW_MS || 60_000),
        openMs: Number(process.env.UNIFIED_CIRCUIT_OPEN_MS || 120_000),
      });
      this.circuits.set(providerId, breaker);
    }
    return breaker;
  }

  private healthOf(providerId: string): { state: string; healthScore: number; latencyMs: number; recentFailures: number; cooldown: boolean } {
    const recorded = this.store.latestProviderHealth(providerId);
    const circuit = this.circuits.get(providerId);
    const state: string = circuit?.currentState() === "OPEN" ? "cooldown" : recorded?.state ?? "healthy";
    const healthScore = state === "healthy" ? 0.95 : state === "degraded" ? 0.5 : 0.1;
    return {
      state,
      healthScore,
      latencyMs: recorded?.latencyMs ?? 0,
      recentFailures: this.recentFailures.get(providerId) ?? 0,
      cooldown: circuit?.currentState() === "OPEN",
    };
  }

  /** Pure routing decision with full reasoning (§11, §48 playground). */
  preview(request: UnifiedAIRequest): RoutePreviewResult & { contextPreview: ReturnType<typeof filterContextForProvider> | null } {
    this.ensureRegistry();
    const preview = previewRoute({
      request,
      providers: this.manifests(),
      healthOf: (providerId) => this.healthOf(providerId),
    });
    const selected = preview.selected ? this.runtimes.get(preview.selected) : undefined;
    const contextEnvelope = this.buildEnvelope(request, preview.mode);
    const contextPreview = selected ? filterContextForProvider(contextEnvelope, selected.manifest().isLocal) : null;
    return { ...preview, contextPreview };
  }

  /** Builds the context envelope from the request (§17). */
  buildEnvelope(request: UnifiedAIRequest, mode: AIMode): ContextEnvelope {
    const items: ContextItem[] = [];
    const text = request.prompt ?? (request.messages ?? []).map((message) => message.content).join("\n");
    items.push({ namespace: "request", key: "prompt", value: text.slice(0, 4000), sensitivity: "PUBLIC" });
    if (request.messages?.length) items.push({ namespace: "conversation", key: "messages", value: `${request.messages.length} message(s)`, sensitivity: "INTERNAL" });
    if (request.execution?.workspaceId) items.push({ namespace: "workspace", key: "workspace", value: request.execution.workspaceId, sensitivity: "PRIVATE" });
    items.push({ namespace: "preferences", key: "mode", value: mode, sensitivity: "INTERNAL" });
    if (mode === "private_local") items.push({ namespace: "workspace", key: "privacy", value: "LOCAL_ONLY content present", sensitivity: "LOCAL_ONLY" });
    return { requestId: request.id ?? "req_" + crypto.randomUUID().slice(0, 12), workspaceId: request.execution?.workspaceId, items };
  }

  /** Executes a request: sanitize → persist → reload in executor → run the
   *  routing order with fallback + circuit breaking (§G, §12). */
  async routeRequest(request: UnifiedAIRequest): Promise<UnifiedAIResponse | { preview: RoutePreviewResult; blocked: true; reason: string }> {
    this.ensureRegistry();
    const startedAt = Date.now();
    const executionClass = executionClassFor(request);

    // Agent mode requires workspace grants (§20, §H, AT-05).
    const grants = request.execution?.workspaceId ? this.store.getGrants(request.execution.workspaceId) : null;
    const agentCheck = checkAgentExecution(request, grants);
    if (!agentCheck.allowed) {
      this.store.appendAudit({ actor: "unified-runtime", event: "policy.denied", risk: "high", decision: "denied", workspaceId: request.execution?.workspaceId ?? null, metadata: { missing: agentCheck.missing } });
      return { preview: this.preview(request), blocked: true, reason: `agent mode denied: missing workspace grants ${agentCheck.missing.join(", ")}` };
    }

    const preview = this.preview(request);
    if (!preview.selected) {
      return { preview, blocked: true, reason: "no eligible provider (capability/policy/health filters exhausted)" };
    }

    // Persist the sanitized request; executor.ts reloads it as the only
    // source of adapter inputs (fail-safe boundary; spec §58, §62).
    const executionId = "rex_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    this.store.insertRouteExecution({
      id: executionId,
      virtualModel: request.model.slice(0, 120),
      mode: preview.mode,
      selectedProvider: preview.selected,
      fallbacksTried: [],
      status: "running",
      executionClass,
      workspaceId: request.execution?.workspaceId ?? null,
      totalMs: 0,
      estimatedCostUsd: 0,
      errorCode: null,
      requestJson: JSON.stringify({
        model: request.model.slice(0, 120),
        prompt: (request.prompt ?? "").slice(0, 8000),
        messages: (request.messages ?? []).slice(0, 64).map((message) => ({ role: String(message.role).slice(0, 20), content: String(message.content).slice(0, 8000) })),
        responseFormat: request.responseFormat,
      }),
    });

    const order = [preview.selected, ...preview.fallbacks].slice(0, 1 + MAX_FALLBACKS);
    const fallbacksTried: string[] = [];
    let lastError: unknown = null;

    for (const providerId of order) {
      const circuit = this.circuit(providerId);
      if (!circuit.canAttempt()) {
        this.store.appendAudit({ actor: "unified-runtime", event: "circuit.open", risk: "medium", decision: "skipped", metadata: { providerId } });
        continue;
      }
      const manifest = this.store.getProvider(providerId);
      const envelope = this.buildEnvelope(request, preview.mode);
      const firewall = filterContextForProvider(envelope, manifest?.isLocal ?? false);
      try {
        const outcome = await attemptProvider(this.store, this.runtimes, executionId, providerId);
        circuit.recordSuccess();
        this.recentFailures.set(providerId, 0);
        const totalMs = Date.now() - startedAt;
        this.store.saveProviderHealth(providerId, "healthy", totalMs, circuit.currentState());
        this.store.updateRouteExecution(executionId, {
          status: "completed", selectedProvider: providerId, fallbacksTried,
          totalMs, estimatedCostUsd: outcome.usage?.estimatedCostUsd ?? 0, errorCode: null,
        });
        const response: UnifiedAIResponse = {
          id: executionId,
          providerId,
          modelId: outcome.modelId,
          output: typeof outcome.output === "string" ? redactSecrets(outcome.output) : outcome.output,
          usage: outcome.usage,
          timing: { totalMs },
          routing: { selectedProvider: providerId, fallbacksTried, mode: preview.mode },
        };
        this.store.appendAudit({ actor: "unified-runtime", event: "route.executed", risk: "low", decision: "allowed", workspaceId: request.execution?.workspaceId ?? null, executionId, metadata: { providerId, mode: preview.mode, droppedContext: firewall.dropped.length } });
        recordAgentEvent({ kind: "unified.route.executed", payload: { providerId, mode: preview.mode, totalMs } });
        return response;
      } catch (err) {
        const classification = classifyRetry(err);
        circuit.recordFailure(err instanceof Error ? err.message : String(err));
        this.recentFailures.set(providerId, (this.recentFailures.get(providerId) ?? 0) + 1);
        fallbacksTried.push(providerId);
        this.store.saveProviderHealth(providerId, "degraded", 0, circuit.currentState(), classification.reason);
        this.store.appendAudit({ actor: "unified-runtime", event: classification.retryable ? "route.fallback" : "route.failed", risk: "medium", decision: classification.retryable ? "fallback" : "denied", metadata: { providerId, reason: classification.reason } });
        lastError = err;
        if (!classification.retryable) break;
      }
    }
    this.store.updateRouteExecution(executionId, {
      status: "failed", selectedProvider: fallbacksTried[0] ?? null, fallbacksTried,
      totalMs: Date.now() - startedAt, estimatedCostUsd: 0,
      errorCode: "ROUTE_FAILED",
    });
    return {
      preview,
      blocked: true,
      reason: `route failed after ${fallbacksTried.length} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    };
  }

  /** Attachment pipeline entry (§27). */
  async validateAttachments(input: Array<{ name: string; source: string; mimeHint?: string; bytes?: Uint8Array }>): Promise<AttachmentValidation[]> {
    return validateAttachments(input);
  }

  // --- workspace grants / usage / audit --------------------------------------------

  getGrants(workspaceId: string): WorkspacePermissionSet | null {
    return this.store.getGrants(workspaceId);
  }

  setGrants(workspaceId: string, grants: WorkspacePermissionSet["grants"], actor: string): WorkspacePermissionSet {
    if (!HUMAN_ACTOR.test(actor.trim())) {
      throw new LeadError("POLICY_BLOCKED", "invariant violation: only human actors may change workspace permissions");
    }
    const set: WorkspacePermissionSet = { workspaceId, grants, updatedAt: new Date().toISOString() };
    this.store.saveGrants(set);
    this.store.appendAudit({ actor, event: "workspace.permission.changed", risk: "high", decision: "allowed", workspaceId, metadata: { grants } });
    return set;
  }

  usageSummary() {
    return this.store.usageSummary();
  }

  listAudit(limit = 50) {
    return this.store.listAudit(limit);
  }
}

let singleton: UnifiedRuntimeService | null = null;

export function getUnifiedRuntimeService(): UnifiedRuntimeService {
  if (!singleton) singleton = new UnifiedRuntimeService();
  return singleton;
}

export function resetUnifiedRuntimeForTests(): void {
  singleton = null;
}

export { detectMode };
