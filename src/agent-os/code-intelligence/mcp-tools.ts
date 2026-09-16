// Phase 20.62 — Pao-owned MCP Context Gateway tools (spec §13-§14).
//
// Raw Graft MCP is never exposed to agents. These Pao-owned tools
// authenticate through the service, resolve scope, enforce path policy,
// normalize/redact output, emit audit metadata, and return evidence IDs.
// Repository-derived content is labeled as data in constraint text.

import type { WebMcpToolDefinition } from "../video/mcp-tools";
import { getCodeIntelService } from "./service";

function service() {
  return getCodeIntelService();
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("missing required string argument: " + key);
  }
  return value;
}

function pathScope(args: Record<string, unknown>): string[] {
  return Array.isArray(args.pathScope) ? args.pathScope.map(String) : [];
}

export const CODE_INTEL_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "pao_repo_map",
    description: "Repository map with clusters and hotspots for an authorized repository. Read-only; falls back with reduced confidence when the graph provider is unavailable.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const outcome = await service().repositoryMap(requireString(args, "repositoryId"), { actorId: "agent" });
      return { ...outcome.result, evidenceId: outcome.evidence?.id ?? null, reducedConfidence: outcome.reducedConfidence };
    },
  },
  {
    name: "pao_find_code",
    description: "Locate code relevant to a question within the authorized scope. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const outcome = await service().findCode(requireString(args, "repositoryId"), {
        question: requireString(args, "question"), pathScope: pathScope(args), actorId: "agent",
      });
      return { results: outcome.result, evidenceId: outcome.evidence?.id ?? null, reducedConfidence: outcome.reducedConfidence };
    },
  },
  {
    name: "pao_file_api",
    description: "Skeleton/API surface of one file (signatures only, no bodies). Read-only; scope-enforced.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const outcome = await service().fileApi(requireString(args, "repositoryId"), { file: requireString(args, "file"), actorId: "agent" });
      return { ...outcome.result, evidenceId: outcome.evidence.id };
    },
  },
  {
    name: "pao_find_all",
    description: "Exhaustive regex find grouped by occurrence, scope-enforced. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const outcome = await service().findAll(requireString(args, "repositoryId"), { pattern: requireString(args, "pattern"), pathScope: pathScope(args), actorId: "agent" });
      return { occurrences: outcome.result, evidenceId: outcome.evidence?.id ?? null, reducedConfidence: outcome.reducedConfidence };
    },
  },
  {
    name: "pao_trace_dependencies",
    description: "Trace callers/dependencies of a symbol with a policy-capped depth. Read-only.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const outcome = await service().traceCalls(requireString(args, "repositoryId"), {
        symbol: requireString(args, "symbol"),
        direction: args.direction === "out" ? "out" : "in",
        depth: typeof args.depth === "number" ? args.depth : 2,
        actorId: "agent",
      });
      return { ...outcome.result, evidenceId: outcome.evidence.id };
    },
  },
  {
    name: "pao_check_code_context",
    description: "Graph freshness check for a repository. Read-only; stale state is always surfaced, never hidden.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const outcome = await service().checkFreshness(requireString(args, "repositoryId"));
      return { state: outcome.state, drift: outcome.drift, graphState: outcome.repository.graphState };
    },
  },
  {
    name: "pao_get_impact_report",
    description: "Pre-edit blast-radius impact report with risk score, policy decision, and affected tests. Read-only over persisted reports.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => ({ report: service().store.getImpactReport(requireString(args, "reportId")) }),
  },
  {
    name: "pao_create_impact_report",
    description: "Run the Pre-Edit Impact Gate for a target file/symbol: dependency trace, protected-area signals, freshness, risk score, and policy decision. Mutating (persists a report) but never edits code.",
    riskTier: "R1",
    readOnly: false,
    execute: async (args) =>
      await service().createImpactReport(requireString(args, "repositoryId"), {
        targetRef: requireString(args, "targetRef"),
        targetType: args.targetType === "symbol" || args.targetType === "path" ? args.targetType : undefined,
        direction: args.direction === "out" ? "out" : "in",
        depth: typeof args.depth === "number" ? args.depth : undefined,
        actorId: "agent",
        taskId: typeof args.taskId === "string" ? args.taskId : null,
        worktreePath: typeof args.worktreePath === "string" ? args.worktreePath : null,
      }),
  },
];
