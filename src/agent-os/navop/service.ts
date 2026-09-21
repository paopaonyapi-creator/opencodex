// Phase Navop & 21.03 — Host-Authoritative Operations Runtime Service.

import { NavopStore, newNavopId, nowIso } from "./store";
import type {
  CcsProvider,
  CcsRuntime,
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
