// Phase 20.89 — Canonical phase lock (user decision 2026-09-18, /goal mission §0).
//
// This table is the authoritative phase_id ↔ blueprint mapping for the
// Capability Hub importer. It exists to eliminate the phase-number collisions
// discovered during blueprinting:
//   - 20.65 was claimed by both Context Mode and Litho/deepwiki-rs
//     → canonical: 20.65 = Context Mode, 20.65.1 = Litho/deepwiki-rs
//   - 20.88 was claimed by both Remotion and Forge
//     → canonical: 20.88 = Remotion, 20.90 = Forge
//   - 20.91 is RESERVED for Business Opportunity / Revenue Intelligence.
//
// The importer resolves every blueprint through this table; H1/filename
// parsing is only a fallback. A canonical ID may be claimed by exactly one
// blueprint (regression-tested).

import type { CanonicalPhase, CapabilityType } from "./types";

const t = (v: CapabilityType) => v;

/** Canonical assignments — order matters only for documentation. */
export const CANONICAL_PHASES: readonly CanonicalPhase[] = [
  { phaseId: "20.61", title: "Pao-hubPro × amux", type: t("runtime-adapter"), blueprintFile: "Phase 20.61 — Pao-hubPro × amux.md" },
  { phaseId: "20.62", title: "Pao-hubPro × Graft", type: t("api"), blueprintFile: "Phase 20.62 — Pao-hubPro × Graft.md" },
  { phaseId: "20.63", title: "Pao-hubPro × Public APIs", type: t("data-source"), blueprintFile: "Phase 20.63 — Pao-hubPro × Public APIs.md" },
  { phaseId: "20.64", title: "Pao-hubPro × Vercel vgpu", type: t("runtime-adapter"), blueprintFile: "Phase 20.64 — Pao-hubPro × Vercel vgpu.md" },
  { phaseId: "20.65", title: "Pao-hubPro × Context Mode", type: t("runtime-adapter"), blueprintFile: "Phase-20.65-Pao-hubPro-x-Context-Mode.md", note: "Canonical: 20.65 = Context Mode (user lock 2026-09-18)" },
  { phaseId: "20.65.1", title: "Pao-hubPro × Litho / deepwiki-rs", type: t("runtime-adapter"), blueprintFile: "Phase-20.65-Pao-hubPro-x-Litho-deepwiki-rs.md", note: "Collision resolution: Litho renumbered from 20.65 to 20.65.1 (user lock 2026-09-18)" },
  { phaseId: "20.66", title: "Pao-hubPro × HybridClaw", type: t("workflow"), blueprintFile: "Phase-20.66-Pao-hubPro-x-HybridClaw.md" },
  { phaseId: "20.67", title: "Pao-hubPro × ECC", type: t("workflow"), blueprintFile: "20.67.md" },
  { phaseId: "20.68", title: "Pao-hubPro × DSPy", type: t("runtime-adapter"), blueprintFile: "20.68.md" },
  { phaseId: "20.69", title: "Pao-hubPro × Phase 20.69", type: t("workflow"), blueprintFile: "20.69.md", note: "Bare-number source file; title resolved from document H1 at import time" },
  { phaseId: "20.70", title: "Pao-hubPro × Tel-Agent", type: t("agent"), blueprintFile: "Phase_20.70_Pao-hubPro_x_Tel-Agent.md" },
  { phaseId: "20.71", title: "Pao-hubPro × Clodex", type: t("runtime-adapter"), blueprintFile: "Phase_20.71_Pao-hubPro_x_Clodex.md" },
  { phaseId: "20.72", title: "Pao-hubPro × Relmio", type: t("runtime-adapter"), blueprintFile: "Phase_20.72_Pao-hubPro_x_Relmio.md" },
  { phaseId: "20.73", title: "Pao-hubPro × Herdr", type: t("runtime-adapter"), blueprintFile: "Phase_20.73_Pao-hubPro_x_Herdr.md" },
  { phaseId: "20.74", title: "Pao-hubPro × MCPProxy", type: t("mcp-server"), blueprintFile: "Phase 20.74 — Pao-hubPro × MCPProxy.md" },
  { phaseId: "20.75", title: "Pao-hubPro × OpenAffiliate", type: t("workflow"), blueprintFile: "Phase_20.75_Pao-hubPro_x_OpenAffiliate.md" },
  { phaseId: "20.76", title: "Pao-hubPro × face_recognition", type: t("api"), blueprintFile: "Phase 20.76 — Pao-hubPro × face_recognition.md" },
  { phaseId: "20.77", title: "Pao-hubPro × OpenClaw API Directory", type: t("data-source"), blueprintFile: "Phase 20.77 - Pao-hubPro x OpenClaw API Directory.md" },
  { phaseId: "20.78", title: "Pao-hubPro × Lead Intelligence", type: t("workflow"), blueprintFile: "Phase_20.78_Pao-hubPro_Lead_Intelligence.md" },
  { phaseId: "20.79", title: "Pao-hubPro × ghgrab", type: t("cli-tool"), blueprintFile: "Phase 20.79 — Pao-hubPro × ghgrab.md" },
  { phaseId: "20.80", title: "Pao-hubPro × Claude Code Best Practice", type: t("skill"), blueprintFile: "Phase_20.80_Pao-hubPro_Claude-Code-Best-Practice.md" },
  { phaseId: "20.81", title: "Pao-hubPro × Alibaba OpenCodeReview", type: t("reviewer"), blueprintFile: "Phase 20.81 — Pao-hubPro × Alibaba OpenCodeReview .md" },
  { phaseId: "20.82", title: "Pao-hubPro × CortexKit AFT — Agent-Native IDE & Sensorimotor Runtime", type: t("runtime-adapter"), blueprintFile: "Phase 20.82 — Pao-hubPro × CortexKit AFT — Agent-Native IDE & Sensorimotor Runtime.md", note: "PRODUCTION-READY / CLOSED (user verdict 2026-09-18)" },
  { phaseId: "20.83", title: "Pao-hubPro × Apple Design Skill", type: t("skill"), blueprintFile: "Phase 20.83 — Pao-hubPro × Apple Design Skill.md" },
  { phaseId: "20.84", title: "Pao-hubPro × TypeSafe Jev", type: t("agent"), blueprintFile: "Phase 20.84 — Pao-hubPro × TypeSafe Jev.md" },
  { phaseId: "20.85", title: "Pao-hubPro × OmniRoute", type: t("router"), blueprintFile: "Phase 20.85 — Pao-hubPro × OmniRoute.md" },
  { phaseId: "20.86", title: "Pao-hubPro × AI APIs You Can Ship Today", type: t("data-source"), blueprintFile: "Phase_20.86_Pao-hubPro_AI_APIs_You_Can_Ship_Today.md" },
  { phaseId: "20.87", title: "Pao-hubPro × FileSync", type: t("runtime-adapter"), blueprintFile: "Phase 20.87 — Pao-hubPro × FileSync.md" },
  { phaseId: "20.88", title: "Pao-hubPro × Remotion AI Video Runtime", type: t("workflow"), blueprintFile: "Phase_20.88_Pao-hubPro_x_Remotion_AI_Video_Runtime.md", note: "Collision resolution: 20.88 = Remotion (user lock 2026-09-18)" },
  { phaseId: "20.89", title: "Pao-hubPro × Bubble — Capability Hub", type: t("runtime-adapter"), blueprintFile: "Phase_20.89_Pao-hubPro_x_Bubble.md", note: "This phase: the registry/marketplace itself" },
  { phaseId: "20.90", title: "Pao-hubPro × Forge — Prompt Engineering Control Plane", type: t("agent"), blueprintFile: "Phase_20.90_Pao-hubPro_x_Forge.md", note: "Collision resolution: Forge renumbered from 20.88 to 20.90 (user lock 2026-09-18)" },
  { phaseId: "20.94", title: "Pao-hubPro × ENZO — Unified AI Operating Workspace", type: t("runtime-adapter"), blueprintFile: "Phase_20.94_Pao-hubPro_x_ENZO.md", note: "Composition plane: ENZO is reference architecture, not a runtime dependency" },
  { phaseId: "20.95", title: "Pao-hubPro × OmniGet Next — Content Acquisition Gateway", type: t("runtime-adapter"), blueprintFile: "Phase_20.95_Pao-hubPro_x_OmniGet_Next.md", note: "OmniGet is a replaceable MCP/CLI worker; Pao-hubPro owns policy, jobs, secrets, artifacts, audit" },
  { phaseId: "20.96", title: "Pao-hubPro × AnythingMCP — Universal API-to-MCP Integration Fabric", type: t("mcp-server"), blueprintFile: "Phase_20.96_Pao-hubPro_x_AnythingMCP.md", note: "AnythingMCP is a replaceable connector engine; Pao-hubPro owns policy, secrets, privacy, approval, versioning, audit" },
] as const;

/** RESERVED phase numbers — never assignable to a blueprint. */
export const RESERVED_PHASES: readonly { phaseId: string; reservedFor: string }[] = [
  { phaseId: "20.91", reservedFor: "Business Opportunity / Revenue Intelligence" },
];

const byId = new Map<string, CanonicalPhase>();
for (const phase of CANONICAL_PHASES) {
  if (byId.has(phase.phaseId)) {
    throw new Error(`canonical phase collision: ${phase.phaseId} claimed twice — registry lock is corrupt`);
  }
  byId.set(phase.phaseId, phase);
}

const byFile = new Map<string, CanonicalPhase>();
for (const phase of CANONICAL_PHASES) {
  byFile.set(phase.blueprintFile, phase);
}

/** Resolve a canonical phase by exact phase id (e.g. "20.65.1"). */
export function getCanonicalPhase(phaseId: string): CanonicalPhase | null {
  return byId.get(phaseId) ?? null;
}

/** Resolve a canonical phase by its known blueprint filename. */
export function getCanonicalPhaseByFile(fileName: string): CanonicalPhase | null {
  return byFile.get(fileName) ?? null;
}

export function listCanonicalPhases(): readonly CanonicalPhase[] {
  return CANONICAL_PHASES;
}

/** Registry invariant: canonical IDs are unique (throws on corruption). */
export function assertNoCanonicalCollisions(): void {
  const seen = new Set<string>();
  for (const phase of CANONICAL_PHASES) {
    if (seen.has(phase.phaseId)) {
      throw new Error(`canonical phase collision: ${phase.phaseId}`);
    }
    seen.add(phase.phaseId);
    if (RESERVED_PHASES.some((r) => r.phaseId === phase.phaseId)) {
      throw new Error(`canonical phase ${phase.phaseId} uses a RESERVED number`);
    }
  }
}

/**
 * Reconcile a candidate phase id parsed from a document against the canonical
 * lock. Returns the canonical id, or null when the candidate is unknown.
 * Legacy ids (e.g. Forge's original "20.88" when paired with the Forge title)
 * are resolved through the blueprintFile mapping by the caller.
 */
export function reconcilePhaseId(candidatePhaseId: string, candidateTitle: string): { phaseId: string; renumbered: boolean; canonical: CanonicalPhase } | null {
  const direct = byId.get(candidatePhaseId);
  if (direct) {
    // A direct hit is only unambiguous if the title agrees with the lock or
    // the id is not part of a known collision pair.
    const collisionPair = candidatePhaseId === "20.88" || candidatePhaseId === "20.65";
    if (!collisionPair || direct.title.includes(candidateTitle.slice(0, 24)) || candidateTitle.includes(direct.title.slice(0, 24)) || candidateTitle.length === 0) {
      return { phaseId: direct.phaseId, renumbered: false, canonical: direct };
    }
    // Collision pair with a mismatched title: match by title keywords.
    const lower = candidateTitle.toLowerCase();
    const match = CANONICAL_PHASES.find((p) => {
      const key = p.title.toLowerCase();
      return key.includes(lower.slice(0, 24)) || lower.includes(extractTitleKey(key));
    });
    return match ? { phaseId: match.phaseId, renumbered: match.phaseId !== candidatePhaseId, canonical: match } : null;
  }
  // Not a canonical id — try title-based resolution against the lock.
  const lower = candidateTitle.toLowerCase();
  const match = CANONICAL_PHASES.find((p) => {
    const key = extractTitleKey(p.title.toLowerCase());
    return lower.includes(key) || key.includes(lower.slice(0, 20));
  });
  return match ? { phaseId: match.phaseId, renumbered: match.phaseId !== candidatePhaseId, canonical: match } : null;
}

function extractTitleKey(title: string): string {
  // Strip the "pao-hubpro × " prefix and take the distinctive product name.
  return title.replace(/^pao-hubpro\s*[×x]\s*/i, "").slice(0, 24);
}
