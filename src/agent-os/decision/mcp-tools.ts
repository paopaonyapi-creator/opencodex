// Phase 20.84 — Decision Intelligence MCP Tools
// (spec §18; autonomous GOLD productionization).
//
// Exposes typed decision contracts to agents using the shared handler
// convention (R0 read-only evaluation; contract-mode mutation is deliberately
// NOT exposed here — operators use the management API instead).

import { getDecisionEngine } from "./engine";
import { describeJevIntegration, validateJevReadiness } from "./provider-mode";
import type { DecisionRequest } from "./types";

export interface DecisionMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createDecisionMcpTools(): DecisionMcpTool[] {
  const engine = getDecisionEngine();

  return [
    {
      name: "pao.decision.contracts",
      description: "List versioned decision contracts, risk tiers, and threshold profiles (Phase 20.84).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const contracts = engine.contracts.list();
        return {
          ok: true,
          count: contracts.length,
          contracts: contracts.map((c) => ({
            id: c.id,
            version: c.version,
            category: c.category,
            riskTier: c.riskTier,
            thresholdProfile: c.thresholdProfile,
            allowedChoices: c.allowedChoices,
            humanApprovalBypass: c.humanApprovalBypass,
          })),
        };
      },
    },
    {
      name: "pao.decision.evaluate",
      description:
        "Evaluate a typed decision contract (agent.route, mcp.tool.risk, shell.command.risk, code.diff.review_depth, model.escalation). " +
        "Returns a calibrated disposition (allow/review/deny/abstain) after 10-stage policy fusion. Probabilistic output is advisory; deterministic policy is authoritative.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: {
          contractId: { type: "string", enum: ["agent.route", "mcp.tool.risk", "shell.command.risk", "code.diff.review_depth", "model.escalation"] },
          state: { type: "object", description: "Contract-specific decision state (redacted before persistence)" },
          requestId: { type: "string", description: "Optional caller-supplied request id" },
        },
        required: ["contractId"],
      },
      handler: async (args) => {
        const contractId = String(args.contractId);
        const state = args.state && typeof args.state === "object" ? args.state : {};
        const requestId = typeof args.requestId === "string" && args.requestId
          ? args.requestId.slice(0, 64)
          : `mcp_${Date.now().toString(36)}`;

        const request: DecisionRequest = {
          requestId,
          contractId,
          state,
          traceId: "mcp_tools",
        };

        const result = await engine.evaluate(request);
        return {
          ok: true,
          requestId: result.requestId,
          contractId: result.contractId,
          contractVersion: result.contractVersion,
          provider: result.provider,
          selected: result.selected,
          disposition: result.disposition,
          confidence: result.confidence,
          latencyMs: result.latencyMs,
          policy: result.policy,
          calibration: result.calibration,
        };
      },
    },
    {
      name: "pao.decision.jev-status",
      description:
        "Report the TypeSafe Jev integration state (Phase 20.84/20.82): active provider mode, staged activation checks " +
        "(mode → credential → schema → transport), real availability, and the exact next action to go live. " +
        "Read-only; never exposes the credential (last-4 hint at most).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({
        ...validateJevReadiness(),
        describe: describeJevIntegration(),
      }),
    },
  ];
}
