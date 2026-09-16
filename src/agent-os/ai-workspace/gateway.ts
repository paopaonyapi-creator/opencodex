// Phase 20.33 — AiWorkspaceGateway: the policy-aware bridge between Open WebUI
// (or any MCP client) and the existing Pao-hubPro execution stack (doc §6.2,
// §8, §E). Every governed call enters the Phase 20.28 governedDispatch
// pipeline — deny-first policy, capability grants, human approvals, pre/post
// audit, kill switch. This module owns NO policy of its own.

import { getOrchestrationService } from "../orchestration/service";
import { getSharedGovernanceGateway } from "../../server/management/governance-routes";
import { newGovId, type ActionRequest, type GovernanceSurface } from "../governance-gateway/types";
import { redactValue } from "../governance-gateway/gateway";
import { speechFlags } from "../speech/flags";
import { douyinFlags } from "../douyin/flags";
import { findPaoTool, PAO_TOOL_CATALOG, type PaoToolEntry } from "./catalog";
import { PaoReviewProvider, PaoShellProvider, workspaceRoots } from "./providers";
import type { GovernanceProvider } from "../governance-gateway/types";

export type ToolCallStatus =
  | "success"
  | "failed"
  | "denied"
  | "approval_required"
  | "surface"
  | "unknown_tool"
  | "approval_invalid";

export interface ToolCallOutcome {
  status: ToolCallStatus;
  tool: string;
  risk: PaoToolEntry["risk"];
  output?: unknown;
  error?: { code: string; message: string };
  approvalId?: string;
  availableVia?: string;
  decision?: unknown;
}

let providersRegistered = false;

function ensureProviders(gateway: ReturnType<typeof getSharedGovernanceGateway>): void {
  if (providersRegistered) return;
  const register = (provider: GovernanceProvider): void => gateway.registerProvider(provider);
  register(new PaoShellProvider());
  register(new PaoReviewProvider());
  register({
    id: "pao-meta",
    capabilities: ["system.health"],
    available: true,
    async perform() {
      const orchestration = getOrchestrationService();
      let runtime: string = "unknown";
      try {
        runtime = orchestration.getActiveRuntimeType();
      } catch {
        runtime = "unavailable";
      }
      return {
        output: {
          governanceMode: gateway.getMode(),
          orchestrationRuntime: runtime,
          workspaceRoots: workspaceRoots().length,
          modules: {
            speechRuntime: speechFlags().runtime,
            douyinProvider: douyinFlags().provider,
          },
        },
      };
    },
  } satisfies GovernanceProvider);
  providersRegistered = true;
}

export class AiWorkspaceGateway {
  async callTool(input: {
    name: string;
    args?: Record<string, unknown>;
    actor?: string;
    sessionId?: string;
    approvalId?: string;
  }): Promise<ToolCallOutcome> {
    const entry = findPaoTool(input.name);
    if (!entry) {
      return { status: "unknown_tool", tool: input.name, risk: "read", error: { code: "TOOL_DENIED", message: `Tool '${input.name}' is not part of the pao.* catalog` } };
    }
    if (entry.executor === "surface") {
      return { status: "surface", tool: entry.name, risk: entry.risk, availableVia: entry.availableVia };
    }

    const gateway = getSharedGovernanceGateway();
    ensureProviders(gateway);
    const args = input.args && typeof input.args === "object" ? input.args : {};
    const actorId = input.actor?.trim() || "openwebui-user";

    // Approval-gated re-dispatch: the human resolved the approval through the
    // governance surface; the re-call must present the SAME arguments and the
    // SAME approval id, and the approval must still be valid (doc §14).
    let preApproved = false;
    if (input.approvalId) {
      const approval = gateway.store.getApproval(input.approvalId);
      const argPreview = JSON.stringify(redactValue(args));
      if (
        !approval
        || approval.status !== "approved"
        || (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now())
        || JSON.stringify(approval.argumentPreview ?? {}) !== argPreview
      ) {
        return {
          status: "approval_invalid",
          tool: entry.name,
          risk: entry.risk,
          error: { code: "TOOL_APPROVAL_REQUIRED", message: "The referenced approval is missing, unresolved, expired, or does not match these arguments" },
        };
      }
      preApproved = true;
    }

    const path = typeof args.path === "string" ? args.path : undefined;
    const action: ActionRequest = {
      actionId: newGovId("act"),
      timestamp: new Date().toISOString(),
      actor: { id: actorId, type: "user" },
      agent: { id: actorId, type: "openwebui" },
      run: { runId: "mcp_" + (input.sessionId?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || newGovId("run")) },
      source: { surface: "mcp" as GovernanceSurface },
      tool: { provider: entry.provider!, name: entry.capability!, effect: entry.effect },
      // resource.kind doubles as the grant capability key (capabilityFor
      // resolves grants by kind), so it carries the full capability id.
      resource: { kind: entry.capability!, path, id: typeof args.artifact_id === "string" ? args.artifact_id : undefined },
      intent: `Open WebUI tool call ${entry.name}`,
      arguments: args,
      requestedAt: new Date().toISOString(),
    };

    const result = await gateway.governedDispatch(action, { preApproved });
    if (result.error?.code === "GOVERNANCE_APPROVAL_REQUIRED" && result.approval) {
      return {
        status: "approval_required",
        tool: entry.name,
        risk: entry.risk,
        approvalId: result.approval.id,
        error: result.error,
        decision: result.decision,
      };
    }
    return {
      status: result.status === "success" ? "success" : result.status === "failed" ? "failed" : "denied",
      tool: entry.name,
      risk: entry.risk,
      output: result.output,
      error: result.error,
      decision: result.decision,
    };
  }

  listTools(): Array<PaoToolEntry & { executable: boolean }> {
    return PAO_TOOL_CATALOG.map((entry) => ({ ...entry, executable: entry.executor === "governed" }));
  }

  status(): Record<string, unknown> {
    const gateway = getSharedGovernanceGateway();
    return {
      governance: { mode: gateway.getMode(), policyCount: gateway.getPolicySet().length },
      workspaceRoots: workspaceRoots(),
      tools: {
        governed: PAO_TOOL_CATALOG.filter((tool) => tool.executor === "governed").length,
        surface: PAO_TOOL_CATALOG.filter((tool) => tool.executor === "surface").length,
      },
    };
  }

  /** Aggregate health (doc §34): optional integrations degrade, never kill. */
  async health(): Promise<Record<string, unknown>> {
    const openWebui = await this.openWebuiStatus();
    let orchestration: Record<string, unknown> = { runtime: "unavailable" };
    try {
      const service = getOrchestrationService();
      const summary = await service.getStatus();
      orchestration = summary as unknown as Record<string, unknown>;
    } catch {
      orchestration = { runtime: "unavailable" };
    }
    const gateway = getSharedGovernanceGateway();
    return {
      overall: "healthy",
      components: {
        governance: { state: "healthy", mode: gateway.getMode() },
        orchestration: { state: "healthy", ...orchestration },
        llmRouter: { state: "healthy", note: "the proxy itself serves /v1/models and /v1/chat/completions" },
        openWebui,
        optional: {
          speechRuntime: speechFlags().runtime ? "healthy" : "degraded",
          douyinProvider: douyinFlags().provider ? "healthy" : "degraded",
        },
      },
      checkedAt: new Date().toISOString(),
    };
  }

  /** Open WebUI integration status (doc §35, §40): pin guard + reachability. */
  async openWebuiStatus(): Promise<Record<string, unknown>> {
    const image = process.env.OPEN_WEBUI_IMAGE || "ghcr.io/open-webui/open-webui:v0.11.3";
    const tag = image.slice(image.lastIndexOf(":") + 1);
    const problems: string[] = [];
    if (tag === "main" || tag === "latest") {
      problems.push("A rolling tag (:main/:latest) is configured; production must use a pinned version");
    }
    const internalUrl = (process.env.OPEN_WEBUI_INTERNAL_URL || "").replace(/\/+$/, "");
    const launchUrl = process.env.PAO_OPEN_WEBUI_URL || "";
    let reachable: boolean | null = null;
    if (internalUrl) {
      try {
        const res = await fetch(`${internalUrl}/health`, { signal: AbortSignal.timeout(1500) });
        reachable = res.ok;
      } catch {
        reachable = false;
      }
    } else {
      problems.push("OPEN_WEBUI_INTERNAL_URL is not configured; Open WebUI integration is optional and currently unmonitored");
    }
    return {
      image,
      version: tag,
      versionPinned: tag !== "main" && tag !== "latest",
      internalUrl: internalUrl || null,
      launchUrl: launchUrl || null,
      reachable,
      problems,
    };
  }
}

let workspaceSingleton: AiWorkspaceGateway | null = null;

export function getAiWorkspaceGateway(): AiWorkspaceGateway {
  if (!workspaceSingleton) workspaceSingleton = new AiWorkspaceGateway();
  return workspaceSingleton;
}

export function resetAiWorkspaceGatewayForTests(): void {
  workspaceSingleton = null;
  providersRegistered = false;
}
