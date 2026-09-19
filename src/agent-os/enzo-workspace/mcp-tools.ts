// Phase 20.94 — MCP tools for the unified workspace.

import { getEnzoWorkspaceService } from "./service";
import { EnzoWorkspaceError } from "./types";

export interface EnzoMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function errToPayload(err: unknown): Record<string, unknown> {
  if (err instanceof EnzoWorkspaceError) {
    return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message, detail: err.detail } };
  }
  return { ok: false, status: 500, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
}

export function createEnzoWorkspaceMcpTools(): EnzoMcpTool[] {
  const service = getEnzoWorkspaceService();
  return [
    {
      name: "enzo.health",
      description: "Phase 20.94 unified workspace health and ownership map.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true, ...(service.health()) }),
    },
    {
      name: "enzo.models",
      description: "List OmniRoute marketplace models.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try { return { ok: true, models: service.models() }; } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "enzo.run",
      description: "Create and execute a workspace run from natural language.",
      riskTier: "R2",
      parameters: { type: "object", properties: { request: { type: "string" }, mode: { type: "string" } }, required: ["request"] },
      handler: async (args) => {
        try {
          const inspection = await service.createAndRun({ request: String(args.request), mode: args.mode as never, actor: "mcp" });
          return { ok: true, run: inspection.run, artifacts: inspection.artifacts.length };
        } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "enzo.run.status",
      description: "Inspect a workspace run: events, artifacts, approvals, lessons.",
      riskTier: "R0",
      parameters: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      handler: async (args) => {
        try { return { ok: true, ...service.inspect(String(args.runId)) }; } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "enzo.skills.resolve",
      description: "Resolve the minimal skill set for a request.",
      riskTier: "R1",
      parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] },
      handler: async (args) => {
        try { return { ok: true, ...service.resolveSkills(String(args.request)) }; } catch (err) { return errToPayload(err); }
      },
    },
    {
      name: "acquire_content",
      description: "Governed content acquisition for workspace agents. Pass source + intent only — never cookies, OmniGet tokens, or raw secrets.",
      riskTier: "R2",
      parameters: { type: "object", properties: { source: { type: "string" }, intent: { type: "string" }, ingestKnowledge: { type: "boolean" } }, required: ["source"] },
      handler: async (args) => {
        try {
          if (args.cookies || args.cookie || args.authorization || args.omnigetToken) {
            return { ok: false, error: { code: "SECRET_IN_REQUEST", message: "cookies/secrets/OmniGet tokens are not allowed" } };
          }
          const { getAcquisitionGateway } = require("../acquisition/service") as typeof import("../acquisition/service");
          const { inferIntent } = require("../acquisition/classify") as typeof import("../acquisition/classify");
          const source = String(args.source);
          const intent = (typeof args.intent === "string" ? args.intent : inferIntent(source)) as import("../acquisition/types").AcquisitionIntent;
          const result = await getAcquisitionGateway().submit({
            actor: { type: "agent", id: "enzo" },
            source: { kind: "url", value: source },
            intent,
            options: { ingestKnowledge: args.ingestKnowledge === true, transcribe: intent === "research" || intent === "transcribe", summarize: intent === "research" },
            policyContext: { workspaceId: "default", purpose: "research" },
          }, "enzo");
          return { ok: true, job: result.job, plan: result.plan, policy: result.policy };
        } catch (err) { return errToPayload(err); }
      },
    },
  ];
}
