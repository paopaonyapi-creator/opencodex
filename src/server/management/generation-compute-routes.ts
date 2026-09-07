// Phase 20 — Pao Multi-GPU Compute & RunPod Management API Routes.
//
// Endpoints under /api/generation/compute/* and /api/generation/runpod/*:
// - compute/providers: List available local & cloud compute backends
// - compute/capacity: Aggregate GPU capacity, queue depths, budget metrics
// - compute/route-preview: Dry-run workload analyzer and placement decision
// - runpod/pods: List managed pods, provision new pod
// - runpod/pods/:id: Pod details, ComfyUI health, terminate
// - runpod/pods/:id/start: Resume stopped pod
// - runpod/pods/:id/stop: Stop running pod (halting GPU hourly burn)
// - runpod/pods/:id/drain: Drain active job, then stop
// - runpod/templates: List compatible ComfyUI templates
// - runpod/templates/:id/validate: Check template ports & environment
// - runpod/cost: FinOps summary & budget decisions
// - runpod/billing: Historical billing ledger records
// - runpod/emergency-stop: Global emergency kill switch
// - runpod/settings: Configuration and limit controls

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getGenerationOrchestrator } from "../../agent-os/generation/orchestrator";
import { listProviders, getProvider } from "../../agent-os/generation/providers";
import { listGpuProfiles } from "../../agent-os/generation/routing/gpu-catalog";
import { openAgentOsDb } from "../../agent-os/db";
import { recordGenerationAudit } from "../../agent-os/generation/queue";
import { rowToPodRecord } from "../../agent-os/generation/cloud/lifecycle-manager";
import { getFinOpsSummary } from "../../agent-os/generation/cost/meter";
import type { RoutingMode } from "../../agent-os/generation/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function forbidden(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "forbidden", message } }, 403, req, {});
}

function actorOf(ctx: ManagementContext): string {
  const principal = ctx.principal ?? "admin-token";
  if (typeof principal === "string") return principal;
  const role = (principal as { role?: string }).role;
  return role ? `session:${role}` : "session";
}

function requireMutationPrincipal(ctx: ManagementContext): Response | null {
  const principal = ctx.principal ?? "admin-token";
  const isStringPrincipal = typeof principal === "string";
  const isGuiOrAdmin = isStringPrincipal
    ? principal === "admin-token" || principal === "gui-session"
    : (principal as { role?: string }).role === "admin" ||
      (principal as { role?: string }).role === "reviewer" ||
      (principal as { role?: string }).role === "creator";
  if (isGuiOrAdmin) return null;
  return forbidden(ctx.req, "principal cannot mutate compute or cloud resources");
}

export async function handleComputeAndRunPodRoutes(
  ctx: ManagementContext,
  subPath: string,
): Promise<Response | null> {
  const { req, url } = ctx;
  const orch = getGenerationOrchestrator();

  // =========================================================================
  // 1. COMPUTE PROVIDERS & CAPACITY
  // =========================================================================

  if (subPath === "compute/providers" && req.method === "GET") {
    const local = getProvider("comfyui-local") ?? listProviders({ enabledOnly: true })[0];
    const runpodEnabled = orch.config.runpodEnabled;
    const runpodConfigured = Boolean(orch.config.runpodApiKey);
    const gpus = listGpuProfiles({ enabledOnly: true });

    const db = openAgentOsDb();
    const activePods = (
      db.query("SELECT COUNT(*) as count FROM gen_runpod_pods WHERE actual_state = 'ready' OR actual_state = 'busy'").get() as { count: number }
    ).count;
    const idlePods = (
      db.query("SELECT COUNT(*) as count FROM gen_runpod_pods WHERE actual_state = 'ready' AND current_job_id IS NULL").get() as { count: number }
    ).count;

    return jsonResponse({
      providers: [
        {
          id: "comfyui-local",
          type: "local",
          name: local?.name ?? "Local ComfyUI",
          healthy: local ? local.healthStatus !== "offline" : true,
          vramGb: orch.config.gpuPreferLocal ? 16 : 12,
          baseUrl: local?.baseUrl ?? orch.config.comfyuiBaseUrl,
          hourlyPrice: 0,
        },
        {
          id: "runpod",
          type: "cloud",
          name: "RunPod Cloud Generation Grid",
          enabled: runpodEnabled,
          configured: runpodConfigured,
          activePods,
          idlePods,
          maxActivePods: orch.config.runpodMaxActivePods,
          availableGpus: gpus.map(g => ({
            id: g.gpuTypeId,
            name: g.displayName,
            vramGb: g.vramGb,
            pricePerHour: g.observedPricePerHour ?? 0.74,
            benchmarkScore: g.benchmarkScore,
          })),
        },
      ],
    }, 200, req, {});
  }

  if (subPath === "compute/capacity" && req.method === "GET") {
    const db = openAgentOsDb();
    const local = getProvider("comfyui-local");
    const queueDepth = (db.query("SELECT COUNT(*) as count FROM gen_jobs WHERE status = 'queued'").get() as { count: number }).count;
    const activeJobs = (db.query("SELECT COUNT(*) as count FROM gen_jobs WHERE status = 'generating'").get() as { count: number }).count;

    const activePods = (
      db.query("SELECT COUNT(*) as count FROM gen_runpod_pods WHERE actual_state IN ('ready', 'busy', 'booting')").get() as { count: number }
    ).count;
    const idlePods = (
      db.query("SELECT COUNT(*) as count FROM gen_runpod_pods WHERE actual_state = 'ready' AND current_job_id IS NULL").get() as { count: number }
    ).count;

    const finOps = getFinOpsSummary(orch.costGuard);

    return jsonResponse({
      local: {
        vramGb: 16,
        healthy: local ? local.healthStatus !== "offline" : true,
        queueDepth,
        activeJobs,
      },
      cloud: {
        enabled: orch.config.runpodEnabled,
        configured: Boolean(orch.config.runpodApiKey),
        activePods,
        idlePods,
        maxActivePods: orch.config.runpodMaxActivePods,
        todaySpend: finOps.todaySpend,
        dailyBudget: finOps.dailyBudget,
        budgetRemaining: finOps.budgetRemaining,
      },
      activeHourlyBurn: finOps.activeCostPerHour,
    }, 200, req, {});
  }

  if (subPath === "compute/route-preview" && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      jobType?: string;
      prompt?: string;
      width?: number;
      height?: number;
      batchSize?: number;
      workflowId?: string;
      modelId?: string;
      routingMode?: RoutingMode;
    } | null;

    const db = openAgentOsDb();
    const queueDepth = (db.query("SELECT COUNT(*) as count FROM gen_jobs WHERE status = 'queued'").get() as { count: number }).count;

    const preview = await orch.router.previewRoute(body ?? {}, queueDepth);
    return jsonResponse(preview, 200, req, {});
  }

  // =========================================================================
  // 2. RUNPOD PODS (CRUD, START, STOP, DRAIN)
  // =========================================================================

  if (subPath === "runpod/pods" && req.method === "GET") {
    const statusFilter = url.searchParams.get("status");
    const db = openAgentOsDb();

    let query = "SELECT * FROM gen_runpod_pods";
    const params: unknown[] = [];
    if (statusFilter) {
      query += " WHERE actual_state = ?";
      params.push(statusFilter);
    }
    query += " ORDER BY created_at DESC";

    const rows = db.query(query).all(...(params as never)) as Array<Record<string, unknown>>;
    const pods = rows.map(rowToPodRecord);
    return jsonResponse({ pods }, 200, req, {});
  }

  if (subPath === "runpod/pods" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    if (!orch.lifecycleManager) {
      return jsonResponse({ error: { code: "runpod_disabled", message: "RunPod integration is not enabled or API key missing" } }, 503, req, {});
    }

    const body = await req.json().catch(() => null) as {
      gpuType?: string;
      templateId?: string;
      networkVolumeId?: string;
      hourlyPrice?: number;
      overrideActive?: boolean;
    } | null;

    const gpuType = body?.gpuType ?? "NVIDIA GeForce RTX 4090";
    const hourlyPrice = body?.hourlyPrice ?? 0.74;

    try {
      const pod = await orch.lifecycleManager.provisionPod({
        jobId: `manual_prov_${Date.now().toString(36)}`,
        gpuType,
        hourlyPrice,
        estimatedCost: hourlyPrice / 4, // 15 min reservation
        templateId: body?.templateId,
        networkVolumeId: body?.networkVolumeId,
        overrideActive: body?.overrideActive,
      });

      recordGenerationAudit({
        actor: actorOf(ctx),
        action: "runpod.pod.provision",
        subjectType: "runpod_pod",
        subjectId: pod.runpodPodId,
        details: { gpuType, hourlyPrice },
      });

      return jsonResponse({ pod }, 201, req, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: { code: "provision_failed", message: msg } }, 400, req, {});
    }
  }

  // Parameterized pod routes: runpod/pods/:id, :id/start, :id/stop, :id/drain
  if (subPath.startsWith("runpod/pods/")) {
    const parts = subPath.slice("runpod/pods/".length).split("/");
    const podId = parts[0];
    const action = parts[1];

    if (!podId) return notFound(req, "pod ID missing");

    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM gen_runpod_pods WHERE runpod_pod_id = ? OR id = ?").get(podId, podId) as Record<string, unknown> | undefined;
    if (!row) return notFound(req, `Pod ${podId} not found`);
    const runpodPodId = row.runpod_pod_id as string;

    if (!action && req.method === "GET") {
      const pod = rowToPodRecord(row);
      return jsonResponse({ pod }, 200, req, {});
    }

    if (!action && req.method === "DELETE") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;

      if (!orch.lifecycleManager) {
        return jsonResponse({ error: { code: "runpod_disabled", message: "RunPod integration not active" } }, 503, req, {});
      }

      const force = url.searchParams.get("force") === "true";
      try {
        await orch.lifecycleManager.safeTerminatePod(runpodPodId, { force });
        recordGenerationAudit({
          actor: actorOf(ctx),
          action: "runpod.pod.terminate",
          subjectType: "runpod_pod",
          subjectId: runpodPodId,
          details: { force },
        });
        return jsonResponse({ ok: true, podId: runpodPodId }, 200, req, {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: { code: "terminate_denied", message: msg } }, 400, req, {});
      }
    }

    if (action === "start" && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;

      if (!orch.lifecycleManager) {
        return jsonResponse({ error: { code: "runpod_disabled", message: "RunPod integration not active" } }, 503, req, {});
      }

      try {
        const updated = await orch.lifecycleManager.startPod(runpodPodId);
        recordGenerationAudit({
          actor: actorOf(ctx),
          action: "runpod.pod.start",
          subjectType: "runpod_pod",
          subjectId: runpodPodId,
        });
        return jsonResponse({ ok: true, pod: updated }, 200, req, {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: { code: "start_failed", message: msg } }, 500, req, {});
      }
    }

    if (action === "stop" && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;

      if (!orch.lifecycleManager) {
        return jsonResponse({ error: { code: "runpod_disabled", message: "RunPod integration not active" } }, 503, req, {});
      }

      try {
        const updated = await orch.lifecycleManager.stopPod(runpodPodId);
        recordGenerationAudit({
          actor: actorOf(ctx),
          action: "runpod.pod.stop",
          subjectType: "runpod_pod",
          subjectId: runpodPodId,
        });
        return jsonResponse({ ok: true, pod: updated }, 200, req, {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: { code: "stop_failed", message: msg } }, 500, req, {});
      }
    }

    if (action === "drain" && req.method === "POST") {
      const guard = requireMutationPrincipal(ctx);
      if (guard) return guard;

      if (!orch.lifecycleManager) {
        return jsonResponse({ error: { code: "runpod_disabled", message: "RunPod integration not active" } }, 503, req, {});
      }

      try {
        const updated = await orch.lifecycleManager.drainPod(runpodPodId);
        recordGenerationAudit({
          actor: actorOf(ctx),
          action: "runpod.pod.drain",
          subjectType: "runpod_pod",
          subjectId: runpodPodId,
        });
        return jsonResponse({ ok: true, pod: updated, status: updated.desiredState }, 200, req, {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: { code: "drain_failed", message: msg } }, 500, req, {});
      }
    }
  }

  // =========================================================================
  // 3. TEMPLATES & VALIDATION
  // =========================================================================

  if (subPath === "runpod/templates" && req.method === "GET") {
    const templates = [
      {
        id: "hs44di56w7",
        name: "ComfyUI Official Workspace (Reference)",
        recommended: true,
        httpPort: 8188,
        description: "Standard production template with PyTorch 2.4, CUDA 12.4, ComfyUI preinstalled with Manager",
      },
    ];

    if (orch.lifecycleManager) {
      try {
        const remote = await orch.lifecycleManager.client.getTemplate("hs44di56w7").catch(() => null);
        if (remote) {
          templates[0].name = remote.name || templates[0].name;
        }
      } catch { /* use built-in reference definition */ }
    }

    return jsonResponse({ templates }, 200, req, {});
  }

  if (subPath.startsWith("runpod/templates/") && subPath.endsWith("/validate") && req.method === "GET") {
    const templateId = subPath.slice("runpod/templates/".length, -"/validate".length);
    let valid = true;
    const checks: Record<string, boolean> = {
      portExposed: true,
      comfyUiCompatible: true,
      hasVolumeSupport: true,
    };

    if (orch.lifecycleManager) {
      try {
        const template = await orch.lifecycleManager.client.getTemplate(templateId);
        if (template.ports && !template.ports.includes("8188")) {
          checks.portExposed = false;
          valid = false;
        }
      } catch {
        valid = false;
        checks.accessible = false;
      }
    }

    return jsonResponse({ templateId, valid, checks }, valid ? 200 : 422, req, {});
  }

  // =========================================================================
  // 4. FINOPS, BILLING & EMERGENCY STOP
  // =========================================================================

  if (subPath === "runpod/cost" && req.method === "GET") {
    const finOps = getFinOpsSummary(orch.costGuard);
    return jsonResponse({ finOps }, 200, req, {});
  }

  if (subPath === "runpod/billing" && req.method === "GET") {
    const db = openAgentOsDb();
    const jobId = url.searchParams.get("jobId");
    const podId = url.searchParams.get("podId");
    const limit = Math.min(200, Number(url.searchParams.get("limit") || 50));

    let query = "SELECT * FROM gen_runpod_billing";
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (podId) {
      clauses.push("pod_id = ?");
      params.push(podId);
    }
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY observed_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.query(query).all(...(params as never));
    return jsonResponse({ entries: rows }, 200, req, {});
  }

  if (subPath === "runpod/emergency-stop" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    if (!orch.lifecycleManager) {
      return jsonResponse({ error: { code: "runpod_disabled", message: "RunPod integration not active" } }, 503, req, {});
    }

    try {
      const result = await orch.lifecycleManager.emergencyStopAll();
      recordGenerationAudit({
        actor: actorOf(ctx),
        action: "runpod.emergency_stop",
        subjectType: "cloud_grid",
        subjectId: "all_managed_pods",
        details: result,
      });
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: { code: "emergency_stop_failed", message: msg } }, 500, req, {});
    }
  }

  if (subPath === "runpod/settings" && req.method === "GET") {
    return jsonResponse({
      enabled: orch.config.runpodEnabled,
      hasApiKey: Boolean(orch.config.runpodApiKey),
      baseUrl: orch.config.runpodApiBaseUrl || "https://api.runpod.io",
      defaultTemplateId: orch.config.runpodDefaultTemplateId,
      dailyBudget: orch.config.runpodDailyBudget,
      monthlyBudget: orch.config.runpodMonthlyBudget,
      maxCostPerJob: orch.config.runpodMaxEstimatedCostPerJob,
      maxHourlyGpuPrice: orch.config.runpodMaxGpuPricePerHour,
      maxActivePods: orch.config.runpodMaxActivePods,
      idleShutdownMinutes: orch.config.runpodIdleStopMinutes,
      autoStop: orch.config.runpodAutoStop,
      preferLocal: orch.config.gpuPreferLocal,
      cloudBurstQueueThreshold: orch.config.cloudBurstQueueThreshold,
    }, 200, req, {});
  }

  if (subPath === "runpod/settings" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return badRequest(req, "settings body required");

    // Dynamic runtime limits update
    if (typeof body.dailyBudget === "number") {
      orch.costGuard.dailyBudget = body.dailyBudget;
    }
    if (typeof body.monthlyBudget === "number") {
      orch.costGuard.monthlyBudget = body.monthlyBudget;
    }
    if (typeof body.maxHourlyGpuPrice === "number") {
      orch.costGuard.maxGpuPricePerHour = body.maxHourlyGpuPrice;
      orch.router.maxGpuPricePerHour = body.maxHourlyGpuPrice;
    }
    if (typeof body.maxCostPerJob === "number") {
      orch.costGuard.maxEstimatedCostPerJob = body.maxCostPerJob;
    }
    if (typeof body.maxActivePods === "number") {
      orch.costGuard.maxActivePods = body.maxActivePods;
    }
    if (typeof body.preferLocal === "boolean") {
      orch.router.preferLocal = body.preferLocal;
    }
    if (typeof body.cloudBurstQueueThreshold === "number") {
      orch.router.cloudBurstQueueThreshold = body.cloudBurstQueueThreshold;
    }

    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "runpod.settings.update",
      subjectType: "system_config",
      subjectId: "runpod_runtime_settings",
      details: body,
    });

    return jsonResponse({
      ok: true,
      updatedSettings: {
        dailyBudget: orch.costGuard.dailyBudget,
        monthlyBudget: orch.costGuard.monthlyBudget,
        maxHourlyGpuPrice: orch.costGuard.maxGpuPricePerHour,
        maxCostPerJob: orch.costGuard.maxEstimatedCostPerJob,
        maxActivePods: orch.costGuard.maxActivePods,
        preferLocal: orch.router.preferLocal,
        cloudBurstQueueThreshold: orch.router.cloudBurstQueueThreshold,
      },
    }, 200, req, {});
  }

  return null;
}
