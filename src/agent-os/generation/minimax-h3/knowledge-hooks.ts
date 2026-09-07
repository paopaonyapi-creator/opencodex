// Phase 20.6 — Living Knowledge Brain Integration & Feedback Loop.

import { openAgentOsDb } from "../../db";
import { createClaim } from "../../brain/claims";
import { registerEntity } from "../../brain/entities";
import { recordDecision } from "../../brain/decisions";
import { getH3Job } from "./jobs";
import { getProvenance } from "./provenance";

export function ensureH3KnowledgeEntities(): { h3EntityId: string; qwenEntityId: string } {
  const h3 = registerEntity({
    canonicalName: "MiniMax H3 Image Studio",
    slug: "minimax-h3",
    kind: "SUBSYSTEM",
    description: "Production image generation engine with multi-frame packet sampling and reference editing.",
  });

  const qwen = registerEntity({
    canonicalName: "Qwen Image Edit 2511 Refiner",
    slug: "qwen-image-edit-2511",
    kind: "SUBSYSTEM",
    description: "Second-pass detail refiner for anatomical corrections, edge cleanup, and tone locking.",
  });

  return {
    h3EntityId: h3.id,
    qwenEntityId: qwen.id,
  };
}

export function syncH3RunToKnowledgeBrain(jobId: string): {
  synced: boolean;
  claimsCreated: number;
} {
  const job = getH3Job(jobId);
  if (!job) return { synced: false, claimsCreated: 0 };

  const { h3EntityId } = ensureH3KnowledgeEntities();
  let claimsCreated = 0;

  // Record active capability claim
  createClaim({
    subjectEntityId: h3EntityId,
    predicate: `tested_recipe_${job.mode}`,
    objectValue: `Preset ${job.preset} at ${job.width}x${job.height} resolution (${job.frameProfile} frames).`,
    claimType: "CAPABILITY",
    status: "ACTIVE",
    sourcePriority: 8,
  });
  claimsCreated++;

  if (job.stockMode) {
    createClaim({
      subjectEntityId: h3EntityId,
      predicate: "stock_mode_verified",
      objectValue: `Job ${job.id} passed Adobe Stock compliance gates with approved model stack.`,
      claimType: "STATUS",
      status: "ACTIVE",
      sourcePriority: 9,
    });
    claimsCreated++;
  }

  // Update provenance record
  const db = openAgentOsDb();
  db.query("UPDATE h3_provenance SET knowledge_sync_status = 'SYNCED' WHERE job_id = ?").run(jobId);

  return {
    synced: true,
    claimsCreated,
  };
}

export function getH3KnownIssues(): Array<{ topic: string; severity: string; resolution: string }> {
  return [
    {
      topic: "FL2VA vs REF2VA Turbo Adapter Mismatch",
      severity: "HIGH",
      resolution: "Do not mix FL2VA adapters with REF2VA multi-reference workflows. Adapter families must match sampling profile.",
    },
    {
      topic: "Overprocessing in Detail Refinement",
      severity: "MEDIUM",
      resolution: "Do not run Qwen Image Edit unconditionally on clean renders. Restrict to specific defects with Detail Tone Lock enabled.",
    },
    {
      topic: "Community Checkpoint License (CC-BY-NC) in Adobe Stock Mode",
      severity: "CRITICAL",
      resolution: "Community experimental 1-frame adapters with CC-BY-NC licenses are blocked from Adobe Stock Mode. Use official Apache-2.0 H3 stack.",
    },
  ];
}

export function recordH3ArchitectureDecision(): void {
  recordDecision({
    title: "ADR-2026-10: MiniMax H3 Image Studio & Qwen Detail Refiner Adoption",
    decision: "Adopt MiniMax H3 as primary production image engine and Qwen Image Edit 2511 as second-pass detail refiner.",
    rationaleSummary: "Provides controllable multi-reference editing, 5-frame packet stability, and stock-safe license governance.",
    effectiveAt: new Date().toISOString(),
    sourceRefs: ["docs/PHASE_20_6_PAO_MINIMAX_H3_IMAGE_STUDIO_REFERENCE_EDIT_QWEN_DETAIL_REFINER.md"],
  });
}
