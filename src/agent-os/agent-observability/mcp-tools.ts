// Phase 20.40 — Read-only MCP observability tools (spec §29). All tools are
// R0/R1 read-only: snapshots, session detail, timelines, health, integrity
// verification. NO execution/control tools exist in this phase — no kill,
// no restart, no send_prompt, no run_command (spec non-goals).

import { getObservabilityEngine } from "./engine";
import type { WebMcpToolDefinition } from "../video/mcp-tools";

function limitOf(args: Record<string, unknown>, fallback: number): number {
  return typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : fallback;
}

export const AGENT_OBSERVABILITY_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "agent_list",
    description: "List observed agent sessions with runtime, activity/health states and confidence (read-only).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const engine = getObservabilityEngine();
      const snapshot = await engine.snapshot();
      return snapshot.sessions
        .filter((session) => (typeof args.runtime === "string" ? session.runtime === args.runtime : true))
        .filter((session) => (typeof args.health === "string" ? session.healthState === args.health : true))
        .slice(0, limitOf(args, 50));
    },
  },
  {
    name: "agent_health",
    description: "Health states + confidence + evidence summary for one session (read-only).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const engine = getObservabilityEngine();
      const snapshot = await engine.snapshot();
      const session = snapshot.sessions.find((candidate) => candidate.id === args.sessionId);
      if (!session) return { error: "session not observed" };
      return {
        sessionId: session.id,
        activityState: session.activityState,
        processState: session.processState,
        executionState: session.executionState,
        healthState: session.healthState,
        confidence: session.confidence,
        confidenceFactors: session.confidenceFactors,
        evidence: session.evidence,
        errors: session.errors,
      };
    },
  },
  {
    name: "agent_activity",
    description: "Activity states across the observed fleet (read-only).",
    riskTier: "R0", readOnly: true,
    execute: async (args) => {
      const engine = getObservabilityEngine();
      const snapshot = await engine.snapshot();
      const wanted = typeof args.activity === "string" ? args.activity : null;
      return snapshot.sessions
        .filter((session) => (wanted ? session.activityState === wanted : true))
        .map((session) => ({ sessionId: session.id, runtime: session.runtime, activityState: session.activityState, lastRecordedEventAt: session.lastRecordedEventAt, lastFileModifiedAt: session.lastFileModifiedAt, observedAt: session.observedAt }));
    },
  },
  {
    name: "agent_timeline",
    description: "Unified bounded timeline of normalized agent events with filters (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const engine = getObservabilityEngine();
      return engine.timeline({
        sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
        runtime: typeof args.runtime === "string" ? args.runtime : undefined,
        kinds: Array.isArray(args.kinds) ? (args.kinds as string[]) : undefined,
        limit: limitOf(args, 50),
      });
    },
  },
  {
    name: "agent_session",
    description: "Full session inspector payload: states, evidence, recent events, integrity (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const engine = getObservabilityEngine();
      return engine.sessionDetail(String(args.sessionId ?? ""));
    },
  },
  {
    name: "agent_process",
    description: "Process evidence for a session (advisory; absence is never 'stopped') (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const engine = getObservabilityEngine();
      const sessionId = String(args.sessionId ?? "");
      const detail = engine.sessionDetail(sessionId);
      if (!detail) return { error: "session not observed" };
      return { sessionId, processState: detail.session.processState, processIds: detail.session.processIds, note: "missing PID evidence means not_observed, never stopped" };
    },
  },
  {
    name: "agent_stalled",
    description: "Sessions meeting the configured stalled evidence rule (read-only).",
    riskTier: "R0", readOnly: true,
    execute: async () => {
      const engine = getObservabilityEngine();
      const snapshot = await engine.snapshot();
      return snapshot.sessions.filter((session) => session.healthState === "stalled");
    },
  },
  {
    name: "agent_errors",
    description: "Sessions with observation errors or explicit failures (read-only).",
    riskTier: "R0", readOnly: true,
    execute: async () => {
      const engine = getObservabilityEngine();
      const snapshot = await engine.snapshot();
      return snapshot.sessions
        .filter((session) => session.errors.length > 0 || session.healthState === "error" || session.executionState === "failed")
        .map((session) => ({ sessionId: session.id, runtime: session.runtime, healthState: session.healthState, errors: session.errors }));
    },
  },
  {
    name: "agent_tool_calls",
    description: "Recent tool_call / tool_result events (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const engine = getObservabilityEngine();
      return engine.timeline({ kinds: ["tool_call", "tool_result"], sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined, limit: limitOf(args, 50) });
    },
  },
  {
    name: "agent_artifacts",
    description: "Artifact-like session outputs (patch/result events) for a session (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const engine = getObservabilityEngine();
      return engine.timeline({ kinds: ["session_end"], sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined, limit: limitOf(args, 20) });
    },
  },
  {
    name: "observability_snapshot",
    description: "Full fleet snapshot with scan metrics and summary counts (read-only).",
    riskTier: "R0", readOnly: true,
    execute: async () => {
      const engine = getObservabilityEngine();
      return engine.snapshot();
    },
  },
  {
    name: "observability_events",
    description: "Recent normalized events across all adapters (read-only).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const engine = getObservabilityEngine();
      return engine.timeline({ limit: limitOf(args, 50) });
    },
  },
  {
    name: "observability_stats",
    description: "Internal observability metrics (scan/cache/alert counters) (read-only).",
    riskTier: "R0", readOnly: true,
    execute: () => getObservabilityEngine().statsSnapshot(),
  },
  {
    name: "observability_verify_session",
    description: "On-demand SHA-256 integrity verification of a REGISTERED session source (read-only toward the source; caches by revision; force bypasses cache).",
    riskTier: "R1", readOnly: true,
    execute: async (args) => {
      const engine = getObservabilityEngine();
      return engine.verifySessionIntegrity(String(args.sessionId ?? ""), args.force === true);
    },
  },
];
