/**
 * Agent OS / Brain Universe observatory routes (read-only) and Stock Factory routes.
 *
 * Phase 15 rule: the system may SEE, INDEX, SEARCH, EXPLAIN — it may not
 * silently ACT. Every handler here is a GET over the local Agent OS store.
 * Mutations happen only through internal engine calls with their own policy
 * checks (Phase 05), never through an HTTP write in this file.
 */

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  listMemories,
  readMemory,
} from "../../agent-os/memory";
import { checkSkillHealth, listSkills } from "../../agent-os/skills";
import { listAgents } from "../../agent-os/registry";
import { listTasks } from "../../agent-os/tasks";
import { listNodes } from "../../agent-os/remote";
import { askPaoBrain } from "../../agent-os/ask";
import { searchAgentOs } from "../../agent-os/search";
import { summarizeCouncil } from "../../agent-os/reviews";
import { taskTimeline } from "../../agent-os/observability";
import {
  decideApproval,
  issueWritePermit,
  redeemWritePermit,
  requestWritePermit,
  revokeWritePermit,
  scopeKey,
  type PermitScope,
} from "../../agent-os/gateway";
import { addPolicy, listPolicies, removePolicy } from "../../agent-os/policy";
import { registerProject, scanProject } from "../../agent-os/brain-scanner";
import { listSessions } from "../../agent-os/brain-sessions";
import { getBrainUniverse, getProjectAtlas } from "../../agent-os/brain-graph";
import { listWebMcpCalls, recordWebMcpCall } from "../../agent-os/webmcp";
import { handleStockRoutes } from "./stock-routes";
import { handleSeoRoutes } from "./seo-routes";
import { handleCampaignRoutes } from "./campaign-routes";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleAgentOsRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  // Namespace scope guard. The dispatch below slices `/api/agent-os/` off the pathname
  // and applies a read-only 405 guard to whatever remains, so a request from another
  // /api/* namespace (codex-auth, config, providers, ...) that reached this link would
  // be answered by THIS handler with a wrong 405 instead of falling through. Chain
  // links must decline out-of-namespace paths, not partially handle them.
  if (url.pathname !== "/api/agent-os" && !url.pathname.startsWith("/api/agent-os/")) {
    return null;
  }
  // Phase 20.25: Pao-hubPro × Agentic AI Universal Registry & Toolchain.
  if (url.pathname.startsWith("/api/agent-os/registry")) {
    const { handleRegistryRoutes } = await import("./registry-routes");
    return handleRegistryRoutes(ctx);
  }
  // Phase 20.30: Pao-hubPro × FCC-inspired Universal AI Gateway control plane
  // (alias/policy/budget layer over the existing proxy router — no second gateway).
  if (url.pathname.startsWith("/api/agent-os/ai-gateway")) {
    const { handleAIGatewayRoutes } = await import("./ai-gateway-routes");
    return handleAIGatewayRoutes(ctx);
  }
  // Phase 20.29: Pao-hubPro × ClawFlows-inspired Workflow Registry & Safe
  // Automation Engine.
  if (url.pathname.startsWith("/api/agent-os/automation")) {
    const { handleAutomationRoutes } = await import("./automation-routes");
    return handleAutomationRoutes(ctx);
  }
  // Phase 20.28: Pao-hubPro × OpenBot-inspired Governed Agent Computer &
  // Safe Execution Fabric.
  if (url.pathname.startsWith("/api/agent-os/governance")) {
    const { handleGovernanceRoutes } = await import("./governance-routes");
    return handleGovernanceRoutes(ctx);
  }
  // Phase 20.27: Pao-hubPro × VibeRaven Agent Cockpit & Production Readiness
  // Control Plane (extends the Phase 20.16 control plane).
  if (url.pathname.startsWith("/api/agent-os/cockpit")) {
    const { handleCockpitRoutes } = await import("./cockpit-routes");
    return handleCockpitRoutes(ctx);
  }
  // Phase 20.32: Pao-hubPro × VoiceStudio Local AI Speech Runtime.
  if (url.pathname.startsWith("/api/agent-os/speech")) {
    const { handleSpeechRoutes } = await import("./speech-routes");
    return handleSpeechRoutes(ctx);
  }
  // Phase 20.33: Pao-hubPro × Open WebUI Unified AI Workspace & MCP Control Plane.
  if (url.pathname.startsWith("/api/agent-os/ai-workspace")) {
    const { handleAiWorkspaceRoutes } = await import("./ai-workspace-routes");
    return handleAiWorkspaceRoutes(ctx);
  }
  // Phase 20.34: Pao-hubPro × Lead Gen API Stack — Lead Intelligence Control Plane.
  if (url.pathname.startsWith("/api/agent-os/leads")) {
    const { handleLeadRoutes } = await import("./lead-routes");
    return handleLeadRoutes(ctx);
  }
  // Phase 20.35: Pao-hubPro × Transgentic-inspired Unified AI Runtime Control Plane.
  if (url.pathname.startsWith("/api/agent-os/unified")) {
    const { handleUnifiedRuntimeRoutes } = await import("./unified-runtime-routes");
    return handleUnifiedRuntimeRoutes(ctx);
  }
  // Phase 30.36: Pao-hubPro × Software Income Playbooks — Pao Business Builder.
  if (url.pathname.startsWith("/api/agent-os/business")) {
    const { handleBusinessBuilderRoutes } = await import("./business-routes");
    return handleBusinessBuilderRoutes(ctx);
  }
  // Phase 20.37: Pao-hubPro × OrchestKit-inspired Agentic Development OS.
  if (url.pathname.startsWith("/api/agent-os/orch")) {
    const { handleAgenticOsRoutes } = await import("./agentic-os-routes");
    return handleAgenticOsRoutes(ctx);
  }
  // Phase 20.38: Pao-hubPro × OFFPack-inspired Dependency Vault.
  if (url.pathname.startsWith("/api/agent-os/dep-vault")) {
    const { handleDependencyVaultRoutes } = await import("./dependency-vault-routes");
    return handleDependencyVaultRoutes(ctx);
  }
  // Phase 20.43: Pao x PLUR Shared Agent Memory Runtime control plane.
  if (url.pathname.startsWith("/api/agent-memory")) {
    const { handlePlurMemoryRoutes } = await import("./plur-memory-routes");
    return handlePlurMemoryRoutes(ctx);
  }
  // Phase 20.42: Pao-hubPro Named AI Teammate Workspace.
  if (url.pathname.startsWith("/api/agent-workspace")) {
    const { handleBotWorkspaceRoutes } = await import("./bot-workspace-routes");
    return handleBotWorkspaceRoutes(ctx);
  }
  // Phase 20.41: Pao-hubPro Trustworthy MCP Memory Plane.
  if (url.pathname.startsWith("/api/memory")) {
    const { handleMemoryPlaneRoutes } = await import("./memory-plane-routes");
    return handleMemoryPlaneRoutes(ctx);
  }
  // Phase 20.40: Pao-hubPro Agent Observability Control Plane (read-only).
  if (url.pathname.startsWith("/api/agent-os/observability")) {
    const { handleObservabilityRoutes } = await import("./observability-routes");
    return handleObservabilityRoutes(ctx);
  }
  // Phase 20.39: Pao-hubPro Unified AI Coding Workspace. The 20.27 agency
  // cockpit keeps /api/agent-os/cockpit (dispatched earlier above); this is
  // the provider-neutral coding surface.
  if (url.pathname.startsWith("/api/agent-os/coding-workspace")) {
    const { handleCodingCockpitRoutes } = await import("./coding-cockpit-routes");
    return handleCodingCockpitRoutes(ctx);
  }
  // Phase 20.26: Pao-hubPro × Douyin Media Intelligence & Downloader Engine.
  // Must be dispatched BEFORE the generic media prefix below.
  if (url.pathname.startsWith("/api/agent-os/media/douyin")) {
    const { handleDouyinRoutes } = await import("./douyin-routes");
    return handleDouyinRoutes(ctx);
  }
  // Phase 20.24: Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine.
  if (url.pathname.startsWith("/api/agent-os/media")) {
    const { handleMediaRoutes } = await import("./media-routes");
    return handleMediaRoutes(ctx);
  }
  // Phase 20.23: Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer.
  if (url.pathname.startsWith("/api/agent-os/notifications")) {
    const { handleNotificationRoutes } = await import("./notification-routes");
    return handleNotificationRoutes(ctx);
  }
  // Phase 20.22: Pao-hubPro × LangChain Agent Orchestration & MCP Runtime Layer.
  // A bare prefix test with no equality branch matching the control-plane dispatcher.
  if (url.pathname.startsWith("/api/agent-os/orchestration")) {
    const { handleOrchestrationRoutes } = await import("./orchestration-routes");
    return handleOrchestrationRoutes(ctx);
  }
  // Phase 20.21: Pao-hubPro × OpenAI Codex Native Runtime Integration.
  // A bare prefix test with no equality branch matching the control-plane dispatcher.
  if (url.pathname.startsWith("/api/agent-os/codex-runtime")) {
    const { handleCodexRuntimeRoutes } = await import("./codex-runtime-routes");
    return handleCodexRuntimeRoutes(ctx);
  }
  // Phase 20.20: Pao-hubPro × ECC Agent Harness OS.
  // A bare prefix test with no equality branch matching the control-plane dispatcher.
  if (url.pathname.startsWith("/api/agent-os/ecc")) {
    const { handleEccRoutes } = await import("./ecc-routes");
    return handleEccRoutes(ctx);
  }
  // Phase 20.16: Pao-hubPro Multi-AI Control Plane.
  // A bare prefix test with no equality branch, matching the domain-control
  // dispatcher: this layer does not resolve HTTP methods, and an equality guard here
  // would be an unresolvable route guard for the registry scanner.
  if (url.pathname.startsWith("/api/agent-os/control-plane")) {
    const { handleControlPlaneRoutes } = await import("./control-plane-routes");
    return handleControlPlaneRoutes(ctx);
  }

  // Phase 20.15: Pao-hubPro Domain Control Plane.
  //
  // Deliberately a bare prefix test with no equality branch: this dispatcher knows
  // nothing about HTTP methods (the handler resolves them), and an equality guard
  // here is a route guard the registry scanner cannot resolve a method for. The
  // scanner fails loud on those by design, so a redundant literal would add an
  // unresolved entry for no benefit. startsWith already covers the exact path.
  if (url.pathname.startsWith("/api/agent-os/domains")) {
    const { handleDomainControlRoutes } = await import("./domain-control-routes");
    return handleDomainControlRoutes(ctx);
  }

  // Phase 20.14: Pao-hubPro Visual Knowledge & Media Memory
  if (
    url.pathname.startsWith("/api/agent-os/media-memory") ||
    url.pathname === "/api/agent-os/media-memory" ||
    url.pathname.startsWith("/api/media-memory")
  ) {
    const { handleMediaMemoryRoutes } = await import("./media-memory-routes");
    return handleMediaMemoryRoutes(ctx);
  }

  // Phase 20.13: Pao-hubPro Video Intelligence × Claude Watch
  if (
    url.pathname.startsWith("/api/agent-os/video-intelligence") ||
    url.pathname === "/api/agent-os/video-intelligence" ||
    url.pathname.startsWith("/api/video")
  ) {
    const { handleVideoIntelligenceRoutes } = await import("./video-intelligence-routes");
    return handleVideoIntelligenceRoutes(ctx);
  }

  // Phase 25: Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
  if (url.pathname.startsWith("/api/agent-os/security") || url.pathname === "/api/agent-os/security") {
    const { handleSecurityRoutes } = await import("./security-routes");
    return handleSecurityRoutes(ctx);
  }

  // Phase 24: Pao Autonomous Cost & Token Economy Governor (ACEG)
  if (url.pathname.startsWith("/api/agent-os/economy") || url.pathname === "/api/agent-os/economy") {
    const { handleEconomyRoutes } = await import("./economy-routes");
    return handleEconomyRoutes(ctx);
  }

  // Phase 23: Pao Autonomous Operations & Self-Healing Fleet (AOF)
  if (url.pathname.startsWith("/api/agent-os/operations") || url.pathname === "/api/agent-os/operations") {
    const { handleOperationsRoutes } = await import("./operations-routes");
    return handleOperationsRoutes(ctx);
  }

  // Phase 22: Pao Autonomous Change Control (ACC)
  if (url.pathname.startsWith("/api/agent-os/change-control") || url.pathname === "/api/agent-os/change-control") {
    const { handleChangeControlRoutes } = await import("./change-control-routes");
    return handleChangeControlRoutes(ctx);
  }

  // Phase 20.12: Pao-hubPro × Google ARTEMIS Mobile Agent Gateway
  if (url.pathname.startsWith("/api/agent-os/mobile") || url.pathname === "/api/agent-os/mobile") {
    const { handleMobileRoutes } = await import("./mobile-routes");
    return handleMobileRoutes(ctx);
  }

  // Phase 20.54: Pao Agent Platform
  if (url.pathname.startsWith("/api/agent-os/agent-platform") || url.pathname === "/api/agent-os/agent-platform") {
    const { handleAgentPlatformRoutes } = await import("./agent-platform-routes");
    return handleAgentPlatformRoutes(ctx);
  }

  if (url.pathname.startsWith("/api/agent-os/capability-lab") || url.pathname === "/api/agent-os/capability-lab") {
    const { handleCapabilityLabRoutes } = await import("./capability-lab-routes");
    return handleCapabilityLabRoutes(ctx);
  }

  // Phase 20.60: Social Publishing control plane (OpenPost integration).
  if (url.pathname.startsWith("/api/agent-os/social-publishing") || url.pathname === "/api/agent-os/social-publishing") {
    const { handleSocialPublishingRoutes } = await import("./social-publishing-routes");
    return handleSocialPublishingRoutes(ctx);
  }

  // Phase 20.61: Agent Runtime control plane (amux integration).
  if (url.pathname.startsWith("/api/agent-os/agent-runtime") || url.pathname === "/api/agent-os/agent-runtime") {
    const { handleAgentRuntimeRoutes } = await import("./agent-runtime-routes");
    return handleAgentRuntimeRoutes(ctx);
  }

  // Phase 20.62: Code Intelligence control plane (Graft integration).
  if (url.pathname.startsWith("/api/agent-os/code-intelligence") || url.pathname === "/api/agent-os/code-intelligence") {
    const { handleCodeIntelRoutes } = await import("./code-intelligence-routes");
    return handleCodeIntelRoutes(ctx);
  }

  // Phase 20.63: External Capability Registry (Public APIs integration).
  if (url.pathname.startsWith("/api/agent-os/external-apis") || url.pathname === "/api/agent-os/external-apis") {
    const { handleExternalApiRoutes } = await import("./external-apis-routes");
    return handleExternalApiRoutes(ctx);
  }

  // Phase 20.57: SkillsGate Skill Control Plane.
  if (url.pathname.startsWith("/api/agent-os/skill-gate") || url.pathname === "/api/agent-os/skill-gate") {
    const { handleSkillGateRoutes } = await import("./skill-gate-routes");
    return handleSkillGateRoutes(ctx);
  }

  // GOLD slice #1: Deterministic code review runtime (Phase 20.81 contract).
  if (url.pathname.startsWith("/api/agent-os/code-review") || url.pathname === "/api/agent-os/code-review") {
    const { handleCodeReviewRoutes } = await import("./code-review-routes");
    return handleCodeReviewRoutes(ctx);
  }

  // Phase 20.82: CortexKit AFT sensorimotor runtime.
  if (url.pathname.startsWith("/api/agent-os/sensorimotor") || url.pathname === "/api/agent-os/sensorimotor") {
    const { handleSensorimotorRoutes } = await import("./sensorimotor-routes");
    return handleSensorimotorRoutes(ctx);
  }

  // Phase 20.89: Capability Hub (Bubble) — registry-first capability marketplace.
  if (url.pathname.startsWith("/api/agent-os/marketplace") || url.pathname === "/api/agent-os/marketplace") {
    const { handleMarketplaceRoutes } = await import("./marketplace-routes");
    return handleMarketplaceRoutes(ctx);
  }

  // Phase 20.91b: Engineering Skill Runtime (Addy Osmani Agent Skills).
  if (url.pathname.startsWith("/api/agent-os/engineering-skills") || url.pathname === "/api/agent-os/engineering-skills") {
    const { handleEngineeringSkillsRoutes } = await import("./engineering-skills-routes");
    return handleEngineeringSkillsRoutes(ctx);
  }

  // Phase 20.92: AI Script-to-Video Studio (semantic director layer).
  if (url.pathname.startsWith("/api/agent-os/video-studio") || url.pathname === "/api/agent-os/video-studio") {
    const { handleVideoStudioRoutes } = await import("./video-studio-routes");
    return handleVideoStudioRoutes(ctx);
  }

  // Phase 20.93: Visual Agentic Workflow Studio (orchestration layer).
  if (url.pathname.startsWith("/api/agent-os/workflow-studio") || url.pathname === "/api/agent-os/workflow-studio") {
    const { handleWorkflowStudioRoutes } = await import("./workflow-studio-routes");
    return handleWorkflowStudioRoutes(ctx);
  }

  // Phase 20.85: OmniRoute Unified Model Gateway
  if (url.pathname.startsWith("/api/agent-os/model-gateway") || url.pathname === "/api/agent-os/model-gateway") {
    const { getModelGateway } = await import("../../agent-os/model-gateway/gateway");
    const gw = getModelGateway();
    if (req.method === "GET" && url.pathname === "/api/agent-os/model-gateway/health") {
      return jsonResponse(await gw.health(), 200, req, {});
    }
    if (req.method === "GET" && url.pathname === "/api/agent-os/model-gateway/routes") {
      return jsonResponse({ ok: true, routes: gw.registry.listRouteGroups() }, 200, req, {});
    }
    if (req.method === "GET" && url.pathname === "/api/agent-os/model-gateway/providers") {
      return jsonResponse({ ok: true, providers: gw.registry.listProviders() }, 200, req, {});
    }
    if (req.method === "GET" && url.pathname === "/api/agent-os/model-gateway/models") {
      return jsonResponse({ ok: true, models: gw.registry.listModels() }, 200, req, {});
    }
    if (req.method === "GET" && url.pathname === "/api/agent-os/model-gateway/circuits") {
      return jsonResponse({ ok: true, circuits: gw.circuitBreaker.listCircuits() }, 200, req, {});
    }
  }

  // Phase 21.1: End-to-End Autonomous Stock Production & Submission Pipeline
  if (url.pathname.startsWith("/api/agent-os/stock/pipeline") || url.pathname === "/api/agent-os/stock/pipeline") {
    const { handleStockPipelineRoutes } = await import("./stock-pipeline-routes");
    return handleStockPipelineRoutes(ctx);
  }

  // Phase 16: Stock Factory Management API Routes
  if (url.pathname.startsWith("/api/agent-os/stock/")) {
    return handleStockRoutes(ctx);
  }

  // Phase 18: SEO Agent OS Management API Routes
  if (url.pathname.startsWith("/api/agent-os/seo/")) {
    return handleSeoRoutes(ctx);
  }

  // Phase 21: Pao Stock Autonomous Campaign Planner Routes
  if (url.pathname.startsWith("/api/agent-os/campaign/") || url.pathname === "/api/agent-os/campaign") {
    return handleCampaignRoutes(ctx);
  }

  // Phase 20.5: Living Knowledge Brain Management API Routes
  if (url.pathname === "/api/agent-os/brain" || url.pathname.startsWith("/api/agent-os/brain/")) {
    const { handleBrainRoutes } = await import("./brain-routes");
    return handleBrainRoutes(ctx);
  }

  // Phase 20.6: MiniMax H3 Image Studio Management API Routes
  if (url.pathname === "/api/agent-os/h3" || url.pathname.startsWith("/api/agent-os/h3/")) {
    const { handleH3Routes } = await import("./h3-routes");
    return handleH3Routes(ctx);
  }

  // Phase 20.8: Agency Intelligence Layer Management API Routes
  if (url.pathname === "/api/agent-os/agency" || url.pathname.startsWith("/api/agent-os/agency/")) {
    const { handleAgencyRoutes } = await import("./agency-routes");
    return handleAgencyRoutes(ctx);
  }

  // Phase 20.9: Pao-hubPro × Chatbox Agent Desktop Runtime
  if (url.pathname === "/api/agent-os/desktop-agent" || url.pathname.startsWith("/api/agent-os/desktop-agent/")) {
    const { handleDesktopAgentRoutes } = await import("./desktop-agent-routes");
    return handleDesktopAgentRoutes(ctx);
  }

  // Phase 20.3: Pao Desktop Vision Control MCP × Local Realtime Agent
  if (url.pathname === "/api/agent-os/desktop" || url.pathname.startsWith("/api/agent-os/desktop/")) {
    const { handleDesktopRoutes } = await import("./desktop-routes");
    return handleDesktopRoutes(ctx);
  }

  // Phase 20.4: Pao Autonomous Engineering Council × Multi-Agent Parallel Worktree Execution
  if (url.pathname === "/api/agent-os/council" || url.pathname.startsWith("/api/agent-os/council/")) {
    const { handleCouncilRoutes } = await import("./council-routes");
    return handleCouncilRoutes(ctx);
  }

  // Phase 20.10: Pao Trend Intelligence × Apify MCP × Adobe Stock Research Engine
  if (url.pathname === "/api/agent-os/trends" || url.pathname.startsWith("/api/agent-os/trends/")) {
    const { handleTrendRoutes } = await import("./trend-routes");
    return handleTrendRoutes(ctx);
  }

  // Phase 21: Pao Knowledge Layer × Grounded Agent Gateway
  if (url.pathname === "/api/agent-os/knowledge" || url.pathname.startsWith("/api/agent-os/knowledge/")) {
    const { handleKnowledgeRoutes } = await import("./knowledge-routes");
    return handleKnowledgeRoutes(ctx);
  }

  // Phase 20.11: Pao-hubPro Browser — Agent-Native Runtime
  if (url.pathname === "/api/agent-os/browser" || url.pathname.startsWith("/api/agent-os/browser/")) {
    const { handleBrowserRoutes } = await import("./browser-routes");
    return handleBrowserRoutes(ctx);
  }

  const path = url.pathname.slice("/api/agent-os/".length);

  // --- Phase 16 gateway surface (the ONLY write paths, and they never mutate
  // a project directly: they request/issue/redeem permits against the approval
  // ledger, which a human owns). ---
  if (path === "permits/request" && req.method === "POST") {
    const body = await req.json().catch(() => null) as
      | { capability?: string; scope?: PermitScope; reason?: string; taskId?: string; workflowRunId?: string; stepIndex?: number }
      | null;
    if (!body?.capability || !body?.scope || !body?.reason) {
      return jsonResponse({ error: { code: "invalid_body", message: "capability, scope, and reason are required" } }, 400, req, {});
    }
    const { approvalId } = requestWritePermit({
      capability: body.capability as never,
      scope: body.scope,
      reason: body.reason,
      taskId: body.taskId ?? null,
      workflowRunId: body.workflowRunId,
      stepIndex: body.stepIndex,
    });
    return jsonResponse({ approvalId, status: "pending", note: "A human must grant this approval before any permit is issued." }, 202, req, {});
  }
  if (path === "permits/issue" && req.method === "POST") {
    const body = await req.json().catch(() => null) as { approvalId?: string; scope?: PermitScope; ttlMs?: number } | null;
    if (!body?.approvalId || !body?.scope) {
      return jsonResponse({ error: { code: "invalid_body", message: "approvalId and scope are required" } }, 400, req, {});
    }
    const result = issueWritePermit(body.approvalId, body.scope, body.ttlMs);
    if ("error" in result) {
      return jsonResponse({ error: { code: result.error, message: "permit issuance refused — approval is not granted" } }, 409, req, {});
    }
    return jsonResponse({ permitId: result.permit.id, token: result.token, expiresAtMs: result.permit.expiresAtMs }, 201, req, {});
  }
  if (path === "permits/redeem" && req.method === "POST") {
    const body = await req.json().catch(() => null) as
      | { permitId?: string; token?: string; scope?: PermitScope; subjectType?: "agent" | "task" | "global"; subjectId?: string | null }
      | null;
    if (!body?.permitId || !body?.token || !body?.scope || !body?.subjectType) {
      return jsonResponse({ error: { code: "invalid_body", message: "permitId, token, scope, and subjectType are required" } }, 400, req, {});
    }
    const result = redeemWritePermit({
      permitId: body.permitId,
      token: body.token,
      scope: body.scope,
      subjectType: body.subjectType,
      subjectId: body.subjectId ?? null,
    });
    return jsonResponse(result, result.ok ? 200 : 403, req, {});
  }
  if (path === "permits/revoke" && req.method === "POST") {
    const body = await req.json().catch(() => null) as { permitId?: string } | null;
    if (!body?.permitId) return jsonResponse({ error: { code: "invalid_body", message: "permitId is required" } }, 400, req, {});
    const revoked = revokeWritePermit(body.permitId);
    return jsonResponse({ revoked }, revoked ? 200 : 409, req, {});
  }
  if (path === "permits/decide" && req.method === "POST") {
    // The human decision endpoint: flips a PENDING approval. Everything
    // downstream (permit issuance, workflow resumption) keys off this.
    const body = await req.json().catch(() => null) as {
      approvalId?: string;
      decision?: "granted" | "denied";
      decidedBy?: string;
      workflowRunId?: string;
      stepIndex?: number;
    } | null;
    if (!body?.approvalId || (body.decision !== "granted" && body.decision !== "denied")) {
      return jsonResponse({ error: { code: "invalid_body", message: "approvalId and decision (granted|denied) are required" } }, 400, req, {});
    }
    const result = decideApproval(body.approvalId, body.decision, body.decidedBy ?? "dashboard-operator", {
      workflowRunId: body.workflowRunId,
      stepIndex: body.stepIndex,
    });
    return jsonResponse(result, result.ok ? 200 : 409, req, {});
  }
  if (path === "policies" && req.method === "GET") {
    return jsonResponse({ policies: listPolicies() }, 200, req, {});
  }
  if (path === "projects" && req.method === "GET") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("../../agent-os/db").openAgentOsDb();
    const projects = db.query("SELECT id, name, root_path AS rootPath, scan_enabled AS scanEnabled, scan_mode AS scanMode FROM brain_projects ORDER BY name").all();
    return jsonResponse({ projects }, 200, req, {});
  }
  if (path === "projects" && req.method === "POST") {
    const body = await req.json().catch(() => null) as
      | { name?: string; rootPath?: string; scanMode?: "quick" | "standard" | "deep" }
      | null;
    if (!body?.name || !body?.rootPath) {
      return jsonResponse({ error: { code: "invalid_body", message: "name and rootPath are required" } }, 400, req, {});
    }
    const project = registerProject({ name: body.name, rootPath: body.rootPath, scanMode: body.scanMode });
    return jsonResponse({ project }, 201, req, {});
  }
  const scanMatch = path.match(/^projects\/([^\/]+)\/scan$/);
  const atlasMatch = path.match(/^projects\/([^/]+)\/atlas$/);
  if (atlasMatch && req.method === "GET") {
    const atlas = getProjectAtlas(atlasMatch[1]);
    return atlas
      ? jsonResponse(atlas, 200, req, {})
      : jsonResponse({ error: { code: "atlas_not_found", message: "project or scan not found" } }, 404, req, {});
  }
  if (path === "universe" && req.method === "GET") {
    return jsonResponse(getBrainUniverse(), 200, req, {});
  }
  if (scanMatch && req.method === "POST") {
    // Read-only scanner: indexes metadata only, never writes into the project.
    try {
      const mode = url.searchParams.get("mode") as "quick" | "standard" | "deep" | null;
      const result = scanProject(scanMatch[1], mode ?? undefined);
      return jsonResponse({
        projectId: result.projectId,
        mode: result.mode,
        coverage: result.coverage,
        detected: result.detected,
      }, 200, req, {});
    } catch (error) {
      return jsonResponse({ error: { code: "scan_failed", message: error instanceof Error ? error.message : "scan failed" } }, 404, req, {});
    }
  }
  if (path === "sessions" && req.method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? undefined;
    return jsonResponse({ sessions: listSessions(projectId) }, 200, req, {});
  }
  if (path === "audit" && req.method === "GET") {
    return jsonResponse({ events: listWebMcpCalls(Number(url.searchParams.get("limit") ?? 100)) }, 200, req, {});
  }
  if (path === "audit" && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      tool?: string; actor?: string; projectId?: string | null; input?: Record<string, unknown>;
      result?: "success" | "error" | "denied"; errorCode?: string | null; durationMs?: number;
      approvalId?: string | null; riskTier?: "R0" | "R1" | "R2" | "R3" | "R4";
    } | null;
    if (!body?.tool || !body?.result || !["success", "error", "denied"].includes(body.result)) {
      return jsonResponse({ error: { code: "invalid_body", message: "tool and result (success|error|denied) are required" } }, 400, req, {});
    }
    const record = recordWebMcpCall({
      tool: body.tool,
      actor: body.actor ?? "agent",
      projectId: body.projectId ?? null,
      input: body.input,
      result: body.result,
      errorCode: body.errorCode ?? null,
      durationMs: body.durationMs ?? 0,
      approvalId: body.approvalId ?? null,
      riskTier: body.riskTier,
    });
    return jsonResponse({ event: record }, 201, req, {});
  }
  if (path === "policies" && req.method === "POST") {
    // Admin-owned policy management: the dashboard operator decides which
    // subjects may hold which capabilities. Effect allow for approval-required
    // capabilities still needs the approval ledger at redemption time.
    const body = await req.json().catch(() => null) as {
      subjectType?: "agent" | "task" | "global";
      subjectId?: string | null;
      capability?: string;
      effect?: "allow" | "deny";
    } | null;
    if (!body?.subjectType || !body?.capability || (body.effect !== "allow" && body.effect !== "deny")) {
      return jsonResponse({ error: { code: "invalid_body", message: "subjectType, capability, and effect (allow|deny) are required" } }, 400, req, {});
    }
    const id = addPolicy({
      subjectType: body.subjectType,
      subjectId: body.subjectId ?? null,
      capability: body.capability as never,
      effect: body.effect,
    });
    return jsonResponse({ policyId: id }, 201, req, {});
  }
  if (path?.startsWith("policies/") && req.method === "DELETE") {
    const policyId = path.slice("policies/".length);
    const removed = removePolicy(policyId);
    return jsonResponse({ removed }, removed ? 200 : 404, req, {});
  }

  // --- Observatory: read-only ---
  if (req.method !== "GET") {
    return jsonResponse({ error: { code: "read_only", message: "Agent OS observatory routes are read-only; use the permit gateway for controlled actions" } }, 405, req, {});
  }

  if (path === "agents") return jsonResponse({ agents: listAgents() }, 200, req, {});
  if (path === "tasks") {
    const status = url.searchParams.get("status");
    return jsonResponse({ tasks: listTasks(status as never) }, 200, req, {});
  }
  if (path === "skills") {
    return jsonResponse({ skills: listSkills(), issues: await checkSkillHealth() }, 200, req, {});
  }
  if (path === "memory") {
    const id = url.searchParams.get("id");
    if (id) {
      const memory = readMemory(id);
      return memory ? jsonResponse(memory, 200, req, {}) : notFound(req, "memory not found");
    }
    const scope = url.searchParams.get("scope") as never;
    return jsonResponse({ memories: listMemories({ scope }) }, 200, req, {});
  }
  if (path === "nodes") return jsonResponse({ nodes: listNodes() }, 200, req, {});
  if (path === "reviews") {
    const subjectKind = url.searchParams.get("subjectKind") ?? "";
    const subjectId = url.searchParams.get("subjectId") ?? "";
    if (!subjectKind || !subjectId) return notFound(req, "subjectKind and subjectId are required");
    const summary = summarizeCouncil(subjectKind, subjectId);
    return summary ? jsonResponse(summary, 200, req, {}) : notFound(req, "no reviews for subject");
  }
  if (path === "task-timeline") {
    const taskId = url.searchParams.get("taskId") ?? "";
    const timeline = taskTimeline(taskId);
    return timeline ? jsonResponse(timeline, 200, req, {}) : notFound(req, "task not found");
  }
  if (path === "search") {
    const q = url.searchParams.get("q") ?? "";
    return jsonResponse({ query: q, hits: searchAgentOs(q) }, 200, req, {});
  }
  if (path === "permits/pending") {
    const approvals = openAgentOsApprovalRows();
    return jsonResponse({ approvals }, 200, req, {});
  }
  if (path === "ask") {
    const q = url.searchParams.get("q") ?? "";
    return jsonResponse(askPaoBrain(q), 200, req, {});
  }
  // This dispatcher is a chain link, not a terminator: reachability is guarded by the
  // prefix checks above, so only /api/agent-os/* paths should ever get this far. Falling
  // through with a 404/405 here would swallow the rest of the /api/* namespace (codex-auth,
  // config, providers, ...) before their own handlers run — observed as surprise 404/405s
  // from unrelated management routes.
  return null;
}

function openAgentOsApprovalRows(): { id: string; capability: string; reason: string; status: string; requestedMs: number }[] {
  // Local import to avoid widening the module surface for tests that stub db.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require("../../agent-os/db").openAgentOsDb();
  return db.query("SELECT id, capability, reason, status, requested_ms AS requestedMs FROM approvals WHERE status = 'pending' ORDER BY requested_ms").all() as never;
}
