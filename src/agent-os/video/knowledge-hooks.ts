// Living Knowledge Brain Hooks for Pao AI Video Factory (Phase 20.7)
import { registerEntity } from "../brain/entities";
import { recordDecision } from "../brain/decisions";

export interface KnowledgeSyncResult {
  entitiesRegistered: number;
  decisionsRecorded: number;
  syncedAt: string;
}

/**
 * Registers Phase 20.7 entities and ADRs into Living Knowledge Brain (Phase 20.5)
 */
export function syncVideoFactoryKnowledge(): KnowledgeSyncResult {
  const syncedAt = new Date().toISOString();

  // 1. Register Canonical Entities
  const entities = [
    {
      id: "ent_pao_video_factory",
      canonicalName: "pao-video-factory",
      kind: "SYSTEM",
      description: "Central control plane for multi-provider AI video generation, routing, Cost Guard, and QC.",
      aliases: ["video-factory", "pao-video-orchestrator", "ai-video-factory"],
    },
    {
      id: "ent_moneyprinterturbo_adapter",
      canonicalName: "moneyprinterturbo-adapter",
      kind: "SYSTEM",
      description: "Additive MoneyPrinterTurbo video production engine and task bridge adapter.",
      aliases: ["moneyprinterturbo", "mpt-adapter", "mpt-engine"],
    },
    {
      id: "ent_metaso_minimax_h3_video",
      canonicalName: "metaso-minimax-h3-video",
      kind: "EXTERNAL_SERVICE",
      description: "Metaso MiniMax Hailuo 3 video generation engine provider for cinematic shots.",
      aliases: ["minimax-h3-video", "hailuo-3-video", "metaso-video"],
    },
    {
      id: "ent_seedance_video_provider",
      canonicalName: "seedance-video-provider",
      kind: "EXTERNAL_SERVICE",
      description: "ByteDance Volcano Engine Ark Seedance video generation adapter.",
      aliases: ["seedance", "volcano-engine-seedance", "ark-video"],
    },
    {
      id: "ent_ofox_wan_video_router",
      canonicalName: "ofox-wan-video-router",
      kind: "SYSTEM",
      description: "OFox and Wan open-source multi-model video generation router.",
      aliases: ["ofox-video", "wan-video", "wan-2-1"],
    },
  ];

  let entitiesRegistered = 0;
  for (const ent of entities) {
    try {
      registerEntity({
        id: ent.id,
        canonicalName: ent.canonicalName,
        kind: ent.kind,
        description: ent.description,
        aliases: ent.aliases,
      });
      entitiesRegistered++;
    } catch {
      // ignore individual registration errors
    }
  }

  // 2. Record ADRs
  const decisions = [
    {
      id: "adr-023-mpt-orchestrator",
      title: "ADR-023: Additive MoneyPrinterTurbo Video Factory Integration",
      decision: "Integrate MoneyPrinterTurbo as an additive first-class video production adapter while preserving Pao-hubPro 100% control plane ownership (routing, Cost Guard, QC, human approval).",
      rationale: "Ensures seamless adoption of MPT open-source batch pipeline without losing Pao-hubPro policy, security, cost guardrails, or Adobe Stock commercial gating.",
      alternatives: [
        "Full rewrite of video pipeline into MPT",
        "Direct iframe embed without backend orchestration",
      ],
      effectiveAt: syncedAt,
    },
    {
      id: "adr-024-adobe-stock-policy",
      title: "ADR-024: Adobe Stock Clean Footage & Human Review Gate",
      decision: "Enforce strict clean footage constraints (no voiceover, no subtitles, no music) for Adobe Stock mode, require mandatory human approval prior to export, and gate third-party stock redistribution rights.",
      rationale: "Prevents marketplace submission rejections, copyright violations, and unauthorized spending while guaranteeing high-resolution commercial stock compliance.",
      alternatives: [
        "Unattended automated publishing to Adobe Stock",
        "Permit mixed stock footage without redistribution verification",
      ],
      effectiveAt: syncedAt,
    },
  ];

  let decisionsRecorded = 0;
  for (const dec of decisions) {
    try {
      recordDecision({
        id: dec.id,
        title: dec.title,
        decision: dec.decision,
        rationale: dec.rationale,
        alternatives: dec.alternatives,
        effectiveAt: dec.effectiveAt,
      });
      decisionsRecorded++;
    } catch {
      // ignore individual decision errors
    }
  }

  return {
    entitiesRegistered,
    decisionsRecorded,
    syncedAt,
  };
}
