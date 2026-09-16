// Phase 20.61 — Pao-owned WebMCP tools for the Agent Runtime control plane.
//
// Agents inspect and drive tasks through these tools; the service enforces
// the state machine, policy gateway, and payload-bound approvals server-side.
// Workers can never approve their own dangerous actions (spec §28).

import type { WebMcpToolDefinition } from "../video/mcp-tools";
import { getAgentRuntimeService } from "./service";

function service() {
  return getAgentRuntimeService();
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("missing required string argument: " + key);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export const AGENT_RUNTIME_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "agent_runtime_get_health",
    description: "Read the agent runtime (amux) health and compatibility state. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: async () => await service().runtimeHealth(),
  },
  {
    name: "agent_runtime_list_workers",
    description: "List registered workers with roles, capabilities, and status. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: () => ({ workers: service().listWorkers() }),
  },
  {
    name: "agent_runtime_list_tasks",
    description: "List agent tasks, optionally filtered by status. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ tasks: service().listTasks({ status: optionalString(args, "status") }) }),
  },
  {
    name: "agent_runtime_get_task",
    description: "Read one task with evidence, approvals, and sessions. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => service().getTask(requireString(args, "task_id")),
  },
  {
    name: "agent_runtime_create_task",
    description: "Create a bounded task specification with acceptance criteria. Mutating but non-executing.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) =>
      service().createTask({
        title: requireString(args, "title"),
        description: requireString(args, "description"),
        acceptanceCriteria: Array.isArray(args.acceptance_criteria) ? args.acceptance_criteria.map(String) : [],
        role: (optionalString(args, "role") ?? "implementer") as never,
        actorType: "agent",
        actorId: optionalString(args, "actor_id") ?? "agent",
      }),
  },
  {
    name: "agent_runtime_dispatch_task",
    description: "Queue, atomically claim, isolate a worktree for, and hand a task to the runtime. High-impact: gated by the dispatch feature flag and the execution gateway.",
    riskTier: "R3",
    readOnly: false,
    execute: async (args) =>
      await service().dispatchTask(requireString(args, "task_id"), { workerId: optionalString(args, "worker_id") }),
  },
  {
    name: "agent_runtime_record_evidence",
    description: "Attach evidence (diff, test report, review report…) to a task. Mutating but non-executing; secret-like material is rejected.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) =>
      service().addEvidence(requireString(args, "task_id"), {
        evidenceType: requireString(args, "evidence_type"),
        uri: optionalString(args, "uri") ?? null,
        content: optionalString(args, "content"),
        metadata: (args.metadata && typeof args.metadata === "object" ? args.metadata : {}) as Record<string, unknown>,
      }),
  },
  {
    name: "agent_runtime_verify_task",
    description: "Run independent verification of a task against its acceptance criteria. The verifier must differ from the implementer.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) =>
      service().verifyTask(requireString(args, "task_id"), {
        verifierWorkerId: requireString(args, "verifier_worker_id"),
        verifierRole: (optionalString(args, "verifier_role") ?? "reviewer") as never,
        verdict: (args.verdict && typeof args.verdict === "object" ? args.verdict : {}) as never,
      }),
  },
  {
    name: "agent_runtime_list_approvals",
    description: "List approval requests, optionally filtered by status. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ approvals: service().store.listApprovals({ status: optionalString(args, "status") }) }),
  },
  {
    name: "agent_runtime_decide_approval",
    description: "Approve or reject a pending request. High-impact: payload hash is re-verified; a changed payload invalidates the request.",
    riskTier: "R3",
    readOnly: false,
    execute: (args) =>
      service().decideApproval(requireString(args, "approval_id"), {
        decision: args.decision === "rejected" ? "rejected" : "approved",
        approverId: requireString(args, "approver_id"),
        reason: optionalString(args, "reason") ?? null,
        currentPayload: args.current_payload,
      }),
  },
  {
    name: "agent_runtime_cancel_task",
    description: "Cancel an active task. Mutating; cleans up the isolated worktree.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => service().cancelTask(requireString(args, "task_id"), { type: "agent", id: optionalString(args, "actor_id") ?? "agent" }),
  },
  {
    name: "agent_runtime_list_events",
    description: "Read the normalized runtime event feed for a task or globally. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ events: service().listEvents({ taskId: optionalString(args, "task_id"), limit: 100 }) }),
  },
];
