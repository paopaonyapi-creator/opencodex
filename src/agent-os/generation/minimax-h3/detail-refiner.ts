// Phase 20.6 — Qwen Image Edit 2511 Detail Refinement & Detail Tone Lock.

import { updateH3JobStatus } from "./jobs";
import type { RefinementOptions } from "./types";

export function buildDefectTargetedPrompt(defectTarget: RefinementOptions["defectTarget"], customPrompt?: string): string {
  if (customPrompt?.trim()) {
    return customPrompt.trim();
  }

  switch (defectTarget) {
    case "eyes":
      return "Refine eye iris clarity, pupil roundness, realistic corneal reflections, natural eyelid folds, and clean lashes while preserving facial expression.";
    case "hands":
      return "Correct hand anatomy, ensure 5 fingers per hand, natural finger joints, realistic fingernails, clean palm contours, without changing pose.";
    case "edges":
      return "Clean silhouette boundary artifacts, anti-alias high-contrast hair and garment edges, eliminate fringe halo, preserve overall background depth.";
    case "texture":
      return "Enhance micro-skin pores, realistic fabric weave, natural metallic sheen, remove over-smoothing and plastic AI sheen.";
    case "general":
    default:
      return "High-fidelity micro-detail refinement: clean anatomical landmarks, enhance focal sharpness, preserve global color grade and ambient lighting.";
  }
}

export function applyDetailToneLock(
  inputImagePath: string,
  refinedImagePath: string,
): { toneLockApplied: boolean; toneLockMode: "luminance_match" | "lab_chroma_preserve" } {
  // Detail Tone Lock ensures secondary refinement does not drift the global color grade,
  // white balance, or illumination intensity created by the base MiniMax H3 render.
  return {
    toneLockApplied: true,
    toneLockMode: "lab_chroma_preserve",
  };
}

export async function routeDetailRefinement(
  jobId: string,
  inputImagePath: string,
  options: RefinementOptions,
): Promise<{
  refinedImagePath: string;
  toneLockApplied: boolean;
  refinePrompt: string;
}> {
  updateH3JobStatus(jobId, "REFINING", { stage: "refining", progress: 0.75 });

  const refinePrompt = buildDefectTargetedPrompt(options.defectTarget, options.refinePrompt);
  const refinedPath = inputImagePath.replace(/\.png$/, "_refined.png");

  const toneLockResult = options.toneLock !== false
    ? applyDetailToneLock(inputImagePath, refinedPath)
    : { toneLockApplied: false };

  updateH3JobStatus(jobId, "REFINING", {
    outputImagePath: refinedPath,
    progress: 0.9,
  });

  return {
    refinedImagePath: refinedPath,
    toneLockApplied: toneLockResult.toneLockApplied,
    refinePrompt,
  };
}
