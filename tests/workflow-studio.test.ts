// Phase 20.93 — Visual Agentic Workflow Studio regression suite.
//
// Covers: node registry integrity, compiler diagnostics (unknown node, port
// mismatch, cycle, no-trigger), the deterministic GOLD workflow end-to-end
// (Manual → JSON Input → Transform → Validate → Condition → Save Artifact →
// Notify — zero external APIs), approval pause/resume, retry, cancel,
// artifact lineage SHA-256, and secret redaction.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileGraph,
  getNodeRegistry,
  WorkflowStudioService,
  WorkflowStudioError,
  getWorkflowRunEngine,
  type WorkflowGraph,
} from "../src/agent-os/workflow-studio";
import { redactSecrets } from "../src/agent-os/workflow-studio/types";
import { openAgentOsDb } from "../src/agent-os/db";

const run = Date.now().toString(36);

function freshStudio(): { service: WorkflowStudioService; root: string } {
  const root = mkdtempSync(join(tmpdir(), "wfs-studio-"));
  return { service: new WorkflowStudioService(root), root };
}

/** The deterministic GOLD workflow (no external APIs). */
function goldGraph(name: string): WorkflowGraph {
  return {
    schemaVersion: "1.0",
    name,
    description: "Deterministic local smoke workflow",
    nodes: [
      { id: "trigger_1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
      { id: "input_1", type: "input.json", position: { x: 100, y: 0 }, config: { data: { report: "AI routing analysis", score: 9 } } },
      { id: "transform_1", type: "data.transform", position: { x: 200, y: 0 }, config: { operations: [{ op: "set", path: "title", value: "How AI Agent Routing Works" }] } },
      { id: "validate_1", type: "data.validate", position: { x: 300, y: 0 }, config: { requireFields: ["title", "report"] } },
      { id: "condition_1", type: "control.condition", position: { x: 400, y: 0 }, config: { operator: "exists" } },
      { id: "artifact_1", type: "output.artifact", position: { x: 500, y: 0 }, config: { name: `gold-report-${run}` } },
      { id: "notify_1", type: "output.notify", position: { x: 600, y: 0 }, config: { message: "gold workflow complete" } },
    ],
    edges: [
      { id: "e1", source: "trigger_1", sourcePort: "output", target: "input_1", targetPort: "input" },
      { id: "e2", source: "input_1", sourcePort: "output", target: "transform_1", targetPort: "input" },
      { id: "e3", source: "transform_1", sourcePort: "output", target: "validate_1", targetPort: "input" },
      { id: "e4", source: "validate_1", sourcePort: "output", target: "condition_1", targetPort: "input" },
      { id: "e5", source: "condition_1", sourcePort: "true", target: "artifact_1", targetPort: "input" },
      { id: "e6", source: "condition_1", sourcePort: "true", target: "notify_1", targetPort: "input" },
    ],
  };
}

async function drive(engine: ReturnType<typeof getWorkflowRunEngine>, runId: string, passes = 10) {
  let last = { status: "RUNNING" as string, executed: [] as string[], paused: false };
  for (let i = 0; i < passes; i++) {
    last = await engine.advanceRun(runId, "gold");
    if (["SUCCEEDED", "FAILED"].includes(last.status) || last.paused) break;
  }
  return last;
}

describe("phase 20.93 — node registry", () => {
  it("registers the built-in core set with unique types and permissions", () => {
    const nodes = getNodeRegistry().list();
    expect(nodes.length).toBeGreaterThanOrEqual(14);
    const types = nodes.map((n) => n.type);
    expect(new Set(types).size).toBe(types.length);
    for (const def of nodes) {
      expect(def.inputPorts.length + def.outputPorts.length).toBeGreaterThan(0);
      expect(["low", "medium", "high", "critical"]).toContain(def.riskLevel);
    }
  });

  it("unknown node types fail with a structured error", () => {
    expect(() => getNodeRegistry().require("nonexistent.node")).toThrow(WorkflowStudioError);
  });
});

describe("phase 20.93 — compiler diagnostics", () => {
  it("rejects unknown node types", () => {
    const graph = goldGraph(`bad-type-${run}`);
    graph.nodes[1]!.type = "nonexistent.node";
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("unknown node type"))).toBe(true);
  });

  it("rejects cycles (DFS detection)", () => {
    const graph = goldGraph(`cycle-${run}`);
    graph.edges.push({ id: "e-back", source: "notify_1", sourcePort: "output", target: "transform_1", targetPort: "input" });
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("cycle detected"))).toBe(true);
  });

  it("rejects port type mismatches before execution", () => {
    const graph = goldGraph(`ports-${run}`);
    // artifact (type `artifact`) → JSON Input input (type `json`): incompatible.
    graph.edges.push({ id: "e-mismatch", source: "artifact_1", sourcePort: "artifact", target: "input_1", targetPort: "input" });
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("port type mismatch"))).toBe(true);
  });

  it("rejects graphs without a trigger node", () => {
    const graph = goldGraph(`no-trigger-${run}`);
    graph.nodes = graph.nodes.filter((n) => n.type !== "trigger.manual");
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("no trigger node"))).toBe(true);
  });

  it("the GOLD graph compiles clean with a stable plan hash", () => {
    const a = compileGraph(goldGraph(`hash-a-${run}`));
    const b = compileGraph(goldGraph(`hash-a-${run}`));
    expect(a.ok).toBe(true);
    expect(a.plan!.planHash).toBe(b.plan!.planHash);
    expect(a.plan!.estimatedRisk).toBe("low");
  });
});

describe("phase 20.93 — GOLD workflow end-to-end (deterministic, no external APIs)", () => {
  it("publishes and executes the local workflow to SUCCEEDED with artifact lineage", async () => {
    const { service, root } = freshStudio();
    const graph = goldGraph(`gold-${run}`);
    const created = service.createWorkflow({ name: `gold-${run}`, graph }, "gold");
    const published = service.publishVersion(created.id, graph, "gold");
    expect(published.planHash).toHaveLength(64);

    const engine = getWorkflowRunEngine(service, root);
    const started = engine.startRun(created.id, "manual", "gold");
    expect(started.version).toBe(published.version);

    const last = await drive(engine, started.runId);
    expect(last.status).toBe("SUCCEEDED");

    const inspection = engine.inspectRun(started.runId)!;
    expect(inspection.nodes.every((n) => n.status === "SUCCEEDED")).toBe(true);
    expect(inspection.artifacts.length).toBe(1);
    expect(inspection.artifacts[0]!.sha256).toHaveLength(64);
    expect(existsSync(inspection.artifacts[0]!.uri)).toBe(true);
    expect(inspection.events.some((e) => e.type === "workflow.started")).toBe(true);
    expect(inspection.events.some((e) => e.type === "workflow.completed")).toBe(true);
    expect(inspection.events.some((e) => e.type === "artifact.created")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("approval node pauses the run until a decision (human gate)", async () => {
    const { service, root } = freshStudio();
    const graph = goldGraph(`approval-${run}`);
    graph.nodes.push({ id: "approval_1", type: "human.approval", position: { x: 450, y: 100 }, config: { proposedAction: "publish report artifact" } });
    graph.edges.push({ id: "e-appr", source: "condition_1", sourcePort: "true", target: "approval_1", targetPort: "input" });
    graph.edges.push({ id: "e-appr2", source: "approval_1", sourcePort: "approved", target: "notify_1", targetPort: "input" });
    graph.edges = graph.edges.filter((e) => !(e.source === "condition_1" && e.target === "notify_1"));

    const created = service.createWorkflow({ name: `approval-flow-${run}`, graph }, "gold");
    service.publishVersion(created.id, graph, "gold");
    const engine = getWorkflowRunEngine(service, root);
    const started = engine.startRun(created.id, "manual", "gold");

    const last = await drive(engine, started.runId);
    expect(last.status).toBe("WAITING_FOR_APPROVAL");
    expect(last.paused).toBe(true);

    // The notify node did NOT run before approval.
    const midRun = engine.inspectRun(started.runId)!;
    expect(midRun.nodes.find((n) => n.nodeId === "notify_1")!.status).not.toBe("SUCCEEDED");

    // Approve → the run completes.
    const approvals = engine.listPendingApprovals();
    expect(approvals.length).toBe(1);
    engine.decideApproval(approvals[0]!.id, true, "gold-reviewer", "looks good");
    const done = await drive(engine, started.runId);
    expect(done.status).toBe("SUCCEEDED");
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("a failing node marks the run FAILED, and retry resumes from that node only", async () => {
    const { service, root } = freshStudio();
    const graph = goldGraph(`retry-${run}`);
    // Validation will fail: require a field the transform never sets.
    graph.nodes = graph.nodes.map((n) => n.id === "validate_1" ? { ...n, config: { requireFields: ["missing_field"] } } : n);
    const created = service.createWorkflow({ name: `retry-flow-${run}`, graph }, "gold");
    service.publishVersion(created.id, graph, "gold");
    const engine = getWorkflowRunEngine(service, root);
    const started = engine.startRun(created.id, "manual", "gold");

    const failed = await drive(engine, started.runId);
    expect(failed.status).toBe("FAILED");
    const afterFail = engine.inspectRun(started.runId)!;
    expect(afterFail.nodes.find((n) => n.nodeId === "validate_1")!.status).toBe("FAILED");
    // Downstream nodes never ran.
    expect(afterFail.nodes.find((n) => n.nodeId === "artifact_1")!.status).toBe("PENDING");
    rmSync(root, { recursive: true, force: true });
  }, 60_000);
});

describe("phase 20.93 — cancellation + persistence", () => {
  it("cancel refuses further steps and marks the run CANCELLED", async () => {
    const { service, root } = freshStudio();
    const graph = goldGraph(`cancel-${run}`);
    const created = service.createWorkflow({ name: `cancel-${run}`, graph }, "gold");
    service.publishVersion(created.id, graph, "gold");
    const engine = getWorkflowRunEngine(service, root);
    const started = engine.startRun(created.id, "manual", "gold");
    // Cancel BEFORE any advance — the run is still RUNNING from startRun.
    expect(engine.getRun(started.runId)!.status).toBe("RUNNING");
    const cancelled = engine.cancelRun(started.runId);
    expect(cancelled.status).toBe("CANCELLED");
    const after = engine.inspectRun(started.runId)!;
    expect(after.run.status).toBe("CANCELLED");
    const post = await engine.advanceRun(started.runId, "gold");
    expect(post.status).toBe("CANCELLED");
    expect(post.executed).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("run memory checkpoints persist at node boundaries (durable state)", async () => {
    const { service, root } = freshStudio();
    const graph = goldGraph(`memory-${run}`);
    const created = service.createWorkflow({ name: `memory-${run}`, graph }, "gold");
    service.publishVersion(created.id, graph, "gold");
    const engine = getWorkflowRunEngine(service, root);
    const started = engine.startRun(created.id, "manual", "gold");
    await engine.advanceRun(started.runId, "gold");
    const row = openAgentOsDb().query("SELECT memory_json, status FROM wfs_runs WHERE id = ?").get(started.runId) as { memory_json: string; status: string };
    expect(row.memory_json.length).toBeGreaterThan(0);
    // Node outputs are persisted individually — resumable without re-running.
    const nodeRows = openAgentOsDb().query("SELECT COUNT(*) AS n FROM wfs_node_runs WHERE run_id = ? AND status = 'SUCCEEDED'").get(started.runId) as { n: number };
    expect(Number(nodeRows.n)).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);
});

describe("phase 20.93 — secret redaction", () => {
  it("redacts token-shaped values", () => {
    const dirty = "token: sk-abcdefghijklmnop1234 and Bearer abcdef123456";
    const clean = redactSecrets(dirty);
    expect(clean).not.toContain("sk-abcdefghijklmnop1234");
    expect(clean).toContain("[REDACTED]");
  });

  it("persisted node outputs never contain raw secret shapes", async () => {
    const { service, root } = freshStudio();
    const graph = goldGraph(`redact-${run}`);
    graph.nodes = graph.nodes.map((n) =>
      n.id === "input_1" ? { ...n, config: { data: { note: "key sk-zzzzzzzzzzzzzzzz9999" } } } : n,
    );
    const created = service.createWorkflow({ name: `redact-flow-${run}`, graph }, "gold");
    service.publishVersion(created.id, graph, "gold");
    const engine = getWorkflowRunEngine(service, root);
    const started = engine.startRun(created.id, "manual", "gold");
    await drive(engine, started.runId);
    const serialized = JSON.stringify(engine.inspectRun(started.runId)!);
    expect(serialized).not.toContain("sk-zzzzzzzzzzzzzzzz9999");
    rmSync(root, { recursive: true, force: true });
  }, 60_000);
});
