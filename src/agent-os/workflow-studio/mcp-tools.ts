// Phase 20.93 — Workflow Studio MCP tools.

import type { WorkflowStudioService } from "./service";
import { getWorkflowRunEngine } from "./run-engine";
import { getNodeRegistry } from "./registry";
import { WorkflowStudioError } from "./types";

export interface WorkflowStudioMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function errToPayload(err: unknown): Record<string, unknown> {
  if (err instanceof WorkflowStudioError) {
    return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message, detail: err.detail } };
  }
  return { ok: false, status: 500, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
}

export function createWorkflowStudioMcpTools(service: WorkflowStudioService): WorkflowStudioMcpTool[] {
  const engine = getWorkflowRunEngine(service);
  return [
    {
      name: "workflow.health",
      description: "Workflow Studio health: registered node types with categories and risk levels (Phase 20.93).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const nodes = getNodeRegistry().list();
          return { ok: true, nodeTypes: nodes.length, nodes: nodes.map((n) => ({ type: n.type, title: n.title, category: n.category, riskLevel: n.riskLevel })) };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "workflow.list",
      description: "List persisted workflows with active versions.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          return { ok: true, workflows: service.listWorkflows() };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "workflow.validate",
      description: "Compile-validate a workflow graph without executing (schema, ports, cycles, policy).",
      riskTier: "R1",
      parameters: { type: "object", properties: { graph: { type: "object" } }, required: ["graph"] },
      handler: async (args) => {
        try {
          const result = service.validateGraph(args.graph);
          return { ok: result.ok, diagnostics: result.diagnostics };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "workflow.run",
      description: "Start and advance a run of a published workflow version (R2 — policy-gated at start).",
      riskTier: "R2",
      parameters: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] },
      handler: async (args) => {
        try {
          const start = engine.startRun(String(args.workflowId), "mcp", "mcp");
          const advanced = engine.advanceRun(start.runId, "mcp");
          return { ok: true, ...start, ...advanced };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "workflow.run.status",
      description: "Inspect a run: node states, events, artifacts, approvals.",
      riskTier: "R0",
      parameters: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      handler: async (args) => {
        try {
          const inspection = engine.inspectRun(String(args.runId));
          if (!inspection) return { ok: false, status: 404, error: { code: "RUN_NOT_FOUND", message: "run not found" } };
          return { ok: true, ...inspection };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "workflow.approval.decide",
      description: "Record a human decision (APPROVE/REJECT) on a pending workflow approval request (R3).",
      riskTier: "R3",
      parameters: { type: "object", properties: { approvalId: { type: "string" }, approve: { type: "boolean" }, note: { type: "string" } }, required: ["approvalId", "approve"] },
      handler: async (args) => {
        try {
          return { ok: true, ...(await Promise.resolve(engine.decideApproval(String(args.approvalId), args.approve === true, "mcp-operator", typeof args.note === "string" ? args.note : undefined))) };
        } catch (err) { return errToPayload(err); }
      },
    },
  ];
}
