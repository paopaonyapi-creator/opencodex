// Phase 20.12 — Browser Workflow Intelligence MCP Tools
//
// Exposes canonical `browser.workflow.*` tools to Codex, Claude, ChatGPT,
// and subagents for workflow authoring, deterministic replay, recording, and task memory inspection.

import { openAgentOsDb } from "../../db";
import type { McpToolDefinition } from "../mcp-tools";
import { getWorkflowDslParser } from "./dsl-parser";
import { getWorkflowExecutor } from "./executor";
import { getWorkflowRecorder } from "./recorder";
import { getTaskMemoryManager } from "./task-memory";
import type { WorkflowDefinition } from "./types";

export function getWorkflowMcpTools(): McpToolDefinition[] {
  const dslParser = getWorkflowDslParser();
  const executor = getWorkflowExecutor();
  const recorder = getWorkflowRecorder();
  const memoryManager = getTaskMemoryManager();

  return [
    {
      name: "browser.workflow.create",
      description: "Creates and saves a reusable browser workflow definition.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          steps: { type: "array" },
          parameters: { type: "object" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "steps"],
      },
      handler: (args: any) => {
        const wf = dslParser.parse(args);
        const db = openAgentOsDb();
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
        return { success: true, workflow: wf };
      },
    },
    {
      name: "browser.workflow.list",
      description: "Lists all saved browser workflow definitions.",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string" },
        },
      },
      handler: (args: { tag?: string }) => {
        const db = openAgentOsDb();
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

        if (args?.tag) {
          workflows = workflows.filter((w) => w.tags?.includes(args.tag!));
        }
        return { workflows };
      },
    },
    {
      name: "browser.workflow.get",
      description: "Retrieves a saved browser workflow definition by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => {
        const db = openAgentOsDb();
        const r = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(args.id) as Record<string, unknown> | null;
        if (!r) throw new Error(`WORKFLOW_NOT_FOUND: ${args.id}`);

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
        return { workflow };
      },
    },
    {
      name: "browser.workflow.delete",
      description: "Deletes a saved browser workflow definition.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => {
        const db = openAgentOsDb();
        db.query("DELETE FROM browser_workflows WHERE id = ?").run(args.id);
        return { success: true, id: args.id };
      },
    },
    {
      name: "browser.workflow.run",
      description: "Executes a browser workflow definition with runtime variables.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string" },
          workflow: { type: "object" },
          variables: { type: "object" },
          initiatingAgent: { type: "string" },
        },
      },
      handler: async (args: {
        workflowId?: string;
        workflow?: any;
        variables?: Record<string, unknown>;
        initiatingAgent?: string;
      }) => {
        let wf: WorkflowDefinition;
        if (args.workflow) {
          wf = dslParser.parse(args.workflow);
        } else if (args.workflowId) {
          const db = openAgentOsDb();
          const r = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(args.workflowId) as Record<string, unknown> | null;
          if (!r) throw new Error(`WORKFLOW_NOT_FOUND: ${args.workflowId}`);
          wf = {
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
        } else {
          throw new Error("EITHER_WORKFLOW_ID_OR_WORKFLOW_OBJECT_REQUIRED");
        }

        const run = await executor.runWorkflow(wf, args.variables || {}, {
          initiatingAgent: args.initiatingAgent || "agent",
        });
        return { run };
      },
    },
    {
      name: "browser.workflow.status",
      description: "Gets the execution status, progress, checkpoints, and step logs for a workflow run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      handler: (args: { runId: string }) => {
        const run = executor.getRun(args.runId);
        if (!run) throw new Error(`RUN_NOT_FOUND: ${args.runId}`);
        const stepLogs = executor.getStepLogs(args.runId);
        return { run, stepLogs };
      },
    },
    {
      name: "browser.workflow.pause",
      description: "Pauses an actively running browser workflow.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      handler: async (args: { runId: string }) => {
        const run = await executor.pauseRun(args.runId);
        return { run };
      },
    },
    {
      name: "browser.workflow.resume",
      description: "Resumes a paused or failed workflow run from its latest checkpoint or next step.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      handler: async (args: { runId: string }) => {
        const run = await executor.resumeRun(args.runId);
        return { run };
      },
    },
    {
      name: "browser.workflow.cancel",
      description: "Cancels an active workflow run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      handler: async (args: { runId: string }) => {
        const run = await executor.cancelRun(args.runId);
        return { run };
      },
    },
    {
      name: "browser.workflow.record.start",
      description: "Starts an interactive browser workflow recording session.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          autoCheckpoint: { type: "boolean" },
        },
        required: ["name"],
      },
      handler: (args: { name: string; description?: string; autoCheckpoint?: boolean }) => {
        const session = recorder.startRecording(args.name, args.description, {
          autoCheckpoint: args.autoCheckpoint,
        });
        return { success: true, session };
      },
    },
    {
      name: "browser.workflow.record.action",
      description: "Records an action into the active recording session.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string" },
          arguments: { type: "object" },
          name: { type: "string" },
          isCheckpoint: { type: "boolean" },
        },
        required: ["action", "arguments"],
      },
      handler: (args: {
        action: string;
        arguments: Record<string, unknown>;
        name?: string;
        isCheckpoint?: boolean;
      }) => {
        const step = recorder.recordAction(args.action, args.arguments, {
          name: args.name,
          isCheckpoint: args.isCheckpoint,
        });
        return { success: true, step };
      },
    },
    {
      name: "browser.workflow.record.stop",
      description: "Stops the active recording session and returns the compiled workflow definition.",
      inputSchema: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
          parameters: { type: "object" },
        },
      },
      handler: (args: { tags?: string[]; parameters?: any }) => {
        const workflow = recorder.stopRecording(args);
        return { success: true, workflow };
      },
    },
    {
      name: "browser.workflow.memory.list",
      description: "Lists learned domain element signatures and task memories.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string" },
        },
      },
      handler: (args: { domain?: string }) => {
        const memories = memoryManager.listMemory(args?.domain);
        return { memories };
      },
    },
    {
      name: "browser.workflow.memory.clear",
      description: "Clears learned task memories for a domain or globally.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string" },
        },
      },
      handler: (args: { domain?: string }) => {
        memoryManager.clearMemory(args?.domain);
        return { success: true };
      },
    },
  ];
}
