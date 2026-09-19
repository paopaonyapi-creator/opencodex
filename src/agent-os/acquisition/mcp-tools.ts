import { getAcquisitionGateway } from "./service";
import { inferIntent } from "./classify";
import { AcquisitionError, looksLikeSecretPayload } from "./types";

export interface AcquisitionMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function err(err: unknown): Record<string, unknown> {
  if (err instanceof AcquisitionError) return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message } };
  return { ok: false, status: 500, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
}

export function createAcquisitionMcpTools(): AcquisitionMcpTool[] {
  const gw = getAcquisitionGateway();
  return [
    {
      name: "pao.acquire",
      description: "Governed content acquisition. Agents must not pass cookies or secrets; use source URL + intent only.",
      riskTier: "R2",
      parameters: { type: "object", properties: { source: { type: "string" }, intent: { type: "string" }, ingestKnowledge: { type: "boolean" } }, required: ["source"] },
      handler: async (args) => {
        try {
          if (args.cookies || args.cookie || args.authorization || looksLikeSecretPayload(args)) {
            return { ok: false, error: { code: "SECRET_IN_REQUEST", message: "cookies/secrets are not allowed" } };
          }
          const source = String(args.source);
          const intent = (typeof args.intent === "string" ? args.intent : inferIntent(source)) as import("./types").AcquisitionIntent;
          const result = await gw.submit({
            actor: { type: "agent", id: "mcp" },
            source: { kind: "url", value: source },
            intent,
            options: { ingestKnowledge: args.ingestKnowledge === true, transcribe: intent === "research" || intent === "transcribe", summarize: intent === "research" },
            policyContext: { workspaceId: "default", purpose: "research" },
          }, "mcp");
          return { ok: true, job: result.job, plan: result.plan, policy: result.policy };
        } catch (e) { return err(e); }
      },
    },
    {
      name: "pao.acquire.status",
      description: "Inspect an acquisition job, artifacts, and events (secrets redacted).",
      riskTier: "R0",
      parameters: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
      handler: async (args) => {
        try { return { ok: true, ...gw.getJob(String(args.jobId)) }; } catch (e) { return err(e); }
      },
    },
    {
      name: "pao.acquire.health",
      description: "Acquisition adapter health (MCP/CLI/mock/legacy).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const health = await gw.health();
        return { ok: health.ok, phase: health.phase, adapters: health.adapters };
      },
    },
  ];
}
