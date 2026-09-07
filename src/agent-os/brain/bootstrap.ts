// Phase 20.5 — Bootstrap Loader for Existing Phase Docs & Canonical Roadmap

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClaim } from "./claims";
import { detectContradictions } from "./contradictions";
import { recordDecision } from "./decisions";
import { registerEntity } from "./entities";
import { parseDocument } from "./parsers";
import { chunkDocument, saveChunks } from "./chunks";
import { createRelation } from "./relations";
import { createSourceVersion, registerSource } from "./sources";
import { compileWikiPage } from "./wiki-compiler";

export interface BootstrapResult {
  sourcesIngested: number;
  entitiesCreated: number;
  claimsCreated: number;
  claimsExtracted: number;
  relationsCreated: number;
  contradictionsProcessed: number;
  contradictionsResolved: number;
  wikiPagesCompiled: number;
  durationMs: number;
}

export function bootstrapKnowledgeBrain(workspaceRoot = process.cwd()): BootstrapResult {
  const started = Date.now();

  // 1. Register Core Project Entity
  const projectEnt = registerEntity({
    canonicalName: "Pao-hubPro",
    entityType: "PROJECT",
    aliases: ["Pao hubPro", "pao-hubpro", "opencodex", "PaohupByPaoZa"],
    description: "Universal AI Agent Platform, proxy runtime, and autonomous production studio.",
  });

  // 2. Define Phase Docs to Bootstrap
  const phaseDocs = [
    {
      phaseNum: "19",
      name: "Phase 19",
      title: "Phase 19 — AI Generation Studio",
      file: "docs/PHASE_19_AI_GENERATION_STUDIO.md",
      canonicalTopic: "AI Generation Studio × ComfyUI Production Orchestrator",
      status: "VERIFIED",
    },
    {
      phaseNum: "20",
      name: "Phase 20",
      title: "Phase 20 — Multi-GPU RunPod Router",
      file: "docs/PHASE_20_PAO_MULTI_GPU_RUNPOD_INTELLIGENT_WORKLOAD_ROUTER.md",
      canonicalTopic: "Multi-GPU Generation Grid × RunPod Intelligent Workload Router",
      status: "VERIFIED",
    },
    {
      phaseNum: "20.1",
      name: "Phase 20.1",
      title: "Phase 20.1 — Smart Queue & Cloud Burst",
      file: "docs/PHASE_20_1_PAO_COMFYUI_SMART_QUEUE_AUTO_CLOUD_BURST_SCHEDULER.md",
      canonicalTopic: "ComfyUI Smart Queue × Auto Cloud Burst Scheduler",
      status: "VERIFIED",
    },
    {
      phaseNum: "20.2",
      name: "Phase 20.2",
      title: "Phase 20.2 — Spec-Driven AI SDLC Orchestrator",
      file: "docs/PHASE_20_2_PAO_SPEC_DRIVEN_AI_SDLC_ORCHESTRATOR.md",
      canonicalTopic: "Spec-Driven AI SDLC Orchestrator",
      status: "VERIFIED",
    },
    {
      phaseNum: "20.3",
      name: "Phase 20.3",
      title: "Phase 20.3 — Desktop Vision Control MCP",
      file: "docs/PHASE_20_3_PAO_DESKTOP_VISION_CONTROL_MCP_LOCAL_REALTIME_AGENT.md",
      canonicalTopic: "Desktop Vision Control MCP × Local Realtime Agent",
      status: "VERIFIED",
    },
    {
      phaseNum: "20.4",
      name: "Phase 20.4",
      title: "Phase 20.4 — Autonomous Engineering Council",
      file: "docs/PHASE_20_4_PAO_AUTONOMOUS_ENGINEERING_COUNCIL_MULTI_AGENT_WORKTREE_EXECUTION.md",
      canonicalTopic: "Autonomous Engineering Council × Multi-Agent Worktree Execution",
      status: "VERIFIED",
    },
    {
      phaseNum: "20.5",
      name: "Phase 20.5",
      title: "Phase 20.5 — Living Knowledge Brain",
      file: "docs/PHASE_20_5_PAO_LIVING_KNOWLEDGE_BRAIN_LLM_WIKI_PERSISTENT_KNOWLEDGE_GRAPH.md",
      canonicalTopic: "Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph",
      status: "VERIFIED",
    },
  ];

  let sourcesIngested = 0;
  let claimsCreated = 0;
  let relationsCreated = 0;
  let wikiPagesCompiled = 0;

  const phaseEntities = new Map<string, string>(); // phaseNum -> entityId

  for (const p of phaseDocs) {
    // Register Phase Entity
    const ent = registerEntity({
      canonicalName: p.name,
      entityType: "PHASE",
      aliases: [p.title, `phase-${p.phaseNum}`, `phase ${p.phaseNum}`],
      description: p.canonicalTopic,
      projectId: projectEnt.id,
    });
    phaseEntities.set(p.phaseNum, ent.id);

    // Link relation: Phase PART_OF Pao-hubPro
    createRelation({
      fromEntityId: ent.id,
      relationType: "PART_OF",
      toEntityId: projectEnt.id,
    });
    relationsCreated++;

    // Ingest Doc if exists on disk
    const absPath = join(workspaceRoot, p.file);
    let versionId = `ver_stub_${p.phaseNum}`;

    if (existsSync(absPath)) {
      const content = readFileSync(absPath, "utf8");
      const src = registerSource({
        sourceType: "PHASE_SPEC",
        title: p.title,
        uriOrPath: p.file,
        projectId: projectEnt.id,
        canonicality: "canonical",
      });
      const { version } = createSourceVersion({
        sourceId: src.id,
        content,
      });
      versionId = version.id;
      sourcesIngested++;

      const doc = parseDocument(content, p.file);
      const chunks = chunkDocument(doc, versionId);
      saveChunks(chunks);

      // Create Active Capability & Topic Claims
      createClaim({
        subjectEntityId: ent.id,
        predicate: "topic",
        objectValue: p.canonicalTopic,
        claimType: "CAPABILITY",
        status: "ACTIVE",
        sourcePriority: 10,
        provenance: { sourceVersionId: versionId, anchor: "title" },
      });
      createClaim({
        subjectEntityId: ent.id,
        predicate: "implementation_status",
        objectValue: p.status,
        claimType: "STATUS",
        status: "ACTIVE",
        sourcePriority: 9,
        provenance: { sourceVersionId: versionId, anchor: "header" },
      });
      claimsCreated += 2;
    }
  }

  // 3. Historical Contradiction Setup (Roadmap Case from Section 64 & 221)
  // Older historical claim: Phase 20.3 was once planned as Autonomous Engineering Council
  const ent203 = phaseEntities.get("20.3")!;
  const ent204 = phaseEntities.get("20.4")!;

  const legacySrc = registerSource({
    sourceType: "PHASE_SPEC",
    title: "Legacy Roadmap Draft",
    uriOrPath: "docs/older_spec.md",
    projectId: projectEnt.id,
    canonicality: "unverified",
  });
  const { version: legacyVer } = createSourceVersion({
    sourceId: legacySrc.id,
    content: "# Legacy Roadmap Draft\nPhase 20.3 was Autonomous Engineering Council",
  });

  const olderClaim = createClaim({
    subjectEntityId: ent203,
    predicate: "topic",
    objectValue: "Autonomous Engineering Council (Legacy Roadmap Draft)",
    claimType: "HISTORICAL",
    status: "ACTIVE", // Created active initially to trigger contradiction detection
    sourcePriority: 4, // Lower priority than canonical spec (10)
    validTo: "2026-08-01T00:00:00Z",
    provenance: { sourceVersionId: legacyVer.id, anchor: "legacy_draft" },
  });
  claimsCreated++;

  // Record canonical roadmap decision
  const roadmapDec = recordDecision({
    title: "ADR-2026-09: Canonical Roadmap Realignment (Phase 20.3 & 20.4)",
    decision: "Assign Phase 20.3 to Desktop Vision Control MCP and Phase 20.4 to Autonomous Engineering Council.",
    rationaleSummary: "Desktop Vision provides essential local agent sensory hands/eyes required before autonomous multi-agent worktree execution.",
    effectiveAt: new Date().toISOString(),
    sourceRefs: ["docs/PHASE_20_3_PAO_DESKTOP_VISION_CONTROL_MCP_LOCAL_REALTIME_AGENT.md", "docs/PHASE_20_4_PAO_AUTONOMOUS_ENGINEERING_COUNCIL_MULTI_AGENT_WORKTREE_EXECUTION.md"],
  });

  // Create explicit supersession relation: Phase 20.4 supersedes older 20.3 council scope
  createRelation({
    fromEntityId: ent204,
    relationType: "SUPERSEDES",
    toEntityId: ent203,
    metadata: { note: "Autonomous Engineering Council promoted to Phase 20.4" },
  });
  relationsCreated++;

  // Detect and auto-resolve contradiction
  const detectedCases = detectContradictions();

  // 4. Compile Initial Living Wiki Pages
  for (const p of phaseDocs) {
    const entId = phaseEntities.get(p.phaseNum);
    compileWikiPage({
      slug: `phase-${p.phaseNum}`,
      title: p.title,
      pageType: "PHASE",
      canonicalEntityId: entId,
    });
    wikiPagesCompiled++;
  }

  // Compile Project Wiki Page
  compileWikiPage({
    slug: "pao-hubpro",
    title: "Pao-hubPro System Overview",
    pageType: "PROJECT",
    canonicalEntityId: projectEnt.id,
  });
  wikiPagesCompiled++;

  return {
    sourcesIngested,
    entitiesCreated: phaseEntities.size + 1,
    claimsCreated,
    claimsExtracted: claimsCreated,
    relationsCreated,
    contradictionsProcessed: detectedCases.length,
    contradictionsResolved: detectedCases.length,
    wikiPagesCompiled,
    durationMs: Date.now() - started,
  };
}
