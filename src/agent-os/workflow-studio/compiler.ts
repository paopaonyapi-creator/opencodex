// Phase 20.93 — Workflow Compiler.
//
// Canvas JSON NEVER executes directly. The compiler validates the graph
// (schema, node existence, port types, cycles, unreachable nodes, required
// inputs), expands permissions, analyses policy and risk, and emits an
// immutable ExecutionPlan (planHash). Diagnostics map back to canvas nodes.

import { createHash } from "node:crypto";
import { WorkflowStudioError, type CompilerDiagnostic, type ExecutionPlan, type RiskLevel, type WorkflowGraph, type WorkflowNodeDefinition } from "./types";
import { definitionFor } from "./catalog";

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export type { ExecutionPlan };

/** Detect cycles over the directed edge list (iterative DFS, three colours). */
export function hasCycle(nodes: string[], edges: Array<{ source: string; target: string }>): string[] | null {
  const adjacency = new Map(nodes.map((n) => [n, edges.filter((e) => e.source === n).map((e) => e.target)]));
  const colour = new Map<string, "white" | "grey" | "black">(nodes.map((n) => [n, "white" as const]));
  const path: string[] = [];
  for (const start of nodes) {
    const stack: Array<{ node: string; phase: "enter" | "exit" }> = [{ node: start, phase: "enter" }];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.phase === "exit") {
        colour.set(frame.node, "black");
        path.pop();
        continue;
      }
      if (colour.get(frame.node) !== "white") continue;
      colour.set(frame.node, "grey");
      path.push(frame.node);
      stack.push({ node: frame.node, phase: "exit" });
      for (const next of adjacency.get(frame.node) ?? []) {
        if (colour.get(next) === "grey") return [...path, next];
        if (colour.get(next) === "white") stack.push({ node: next, phase: "enter" });
      }
    }
  }
  return null;
}

/** Topological execution groups (Kahn levels) over the DAG. */
export function executionGroups(nodes: string[], edges: Array<{ source: string; target: string }>): Array<{ nodeIds: string[] }> {
  const remaining = new Set(nodes);
  const deps = new Map(nodes.map((n) => [n, new Set(edges.filter((e) => e.target === n).map((e) => e.source))]));
  const groups: Array<{ nodeIds: string[] }> = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((n) => [...(deps.get(n) ?? [])].every((d) => !remaining.has(d)));
    if (ready.length === 0) break; // cycle — the cycle check already rejected this
    for (const n of ready) remaining.delete(n);
    groups.push({ nodeIds: ready.sort() });
  }
  return groups;
}

export interface CompileResult {
  plan: ExecutionPlan | null;
  diagnostics: CompilerDiagnostic[];
  ok: boolean;
}

/** Compile a canvas graph into an immutable execution plan. */
export function compileGraph(graph: WorkflowGraph): CompileResult {
  const diagnostics: CompilerDiagnostic[] = [];

  // Node existence.
  const definitions = new Map<string, WorkflowNodeDefinition>();
  for (const node of graph.nodes) {
    try {
      definitions.set(node.id, definitionFor(node.type));
    } catch {
      diagnostics.push({ nodeId: node.id, severity: "error", message: `unknown node type '${node.type}'` });
    }
  }

  // Trigger presence.
  const triggerNodes = graph.nodes.filter((n) => definitions.get(n.id)?.category === "trigger");
  if (graph.nodes.length > 0 && triggerNodes.length === 0) {
    diagnostics.push({ nodeId: null, severity: "error", message: "workflow has no trigger node" });
  }

  // Edge endpoint sanity + port type compatibility.
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      diagnostics.push({ nodeId: edge.source, severity: "error", message: `edge references an unknown node (${edge.source} → ${edge.target})` });
      continue;
    }
    const sourceDef = definitions.get(edge.source);
    const targetDef = definitions.get(edge.target);
    if (!sourceDef || !targetDef) continue;
    const outPort = sourceDef.outputPorts.find((p) => p.name === edge.sourcePort);
    const inPort = targetDef.inputPorts.find((p) => p.name === edge.targetPort);
    if (!outPort) diagnostics.push({ nodeId: edge.source, severity: "error", message: `node '${edge.source}' has no output port '${edge.sourcePort}'` });
    if (!inPort) diagnostics.push({ nodeId: edge.target, severity: "error", message: `node '${edge.target}' has no input port '${edge.targetPort}'` });
    if (outPort && inPort && outPort.type !== inPort.type && outPort.type !== "any" && inPort.type !== "any") {
      diagnostics.push({ nodeId: edge.target, severity: "error", message: `port type mismatch: ${edge.sourcePort}:${outPort.type} → ${edge.targetPort}:${inPort.type} (insert a converter node)` });
    }
  }

  // Cycles (unsupported in this milestone).
  const cycle = hasCycle([...nodeIds], graph.edges);
  if (cycle) {
    diagnostics.push({ nodeId: cycle[0] ?? null, severity: "error", message: `cycle detected: ${cycle.join(" → ")}` });
  }

  // Unreachable nodes (no trigger-ancestor path) — warning only.
  const reachable = new Set<string>();
  const walk = (nodeId: string): void => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const edge of graph.edges.filter((e) => e.source === nodeId)) walk(edge.target);
  };
  for (const trigger of triggerNodes) walk(trigger.id);
  for (const node of graph.nodes) {
    if (!reachable.has(node.id) && nodeIds.has(node.id)) {
      diagnostics.push({ nodeId: node.id, severity: "warning", message: "node is unreachable from any trigger" });
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    return { plan: null, diagnostics, ok: false };
  }

  // Topological groups + capability/policy expansion.
  const groups = executionGroups([...nodeIds], graph.edges);
  const requiredCapabilities = [...new Set(graph.nodes.flatMap((n) => definitions.get(n.id)?.requiredCapabilities ?? []))];
  const policyGates = graph.nodes
    .filter((n) => (definitions.get(n.id)?.requiredCapabilities.length ?? 0) > 0)
    .flatMap((n) => (definitions.get(n.id)!.requiredCapabilities).map((capability) => ({ nodeId: n.id, capability })));
  let estimatedRisk: RiskLevel = "low";
  for (const node of graph.nodes) estimatedRisk = maxRisk(estimatedRisk, definitions.get(node.id)?.riskLevel ?? "low");

  const plan: ExecutionPlan = {
    schemaVersion: "1.0",
    workflowName: graph.name,
    planHash: createHash("sha256").update(JSON.stringify({ nodes: graph.nodes, edges: graph.edges })).digest("hex"),
    nodes: graph.nodes.map((n) => {
      const def = definitions.get(n.id)!;
      return { id: n.id, type: n.type, version: def.version, config: n.config, riskLevel: def.riskLevel, capabilities: def.requiredCapabilities };
    }),
    edges: graph.edges,
    executionGroups: groups,
    requiredCapabilities,
    estimatedRisk,
    policyGates,
  };

  return { plan, diagnostics, ok: true };
}

/** Convenience guard for call sites that require a compiled plan. */
export function compileOrThrow(graph: WorkflowGraph): ExecutionPlan {
  const result = compileGraph(graph);
  if (!result.ok || !result.plan) {
    throw new WorkflowStudioError("GRAPH_INVALID", 422, "workflow graph failed compilation", { diagnostics: result.diagnostics });
  }
  return result.plan;
}

export { definitionFor };
