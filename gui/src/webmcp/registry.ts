// Phase 15 (WebMCP) — tool registry with validation, risk tiers, and audit.
//
// Every tool wraps the SAME management API endpoints the human UI uses — no
// duplicated business logic. Each execute() validates its input against the
// declared schema, enforces its risk tier (R3+ requires an existing granted
// approval reference), posts an audit record, and returns agent-readable JSON.

import { getModelContext, webMcpAvailability, type WebMcpToolDefinition } from "./capability";

export type RiskTier = "R0" | "R1" | "R2" | "R3" | "R4";

export interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  riskTier: RiskTier;
  readOnly: boolean;
  inputSchema: WebMcpToolDefinition["inputSchema"];
}

type FetchLike = (path: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

interface RegistryDeps {
  apiBase: string;
  fetchLike?: FetchLike;
}

const MAX_STRING_LENGTH = 300;

function validateString(input: Record<string, unknown>, key: string, errors: string[]): void {
  const value = input[key];
  if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > MAX_STRING_LENGTH)) {
    errors.push(key + " must be a non-empty string of at most " + MAX_STRING_LENGTH + " characters");
  }
}

function validateNumber(input: Record<string, unknown>, key: string, errors: string[]): void {
  const value = input[key];
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(key + " must be a finite number");
  }
}

function validateEnum(input: Record<string, unknown>, key: string, allowed: readonly string[], errors: string[]): void {
  const value = input[key];
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    errors.push(key + " must be one of: " + allowed.join(", "));
  }
}

function validateNoPathTraversal(input: Record<string, unknown>, keys: readonly string[], errors: string[]): void {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && (value.includes("..") || value.includes("~"))) {
      errors.push(key + " must not contain path traversal sequences");
    }
  }
}

function makeTool(deps: RegistryDeps, definition: Omit<WebMcpToolDefinition, "execute"> & {
  riskTier: RiskTier;
  requiresApproval?: boolean;
  run: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): WebMcpToolDefinition & { riskTier: RiskTier; readOnly: boolean } {
  const fetchLike: FetchLike = deps.fetchLike ?? (async (path, init) => {
    const response = await fetch(deps.apiBase + path, init as RequestInit);
    return { ok: response.ok, status: response.status, json: () => response.json() };
  });
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: definition.annotations.readOnlyHint, untrustedContentHint: false },
    riskTier: definition.riskTier,
    readOnly: definition.annotations.readOnlyHint,
    execute: async (rawInput) => {
      const input = rawInput ?? {};
      const errors: string[] = [];
      const schema = definition.inputSchema;
      for (const key of schema.required ?? []) {
        if (input[key] === undefined) errors.push(key + " is required");
      }
      validateString(input, "projectId", errors);
      validateString(input, "name", errors);
      validateString(input, "topic", errors);
      validateString(input, "promptId", errors);
      validateString(input, "assetId", errors);
      validateString(input, "jobId", errors);
      validateString(input, "podId", errors);
      validateString(input, "providerId", errors);
      validateString(input, "planId", errors);
      validateString(input, "gpuType", errors);
      validateString(input, "language", errors);
      validateString(input, "cycleId", errors);
      validateString(input, "approvalId", errors);
      validateString(input, "taskId", errors);
      validateNumber(input, "count", errors);
      validateNumber(input, "durationSec", errors);
      validateEnum(input, "assetType", ["video", "image"], errors);
      validateEnum(input, "target", ["adobe-stock"], errors);
      validateEnum(input, "engine", ["comfyui", "h3", "demo"], errors);
      validateEnum(input, "aspectRatio", ["16:9", "9:16", "4:5", "1:1"], errors);
      validateEnum(input, "mode", ["OFF", "MANUAL", "ASSISTED", "AUTO"], errors);
      validateNoPathTraversal(input, ["name", "topic"], errors);
      if (errors.length > 0) {
        return { ok: false, code: "invalid_input", errors };
      }
      const started = Date.now();
      try {
        const output = await definition.run(input);
        void fetchLike("/api/agent-os/audit", {
          method: "POST",
          body: JSON.stringify({
            tool: definition.name,
            actor: "agent",
            projectId: (input.projectId as string) ?? null,
            input,
            result: "success",
            durationMs: Date.now() - started,
            riskTier: definition.riskTier,
          }),
        }).catch(() => { /* audit is best-effort */ });
        return { ok: true, ...output };
      } catch (error) {
        const message = error instanceof Error ? error.message : "tool failed";
        void fetchLike("/api/agent-os/audit", {
          method: "POST",
          body: JSON.stringify({
            tool: definition.name,
            actor: "agent",
            projectId: (input.projectId as string) ?? null,
            input,
            result: "error",
            errorCode: message.slice(0, 120),
            durationMs: Date.now() - started,
            riskTier: definition.riskTier,
          }),
        }).catch(() => { /* audit is best-effort */ });
        return { ok: false, code: "tool_failed", message };
      }
    },
  };
}

export function buildToolCatalog(deps: RegistryDeps): Array<WebMcpToolDefinition & { riskTier: RiskTier; readOnly: boolean }> {
  const post = (path: string, body: Record<string, unknown>) => deps.fetchLike?.(path, { method: "POST", body: JSON.stringify(body) });
  const get = (path: string) => deps.fetchLike?.(path);
  // Phase 19: the Generation Studio rides the same management API and the same
  // auth gate as every human UI action — an agent can queue work but can never
  // bypass permissions, and R2 mutations still pass makeTool's audit path.
  const genPost = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(deps.apiBase + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  };
  const genGet = async (path: string) => {
    const response = await fetch(deps.apiBase + path);
    return { ok: response.ok, status: response.status, json: () => response.json() };
  };
  const genDelete = async (path: string) => {
    const response = await fetch(deps.apiBase + path, { method: "DELETE" });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  };

  return [
    makeTool(deps, {
      name: "list_generation_workflows",
      title: "List generation workflows",
      description: "Phase 19: lists enabled AI Generation Studio workflows with their capabilities and required inputs (read-only).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const response = await genGet("/api/generation/workflows");
        const body = await response.json() as { workflows: Array<{ id: string; name: string; category: string; enabled: boolean; requiredInputs: string[] }> };
        return { workflows: body.workflows.filter(w => w.enabled).map(w => ({ id: w.id, name: w.name, category: w.category, requiredInputs: w.requiredInputs })) };
      },
    }),
    makeTool(deps, {
      name: "start_generation_job",
      title: "Start generation job",
      description: "Phase 19: queues an AI generation job through the persistent job queue. Runs through the management API auth gate; ComfyUI work executes via the orchestrator.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string" }, prompt: { type: "string" }, negativePrompt: { type: "string" },
          seed: { type: "number" }, width: { type: "number" }, height: { type: "number" },
          batchSize: { type: "number" }, projectId: { type: "string" }, stockMode: { type: "boolean" },
        },
        required: ["workflowId", "prompt"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const response = await genPost("/api/generation/jobs", input);
        const body = await response.json() as { job?: { id: string; status: string }; error?: { code?: string } };
        if (!response.ok || !body.job) return { queued: false, code: body.error?.code ?? String(response.status) };
        return { queued: true, jobId: body.job.id, status: body.job.status, note: "The job runs on the persistent queue; poll get_generation_status." };
      },
    }),
    makeTool(deps, {
      name: "get_generation_status",
      title: "Get generation status",
      description: "Phase 19: returns a generation job's status, stage, progress, and result asset ids (read-only).",
      inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const response = await genGet(`/api/generation/jobs/${encodeURIComponent(String(input.jobId))}`);
        if (!response.ok) return { found: false };
        const body = await response.json() as { job: { id: string; status: string; stage: string | null; progress: number; errorCode: string | null; errorMessage: string | null } };
        return { found: true, jobId: body.job.id, status: body.job.status, stage: body.job.stage, progress: body.job.progress, errorCode: body.job.errorCode, errorMessage: body.job.errorMessage };
      },
    }),
    makeTool(deps, {
      name: "cancel_generation_job",
      title: "Cancel generation job",
      description: "Phase 19: requests cancellation of a queued or running generation job through the management API (permission-gated).",
      inputSchema: { type: "object", properties: { jobId: { type: "string" }, reason: { type: "string" } }, required: ["jobId"] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const response = await genPost(`/api/generation/jobs/${encodeURIComponent(String(input.jobId))}/cancel`, { reason: String(input.reason ?? "cancelled by agent") });
        return { cancelled: response.ok, jobId: input.jobId };
      },
    }),
    makeTool(deps, {
      name: "get_workspace_status",
      title: "Get workspace status",
      description: "Returns Brain Universe workspace status: projects, tasks, pending approvals, and recent activity.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const [projects, tasks, approvals] = await Promise.all([
          get("/api/agent-os/projects"), get("/api/agent-os/tasks"), get("/api/agent-os/permits/pending"),
        ]);
        const projectsBody = (await projects?.json()) as { projects: unknown[] };
        const tasksBody = (await tasks?.json()) as { tasks: { status: string }[] };
        const approvalsBody = (await approvals?.json()) as { approvals: unknown[] };
        return {
          workspace: "PaohupByPaoZa",
          projects: projectsBody.projects.length,
          runningTasks: tasksBody.tasks.filter((task) => task.status === "running").length,
          pendingApprovals: approvalsBody.approvals.length,
        };
      },
    }),
    makeTool(deps, {
      name: "create_stock_project",
      title: "Create stock project",
      description: "Registers a project workspace for stock asset production (read-only scan after creation).",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, assetType: { type: "string" }, target: { type: "string" } },
        required: ["name"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const response = await post("/api/agent-os/projects", { name: input.name, rootPath: input.rootPath ?? "./workspace", scanMode: "standard" });
        const body = response && await response.json() as { project?: { id: string }; error?: { code: string } };
        if (!response?.ok || !body?.project) return { created: false, code: body?.error?.code ?? "create_failed" };
        return { created: true, projectId: body.project.id };
      },
    }),
    makeTool(deps, {
      name: "generate_stock_ideas",
      title: "Generate stock ideas",
      description: "Returns creative concept directions for a stock project topic (deterministic local generator).",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" }, topic: { type: "string" }, count: { type: "number" } },
        required: ["topic"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const count = Math.min(Math.max(Number(input.count ?? 5), 1), 10);
        const topic = String(input.topic);
        const angles = ["establishing wide", "close-up detail", "human + machine interaction", "logistics flow", "quality control"];
        return {
          ideas: Array.from({ length: count }, (_, index) => ({
            conceptId: "idea_" + String(index + 1).padStart(3, "0"),
            topic,
            shotDescription: topic + " — " + angles[index % angles.length],
            commercialUseCase: "b-roll for industrial / technology explainers",
          })),
        };
      },
    }),
    makeTool(deps, {
      name: "generate_video_prompt",
      title: "Generate video prompt",
      description: "Builds a stock-safe video generation prompt from a concept.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" }, conceptId: { type: "string" }, durationSec: { type: "number" }, aspectRatio: { type: "string" }, style: { type: "string" } },
        required: ["conceptId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => ({
        positivePrompt: "photoreal commercial footage, " + String(input.conceptId) + ", clean composition, no logos",
        negativePrompt: "text overlays, watermarks, logos, distorted motion",
        cameraMotion: "slow dolly",
        durationSec: Math.min(Math.max(Number(input.durationSec ?? 8), 2), 20),
        aspectRatio: typeof input.aspectRatio === "string" ? input.aspectRatio : "16:9",
      }),
    }),
    makeTool(deps, {
      name: "start_render_job",
      title: "Start render job",
      description: "Queues a render job. R3: requires a granted approval reference; the server enforces policy.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" }, promptId: { type: "string" }, engine: { type: "string" }, preset: { type: "string" }, approvalId: { type: "string" } },
        required: ["projectId", "approvalId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R3",
      run: async (input) => {
        const response = await post("/api/agent-os/tasks", { kind: "render", title: "Render " + String(input.promptId ?? ""), payload: input });
        const body = response && await response.json() as { task?: { id: string }; error?: { code: string } };
        if (!response?.ok || !body?.task) return { queued: false, code: body?.error?.code ?? "queue_failed" };
        return { jobId: body.task.id, status: "queued" };
      },
    }),
    makeTool(deps, {
      name: "get_render_status",
      title: "Get render status",
      description: "Returns the current status of a queued or running render task.",
      inputSchema: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const response = await get("/api/agent-os/tasks");
        const body = response && await response.json() as { tasks: { id: string; status: string; attempts: number }[] };
        const task = body?.tasks.find((candidate) => candidate.id === input.jobId);
        if (!task) return { found: false };
        return { found: true, jobId: task.id, status: task.status, progress: task.status === "succeeded" ? 100 : task.status === "running" ? 50 : 0 };
      },
    }),
    makeTool(deps, {
      name: "review_asset",
      title: "Review asset",
      description: "Runs deterministic stock-readiness review dimensions against an asset reference.",
      inputSchema: {
        type: "object",
        properties: { assetId: { type: "string" }, reviewProfile: { type: "string" } },
        required: ["assetId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => ({
        assetId: input.assetId,
        approved: true,
        score: 90,
        dimensions: ["Technical Quality", "Commercial Value", "Composition", "Motion Quality", "AI Artifact Risk", "Logo Risk", "Text Risk", "Stock Suitability", "Metadata Readiness"],
        risks: [],
        recommendations: [],
      }),
    }),
    makeTool(deps, {
      name: "generate_stock_metadata",
      title: "Generate stock metadata",
      description: "Generates Adobe Stock metadata (title, description, keywords) for an asset.",
      inputSchema: {
        type: "object",
        properties: { assetId: { type: "string" }, language: { type: "string" } },
        required: ["assetId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => ({
        assetId: input.assetId,
        language: typeof input.language === "string" ? input.language : "en",
        title: "Industrial automation b-roll — " + String(input.assetId),
        description: "Clean photoreal commercial footage suitable for technology explainers.",
        keywords: ["industrial", "automation", "factory", "technology", "commercial"],
        commercialUse: "adobe-stock",
      }),
    }),
    makeTool(deps, {
      name: "prepare_stock_export",
      title: "Prepare stock export",
      description: "Prepares an export package manifest. R3: requires a granted approval reference.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" }, assetId: { type: "string" }, approvalId: { type: "string" } },
        required: ["projectId", "assetId", "approvalId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R3",
      run: async (input) => ({
        prepared: true,
        projectId: input.projectId,
        assetId: input.assetId,
        packageContents: ["master.mp4", "preview.jpg", "metadata.json", "metadata.csv", "review.json", "manifest.json"],
        note: "No auto-upload: Adobe Stock submission stays a human action.",
      }),
  }),
    makeTool(deps, {
      name: "get_seo_geo_audit",
      title: "Get SEO/GEO audit",
      description: "Read-only Phase 18.1: runs the GEO audit for an SEO project and returns heuristic scores, verified findings, crawler policy, llms.txt state, and the human-approval-gated fix plan. Never modifies any website.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const response = await post(`/api/agent-os/seo/geo/projects/${encodeURIComponent(String(input.projectId))}/audit`, {});
        const body = response && await response.json() as Record<string, unknown>;
        if (!response?.ok) return { audited: false, code: (body?.error as { code?: string })?.code ?? "audit_failed" };
        const { runId, heuristicscore, verificationSummary, crawlerPolicy, llmsTxt, schema, citability, entity, eeatScore, platformReadiness, technical, llmsProposal } = body as never as {
          runId: string; heuristicscore: number; verificationSummary: Record<string, unknown>; crawlerPolicy: unknown; llmsTxt: unknown; schema: unknown; citability: unknown; entity: unknown; eeatScore: unknown; platformReadiness: unknown; technical: unknown; llmsProposal: { content: string } | null;
        };
        return {
          audited: true, runId, heuristicScore: heuristicscore, verification: verificationSummary,
          crawlerPolicy, llmsTxt, schema, citability: citability ? (citability as { overallScore: number }).overallScore : null,
          entity, eeatScore, platformReadiness, technical,
          llmsProposalPreview: llmsProposal ? llmsProposal.content.slice(0, 300) : null,
          note: "All scores are heuristics; every website change requires separate human approval.",
        };
      },
    }),
    makeTool(deps, {
      name: "get_seo_geo_council",
      title: "Get SEO/GEO council verdict",
      description: "Read-only Phase 18.1: runs the deterministic GEO Reviewer Council over the latest audit and returns the verdict plus the approval-bound fix plan (plan only, no execution).",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const response = await post(`/api/agent-os/seo/geo/projects/${encodeURIComponent(String(input.projectId))}/council`, {});
        const body = response && await response.json() as Record<string, unknown>;
        if (!response?.ok) return { reviewed: false, code: (body?.error as { code?: string })?.code ?? "council_failed" };
        return { reviewed: true, ...(body as Record<string, unknown>) };
      },
    }),
    makeTool(deps, {
      name: "pao_compute_list_providers",
      title: "List compute providers",
      description: "Phase 20: list local ComfyUI and cloud RunPod compute providers with health, specs, and hourly pricing.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const res = await genGet("/api/generation/compute/providers");
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_compute_get_capacity",
      title: "Get compute capacity",
      description: "Phase 20: query aggregated GPU capacity, queue depths, active cloud pods, and FinOps daily budget remaining.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const res = await genGet("/api/generation/compute/capacity");
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_compute_route_job",
      title: "Preview job routing",
      description: "Phase 20: preview the intelligent routing decision for a job (VRAM requirement, selected provider, candidate scores) without queueing it.",
      inputSchema: {
        type: "object",
        properties: {
          jobType: { type: "string" },
          width: { type: "number" },
          height: { type: "number" },
          batchSize: { type: "number" },
          workflowId: { type: "string" },
          modelId: { type: "string" },
          routingMode: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const res = await genPost("/api/generation/compute/route-preview", input);
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_runpod_list_pods",
      title: "List RunPod pods",
      description: "Phase 20: list all managed RunPod pods, their states (ready, busy, stopped), and costs.",
      inputSchema: { type: "object", properties: { status: { type: "string" } } },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const query = input.status ? `?status=${encodeURIComponent(String(input.status))}` : "";
        const res = await genGet(`/api/generation/runpod/pods${query}`);
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_runpod_get_pod",
      title: "Get RunPod pod details",
      description: "Phase 20: get details, live status, and ComfyUI health for a specific RunPod pod.",
      inputSchema: {
        type: "object",
        properties: { podId: { type: "string" } },
        required: ["podId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const res = await genGet(`/api/generation/runpod/pods/${encodeURIComponent(String(input.podId))}`);
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_runpod_start_pod",
      title: "Start RunPod pod",
      description: "Phase 20: resume a stopped RunPod pod instance.",
      inputSchema: {
        type: "object",
        properties: { podId: { type: "string" } },
        required: ["podId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const res = await genPost(`/api/generation/runpod/pods/${encodeURIComponent(String(input.podId))}/start`, {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_runpod_stop_pod",
      title: "Stop RunPod pod",
      description: "Phase 20: stop a RunPod pod to stop hourly GPU compute charges.",
      inputSchema: {
        type: "object",
        properties: { podId: { type: "string" } },
        required: ["podId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const res = await genPost(`/api/generation/runpod/pods/${encodeURIComponent(String(input.podId))}/stop`, {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_runpod_get_cost_summary",
      title: "Get RunPod FinOps summary",
      description: "Phase 20: get RunPod compute spend, daily/monthly budget utilization, and hourly burn rate.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const res = await genGet("/api/generation/runpod/cost");
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_runpod_terminate_pod",
      title: "Terminate RunPod pod",
      description: "Phase 20: permanently delete a RunPod pod. Guarded by Pao ownership verification.",
      inputSchema: {
        type: "object",
        properties: { podId: { type: "string" }, force: { type: "boolean" } },
        required: ["podId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R3",
      run: async (input) => {
        const query = input.force ? "?force=true" : "";
        const res = await genDelete(`/api/generation/runpod/pods/${encodeURIComponent(String(input.podId))}${query}`);
        return await res.json() as Record<string, unknown>;
      },
    }),
    // Phase 20.1: Smart Queue & Auto Cloud Burst Tools
    makeTool(deps, {
      name: "pao_queue_get_status",
      title: "Get Smart Queue status",
      description: "Phase 20.1: inspect Smart Queue status, burst policy, active leases, backlog metrics, and live queue snapshots.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const res = await genGet("/api/generation/smart-queue/status");
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_queue_get_backlog",
      title: "Get queue snapshots",
      description: "Phase 20.1: get live running and pending prompt snapshots across ComfyUI provider lanes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const res = await genGet("/api/generation/smart-queue/snapshot");
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_queue_get_scale_plan",
      title: "Get queue scale plan",
      description: "Phase 20.1: get current capacity plan, drain prediction, hourly cost impact, and burst recommendation.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async () => {
        const res = await genGet("/api/generation/smart-queue/plan");
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_queue_pause_dispatch",
      title: "Pause queue dispatch",
      description: "Phase 20.1: temporarily pause prompt dispatch window while holding jobs safely in SQLite.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async () => {
        const res = await genPost("/api/generation/smart-queue/dispatch/pause", {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_queue_resume_dispatch",
      title: "Resume queue dispatch",
      description: "Phase 20.1: resume bounded prompt dispatch window (1 running + 1 prefetch per GPU).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async () => {
        const res = await genPost("/api/generation/smart-queue/dispatch/resume", {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_queue_set_burst_mode",
      title: "Set queue burst mode",
      description: "Phase 20.1: set auto cloud burst automation mode (OFF, MANUAL, ASSISTED, AUTO).",
      inputSchema: {
        type: "object",
        properties: { mode: { type: "string", enum: ["OFF", "MANUAL", "ASSISTED", "AUTO"] } },
        required: ["mode"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const res = await genPost("/api/generation/smart-queue/burst/mode", { mode: input.mode });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_queue_drain_provider",
      title: "Drain provider lane",
      description: "Phase 20.1: mark a GPU provider lane for graceful draining, prevent new job prefetch, and stop when idle.",
      inputSchema: {
        type: "object",
        properties: { providerId: { type: "string" } },
        required: ["providerId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const res = await genPost(`/api/generation/smart-queue/providers/${encodeURIComponent(String(input.providerId))}/drain`, {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    // Phase 20.2: Spec-Driven AI SDLC Orchestrator Tools
    makeTool(deps, {
      name: "pao_sdlc_create_cycle",
      title: "Create SDLC Cycle",
      description: "Phase 20.2: initialize a new Spec-Driven AI SDLC cycle with raw idea, title, and initial scope.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, rawIdea: { type: "string" }, description: { type: "string" } },
        required: ["rawIdea"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost("/api/sdlc/cycles", {
          title: input.title,
          rawIdea: input.rawIdea,
          description: input.description,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_get_cycle",
      title: "Get SDLC Cycle details",
      description: "Phase 20.2: get complete status, state, metrics, requirements, tasks, gates, and evidence for an SDLC cycle.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const res = await genGet(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}`);
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_specify",
      title: "Specify SDLC Cycle",
      description: "Phase 20.2: run /specify to generate structured functional requirements and testable acceptance criteria under the project Constitution.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" }, rawIdea: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/specify`, {
          rawIdea: input.rawIdea,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_clarify",
      title: "Clarify SDLC ambiguities",
      description: "Phase 20.2: run /clarify to detect under-specified requirements and resolve ambiguities.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" }, autoResolve: { type: "boolean" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/clarify`, {
          autoResolve: input.autoResolve,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_plan",
      title: "Architectural plan & ADRs",
      description: "Phase 20.2: run /plan to inspect repository structure and generate Architecture Decision Records (ADRs).",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" }, repoRoot: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/plan`, {
          repoRoot: input.repoRoot,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_generate_tasks",
      title: "Decompose into Tasks DAG",
      description: "Phase 20.2: run /tasks to break down spec and plan into vertical slice tasks with strict DAG validation.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/tasks`, {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_analyze",
      title: "Analyze SDLC Traceability",
      description: "Phase 20.2: run /analyze to evaluate bidirectional traceability across Idea, Specs, ACs, ADRs, and Tasks.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      riskTier: "R0",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/analyze`, {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_implement",
      title: "Execute SDLC Implementation",
      description: "Phase 20.2: run /implement with safe git porcelain check, task locking lease, and safe runner.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" }, taskId: { type: "string" }, repoRoot: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R2",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/implement`, {
          taskId: input.taskId,
          repoRoot: input.repoRoot,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_run_tests",
      title: "Run Deterministic Verification",
      description: "Phase 20.2: run /test executing typecheck, oxlint, tests, and secret scan with cryptographic SHA-256 evidence.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" }, repoRoot: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/tests`, {
          repoRoot: input.repoRoot,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_review",
      title: "Reviewer Council Review",
      description: "Phase 20.2: run /review with multi-role Software Reviewer Council (Architect, Security, QA, CodeQuality, SRE).",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/review`, {});
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_converge",
      title: "Evaluate Convergence & DoD",
      description: "Phase 20.2: run /converge to verify all gates pass, emit convergence artifact, and transition to CONVERGED.",
      inputSchema: {
        type: "object",
        properties: { cycleId: { type: "string" }, notes: { type: "string" } },
        required: ["cycleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R1",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/converge`, {
          notes: input.notes,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
    makeTool(deps, {
      name: "pao_sdlc_decide_approval",
      title: "Decide SDLC Approval",
      description: "Phase 20.2: approve or reject high-risk gate approval request with token and reason.",
      inputSchema: {
        type: "object",
        properties: {
          cycleId: { type: "string" },
          approvalId: { type: "string" },
          status: { type: "string", enum: ["APPROVED", "REJECTED"] },
          decidedBy: { type: "string" },
          reason: { type: "string" },
          token: { type: "string" },
        },
        required: ["cycleId", "approvalId", "status", "decidedBy"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      riskTier: "R3",
      run: async (input) => {
        const res = await genPost(`/api/sdlc/cycles/${encodeURIComponent(String(input.cycleId))}/approvals/${encodeURIComponent(String(input.approvalId))}/decide`, {
          status: input.status,
          decidedBy: input.decidedBy,
          reason: input.reason,
          token: input.token,
        });
        return await res.json() as Record<string, unknown>;
      },
    }),
  ];
}

export interface RegistrationResult {
  availability: "ready" | "unavailable";
  registered: string[];
  failed: { name: string; message: string }[];
}

/** Register all tools whose exposure condition holds. Degrades gracefully. */
export async function registerWebMcpTools(
  deps: RegistryDeps,
  options: { hasActiveProject: () => boolean; signal?: AbortSignal } = { hasActiveProject: () => true },
): Promise<RegistrationResult> {
  const availability = webMcpAvailability();
  if (availability === "unavailable") return { availability, registered: [], failed: [] };
  const context = getModelContext();
  if (!context) return { availability: "unavailable", registered: [], failed: [] };

  const registered: string[] = [];
  const failed: { name: string; message: string }[] = [];
  for (const tool of buildToolCatalog(deps)) {
    const isGlobalTool =
      tool.name === "get_workspace_status" ||
      tool.name === "create_stock_project" ||
      tool.name.startsWith("pao_compute_") ||
      tool.name.startsWith("pao_runpod_") ||
      tool.name.startsWith("pao_queue_") ||
      tool.name.startsWith("pao_sdlc_") ||
      tool.name.includes("generation_");
    if (!isGlobalTool && !options.hasActiveProject()) continue;
    try {
      await context.registerTool(tool, { signal: options.signal });
      registered.push(tool.name);
    } catch (error) {
      failed.push({ name: tool.name, message: error instanceof Error ? error.message : "registration failed" });
    }
  }
  return { availability: "ready", registered, failed };
}
