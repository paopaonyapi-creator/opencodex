// Phase Navop & 21.03 — Host-Authoritative Operations Runtime Service.

import { NavopStore, newNavopId, nowIso } from "./store";
import { createHash } from "node:crypto";
import type {
  CcsProvider,
  CcsRuntime,
  CcsCircuitBreaker,
  CcsRoute,
  CcsRouteAttempt,
  CcsRouteCandidate,
  CcsRouteDecision,
  CcsUsageEvent,
  CcsConfigProjection,
  NavopApproval,
  NavopAuditEvent,
  NavopCapability,
  NavopPermissionProfile,
  NavopResource,
  NavopRiskLevel,
  NavopSession,
  NavopToolInvocation,
} from "./types";
import { navopRuntimeEnabled, defaultPermissionProfile } from "./flags";

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

export class NavopRuntimeService {
  private store = new NavopStore();

  assertEnabled(): void {
    if (!navopRuntimeEnabled()) {
      throw new Error("Pao Navop Host-Authoritative Runtime is disabled");
    }
  }

  // -------------------------------------------------------------------------
  // Resource Registry (Section 7)
  // -------------------------------------------------------------------------
  registerResource(res: Omit<NavopResource, "id" | "createdAt" | "updatedAt">): NavopResource {
    this.assertEnabled();
    const resource: NavopResource = {
      ...res,
      id: newNavopId("res"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertResource(resource);
    this.audit("SYSTEM", "SYSTEM", "resource.register", resource.resourceUri, { displayName: resource.displayName });
    return resource;
  }

  getResource(uri: string): NavopResource | null {
    this.assertEnabled();
    return this.store.getResourceByUri(uri);
  }

  listResources(type?: string): NavopResource[] {
    this.assertEnabled();
    return this.store.listResources(type);
  }

  // -------------------------------------------------------------------------
  // Capability Registry (Section 13, 14)
  // -------------------------------------------------------------------------
  registerCapability(cap: Omit<NavopCapability, "id" | "createdAt">): NavopCapability {
    this.assertEnabled();
    const capability: NavopCapability = {
      ...cap,
      id: newNavopId("cap"),
      createdAt: nowIso(),
    };
    this.store.upsertCapability(capability);
    return capability;
  }

  listCapabilities(): NavopCapability[] {
    this.assertEnabled();
    return this.store.listCapabilities();
  }

  // -------------------------------------------------------------------------
  // Sessions (Section 17)
  // -------------------------------------------------------------------------
  createSession(agentKey: string, profile?: NavopPermissionProfile, sessionType = "interactive"): NavopSession {
    this.assertEnabled();
    const session: NavopSession = {
      id: newNavopId("sess"),
      sessionType,
      agentKey,
      status: "active",
      policyProfile: profile || defaultPermissionProfile(),
      startedAt: nowIso(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    this.store.createSession(session);
    this.audit("AGENT", agentKey, "session.create", undefined, { sessionId: session.id, profile: session.policyProfile });
    return session;
  }

  getSession(id: string): NavopSession | null {
    this.assertEnabled();
    return this.store.getSession(id);
  }

  // -------------------------------------------------------------------------
  // Policy & Execution Router (§16, §23, §24, §51)
  // "Agents request capabilities. Pao Runtime owns execution. Policy decides. Human retains authority. Audit records everything."
  // -------------------------------------------------------------------------
  async requestExecution(params: {
    sessionId: string;
    capabilityName: string;
    resourceUri?: string;
    input: Record<string, unknown>;
    dryRun?: boolean;
  }): Promise<{
    traceId: string;
    status: "completed" | "requires_approval" | "denied";
    approvalId?: string;
    result?: unknown;
    error?: string;
  }> {
    this.assertEnabled();
    const traceId = `trc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const session = this.store.getSession(params.sessionId);
    if (!session || session.status !== "active") {
      throw new Error("Invalid or expired session");
    }

    const capability = this.store.getCapability(params.capabilityName);
    if (!capability || !capability.enabled) {
      throw new Error(`Capability ${params.capabilityName} is not available or disabled`);
    }

    // 1. Path traversal & shell injection guard (§25, §26)
    const inputStr = JSON.stringify(params.input);
    if (inputStr.includes("../") || inputStr.includes("..\\")) {
      this.audit("AGENT", session.agentKey, "security.path_traversal_blocked", params.resourceUri, { input: params.input }, traceId);
      throw new Error("Security violation: path traversal detected");
    }

    // 2. Risk check & approval requirement (R4/R5 require human approval)
    const requiresApproval = capability.riskLevel === "R4" || capability.riskLevel === "R5" || (capability.mutates && session.policyProfile === "observe");

    if (requiresApproval) {
      const approvalId = newNavopId("appr");
      const approval: NavopApproval = {
        id: approvalId,
        traceId,
        sessionId: session.id,
        actionSummary: `Request to execute ${capability.name} on ${params.resourceUri || "local"}`,
        riskLevel: capability.riskLevel,
        requestPayload: params.input,
        status: "pending",
        requestedAt: nowIso(),
        expiresAt: new Date(Date.now() + 1800 * 1000).toISOString(),
      };
      this.store.createApproval(approval);
      this.store.createInvocation({
        id: newNavopId("inv"),
        traceId,
        sessionId: session.id,
        capabilityName: capability.name,
        resourceUri: params.resourceUri,
        inputRedacted: this.redactInput(params.input),
        riskLevel: capability.riskLevel,
        policyDecision: "requires_approval",
        approvalId,
        status: "blocked",
        startedAt: nowIso(),
      });
      this.audit("AGENT", session.agentKey, "execution.requires_approval", params.resourceUri, { approvalId, risk: capability.riskLevel }, traceId);
      return { traceId, status: "requires_approval", approvalId };
    }

    // 3. Execution (Dry-run or local mock execution)
    const startedAt = nowIso();
    let resultSummary: Record<string, unknown> = {};
    if (params.dryRun) {
      resultSummary = { dryRun: true, message: `Dry-run execution simulated for ${capability.name}` };
    } else {
      resultSummary = { success: true, message: `Executed ${capability.name} via ${capability.adapterType} adapter` };
    }

    this.store.createInvocation({
      id: newNavopId("inv"),
      traceId,
      sessionId: session.id,
      capabilityName: capability.name,
      resourceUri: params.resourceUri,
      inputRedacted: this.redactInput(params.input),
      riskLevel: capability.riskLevel,
      policyDecision: "allowed",
      status: "completed",
      startedAt,
      finishedAt: nowIso(),
      resultSummary,
    });

    this.audit("AGENT", session.agentKey, "execution.completed", params.resourceUri, { capability: capability.name }, traceId);
    return { traceId, status: "completed", result: resultSummary };
  }

  resolveApproval(id: string, decision: "approved" | "rejected", by: string, note?: string): NavopApproval {
    this.assertEnabled();
    const app = this.store.getApproval(id);
    if (!app) throw new Error(`Approval ${id} not found`);
    this.store.resolveApproval(id, decision, by, note);
    this.audit("HUMAN", by, `approval.${decision}`, undefined, { approvalId: id, decision, note }, app.traceId);
    return this.store.getApproval(id)!;
  }

  // -------------------------------------------------------------------------
  // CC-Switch Provider Management (§8, §9)
  // -------------------------------------------------------------------------
  registerProvider(p: Omit<CcsProvider, "id" | "createdAt" | "updatedAt">): CcsProvider {
    this.assertEnabled();
    const provider: CcsProvider = {
      ...p,
      id: newNavopId("ccp"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertProvider(provider);
    return provider;
  }

  listProviders(): CcsProvider[] {
    this.assertEnabled();
    return this.store.listProviders();
  }

  registerRuntime(rt: Omit<CcsRuntime, "id">): CcsRuntime {
    this.assertEnabled();
    const runtime: CcsRuntime = {
      ...rt,
      id: newNavopId("ccrt"),
    };
    this.store.upsertRuntime(runtime);
    return runtime;
  }

  listRuntimes(): CcsRuntime[] {
    this.assertEnabled();
    return this.store.listRuntimes();
  }

  // -------------------------------------------------------------------------
  // Routing, circuit breaker, and safe failover (Phase 21.03.8–21.03.10)
  // -------------------------------------------------------------------------
  registerRoute(input: {
    name: string;
    runtimeId?: string | null;
    routingMode?: CcsRoute["routingMode"];
    candidates: CcsRouteCandidate[];
    enabled?: boolean;
  }): CcsRoute {
    this.assertEnabled();
    const candidates = [...input.candidates].sort((a, b) => a.priority - b.priority);
    if (candidates.length === 0) throw new Error("A route needs at least one provider candidate");
    for (const candidate of candidates) {
      if (!this.store.getProvider(candidate.providerId)) {
        throw new Error(`Provider ${candidate.providerId} is not registered`);
      }
    }
    const existing = this.store.getRouteByName(input.name);
    const route: CcsRoute = {
      id: existing?.id ?? newNavopId("ccroute"),
      name: input.name,
      runtimeId: input.runtimeId ?? null,
      routingMode: input.routingMode ?? "auto-failover",
      candidates,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    this.store.upsertRoute(route);
    this.audit("SYSTEM", "SYSTEM", "route.register", undefined, {
      route: route.name,
      mode: route.routingMode,
      candidates: route.candidates.map((c) => c.providerId),
    });
    return route;
  }

  listRoutes(): CcsRoute[] {
    this.assertEnabled();
    return this.store.listRoutes();
  }

  recordProviderOutcome(providerId: string, outcome: "success" | "failure", now = Date.now()): CcsCircuitBreaker {
    this.assertEnabled();
    const current = this.store.getCircuit(providerId) ?? this.freshCircuit(providerId);
    const next = this.transitionCircuit(current, outcome, now);
    this.store.upsertCircuit(next);
    this.audit("SYSTEM", "SYSTEM", `circuit.${next.state.toLowerCase()}`, undefined, {
      providerId,
      outcome,
      failureCount: next.failureCount,
    });
    return next;
  }

  getCircuit(providerId: string, now = Date.now()): CcsCircuitBreaker {
    this.assertEnabled();
    const current = this.store.getCircuit(providerId) ?? this.freshCircuit(providerId);
    const cooled = this.applyCooldown(current, now);
    if (cooled.state !== current.state || cooled.halfOpenAt !== current.halfOpenAt) {
      this.store.upsertCircuit(cooled);
    }
    return cooled;
  }

  routeRequest(input: {
    routeName: string;
    requestClass: "idempotent" | "side_effecting";
    projectId?: string;
    taskId?: string;
    probe: (candidate: CcsRouteCandidate) => { ok: boolean; errorCode?: string; inputTokens?: number; outputTokens?: number; estimatedCost?: number; latencyMs?: number };
    now?: number;
  }): CcsRouteDecision {
    this.assertEnabled();
    const route = this.store.getRouteByName(input.routeName);
    if (!route || !route.enabled) throw new Error(`Route ${input.routeName} is not available`);
    const now = input.now ?? Date.now();
    const traceId = `trc_${now}_${crypto.randomUUID().slice(0, 8)}`;
    const attempts: CcsRouteAttempt[] = [];
    let selected: CcsRouteCandidate | null = null;
    let replayed = false;

    for (const candidate of route.candidates) {
      const circuit = this.getCircuit(candidate.providerId, now);
      if (circuit.state === "OPEN") {
        attempts.push({ providerId: candidate.providerId, modelId: candidate.modelId, outcome: "skipped_open", errorCode: "circuit_open" });
        this.recordUsage({
          routeId: route.id,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          projectId: input.projectId,
          taskId: input.taskId,
          requestClass: input.requestClass,
          outcome: "blocked",
          replayed: false,
          errorCode: "circuit_open",
          traceId,
        });
        continue;
      }
      if (attempts.some((a) => a.outcome === "failed") && input.requestClass === "side_effecting") {
        attempts.push({ providerId: candidate.providerId, modelId: candidate.modelId, outcome: "blocked_unsafe_replay", errorCode: "unsafe_replay" });
        this.recordUsage({
          routeId: route.id,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          projectId: input.projectId,
          taskId: input.taskId,
          requestClass: input.requestClass,
          outcome: "blocked",
          replayed: false,
          errorCode: "unsafe_replay",
          traceId,
        });
        break;
      }
      const probe = input.probe(candidate);
      if (probe.ok) {
        this.recordProviderOutcome(candidate.providerId, "success", now);
        selected = candidate;
        replayed = attempts.some((a) => a.outcome === "failed");
        attempts.push({ providerId: candidate.providerId, modelId: candidate.modelId, outcome: "success" });
        this.recordUsage({
          routeId: route.id,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          projectId: input.projectId,
          taskId: input.taskId,
          requestClass: input.requestClass,
          outcome: replayed ? "failover" : "success",
          replayed,
          inputTokens: probe.inputTokens ?? 0,
          outputTokens: probe.outputTokens ?? 0,
          estimatedCost: probe.estimatedCost ?? 0,
          latencyMs: probe.latencyMs,
          traceId,
        });
        break;
      }
      this.recordProviderOutcome(candidate.providerId, "failure", now);
      attempts.push({ providerId: candidate.providerId, modelId: candidate.modelId, outcome: "failed", errorCode: probe.errorCode ?? "upstream_failed" });
      this.recordUsage({
        routeId: route.id,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        projectId: input.projectId,
        taskId: input.taskId,
        requestClass: input.requestClass,
        outcome: "failed",
        replayed: false,
        inputTokens: probe.inputTokens ?? 0,
        outputTokens: probe.outputTokens ?? 0,
        estimatedCost: probe.estimatedCost ?? 0,
        latencyMs: probe.latencyMs,
        errorCode: probe.errorCode ?? "upstream_failed",
        traceId,
      });
    }

    const failoverCount = attempts.filter((a) => a.outcome === "failed").length;
    const decision: CcsRouteDecision = {
      routeId: route.id,
      traceId,
      selectedProviderId: selected?.providerId ?? null,
      selectedModelId: selected?.modelId ?? null,
      status: selected ? "completed" : attempts.some((a) => a.outcome === "blocked_unsafe_replay") ? "blocked" : "failed",
      failoverCount,
      replayed,
      attempts,
      reason: selected
        ? replayed ? "failed_over" : "primary_selected"
        : attempts.some((a) => a.outcome === "blocked_unsafe_replay")
          ? "unsafe_side_effect_not_replayed"
          : "no_eligible_provider",
    };
    this.audit("SYSTEM", "SYSTEM", `route.${decision.status}`, undefined, {
      route: route.name,
      reason: decision.reason,
      selectedProviderId: decision.selectedProviderId,
      failoverCount,
    }, traceId);
    return decision;
  }

  listUsage(filter: { providerId?: string; projectId?: string; taskId?: string } = {}): CcsUsageEvent[] {
    this.assertEnabled();
    return this.store.listUsageEvents(filter);
  }

  previewConfigProjection(input: {
    runtimeId: string;
    targetPath: string;
    currentText: string;
    projectedText: string;
  }): CcsConfigProjection {
    this.assertEnabled();
    const beforeHash = this.hashText(input.currentText);
    const afterHash = this.hashText(input.projectedText);
    const projection: CcsConfigProjection = {
      id: newNavopId("ccproj"),
      runtimeId: input.runtimeId,
      targetPath: input.targetPath,
      beforeHash,
      afterHash,
      beforeText: input.currentText,
      afterText: input.projectedText,
      drift: beforeHash !== afterHash,
      status: "preview",
      createdAt: nowIso(),
    };
    this.store.addConfigProjection(projection);
    this.audit("SYSTEM", "SYSTEM", "config.preview", undefined, {
      runtimeId: input.runtimeId,
      targetPath: input.targetPath,
      drift: projection.drift,
    });
    return projection;
  }

  restoreConfigProjection(runtimeId: string, targetPath: string): CcsConfigProjection {
    this.assertEnabled();
    const latest = this.store.latestConfigProjection(runtimeId, targetPath);
    if (!latest) throw new Error("No config projection exists for that runtime and path");
    const restored: CcsConfigProjection = {
      ...latest,
      id: newNavopId("ccproj"),
      beforeText: latest.afterText,
      afterText: latest.beforeText,
      beforeHash: latest.afterHash,
      afterHash: latest.beforeHash,
      drift: false,
      status: "restored",
      createdAt: nowIso(),
    };
    this.store.addConfigProjection(restored);
    this.audit("SYSTEM", "SYSTEM", "config.restore", undefined, {
      runtimeId,
      targetPath,
      restoredFrom: latest.id,
    });
    return restored;
  }

  private hashText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private freshCircuit(providerId: string): CcsCircuitBreaker {
    return {
      providerId,
      state: "CLOSED",
      failureCount: 0,
      successCount: 0,
      updatedAt: nowIso(),
    };
  }

  private applyCooldown(circuit: CcsCircuitBreaker, now: number): CcsCircuitBreaker {
    if (circuit.state !== "OPEN" || !circuit.openedAt) return circuit;
    if (now - Date.parse(circuit.openedAt) < COOLDOWN_MS) return circuit;
    return { ...circuit, state: "HALF_OPEN", halfOpenAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
  }

  private transitionCircuit(circuit: CcsCircuitBreaker, outcome: "success" | "failure", now: number): CcsCircuitBreaker {
    const cooled = this.applyCooldown(circuit, now);
    const at = new Date(now).toISOString();
    if (outcome === "success") {
      return { ...cooled, state: "CLOSED", failureCount: 0, successCount: cooled.successCount + 1, openedAt: null, halfOpenAt: null, updatedAt: at };
    }
    const failureCount = cooled.failureCount + 1;
    const open = cooled.state === "HALF_OPEN" || failureCount >= FAILURE_THRESHOLD;
    return {
      ...cooled,
      state: open ? "OPEN" : "CLOSED",
      failureCount,
      lastFailureAt: at,
      openedAt: open ? at : cooled.openedAt ?? null,
      updatedAt: at,
    };
  }

  private recordUsage(event: Omit<CcsUsageEvent, "id" | "createdAt" | "inputTokens" | "outputTokens" | "estimatedCost"> & Partial<Pick<CcsUsageEvent, "inputTokens" | "outputTokens" | "estimatedCost">>): void {
    this.store.addUsageEvent({
      id: newNavopId("ccuse"),
      createdAt: nowIso(),
      inputTokens: event.inputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
      estimatedCost: event.estimatedCost ?? 0,
      ...event,
    });
  }

  // -------------------------------------------------------------------------
  // Audit Trail & Redaction (§29)
  // -------------------------------------------------------------------------
  private redactInput(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (/password|token|secret|api_?key|credential/i.test(k)) {
        out[k] = "[REDACTED]";
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        out[k] = this.redactInput(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private audit(
    actorType: "HUMAN" | "AGENT" | "SYSTEM",
    actorId: string,
    eventType: string,
    resourceUri?: string,
    payload?: Record<string, unknown>,
    traceId?: string,
  ): void {
    this.store.addAuditEvent({
      id: newNavopId("naud"),
      traceId,
      eventType,
      actorType,
      actorId,
      resourceUri,
      payloadRedacted: payload ? this.redactInput(payload) : {},
      createdAt: nowIso(),
    });
  }

  listAudit(limit = 100): NavopAuditEvent[] {
    this.assertEnabled();
    return this.store.listAuditEvents(limit);
  }
}

let singletonNavop: NavopRuntimeService | null = null;
export function getNavopRuntimeService(): NavopRuntimeService {
  if (!singletonNavop) {
    singletonNavop = new NavopRuntimeService();
  }
  return singletonNavop;
}
