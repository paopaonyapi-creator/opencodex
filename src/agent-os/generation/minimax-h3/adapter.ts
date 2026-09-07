// Phase 20.6 — MiniMax H3 Provider Adapter & ComfyUI API Graph Compiler.
//
// Converts high-level Pao H3 jobs into ComfyUI API JSON graphs.
// Handles multi-frame packets, reference injection (REF2VA), turbo adapters (FL2VA),
// and Qwen Image Edit 2511 detail refinement with Tone Lock.

import type { H3Job, H3Mode, ReferenceImageInput } from "./types";
import { ComfyUiClient } from "../comfyui-client";

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export interface CompiledGraphResult {
  workflowId: string;
  nodeCount: number;
  graph: Record<string, ComfyNode>;
  outputNodeId: string;
}

export class H3GraphCompiler {
  /**
   * Compiles an H3Job into a complete ComfyUI API JSON graph.
   */
  static compileJob(job: H3Job): CompiledGraphResult {
    switch (job.mode) {
      case "text_to_image":
      case "text_to_image_single":
        return this.compileT2I(job);
      case "image_to_image":
      case "image_to_image_single":
        return this.compileI2I(job);
      case "reference_edit":
      case "reference_edit_single":
        return this.compileReferenceEdit(job);
      case "detail_refiner":
        return this.compileDetailRefiner(job);
      default:
        return this.compileT2I(job);
    }
  }

  /**
   * MiniMax H3 Standard Text-to-Image graph.
   * Produces a multi-frame candidate packet (default 5 frames).
   */
  static compileT2I(job: H3Job): CompiledGraphResult {
    const graph: Record<string, ComfyNode> = {};
    const frames = job.frameProfile ?? 5;

    // Node 1: MiniMax H3 Model Loader
    graph["1"] = {
      class_type: "MiniMaxH3Loader",
      inputs: {
        model_name: "minimax_h3_diffusion.safetensors",
        text_encoder: "t5_text_encoder.safetensors",
        vae_name: frames > 1 ? "video_vae.safetensors" : "image_vae.safetensors",
        precision: "bf16",
      },
      _meta: { title: "MiniMax H3 Checkpoint Loader" },
    };

    // Node 2: Positive Prompt
    graph["2"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: job.prompt,
        clip: ["1", 1],
      },
      _meta: { title: "Positive Conditioning" },
    };

    // Node 3: Negative Prompt
    const negativeText = (job.metadata?.negativePrompt as string) ||
      "blurry, malformed hands, distorted eyes, text, watermark, low quality, artifacts, extra limbs";
    graph["3"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativeText,
        clip: ["1", 1],
      },
      _meta: { title: "Negative Conditioning" },
    };

    // Node 4: Empty Latent
    graph["4"] = {
      class_type: "EmptyVideoLatent",
      inputs: {
        width: job.width,
        height: job.height,
        length: frames,
        batch_size: 1,
      },
      _meta: { title: "H3 Empty Video Latent (Multi-Frame)" },
    };

    // Node 5: Sampler
    const steps = job.preset === "FAST" ? 20 : job.preset === "QUALITY" ? 35 : 28;
    const cfg = 6.5;
    graph["5"] = {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed: job.seed,
        steps,
        cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1.0,
      },
      _meta: { title: "H3 Flow Sampler" },
    };

    // Node 6: VAE Decode
    graph["6"] = {
      class_type: "VAEDecode",
      inputs: {
        samples: ["5", 0],
        vae: ["1", 2],
      },
      _meta: { title: "H3 VAE Decoder" },
    };

    // Node 7: Output Save / Batch Split
    graph["7"] = {
      class_type: "SaveImageBatch",
      inputs: {
        images: ["6", 0],
        filename_prefix: `pao_h3_t2i_${job.id}`,
      },
      _meta: { title: "Save Candidate Packet" },
    };

    return {
      workflowId: "H3_T2I",
      nodeCount: Object.keys(graph).length,
      graph,
      outputNodeId: "7",
    };
  }

  /**
   * MiniMax H3 Image-to-Image / Restyling graph.
   */
  static compileI2I(job: H3Job): CompiledGraphResult {
    const graph: Record<string, ComfyNode> = {};
    const frames = job.frameProfile ?? 5;
    const isTurbo = job.preset === "TURBO_FAST";

    // Node 1: Model Loader
    graph["1"] = {
      class_type: "MiniMaxH3Loader",
      inputs: {
        model_name: "minimax_h3_diffusion.safetensors",
        text_encoder: "t5_text_encoder.safetensors",
        vae_name: "video_vae.safetensors",
        precision: "bf16",
      },
      _meta: { title: "MiniMax H3 Checkpoint Loader" },
    };

    let activeModelNode: [string, number] = ["1", 0];

    // Node 2: Load Source Image
    graph["2"] = {
      class_type: "LoadImage",
      inputs: {
        image: job.sourceImagePath || "input/source_placeholder.png",
      },
      _meta: { title: "Source Image Input" },
    };

    // Optional Turbo LoRA (FL2VA Turbo)
    if (isTurbo) {
      graph["8"] = {
        class_type: "LoraLoader",
        inputs: {
          model: ["1", 0],
          clip: ["1", 1],
          lora_name: "fl2va_turbo_adapter.safetensors",
          strength_model: 1.0,
          strength_clip: 1.0,
        },
        _meta: { title: "FL2VA 8-Step Turbo Adapter" },
      };
      activeModelNode = ["8", 0];
    }

    // Node 3: VAE Encode Source Image
    graph["3"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["2", 0],
        vae: ["1", 2],
      },
      _meta: { title: "VAE Encode Source" },
    };

    // Node 4: Positive Conditioning
    graph["4"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: job.prompt,
        clip: isTurbo ? ["8", 1] : ["1", 1],
      },
      _meta: { title: "Positive Conditioning" },
    };

    // Node 5: Negative Conditioning
    graph["5"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: (job.metadata?.negativePrompt as string) || "blurry, low quality, artifacts, distortion",
        clip: isTurbo ? ["8", 1] : ["1", 1],
      },
      _meta: { title: "Negative Conditioning" },
    };

    // Node 6: Sampler with fidelity control (denoise)
    const steps = isTurbo ? 8 : 25;
    const fidelity = Number(job.metadata?.fidelity ?? 0.65);
    const denoise = Math.max(0.1, Math.min(1.0, 1.0 - fidelity * 0.5));

    graph["6"] = {
      class_type: "KSampler",
      inputs: {
        model: activeModelNode,
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["3", 0],
        seed: job.seed,
        steps,
        cfg: isTurbo ? 2.5 : 6.0,
        sampler_name: "euler",
        scheduler: "normal",
        denoise,
      },
      _meta: { title: "H3 I2I Flow Sampler" },
    };

    // Node 7: VAE Decode
    graph["7"] = {
      class_type: "VAEDecode",
      inputs: {
        samples: ["6", 0],
        vae: ["1", 2],
      },
      _meta: { title: "VAE Decode Result" },
    };

    // Output node
    graph["9"] = {
      class_type: "SaveImageBatch",
      inputs: {
        images: ["7", 0],
        filename_prefix: `pao_h3_i2i_${job.id}`,
      },
      _meta: { title: "Save Restyled Candidates" },
    };

    return {
      workflowId: isTurbo ? "H3_I2I_TURBO" : "H3_I2I",
      nodeCount: Object.keys(graph).length,
      graph,
      outputNodeId: "9",
    };
  }

  /**
   * MiniMax H3 Multi-Reference Editor (REF2VA) graph.
   * Injects identity, pose, outfit, and environment reference images.
   */
  static compileReferenceEdit(job: H3Job): CompiledGraphResult {
    const graph: Record<string, ComfyNode> = {};

    // Node 1: Model Loader
    graph["1"] = {
      class_type: "MiniMaxH3Loader",
      inputs: {
        model_name: "minimax_h3_diffusion.safetensors",
        text_encoder: "t5_text_encoder.safetensors",
        vae_name: "video_vae.safetensors",
        precision: "bf16",
      },
      _meta: { title: "MiniMax H3 Checkpoint Loader" },
    };

    // Node 2: REF2VA Adapter Loader
    graph["2"] = {
      class_type: "Ref2vaAdapterLoader",
      inputs: {
        model: ["1", 0],
        adapter_name: "ref2va_adapter.safetensors",
        weight: 0.85,
      },
      _meta: { title: "REF2VA Multi-Reference Adapter" },
    };

    // Reference Image inputs
    const refImages: ReferenceImageInput[] = job.referenceImages ?? [];
    const refNodeIds: string[] = [];

    refImages.forEach((ref, idx) => {
      const nodeId = `10${idx}`;
      graph[nodeId] = {
        class_type: "LoadImage",
        inputs: {
          image: ref.imagePath,
        },
        _meta: { title: `Ref Image [${ref.role}] (weight: ${ref.weight ?? 1.0})` },
      };
      refNodeIds.push(nodeId);
    });

    // Node 3: Reference Conditioning Combiner
    graph["3"] = {
      class_type: "Ref2vaConditioningApply",
      inputs: {
        adapter_model: ["2", 0],
        reference_images: refNodeIds.map((id) => [id, 0]),
        identity_weight: 0.9,
        pose_weight: 0.8,
        outfit_weight: 0.75,
      },
      _meta: { title: "Apply Multi-Reference Features" },
    };

    // Node 4: Prompt
    graph["4"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: job.prompt,
        clip: ["1", 1],
      },
      _meta: { title: "Positive Conditioning" },
    };

    // Node 5: Negative Prompt
    graph["5"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: (job.metadata?.negativePrompt as string) || "blurry, identity shift, anatomy distortion, watermark",
        clip: ["1", 1],
      },
      _meta: { title: "Negative Conditioning" },
    };

    // Node 6: Latent
    graph["6"] = {
      class_type: "EmptyVideoLatent",
      inputs: {
        width: job.width,
        height: job.height,
        length: job.frameProfile ?? 5,
        batch_size: 1,
      },
      _meta: { title: "Video Latent Buffer" },
    };

    // Node 7: Sampler
    graph["7"] = {
      class_type: "KSampler",
      inputs: {
        model: ["3", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: job.seed,
        steps: 30,
        cfg: 6.5,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1.0,
      },
      _meta: { title: "Reference Guided Sampler" },
    };

    // Node 8: VAE Decode
    graph["8"] = {
      class_type: "VAEDecode",
      inputs: {
        samples: ["7", 0],
        vae: ["1", 2],
      },
      _meta: { title: "Decode Output Frames" },
    };

    // Node 9: Save
    graph["9"] = {
      class_type: "SaveImageBatch",
      inputs: {
        images: ["8", 0],
        filename_prefix: `pao_h3_ref_${job.id}`,
      },
      _meta: { title: "Save Reference Edit Packet" },
    };

    return {
      workflowId: "H3_REFERENCE_EDIT",
      nodeCount: Object.keys(graph).length,
      graph,
      outputNodeId: "9",
    };
  }

  /**
   * Qwen Image Edit 2511 Detail Refinement & Detail Tone Lock graph.
   * Selectively refines anatomy, eyes, hands, edges, or texture.
   */
  static compileDetailRefiner(job: H3Job): CompiledGraphResult {
    const graph: Record<string, ComfyNode> = {};
    const sourceImage = job.sourceImagePath || job.outputImagePath || "input/candidate_selected.png";
    const defectTarget = (job.metadata?.defectTarget as string) || "hands, eyes, micro-texture";
    const refinePrompt = `clean up anatomy, perfect realistic details, pristine sharp focus on ${defectTarget}, no distortion`;

    // Node 1: Qwen Image Edit Checkpoint Loader
    graph["1"] = {
      class_type: "QwenImageEditLoader",
      inputs: {
        checkpoint: "qwen_image_edit_2511.safetensors",
        text_encoder: "qwen_text_encoder.safetensors",
        vae: "qwen_vae.safetensors",
      },
      _meta: { title: "Qwen Image Edit 2511 Stack" },
    };

    // Node 2: Input Candidate Image
    graph["2"] = {
      class_type: "LoadImage",
      inputs: {
        image: sourceImage,
      },
      _meta: { title: "Primary H3 Candidate Image" },
    };

    // Node 3: Defect Targeted Prompt Conditioning
    graph["3"] = {
      class_type: "QwenTextEncode",
      inputs: {
        prompt: refinePrompt,
        clip: ["1", 1],
      },
      _meta: { title: "Defect Repair Prompt" },
    };

    // Node 4: VAE Encode Source
    graph["4"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["2", 0],
        vae: ["1", 2],
      },
      _meta: { title: "Encode to Qwen Latent" },
    };

    // Node 5: Qwen Sampler (subtle denoise to preserve core likeness)
    graph["5"] = {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["3", 0],
        negative: ["3", 0], // Inpainting/repair conditioning
        latent_image: ["4", 0],
        seed: job.seed + 101,
        steps: 16,
        cfg: 4.5,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 0.35,
      },
      _meta: { title: "Qwen Detail Refiner Sampler" },
    };

    // Node 6: Decode Refined Image
    graph["6"] = {
      class_type: "VAEDecode",
      inputs: {
        samples: ["5", 0],
        vae: ["1", 2],
      },
      _meta: { title: "Decode Refined Pixels" },
    };

    // Node 7: Detail Tone Lock Node (locks color palette, exposure & contrast to primary H3)
    graph["7"] = {
      class_type: "DetailToneLockComposite",
      inputs: {
        source_image: ["2", 0],
        refined_image: ["6", 0],
        blend_mode: "luminance_match",
        chroma_lock: true,
        edge_feather: 0.15,
      },
      _meta: { title: "Pao Detail Tone Lock Composite" },
    };

    // Node 8: Save Final Master Asset
    graph["8"] = {
      class_type: "SaveImage",
      inputs: {
        images: ["7", 0],
        filename_prefix: `pao_qwen_refined_${job.id}`,
      },
      _meta: { title: "Save Tone-Locked Master Asset" },
    };

    return {
      workflowId: "H3_DETAIL_REFINER",
      nodeCount: Object.keys(graph).length,
      graph,
      outputNodeId: "8",
    };
  }

  /**
   * Validates compiled ComfyUI graph structure.
   */
  static validateGraph(graph: Record<string, ComfyNode>): { valid: boolean; nodeCount: number; errors: string[] } {
    const errors: string[] = [];
    const nodeIds = Object.keys(graph);

    if (nodeIds.length === 0) {
      errors.push("Graph contains no nodes");
      return { valid: false, nodeCount: 0, errors };
    }

    for (const [id, node] of Object.entries(graph)) {
      if (!node.class_type) {
        errors.push(`Node ${id} is missing class_type`);
      }
      if (!node.inputs || typeof node.inputs !== "object") {
        errors.push(`Node ${id} has invalid inputs`);
      }
    }

    return {
      valid: errors.length === 0,
      nodeCount: nodeIds.length,
      errors,
    };
  }
}

export class H3ProviderAdapter {
  private client?: ComfyUiClient;

  constructor(client?: ComfyUiClient) {
    this.client = client;
  }

  /**
   * Compiles the job into a ComfyUI graph.
   */
  compile(job: H3Job): CompiledGraphResult {
    return H3GraphCompiler.compileJob(job);
  }

  /**
   * Executes the job against the ComfyUI instance or performs a dry-run / simulation.
   */
  async execute(job: H3Job): Promise<{
    success: boolean;
    promptId?: string;
    outputFrames?: string[];
    error?: string;
  }> {
    const compiled = this.compile(job);
    const validation = H3GraphCompiler.validateGraph(compiled.graph);
    if (!validation.valid) {
      return {
        success: false,
        error: `Graph validation failed: ${validation.errors.join(", ")}`,
      };
    }

    if (this.client) {
      try {
        const result = await this.client.queuePrompt(compiled.graph as Record<string, unknown>);
        return {
          success: true,
          promptId: result.promptId,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Dry-run / mock simulation when ComfyUI is not directly hooked
    const frameCount = job.frameProfile ?? 5;
    const mockFrames: string[] = [];
    for (let i = 0; i < frameCount; i++) {
      mockFrames.push(`/artifacts/h3_renders/${job.id}_frame_${i}.webp`);
    }

    return {
      success: true,
      promptId: `mock_prompt_${job.id}`,
      outputFrames: mockFrames,
    };
  }
}
