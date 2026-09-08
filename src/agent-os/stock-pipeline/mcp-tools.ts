// End-to-End Autonomous Stock Production & Submission Pipeline — Canonical MCP Tools
//
// Exposes tools under the `stock.pipeline.*` namespace:
// - stock.pipeline.run: Start end-to-end pipeline run
// - stock.pipeline.create: Create a new pipeline run
// - stock.pipeline.get: Inspect run progress & stage outputs
// - stock.pipeline.list: List past and active pipeline runs
// - stock.pipeline.step: Manually advance or re-run a pipeline stage
// - stock.pipeline.finalize: Submit approval/rejection decision for Stage 7
// - stock.pipeline.cancel: Terminate an active pipeline run

import { getStockPipelineEngine } from "./pipeline-engine";
import type { PipelineStatus, StartPipelineInput } from "./types";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const STOCK_PIPELINE_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "stock.pipeline.run",
    description:
      "Starts an end-to-end autonomous stock production pipeline run: Trend Discovery -> Campaign Planning -> Generation -> QC -> CSV Manifest -> Browser Mission -> Approval Gate.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Market search query or concept topic" },
        market: { type: "string", description: "Target market region (e.g. US, Global)", default: "US" },
        targetAssetCount: { type: "number", description: "Target portfolio asset count (e.g. 10 or 20)", default: 10 },
        autoDispatchGen: { type: "boolean", description: "Automatically dispatch jobs into GPU queue", default: true },
        skipBrowserUpload: { type: "boolean", description: "Skip browser web upload stage", default: false },
        targetDomain: { type: "string", description: "Target stock platform domain", default: "stock.adobe.com" },
      },
      required: ["query"],
    },
  },
  {
    name: "stock.pipeline.create",
    description: "Creates an initial pipeline run in pending state without automatically advancing stages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Market query or niche" },
        market: { type: "string", default: "US" },
        targetAssetCount: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "stock.pipeline.get",
    description: "Fetches detailed status, stage outputs, and summaries for a specific pipeline run.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Pipeline run ID" },
      },
      required: ["runId"],
    },
  },
  {
    name: "stock.pipeline.list",
    description: "Lists past and active autonomous stock pipeline runs.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status (e.g. pending, rendering, waiting_approval, completed, failed)",
        },
        limit: { type: "number", description: "Maximum runs to return", default: 50 },
      },
    },
  },
  {
    name: "stock.pipeline.step",
    description:
      "Explicitly executes a specific stage of an autonomous pipeline run: 1 (trends), 2 (plan), 3 (generate), 4 (qc), 5 (manifest), 6 (browser).",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Pipeline run ID" },
        stage: { type: "number", description: "Stage number to run (1 to 6)" },
        targetDomain: { type: "string", description: "Optional target domain for stage 6", default: "stock.adobe.com" },
      },
      required: ["runId", "stage"],
    },
  },
  {
    name: "stock.pipeline.finalize",
    description:
      "Finalizes Stage 7 submission by approving or rejecting the pending Human Supervisor Gate.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Pipeline run ID" },
        decision: { type: "string", enum: ["approve", "reject"], description: "Decision to approve or reject submission" },
        reason: { type: "string", description: "Optional rationale or rejection reason" },
      },
      required: ["runId", "decision"],
    },
  },
  {
    name: "stock.pipeline.cancel",
    description: "Cancels an active or waiting pipeline run.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Pipeline run ID to cancel" },
        reason: { type: "string", description: "Cancellation reason" },
      },
      required: ["runId"],
    },
  },
];

export async function executeStockPipelineMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const engine = getStockPipelineEngine();

  switch (toolName) {
    case "stock.pipeline.run": {
      const input: StartPipelineInput = {
        query: String(args.query || ""),
        market: args.market ? String(args.market) : "US",
        targetAssetCount: typeof args.targetAssetCount === "number" ? args.targetAssetCount : 10,
        autoDispatchGen: args.autoDispatchGen !== false,
        skipBrowserUpload: Boolean(args.skipBrowserUpload),
        targetDomain: args.targetDomain ? String(args.targetDomain) : "stock.adobe.com",
      };
      const run = await engine.runFullPipeline(input);
      return { ok: true, run };
    }

    case "stock.pipeline.create": {
      const input: StartPipelineInput = {
        query: String(args.query || ""),
        market: args.market ? String(args.market) : "US",
        targetAssetCount: typeof args.targetAssetCount === "number" ? args.targetAssetCount : 10,
      };
      const run = engine.createPipelineRun(input);
      return { ok: true, run };
    }

    case "stock.pipeline.get": {
      const runId = String(args.runId || "");
      const run = engine.getPipelineRun(runId);
      if (!run) return { ok: false, error: `Pipeline run '${runId}' not found` };
      return { ok: true, run };
    }

    case "stock.pipeline.list": {
      const filter = {
        status: args.status ? (String(args.status) as PipelineStatus) : undefined,
        limit: typeof args.limit === "number" ? args.limit : 50,
      };
      const runs = engine.listPipelineRuns(filter);
      return { ok: true, count: runs.length, runs };
    }

    case "stock.pipeline.step": {
      const runId = String(args.runId || "");
      const stage = Number(args.stage || 1);

      switch (stage) {
        case 1:
          return { ok: true, ...(await engine.stepTrends(runId)) };
        case 2:
          return { ok: true, ...engine.stepPlanCampaign(runId) };
        case 3:
          return { ok: true, ...engine.stepDispatchGeneration(runId) };
        case 4:
          return { ok: true, ...engine.stepRunQc(runId) };
        case 5:
          return { ok: true, ...engine.stepPackageManifest(runId) };
        case 6:
          return {
            ok: true,
            ...(await engine.stepPrepareBrowserMission(
              runId,
              args.targetDomain ? String(args.targetDomain) : "stock.adobe.com",
            )),
          };
        default:
          return { ok: false, error: `Invalid stage number '${stage}'. Must be 1 to 6.` };
      }
    }

    case "stock.pipeline.finalize": {
      const runId = String(args.runId || "");
      const decision = String(args.decision || "approve") as "approve" | "reject";
      const reason = args.reason ? String(args.reason) : undefined;
      const res = engine.stepFinalizeSubmission(runId, decision, reason);
      return { ok: true, ...res };
    }

    case "stock.pipeline.cancel": {
      const runId = String(args.runId || "");
      const reason = args.reason ? String(args.reason) : "Cancelled by operator";
      const run = engine.getPipelineRun(runId);
      if (!run) return { ok: false, error: `Pipeline run '${runId}' not found` };

      // If waiting approval, reject it
      if (run.approvalId && run.status === "waiting_approval") {
        engine.stepFinalizeSubmission(runId, "reject", reason);
      }
      return { ok: true, run: engine.getPipelineRun(runId) };
    }

    default:
      throw new Error(`Unknown stock pipeline tool: ${toolName}`);
  }
}
