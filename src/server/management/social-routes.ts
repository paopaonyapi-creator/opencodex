// Phase 20.20 — Social Intelligence Management REST API routes (spec section 25).
//
// Endpoints mounted under /api/social/*. Every guard here is a full-literal pathname
// equality so the route registry scanner can see the surface; all values ride in
// bound parameters and provider tokens never appear in any response.

import { jsonResponse } from "../auth-cors";
import { openAgentOsDb } from "../../agent-os/db";
import type { ManagementContext } from "./context";
import { listSocialAudit, recordSocialAudit, type SocialAuditEvent } from "../../agent-os/social/audit";
import { getSocialConfig } from "../../agent-os/social/config";
import { getSocialCostGuard } from "../../agent-os/social/cost-guard";
import { SocialToolRegistry } from "../../agent-os/social/registry";
import { SocialResearchOrchestrator } from "../../agent-os/social/research";
import { SOCIAL_MCP_TOOLS } from "../../agent-os/social/mcp-tools";
import type { SocialCapability, SocialPlatform } from "../../agent-os/social/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function handleSocialRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/social/status") {
    const config = getSocialConfig();
    const registry = new SocialToolRegistry();
    const guard = getSocialCostGuard();
    const orchestrator = new SocialResearchOrchestrator();
    const tools = registry.listTools();
    const unproven = tools.filter((t) => t.enabled && t.successCount + t.failureCount + t.timeoutCount === 0);
    const healthy = tools.filter((t) => t.enabled && t.successCount + t.failureCount + t.timeoutCount > 0 && t.successCount >= t.failureCount);
    const degraded = tools.filter((t) => t.enabled && t.successCount + t.failureCount + t.timeoutCount > 0 && t.successCount < t.failureCount);

    // Runs today and observed success rate come from the run table only; null means
    // "no completed runs yet", which the dashboard must show as Unknown, never zero.
    const today = new Date().toISOString().slice(0, 10);
    const runsTodayRow = openAgentOsDb()
      .query("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded FROM social_provider_runs WHERE started_at LIKE ?")
      .get(`${today}%`) as { total: number; succeeded: number | null };

    return jsonResponse({
      status: "online",
      enabled: config.enabled,
      mockMode: config.mockMode,
      providers: registry.listProviders().length,
      tools: {
        total: tools.length,
        enabled: tools.filter((t) => t.enabled).length,
        healthy: healthy.length,
        degraded: degraded.length,
        unproven: unproven.length,
      },
      runsToday: Number(runsTodayRow.total ?? 0),
      successRateToday: runsTodayRow.succeeded !== null && Number(runsTodayRow.total) > 0
        ? Math.round((Number(runsTodayRow.succeeded) / Number(runsTodayRow.total)) * 100) / 100
        : null,
      usage: guard.getUsageSummary(),
      policy: {
        defaultMaxJobUsd: config.defaultMaxJobUsd,
        dailyBudgetUsd: config.dailyBudgetUsd,
        monthlyBudgetUsd: config.monthlyBudgetUsd,
        requireApprovalOverUsd: config.requireApprovalOverUsd,
        allowUnestimatedPaidRun: config.allowUnestimatedPaidRun,
        allowPaidAutoRun: config.allowPaidAutoRun,
        maxProviderAttempts: config.maxProviderAttempts,
        maxItemsHardLimit: config.maxItemsHardLimit,
      },
      recentJobs: orchestrator.listJobs(10).map((job) => ({ id: job.id, state: job.state, platform: job.platform, query: job.query, createdAt: job.createdAt })),
    }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/providers") {
    const registry = new SocialToolRegistry();
    return jsonResponse({ providers: registry.listProviders() }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/tools") {
    const registry = new SocialToolRegistry();
    const platform = url.searchParams.get("platform");
    const capability = url.searchParams.get("capability");
    const tools = registry.listTools({
      providerId: url.searchParams.get("provider") ?? undefined,
      platform: (platform as SocialPlatform | "any" | null) ?? "any",
      capability: (capability as SocialCapability | null) ?? undefined,
      enabledOnly: url.searchParams.get("enabledOnly") !== "false",
      search: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    return jsonResponse({ tools, count: tools.length }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/social/tools/toggle") {
    const body = await readJsonBody(req);
    if (typeof body.toolId !== "string" || typeof body.enabled !== "boolean") {
      return badRequest(req, "toggle requires toolId (string) and enabled (boolean)");
    }
    const registry = new SocialToolRegistry();
    const tool = registry.setToolEnabled(body.toolId, body.enabled);
    if (!tool) return notFound(req, `tool ${body.toolId} not found`);
    recordSocialAudit({
      event: "SOCIAL_SETTINGS_CHANGED",
      toolId: tool.id,
      providerId: tool.providerId,
      detail: { setting: "tool_enabled", enabled: body.enabled, externalId: tool.externalId },
    });
    return jsonResponse({ tool }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/social/registry/refresh") {
    const body = await readJsonBody(req);
    const providerId = typeof body.provider === "string" ? body.provider : "apify";
    const registry = new SocialToolRegistry();
    try {
      const summary = await registry.refresh(providerId, {
        maxPages: typeof body.maxPages === "number" ? body.maxPages : 3,
        search: typeof body.search === "string" ? body.search : undefined,
      });
      return jsonResponse({ refresh: summary }, 200, req, {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: { code: "provider_error", message } }, 502, req, {});
    }
  }

  if (req.method === "POST" && pathname === "/api/social/route/preview") {
    const body = await readJsonBody(req);
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((v): v is SocialCapability => typeof v === "string") : [];
    if (capabilities.length === 0) return badRequest(req, "capabilities must be a non-empty array");
    const orchestrator = new SocialResearchOrchestrator();
    const { decision, selectedTool, budget } = await orchestrator.previewRoute({
      platform: (typeof body.platform === "string" ? body.platform : "any") as SocialPlatform | "any",
      capabilities,
      query: typeof body.query === "string" ? body.query : undefined,
      maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
      maxCostUsd: typeof body.maxCostUsd === "number" ? body.maxCostUsd : undefined,
    });
    return jsonResponse({
      selectedToolId: decision.selectedToolId,
      selectedToolName: selectedTool?.name ?? null,
      estimatedCostUsd: decision.estimatedCostUsd,
      requiresApproval: decision.requiresApproval,
      budgetState: budget?.state ?? null,
      candidates: decision.candidates,
      blockedReason: decision.blockedReason,
    }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/social/run") {
    const body = await readJsonBody(req);
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((v): v is SocialCapability => typeof v === "string") : [];
    if (capabilities.length === 0) return badRequest(req, "capabilities must be a non-empty array");
    const orchestrator = new SocialResearchOrchestrator();
    const job = orchestrator.createJob({
      platform: (typeof body.platform === "string" ? body.platform : "any") as SocialPlatform | "any",
      capabilities,
      query: typeof body.query === "string" ? body.query : undefined,
      maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
      maxCostUsd: typeof body.maxCostUsd === "number" ? body.maxCostUsd : undefined,
    });
    const result = await orchestrator.runJob(job.id, {
      approvalToken: typeof body.approvalToken === "string" ? body.approvalToken : undefined,
    });
    return jsonResponse({
      researchJobId: result.job.id,
      state: result.job.state,
      selectedTool: result.job.selectedToolId,
      estimatedCost: result.job.estimatedCostUsd,
      fallbackHistory: result.job.fallbackHistory,
      itemCount: result.items.length,
      resultSummary: result.job.resultSummary,
    }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/runs") {
    const orchestrator = new SocialResearchOrchestrator();
    const runId = url.searchParams.get("id");
    if (runId) {
      const run = orchestrator.getRun(runId);
      if (!run) return notFound(req, `run ${runId} not found`);
      return jsonResponse({ run }, 200, req, {});
    }
    const jobId = url.searchParams.get("jobId");
    if (jobId) {
      const runs = orchestrator.listRuns(jobId);
      return jsonResponse({ runs, count: runs.length }, 200, req, {});
    }
    return badRequest(req, "either id or jobId query parameter is required");
  }

  if (req.method === "POST" && pathname === "/api/social/research") {
    const body = await readJsonBody(req);
    const action = typeof body.action === "string" ? body.action : "run";
    const orchestrator = new SocialResearchOrchestrator();

    if (action === "approve") {
      if (typeof body.jobId !== "string" || typeof body.maxUsd !== "number") {
        return badRequest(req, "approve requires jobId (string) and maxUsd (number)");
      }
      const approval = orchestrator.approveJob(body.jobId, { maxUsd: body.maxUsd });
      return jsonResponse({ jobId: body.jobId, ...approval }, 200, req, {});
    }

    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((v): v is SocialCapability => typeof v === "string") : [];
    if (capabilities.length === 0) return badRequest(req, "capabilities must be a non-empty array");
    const job = orchestrator.createJob({
      platform: (typeof body.platform === "string" ? body.platform : "any") as SocialPlatform | "any",
      capabilities,
      query: typeof body.query === "string" ? body.query : undefined,
      maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
      maxCostUsd: typeof body.maxCostUsd === "number" ? body.maxCostUsd : undefined,
    });
    const result = await orchestrator.runJob(job.id, {
      approvalToken: typeof body.approvalToken === "string" ? body.approvalToken : undefined,
    });
    return jsonResponse({
      researchJobId: result.job.id,
      state: result.job.state,
      itemCount: result.items.length,
      resultSummary: result.job.resultSummary,
    }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/research") {
    const orchestrator = new SocialResearchOrchestrator();
    const jobId = url.searchParams.get("id");
    if (jobId) {
      const job = orchestrator.getJob(jobId);
      if (!job) return notFound(req, `job ${jobId} not found`);
      return jsonResponse({ job, runs: orchestrator.listRuns(jobId) }, 200, req, {});
    }
    const jobs = orchestrator.listJobs(Number(url.searchParams.get("limit") ?? 50));
    return jsonResponse({ jobs, count: jobs.length }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/usage") {
    return jsonResponse({ usage: getSocialCostGuard().getUsageSummary() }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/audit") {
    const event = url.searchParams.get("event");
    const records = listSocialAudit({
      event: (event as SocialAuditEvent | null) ?? undefined,
      researchJobId: url.searchParams.get("jobId") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    return jsonResponse({ events: records, count: records.length }, 200, req, {});
  }

  if (req.method === "GET" && pathname === "/api/social/mcp-tools") {
    return jsonResponse({
      tools: Object.values(SOCIAL_MCP_TOOLS).map((tool) => ({
        name: tool.name,
        description: tool.description,
        riskTier: tool.riskTier,
        parameters: tool.parameters,
      })),
    }, 200, req, {});
  }

  // Out-of-namespace paths must fall through to the rest of the /api/* chain, not
  // terminate with a 404/405 that would shadow other handlers.
  if (pathname.startsWith("/api/social")) {
    return notFound(req, `unknown social route: ${req.method} ${pathname}`);
  }
  return null;
}
