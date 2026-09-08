// Phase 20.12 — Browser Workflow Intelligence Management API Routes
//
// Endpoints mounted under /api/browser/workflows/* and /api/agent-os/browser/workflows/*
// Exposes workflow CRUD, execution, pause/resume/cancel, interactive recording,
// checkpoints, and task memory inspection.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { openAgentOsDb } from "../../agent-os/db";
import { getWorkflowDslParser } from "../../agent-os/browser/workflow/dsl-parser";
import { getWorkflowExecutor } from "../../agent-os/browser/workflow/executor";
import { getWorkflowRecorder } from "../../agent-os/browser/workflow/recorder";
import { getTaskMemoryManager } from "../../agent-os/browser/workflow/task-memory";
import type { WorkflowDefinition } from "../../agent-os/browser/workflow/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleWorkflowRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/browser/workflows/")) {
    path = url.pathname.slice("/api/browser/workflows/".length);
  } else if (url.pathname === "/api/browser/workflows") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/browser/workflows/")) {
    path = url.pathname.slice("/api/agent-os/browser/workflows/".length);
  } else if (url.pathname === "/api/agent-os/browser/workflows") {
    path = "";
  } else {
    return null;
  }

  const dslParser = getWorkflowDslParser();
  const executor = getWorkflowExecutor();
  const recorder = getWorkflowRecorder();
  const memoryManager = getTaskMemoryManager();
  const db = openAgentOsDb();

  // 1. GET /api/browser/workflows & POST /api/browser/workflows
  if (path === "") {
    if (req.method === "GET") {
      const tag = url.searchParams.get("tag");
      const rows = db.query("SELECT * FROM browser_workflows ORDER BY updated_at DESC").all() as Record<string, unknown>[];
      let workflows: WorkflowDefinition[] = rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        description: String(r.description),
        version: Number(r.version),
        steps: JSON.parse(String(r.dsl_json || "[]")),
        parameters: JSON.parse(String(r.parameters_schema_json || "{}")),
        tags: JSON.parse(String(r.tags_json || "[]")),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }));

      if (tag) {
        workflows = workflows.filter((w) => w.tags?.includes(tag));
      }
      return jsonResponse({ workflows }, 200, req, {});
    }

    if (req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      const wf = dslParser.parse(body);
      const now = Date.now();
      db.query(`
        INSERT INTO browser_workflows (id, name, description, version, dsl_json, parameters_schema_json, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          dsl_json = excluded.dsl_json,
          parameters_schema_json = excluded.parameters_schema_json,
          tags_json = excluded.tags_json,
          updated_at = excluded.updated_at
      `).run(
        wf.id,
        wf.name,
        wf.description,
        wf.version,
        JSON.stringify(wf.steps),
        JSON.stringify(wf.parameters || {}),
        JSON.stringify(wf.tags || []),
        wf.createdAt,
        now,
      );

      return jsonResponse({ success: true, workflow: wf }, 201, req, {});
    }
    return null;
  }

  // 2. RECORDING ROUTES
  // POST /api/browser/workflows/record/start
  if (path === "record/start" && req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const name = String(body?.name || "Recorded Workflow");
    const description = String(body?.description || "");
    const session = recorder.startRecording(name, description, {
      autoCheckpoint: body?.autoCheckpoint,
    });
    return jsonResponse({ success: true, session }, 200, req, {});
  }

  // POST /api/browser/workflows/record/action
  if (path === "record/action" && req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return badRequest(req, "Invalid JSON body");
    }

    if (!body?.action) return badRequest(req, "Missing 'action' parameter");
    try {
      const step = recorder.recordAction(body.action, body.arguments || {}, {
        name: body.name,
        isCheckpoint: body.isCheckpoint,
      });
      return jsonResponse({ success: true, step }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err.message);
    }
  }

  // POST /api/browser/workflows/record/stop
  if (path === "record/stop" && req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    try {
      const workflow = recorder.stopRecording(body);
      return jsonResponse({ success: true, workflow }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err.message);
    }
  }

  // GET /api/browser/workflows/record/status
  if (path === "record/status" && req.method === "GET") {
    return jsonResponse({
      recording: recorder.isRecording(),
      session: recorder.getActiveSession(),
      steps: recorder.getCurrentSteps(),
    }, 200, req, {});
  }

  // 3. TASK MEMORY ROUTES
  // GET & DELETE /api/browser/workflows/memory
  if (path === "memory") {
    if (req.method === "GET") {
      const domain = url.searchParams.get("domain") || undefined;
      const memories = memoryManager.listMemory(domain);
      return jsonResponse({ memories }, 200, req, {});
    }
    if (req.method === "DELETE") {
      const domain = url.searchParams.get("domain") || undefined;
      memoryManager.clearMemory(domain);
      return jsonResponse({ success: true, clearedDomain: domain || "all" }, 200, req, {});
    }
    return null;
  }

  // 4. RUNS LISTING & MANAGEMENT
  // GET /api/browser/workflows/runs
  if (path === "runs" && req.method === "GET") {
    const workflowId = url.searchParams.get("workflowId") || undefined;
    const runs = executor.listRuns(workflowId);
    return jsonResponse({ runs }, 200, req, {});
  }

  // GET /api/browser/workflows/runs/:runId
  const runGetMatch = /^runs\/([^/]+)$/.exec(path);
  if (runGetMatch && req.method === "GET") {
    const runId = runGetMatch[1];
    const run = executor.getRun(runId);
    if (!run) return notFound(req, `Run not found: ${runId}`);
    const stepLogs = executor.getStepLogs(runId);
    return jsonResponse({ run, stepLogs }, 200, req, {});
  }

  // POST /api/browser/workflows/runs/:runId/pause
  const runPauseMatch = /^runs\/([^/]+)\/pause$/.exec(path);
  if (runPauseMatch && req.method === "POST") {
    const runId = runPauseMatch[1];
    try {
      const run = await executor.pauseRun(runId);
      return jsonResponse({ success: true, run }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err.message);
    }
  }

  // POST /api/browser/workflows/runs/:runId/resume
  const runResumeMatch = /^runs\/([^/]+)\/resume$/.exec(path);
  if (runResumeMatch && req.method === "POST") {
    const runId = runResumeMatch[1];
    try {
      const run = await executor.resumeRun(runId);
      return jsonResponse({ success: true, run }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err.message);
    }
  }

  // POST /api/browser/workflows/runs/:runId/cancel
  const runCancelMatch = /^runs\/([^/]+)\/cancel$/.exec(path);
  if (runCancelMatch && req.method === "POST") {
    const runId = runCancelMatch[1];
    try {
      const run = await executor.cancelRun(runId);
      return jsonResponse({ success: true, run }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err.message);
    }
  }

  // 5. POST /api/browser/workflows/:id/run
  const runWfMatch = /^([^/]+)\/run$/.exec(path);
  if (runWfMatch && req.method === "POST") {
    const wfId = runWfMatch[1];
    const r = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(wfId) as Record<string, unknown> | null;
    if (!r) return notFound(req, `Workflow not found: ${wfId}`);

    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const workflow: WorkflowDefinition = {
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      version: Number(r.version),
      steps: JSON.parse(String(r.dsl_json || "[]")),
      parameters: JSON.parse(String(r.parameters_schema_json || "{}")),
      tags: JSON.parse(String(r.tags_json || "[]")),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };

    try {
      const run = await executor.runWorkflow(workflow, body?.variables || {}, {
        initiatingAgent: body?.initiatingAgent || "dashboard",
      });
      return jsonResponse({ success: true, run }, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ success: false, error: err.message }, 500, req, {});
    }
  }

  // 6. GET /api/browser/workflows/:id & DELETE /api/browser/workflows/:id
  const singleWfMatch = /^([^/]+)$/.exec(path);
  if (singleWfMatch) {
    const wfId = singleWfMatch[1];
    if (req.method === "GET") {
      const r = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(wfId) as Record<string, unknown> | null;
      if (!r) return notFound(req, `Workflow not found: ${wfId}`);
      const workflow: WorkflowDefinition = {
        id: String(r.id),
        name: String(r.name),
        description: String(r.description),
        version: Number(r.version),
        steps: JSON.parse(String(r.dsl_json || "[]")),
        parameters: JSON.parse(String(r.parameters_schema_json || "{}")),
        tags: JSON.parse(String(r.tags_json || "[]")),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      };
      return jsonResponse({ workflow }, 200, req, {});
    }

    if (req.method === "DELETE") {
      db.query("DELETE FROM browser_workflows WHERE id = ?").run(wfId);
      return jsonResponse({ success: true, id: wfId }, 200, req, {});
    }
  }

  return null;
}
