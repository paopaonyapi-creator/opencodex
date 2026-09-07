// Phase 20.9 — Pao-hubPro × Chatbox Agent Desktop Runtime
// REST Management API Endpoints for Desktop Agent Operating Layer
// Accessible via /api/desktop-agent/* and /api/agent-os/desktop-agent/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getAgentModeManager,
  getProviderRegistry,
  getModelCapabilityRegistry,
  getToolRegistry,
  getMCPManager,
  getSkillsRuntime,
  getPolicyEngine,
  getApprovalGateway,
  getAgentRuntime,
  AuditLogger,
  type AgentMode,
  type MCPServerConfig,
  type SkillMetadata,
  type WorkspacePolicy,
  type ApprovalDecision,
} from "../../agent-os/desktop-runtime";
import {
  getPonytailGovernanceGate,
  getDebtLedger,
  getDependencyGuard,
} from "../../agent-os/governance";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleDesktopAgentRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/desktop-agent/")) {
    path = url.pathname.slice("/api/desktop-agent/".length);
  } else if (url.pathname === "/api/desktop-agent") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/desktop-agent/")) {
    path = url.pathname.slice("/api/agent-os/desktop-agent/".length);
  } else if (url.pathname === "/api/agent-os/desktop-agent") {
    path = "";
  } else {
    return null;
  }

  const modeManager = getAgentModeManager();
  const providerRegistry = getProviderRegistry();
  const capabilityRegistry = getModelCapabilityRegistry();
  const toolRegistry = getToolRegistry();
  const mcpManager = getMCPManager();
  const skillsRuntime = getSkillsRuntime();
  const policyEngine = getPolicyEngine();
  const approvalGateway = getApprovalGateway();
  const agentRuntime = getAgentRuntime();
  const auditLogger = new AuditLogger();

  // 1. GET /api/desktop-agent/status
  if ((path === "status" || path === "") && req.method === "GET") {
    const activeMode = modeManager.getMode();
    const providers = providerRegistry.listProviders();
    const tools = toolRegistry.listTools();
    const mcpServers = mcpManager.listServers();
    const skills = skillsRuntime.listSkills();
    const pendingApprovals = approvalGateway.listPendingApprovals();
    const recentRuns = agentRuntime.listRuns(5);

    return jsonResponse(
      {
        success: true,
        runtime: "Pao-hubPro × Chatbox Agent Desktop Runtime",
        version: "20.9.0",
        activeMode,
        counts: {
          providers: providers.length,
          tools: tools.length,
          mcpServers: mcpServers.length,
          skills: skills.length,
          pendingApprovals: pendingApprovals.length,
          recentRuns: recentRuns.length,
        },
      },
      200,
      req,
      {},
    );
  }

  // 2. GET & POST /api/desktop-agent/modes
  if (path === "modes") {
    if (req.method === "GET") {
      return jsonResponse(
        {
          success: true,
          activeMode: modeManager.getMode(),
          availableModes: ["off", "ask", "safe_auto", "full_auto"],
        },
        200,
        req,
        {},
      );
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { mode?: AgentMode } | null;
      if (!body?.mode || !["off", "ask", "safe_auto", "full_auto"].includes(body.mode)) {
        return badRequest(req, "Invalid mode. Must be one of: 'off', 'ask', 'safe_auto', 'full_auto'");
      }
      modeManager.setMode(body.mode);
      return jsonResponse({ success: true, activeMode: body.mode, mode: body.mode }, 200, req, {});
    }
  }

  // 3. GET /api/desktop-agent/providers
  if (path === "providers" && req.method === "GET") {
    const providers = providerRegistry.listProviders();
    const models = await providerRegistry.listAllModels();
    return jsonResponse(
      {
        success: true,
        providers: providers.map((p) => ({ id: p.id, name: p.name })),
        models,
      },
      200,
      req,
      {},
    );
  }

  // 4. GET /api/desktop-agent/tools
  if (path === "tools" && req.method === "GET") {
    const namespace = url.searchParams.get("namespace") ?? undefined;
    const mode = url.searchParams.get("mode") as AgentMode | null;
    let tools = toolRegistry.listTools(namespace);

    if (mode) {
      tools = toolRegistry.getVisibleTools({ mode });
    }

    return jsonResponse({ success: true, count: tools.length, tools }, 200, req, {});
  }

  // 5. GET & POST /api/desktop-agent/mcp/servers
  if (path === "mcp/servers") {
    if (req.method === "GET") {
      const servers = mcpManager.listServers();
      return jsonResponse({ success: true, servers }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as MCPServerConfig | null;
      if (!body?.name || !body?.transport) {
        return badRequest(req, "name and transport are required for MCP server registration");
      }
      const serverConfig: MCPServerConfig = {
        ...body,
        id: body.id || `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      };
      try {
        const registered = await mcpManager.registerServer(serverConfig);
        if (!registered.success) {
          return badRequest(req, registered.error ?? "Failed to register MCP server");
        }
        return jsonResponse({ success: true, server: serverConfig }, 201, req, {});
      } catch (err) {
        return badRequest(req, err instanceof Error ? err.message : String(err));
      }
    }
  }

  // 6. DELETE /api/desktop-agent/mcp/servers/:id and POST /health
  if (path.startsWith("mcp/servers/")) {
    const sub = path.slice("mcp/servers/".length);
    const parts = sub.split("/");
    const serverId = parts[0];

    if (parts.length === 2 && parts[1] === "health" && req.method === "POST") {
      const health = await mcpManager.checkHealth(serverId);
      return jsonResponse({ success: true, health }, 200, req, {});
    }

    if (parts.length === 1 && req.method === "DELETE") {
      const deleted = mcpManager.unregisterServer(serverId);
      if (!deleted) return notFound(req, `MCP Server '${serverId}' not found`);
      return jsonResponse({ success: true, deleted: serverId }, 200, req, {});
    }
  }

  // 7. GET & POST /api/desktop-agent/skills
  if (path === "skills") {
    if (req.method === "GET") {
      const skills = skillsRuntime.listSkills();
      return jsonResponse({ success: true, count: skills.length, skills }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as SkillMetadata | null;
      if (!body?.id || !body?.name || !body?.sourcePath) {
        return badRequest(req, "id, name, and sourcePath are required for skill registration");
      }
      try {
        const registered = skillsRuntime.registerSkill(body);
        return jsonResponse({ success: true, skill: registered }, 201, req, {});
      } catch (err) {
        return badRequest(req, err instanceof Error ? err.message : String(err));
      }
    }
  }

  // 8. GET & POST /api/desktop-agent/policies
  if (path === "policies") {
    if (req.method === "GET") {
      const policy = policyEngine.getPolicy();
      return jsonResponse({ success: true, policy }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as Partial<WorkspacePolicy> | null;
      if (!body) return badRequest(req, "Policy object expected");
      policyEngine.updatePolicy(body);
      return jsonResponse({ success: true, policy: policyEngine.getPolicy() }, 200, req, {});
    }
  }

  // 9. GET & POST /api/desktop-agent/approvals
  if (path === "approvals") {
    if (req.method === "GET") {
      const approvals = approvalGateway.listPendingApprovals();
      return jsonResponse({ success: true, count: approvals.length, approvals }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        runId?: string;
        toolId?: string;
        toolName?: string;
        risk?: "read_only" | "low" | "medium" | "high" | "critical";
        command?: string;
        affectedFiles?: string[];
        reason?: string;
        estimatedSideEffects?: string[];
      } | null;

      const risk = body?.risk ?? "high";
      const toolName = body?.toolName ?? "shell_exec";
      const toolId = body?.toolId ?? `builtin__${toolName}`;
      const runId = body?.runId ?? `sim_${Date.now()}`;

      const card = approvalGateway.requestApproval({
        runId,
        toolCall: {
          id: `tc_${Date.now()}`,
          runId,
          toolId,
          name: toolName,
          namespace: "builtin",
          risk,
          arguments: body?.command ? { command: body.command } : {},
        },
        model: "gpt-4o",
        command: body?.command,
        affectedFiles: body?.affectedFiles,
        reason: body?.reason ?? "Simulated human-in-the-loop authorization request",
        estimatedSideEffects: body?.estimatedSideEffects,
      });

      return jsonResponse({ success: true, card }, 201, req, {});
    }
  }

  // 10. POST /api/desktop-agent/approvals/:id/decide
  if (path.startsWith("approvals/") && path.endsWith("/decide") && req.method === "POST") {
    const id = path.slice("approvals/".length, -"/decide".length);
    const body = (await req.json().catch(() => null)) as {
      decision?: ApprovalDecision;
      operator?: string;
      reason?: string;
    } | null;

    if (!body?.decision || !["approve_once", "approve_session", "reject"].includes(body.decision)) {
      return badRequest(req, "decision must be one of: 'approve_once', 'approve_session', 'reject'");
    }

    try {
      const result = approvalGateway.decide(id, body.decision, body.operator ?? "web-operator", body.reason);
      return jsonResponse({ success: true, result }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 11. GET & POST /api/desktop-agent/runs
  if (path === "runs") {
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const runs = agentRuntime.listRuns(limit);
      return jsonResponse({ success: true, count: runs.length, runs }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        mission?: string;
        agentMode?: AgentMode;
        providerId?: string;
        modelId?: string;
        workspaceRoot?: string;
        maxSteps?: number;
      } | null;

      if (!body?.mission) {
        return badRequest(req, "mission is required to start an agent run");
      }

      // Execute mission asynchronously or synchronously based on query
      const asyncRun = url.searchParams.get("async") === "true";
      if (asyncRun) {
        // Fire and forget, client polls runs/:id
        const runPromise = agentRuntime.runMission({
          mission: body.mission,
          agentMode: body.agentMode,
          providerId: body.providerId,
          modelId: body.modelId,
          workspaceRoot: body.workspaceRoot,
          maxSteps: body.maxSteps,
        });
        // We catch unhandled rejections
        runPromise.catch((e) => console.error(`[AgentRuntime] Async run error:`, e));
        return jsonResponse(
          {
            success: true,
            status: "started",
            mission: body.mission,
            note: "Mission started in background. Poll /api/desktop-agent/runs for updates.",
          },
          202,
          req,
          {},
        );
      } else {
        const completedRun = await agentRuntime.runMission({
          mission: body.mission,
          agentMode: body.agentMode,
          providerId: body.providerId,
          modelId: body.modelId,
          workspaceRoot: body.workspaceRoot,
          maxSteps: body.maxSteps,
        });
        return jsonResponse({ success: true, run: completedRun }, 200, req, {});
      }
    }
  }

  // 12. GET /api/desktop-agent/runs/:id and POST /cancel
  if (path.startsWith("runs/")) {
    const sub = path.slice("runs/".length);
    const parts = sub.split("/");
    const runId = parts[0];

    if (parts.length === 2 && parts[1] === "cancel" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { reason?: string } | null;
      const cancelled = agentRuntime.cancelRun(runId, body?.reason);
      return jsonResponse({ success: true, cancelled }, 200, req, {});
    }

    if (parts.length === 1 && req.method === "GET") {
      const run = agentRuntime.getRun(runId);
      if (!run) return notFound(req, `Run '${runId}' not found`);
      const events = auditLogger.queryEvents(runId);
      return jsonResponse({ success: true, run, events }, 200, req, {});
    }
  }

  // 13. GET /api/desktop-agent/audit
  if (path === "audit" && req.method === "GET") {
    const runId = url.searchParams.get("runId");
    const limit = Number(url.searchParams.get("limit") ?? 100);

    const events = runId ? auditLogger.queryEvents(runId, limit) : auditLogger.getRecentEvents(limit);

    return jsonResponse({ success: true, count: events.length, events }, 200, req, {});
  }

  // 14. GET /api/desktop-agent/governance/status
  if (path === "governance/status" && req.method === "GET") {
    const gate = getPonytailGovernanceGate();
    const debts = getDebtLedger().listDebts();
    return jsonResponse(
      {
        success: true,
        governance: "Pao-hubPro × Ponytail Minimal-Code Governance",
        config: gate.getConfig(),
        openDebtsCount: debts.filter((d) => d.status === "open").length,
      },
      200,
      req,
      {},
    );
  }

  // 15. POST /api/desktop-agent/governance/evaluate
  if (path === "governance/evaluate" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      prompt?: string;
      agentType?: string;
      explicitMode?: any;
    } | null;

    const prompt = body?.prompt || (body as any)?.taskPrompt;
    if (!prompt) {
      return badRequest(req, "prompt is required for governance evaluation");
    }

    const gate = getPonytailGovernanceGate();
    const decision = gate.evaluateTask(prompt, {
      explicitMode: body?.explicitMode,
      agentType: body?.agentType || (body as any)?.subagentType,
    });
    const promptSnippet = gate.buildGovernanceSystemPrompt(decision);

    return jsonResponse({ success: true, decision, promptSnippet }, 200, req, {});
  }

  // 16. GET & POST /api/desktop-agent/governance/debt
  if (path === "governance/debt") {
    const ledger = getDebtLedger();
    if (req.method === "GET") {
      const debts = ledger.listDebts();
      return jsonResponse({ success: true, count: debts.length, debts }, 200, req, {});
    }
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        area?: string;
        shortcut?: string;
        reason?: string;
        risk?: string;
        triggerToRevisit?: string;
        relatedFiles?: string[];
        owner?: string;
      } | null;

      if (!body?.shortcut || !body?.reason) {
        return badRequest(req, "shortcut and reason are required to record technical debt");
      }

      const recorded = ledger.recordDebt({
        area: body.area ?? "general",
        shortcut: body.shortcut,
        reason: body.reason,
        risk: body.risk ?? "low",
        triggerToRevisit: body.triggerToRevisit ?? "Future review",
        relatedFiles: body.relatedFiles ?? [],
        owner: body.owner ?? "operator",
      });

      return jsonResponse({ success: true, debt: recorded }, 201, req, {});
    }
  }

  // 17. POST /api/desktop-agent/governance/dependency
  if (path === "governance/dependency" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      packageName?: string;
      reason?: string;
      isProtocolRequired?: boolean;
    } | null;

    const reason = body?.reason || (body as any)?.justification;
    if (!body?.packageName || !reason) {
      return badRequest(req, "packageName and reason are required for dependency evaluation");
    }

    const guard = getDependencyGuard();
    const decision = guard.evaluateProposal({
      packageName: body.packageName,
      reason,
      isProtocolRequired: body.isProtocolRequired,
    });

    return jsonResponse({ success: true, decision }, 200, req, {});
  }

  return notFound(req, `Desktop Agent API route '${path}' not found`);
}
