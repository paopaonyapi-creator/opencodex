// Phase 20.6 — WebMCP Tools Definitions for MiniMax H3 Image Studio.
//
// Exposes 21 standard, type-safe agentic tools for workflow selection, preset configuration,
// job management, candidate selection, Qwen detail refinement, Adobe Stock QC, provenance,
// and Knowledge Brain synchronization.

import { listWorkflows, getWorkflow } from "./workflows";
import { listPresets, resolvePreset } from "./presets";
import { listModels, getModel, validateModelStack } from "./models";
import { canRunInStockMode, evaluateLicensePolicy } from "./license-policy";
import {
  createH3Job,
  getH3Job,
  listH3Jobs,
  updateH3JobStatus,
  cancelH3Job,
  estimateH3Job,
} from "./jobs";
import {
  getCandidates,
  selectCandidate,
  generateCandidatePacket,
} from "./candidate-selector";
import { routeDetailRefinement, buildDefectTargetedPrompt } from "./detail-refiner";
import { evaluateStockQC, getStockQC } from "./stock-qc";
import { recordProvenance, getProvenance, exportAssetPackage } from "./provenance";
import {
  syncH3RunToKnowledgeBrain,
  getH3KnownIssues,
  recordH3ArchitectureDecision,
} from "./knowledge-hooks";
import { H3ProviderAdapter } from "./adapter";
import type {
  H3Mode,
  H3Preset,
  H3JobInput,
  RefinementOptions,
  ReferenceRole,
} from "./types";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const H3_MCP_TOOLS: WebMcpToolDefinition[] = [
  // 1. Workflows
  {
    name: "h3_list_workflows",
    description: "List available MiniMax H3 generation and refinement workflows (T2I, I2I, Reference Edit, Refiner).",
    riskTier: "R0",
    readOnly: true,
    execute: (args) =>
      listWorkflows({
        mode: args.mode as H3Mode,
        stockSafeOnly: Boolean(args.stockSafeOnly),
      }),
  },

  // 2. Presets
  {
    name: "h3_list_presets",
    description: "List preset configurations (QUALITY, BALANCED, FAST, TURBO_FAST, REFERENCE_EDIT, DETAIL_REFINE, STOCK_SAFE).",
    riskTier: "R0",
    readOnly: true,
    execute: (args) =>
      listPresets({
        mode: args.mode as H3Mode,
        stockSafeOnly: Boolean(args.stockSafeOnly),
      }),
  },

  // 3. Models
  {
    name: "h3_list_models",
    description: "List catalog of MiniMax H3, FL2VA, REF2VA, and Qwen models, licenses, and installation status.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) =>
      listModels({
        category: args.category as string,
        stockOnly: Boolean(args.stockOnly),
      }),
  },

  // 4. Validate Stack
  {
    name: "h3_validate_stack",
    description: "Validate model stack readiness and license policy permissions for a workflow or preset.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      let keys: string[] = [];
      if (Array.isArray(args.modelKeys)) {
        keys = args.modelKeys as string[];
      } else {
        const wfId = String(args.workflowId || "H3_T2I");
        const wf = getWorkflow(wfId);
        keys = wf?.modelStack ?? ["minimax_h3_diffusion", "t5_text_encoder", "video_vae"];
      }
      return validateModelStack(keys);
    },
  },

  // 5. Create Job
  {
    name: "h3_create_job",
    description: "Create a new MiniMax H3 generation job (T2I, I2I, Reference Edit, or Detail Refine) with structured prompts.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const input = args as unknown as H3JobInput;
      return createH3Job(input);
    },
  },

  // 6. Estimate Job
  {
    name: "h3_estimate_job",
    description: "Estimate execution duration, VRAM requirement, and target node (local vs remote) for a proposed job configuration.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const input = args as unknown as H3JobInput;
      return estimateH3Job(input);
    },
  },

  // 7. Run Job
  {
    name: "h3_run_job",
    description: "Execute a queued job through model verification, ComfyUI graph generation, candidate extraction, and QC.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const jobId = String(args.jobId);
      const job = getH3Job(jobId);
      if (!job) throw new Error(`Job ${jobId} not found.`);

      // License gate
      if (job.stockMode) {
        const check = canRunInStockMode(job.mode === "reference_edit" ? "H3_REFERENCE_EDIT" : "H3_T2I");
        if (!check.allowed) {
          updateH3JobStatus(jobId, "BLOCKED_LICENSE", { errorMessage: check.reason });
          return { success: false, status: "BLOCKED_LICENSE", error: check.reason };
        }
      }

      // Update to running
      updateH3JobStatus(jobId, "RUNNING", { stage: "generating", progress: 0.3 });

      // Adapter execution
      const adapter = new H3ProviderAdapter();
      const execResult = await adapter.execute(job);
      if (!execResult.success) {
        updateH3JobStatus(jobId, "FAILED", { errorMessage: execResult.error });
        return { success: false, status: "FAILED", error: execResult.error };
      }

      // Candidate packet extraction
      const candidates = generateCandidatePacket(job.id, job.frameProfile ?? 5);
      const recommended = candidates.find((c) => c.isRecommended) ?? candidates[0];

      let outputImagePath = recommended.imagePath;

      // Optional conditional detail refinement
      if (job.detailRefine) {
        const refineResult = await routeDetailRefinement(job.id, outputImagePath, {
          defectTarget: "general",
          toneLock: true,
        });
        outputImagePath = refineResult.refinedImagePath;
      }

      // QC evaluation
      if (job.stockMode) {
        evaluateStockQC(job.id);
      }

      // Provenance record
      recordProvenance({
        jobId: job.id,
        assetPath: outputImagePath,
      });

      const finalStatus = job.stockMode ? "REVIEW_REQUIRED" : "COMPLETED";
      const updated = updateH3JobStatus(job.id, finalStatus, {
        stage: job.stockMode ? "review_required" : "selecting_output",
        progress: 1.0,
        selectedCandidateIndex: recommended.candidateIndex,
        outputImagePath,
      });

      return {
        success: true,
        job: updated,
        candidates,
        outputImagePath,
      };
    },
  },

  // 8. Get Job
  {
    name: "h3_get_job",
    description: "Get the current status, stage, progress, and output candidates of an H3 job.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const jobId = String(args.jobId);
      const job = getH3Job(jobId);
      if (!job) return null;
      const candidates = getCandidates(jobId);
      const qc = getStockQC(jobId);
      const provenance = getProvenance(jobId);
      return { job, candidates, qc, provenance };
    },
  },

  // 9. Cancel Job
  {
    name: "h3_cancel_job",
    description: "Cancel a queued or currently executing H3 generation job.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => cancelH3Job(String(args.jobId), args.reason as string),
  },

  // 10. Shortcut: Submit Reference Edit
  {
    name: "h3_submit_reference_edit",
    description: "Create and immediately execute a multi-reference editing job with identity/pose/outfit roles.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const prompt = String(args.prompt);
      const references = (args.referenceImages as Array<{ role: ReferenceRole; imagePath: string }>) || [];
      const job = createH3Job({
        mode: "reference_edit",
        preset: "REFERENCE_EDIT",
        prompt,
        referenceImages: references,
        detailRefine: Boolean(args.detailRefine),
        stockMode: Boolean(args.stockMode),
      });
      return H3_MCP_TOOLS.find((t) => t.name === "h3_run_job")!.execute({ jobId: job.id });
    },
  },

  // 11. Shortcut: Submit I2I
  {
    name: "h3_submit_i2i",
    description: "Create and immediately execute an image-to-image restyling job.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const prompt = String(args.prompt);
      const sourceImagePath = String(args.sourceImagePath);
      const isTurbo = Boolean(args.turbo);
      const job = createH3Job({
        mode: "image_to_image",
        preset: isTurbo ? "TURBO_FAST" : "BALANCED",
        prompt,
        sourceImagePath,
        detailRefine: Boolean(args.detailRefine),
        stockMode: Boolean(args.stockMode),
      });
      return H3_MCP_TOOLS.find((t) => t.name === "h3_run_job")!.execute({ jobId: job.id });
    },
  },

  // 12. Shortcut: Submit T2I
  {
    name: "h3_submit_t2i",
    description: "Create and immediately execute a text-to-image job producing a candidate frame packet.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const prompt = String(args.prompt);
      const preset = (args.preset as H3Preset) || "BALANCED";
      const job = createH3Job({
        mode: "text_to_image",
        preset,
        prompt,
        detailRefine: Boolean(args.detailRefine),
        stockMode: Boolean(args.stockMode),
      });
      return H3_MCP_TOOLS.find((t) => t.name === "h3_run_job")!.execute({ jobId: job.id });
    },
  },

  // 13. Submit Detail Refine
  {
    name: "h3_submit_detail_refine",
    description: "Submit Qwen Image Edit 2511 conditional refinement with Detail Tone Lock.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const jobId = String(args.jobId);
      const inputImagePath = String(args.inputImagePath);
      const options = (args.options as RefinementOptions) || { defectTarget: "general" };
      return routeDetailRefinement(jobId, inputImagePath, options);
    },
  },

  // 14. Get Candidates
  {
    name: "h3_get_candidates",
    description: "Retrieve all candidate frames and diagnostic visual scores for an H3 job packet.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getCandidates(String(args.jobId)),
  },

  // 15. Select Candidate
  {
    name: "h3_select_candidate",
    description: "Select a specific candidate frame from the multi-frame packet as primary output.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => selectCandidate(String(args.jobId), Number(args.candidateIndex)),
  },

  // 16. Send To Refine
  {
    name: "h3_send_to_refine",
    description: "Send selected candidate image to Qwen Image Edit 2511 for defect-targeted cleanup.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const jobId = String(args.jobId);
      const job = getH3Job(jobId);
      if (!job) throw new Error(`Job ${jobId} not found.`);
      const imagePath = job.outputImagePath || (args.imagePath as string);
      if (!imagePath) throw new Error("No image available to refine.");

      const options: RefinementOptions = {
        defectTarget: (args.defectTarget as RefinementOptions["defectTarget"]) || "general",
        refinePrompt: args.refinePrompt as string,
        toneLock: args.toneLock !== false,
      };
      return routeDetailRefinement(jobId, imagePath, options);
    },
  },

  // 17. Run Stock QC
  {
    name: "h3_run_stock_qc",
    description: "Run automated Adobe Stock QC checks (license, logos, text, anatomy, IP).",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      return evaluateStockQC(String(args.jobId), {
        logoCheckPassed: args.logoCheckPassed as boolean,
        textCheckPassed: args.textCheckPassed as boolean,
        anatomyCheckPassed: args.anatomyCheckPassed as boolean,
        ipCheckPassed: args.ipCheckPassed as boolean,
        reviewerNotes: args.reviewerNotes as string,
        reviewedBy: args.reviewedBy as string,
      });
    },
  },

  // 18. Get Provenance
  {
    name: "h3_get_provenance",
    description: "Retrieve the immutable provenance ledger record for an H3 generation asset.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getProvenance(String(args.jobId || args.assetPath)),
  },

  // 19. Export Asset
  {
    name: "h3_export_asset",
    description: "Export the final asset package with provenance metadata, enforcing stock sign-off if in stock mode.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => exportAssetPackage(String(args.jobId)),
  },

  // 20. Get Known Issues
  {
    name: "h3_get_known_issues",
    description: "Get known issues, prompt syntax gotchas, and troubleshooting notes for MiniMax H3.",
    riskTier: "R0",
    readOnly: true,
    execute: () => getH3KnownIssues(),
  },

  // 21. Sync Knowledge
  {
    name: "h3_sync_knowledge",
    description: "Sync H3 recipes, benchmark claims, and troubleshooting notes into Phase 20.5 Living Knowledge Brain.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const jobId = args.jobId ? String(args.jobId) : undefined;
      recordH3ArchitectureDecision();
      if (jobId) {
        return syncH3RunToKnowledgeBrain(jobId);
      }
      return { synced: true, message: "H3 architecture decision and base entities recorded in Knowledge Brain." };
    },
  },
];
