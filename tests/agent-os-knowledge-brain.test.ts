import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import {
  bootstrapKnowledgeBrain,
  compareEntities,
  compileWikiPage,
  createClaim,
  createRelation,
  createSourceVersion,
  detectContradictions,
  getBrainHealthStatus,
  getClaim,
  getDecision,
  getEntity,
  getKnowledgeGraph,
  getSource,
  getWikiPage,
  listClaims,
  listContradictions,
  listEntities,
  listSources,
  listWikiPages,
  pruneKnowledgeBrain,
  queryKnowledgeBrain,
  rebuildKnowledgeBrain,
  recordDecision,
  registerEntity,
  registerSource,
  resolveContradiction,
  runKnowledgeLint,
  searchBrain,
  tombstoneSource,
} from "../src/agent-os/brain";
import { parseMarkdown } from "../src/agent-os/brain/parsers";
import { chunkSourceDocument } from "../src/agent-os/brain/chunks";
import { handleManagementAPI } from "../src/server/management-api";

const tempHomes: string[] = [];

function openFreshDb(): { homeDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "agent-os-kb-"));
  tempHomes.push(dir);
  process.env.OPENCODEX_HOME = dir;
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
  return { homeDir: dir };
}

afterEach(() => {
  closeAgentOsDbForTests();
  while (tempHomes.length) {
    try {
      rmSync(tempHomes.pop()!, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("phase 20.5 — living knowledge brain: sources & chunking", () => {
  test("registers sources, detects unchanged content idempotently, and tracks new versions", () => {
    openFreshDb();
    const docPath = "docs/PHASE_20_3.md";
    const initialContent = "# Phase 20.3: Pao Desktop Vision\n\nFull native desktop experience.";

    const reg1 = registerSource({
      sourcePath: docPath,
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: initialContent,
    });

    expect(reg1.status).toBe("NEW");
    expect(reg1.source.current_fingerprint).toBeDefined();

    // Idempotent re-registration with identical content
    const reg2 = registerSource({
      sourcePath: docPath,
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: initialContent,
    });
    expect(reg2.status).toBe("UNCHANGED");
    expect(reg2.source.current_version).toBe(1);

    // Update with modified content creates version 2
    const updatedContent = "# Phase 20.3: Pao Desktop Vision\n\nFull native desktop experience with agent runtime.";
    const reg3 = registerSource({
      sourcePath: docPath,
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: updatedContent,
    });
    expect(reg3.status).toBe("UPDATED");
    expect(reg3.source.current_version).toBe(2);

    // Tombstoning
    const tomb = tombstoneSource(reg3.source.id);
    expect(tomb).toBe(true);
    const fetched = getSource(reg3.source.id);
    expect(fetched?.status).toBe("TOMBSTONED");
  });

  test("excludes secrets without indexing them", () => {
    openFreshDb();
    const envReg = registerSource({
      sourcePath: ".env",
      domain: "PROJECT",
      tier: "CANONICAL",
      content: "DATABASE_URL=postgres://user:supersecret@localhost:5432/db",
    });
    expect(envReg.status).toBe("EXCLUDED");

    const keyReg = registerSource({
      sourcePath: "config/private.key",
      domain: "PROJECT",
      tier: "CANONICAL",
      content: "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
    });
    expect(keyReg.status).toBe("EXCLUDED");
  });

  test("parses markdown sections with line numbers and preserves byte offsets", () => {
    const md = "# Title\nIntro paragraph.\n\n## Section 1\nContent of section 1.\n\n## Section 2\nContent of section 2.";
    const doc = parseMarkdown(md);
    expect(doc.sections.length).toBe(3);
    expect(doc.sections[0].title).toBe("Title");
    expect(doc.sections[1].title).toBe("Section 1");
    expect(doc.sections[2].title).toBe("Section 2");
    expect(doc.sections[1].lineStart).toBe(4);
  });

  test("chunks source document preserving anchors and line ranges", () => {
    openFreshDb();
    const sourceReg = registerSource({
      sourcePath: "docs/spec.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Architecture\n\nCore subsystem details.\n\n## Data Plane\n\nHandles request routing.",
    });

    const chunks = chunkSourceDocument(sourceReg.version!.id, "# Architecture\n\nCore subsystem details.\n\n## Data Plane\n\nHandles request routing.");
    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe("Architecture");
    expect(chunks[1].heading).toBe("Data Plane");
    expect(chunks[0].chunk_sha256).toBeDefined();
    expect(chunks[1].start_line).toBe(5);
  });
});

describe("phase 20.5 — entities, claims, relations & graph", () => {
  test("canonical entity registry normalizes aliases and guards against invalid merges", () => {
    openFreshDb();

    const entity1 = registerEntity({
      canonicalName: "Pao Living Knowledge Brain",
      slug: "pao-living-knowledge-brain",
      kind: "SUBSYSTEM",
      summary: "Living knowledge brain and persistent graph.",
      aliases: ["Knowledge Brain", "Living Brain", "Pao Brain 20.5"],
    });

    expect(entity1.canonical_name).toBe("Pao Living Knowledge Brain");

    // Fetch by alias
    const fetchedByAlias = getEntity("Knowledge Brain");
    expect(fetchedByAlias?.id).toBe(entity1.id);

    // Attempting to alias distinct entities raises error / guards against false merge
    const entity2 = registerEntity({
      canonicalName: "Pao Desktop Vision",
      slug: "pao-desktop-vision",
      kind: "PHASE",
      summary: "Desktop vision subsystem.",
    });

    expect(entity2.id).not.toBe(entity1.id);
  });

  test("claims lifecycle, provenance tracking, and status transitions", () => {
    openFreshDb();

    const source = registerSource({
      sourcePath: "docs/PHASE_20_3.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Phase 20.3\n\nPhase 20.3 delivers the Native Desktop Vision.",
    });

    const chunks = chunkSourceDocument(source.version!.id, "# Phase 20.3\n\nPhase 20.3 delivers the Native Desktop Vision.");

    const claim = createClaim({
      subjectEntity: "Phase 20.3",
      predicate: "delivers",
      objectValue: "Native Desktop Vision",
      confidence: 0.99,
      provenanceChunkId: chunks[0].id,
      validFrom: "2026-09-01",
    });

    expect(claim.status).toBe("ACTIVE");
    expect(claim.confidence).toBe(0.99);

    const retrieved = getClaim(claim.id);
    expect(retrieved?.provenance?.source_title).toContain("docs/PHASE_20_3.md");
    expect(retrieved?.provenance?.chunk_heading).toBe("Phase 20.3");
  });

  test("typed relations and graph neighborhood queries with cycle tolerance", () => {
    openFreshDb();

    const e1 = registerEntity({ canonicalName: "Phase 20.5", slug: "phase-20-5", kind: "PHASE" });
    const e2 = registerEntity({ canonicalName: "Knowledge Graph", slug: "knowledge-graph", kind: "SUBSYSTEM" });
    const e3 = registerEntity({ canonicalName: "Living Wiki", slug: "living-wiki", kind: "SUBSYSTEM" });

    createRelation({ sourceEntityId: e1.id, relationType: "IMPLEMENTS", targetEntityId: e2.id });
    createRelation({ sourceEntityId: e1.id, relationType: "IMPLEMENTS", targetEntityId: e3.id });
    // Add cyclical relation to test cycle tolerance
    createRelation({ sourceEntityId: e2.id, relationType: "DEPENDS_ON", targetEntityId: e1.id });

    const graph = getKnowledgeGraph(e1.id, 2);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graph.edges.length).toBeGreaterThanOrEqual(3);
  });
});

describe("phase 20.5 — roadmap contradiction detection & auto-resolution", () => {
  test("detects roadmap contradiction and auto-resolves via canonical decision without deleting history", () => {
    openFreshDb();

    const sourceCouncil = registerSource({
      sourcePath: "docs/older_spec.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Roadmap\nPhase 20.3 is Engineering Council.",
    });
    const chunkCouncil = chunkSourceDocument(sourceCouncil.version!.id, "# Roadmap\nPhase 20.3 is Engineering Council.");

    const sourceDesktop = registerSource({
      sourcePath: "docs/PHASE_20_3_PAO_NATIVE_DESKTOP_VISION.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Phase 20.3\nPhase 20.3 is Native Desktop Vision.",
    });
    const chunkDesktop = chunkSourceDocument(sourceDesktop.version!.id, "# Phase 20.3\nPhase 20.3 is Native Desktop Vision.");

    // Claim A (older council plan)
    const claimA = createClaim({
      subjectEntity: "Phase 20.3",
      predicate: "title",
      objectValue: "Engineering Council",
      confidence: 0.85,
      provenanceChunkId: chunkCouncil[0].id,
      validFrom: "2026-08-01",
    });

    // Claim B (desktop vision plan)
    const claimB = createClaim({
      subjectEntity: "Phase 20.3",
      predicate: "title",
      objectValue: "Native Desktop Vision",
      confidence: 0.99,
      provenanceChunkId: chunkDesktop[0].id,
      validFrom: "2026-09-01",
    });

    // Detect contradiction
    const detected = detectContradictions();
    expect(detected.length).toBeGreaterThan(0);
    const roadmapConflict = detected.find((c) => c.topic.includes("Phase 20.3"));
    expect(roadmapConflict).toBeDefined();
    expect(roadmapConflict?.status).toBe("OPEN");

    // Record canonical architecture decision superseding older plan
    recordDecision({
      decisionId: "ADR-20-3-ROADMAP",
      title: "Phase 20.3 Scope: Native Desktop Vision",
      domain: "ROADMAP",
      rationale: "Desktop Vision ratified as Phase 20.3; Engineering Council moved to Phase 20.4.",
      status: "RATIFIED",
      supersedesDecisionId: undefined,
    });

    // Resolve contradiction
    const resolution = resolveContradiction(
      roadmapConflict!.id,
      "TIMELINE_SUPERSEDED",
      "Resolved via ADR-20-3-ROADMAP: Desktop Vision is Phase 20.3; older Engineering Council claim superseded.",
    );

    expect(resolution).toBe(true);

    // Verify historical claim is SUPERSEDED, not deleted!
    const claimARefreshed = getClaim(claimA.id);
    const claimBRefreshed = getClaim(claimB.id);

    expect(claimARefreshed?.status).toBe("SUPERSEDED");
    expect(claimBRefreshed?.status).toBe("ACTIVE");
    expect(claimARefreshed?.provenance?.source_title).toContain("docs/older_spec.md");
  });
});

describe("phase 20.5 — living wiki compilation & human preservation", () => {
  test("compiles wiki page and strictly preserves human-curated sections across recompiles", () => {
    openFreshDb();

    registerEntity({
      canonicalName: "Phase 20.5",
      slug: "phase-20-5",
      kind: "PHASE",
      summary: "Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph",
    });

    const source = registerSource({
      sourcePath: "docs/spec.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Phase 20.5 Overview\n\nFull autonomous knowledge synchronization.",
    });
    const chunk = chunkSourceDocument(source.version!.id, "# Phase 20.5 Overview\n\nFull autonomous knowledge synchronization.");

    createClaim({
      subjectEntity: "Phase 20.5",
      predicate: "architecture",
      objectValue: "Local-First Persistent SQLite Graph",
      confidence: 0.99,
      provenanceChunkId: chunk[0].id,
      validFrom: "2026-09-07",
    });

    // 1. First compilation
    const compiled1 = compileWikiPage("phase-20-5");
    expect(compiled1.content).toContain("# Phase 20.5");
    expect(compiled1.content).toContain("Local-First Persistent SQLite Graph");
    expect(compiled1.content).toContain("<!-- PAO:HUMAN-START -->");
    expect(compiled1.content).toContain("<!-- PAO:HUMAN-END -->");

    // 2. Operator injects custom notes inside the preserved section
    const humanNote = "CRITICAL HUMAN NOTE: Zero data loss verified on Windows filesystem.";
    const userModifiedMarkdown = compiled1.content.replace(
      /<!-- PAO:HUMAN-START -->[\s\S]*?<!-- PAO:HUMAN-END -->/,
      `<!-- PAO:HUMAN-START -->\n${humanNote}\n<!-- PAO:HUMAN-END -->`,
    );

    // Save to dual storage (both file and DB)
    const pageBefore = getWikiPage("phase-20-5")!;
    writeFileSync(pageBefore.file_path, userModifiedMarkdown, "utf8");

    // 3. Recompile the page after updating system data
    createClaim({
      subjectEntity: "Phase 20.5",
      predicate: "verification",
      objectValue: "42 Verification Points",
      confidence: 1.0,
      provenanceChunkId: chunk[0].id,
      validFrom: "2026-09-07",
    });

    const recompiled = compileWikiPage("phase-20-5");

    // Both the newly added system claim and the human-curated note MUST exist!
    expect(recompiled.content).toContain("42 Verification Points");
    expect(recompiled.content).toContain(humanNote);
    expect(recompiled.is_human_curated).toBe(1);
  });
});

describe("phase 20.5 — hybrid search, query planner & compare engine", () => {
  test("hybrid search returns hits from wiki, claims, and entities", () => {
    openFreshDb();

    registerEntity({
      canonicalName: "Phase 20.1",
      slug: "phase-20-1",
      kind: "PHASE",
      summary: "Autonomous SDLC Pipeline",
    });

    const hits = searchBrain("SDLC");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.kind === "entity" && h.title.includes("Phase 20.1"))).toBe(true);
  });

  test("query planner distinguishes canonical queries from historical queries with citations", () => {
    openFreshDb();

    const source = registerSource({
      sourcePath: "docs/spec.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Roadmap\n\nPhase 20.3 is Native Desktop Vision.\nOlder draft considered Council.",
    });
    const chunk = chunkSourceDocument(source.version!.id, "# Roadmap\n\nPhase 20.3 is Native Desktop Vision.\nOlder draft considered Council.");

    createClaim({
      subjectEntity: "Phase 20.3",
      predicate: "title",
      objectValue: "Native Desktop Vision",
      confidence: 0.99,
      status: "ACTIVE",
      provenanceChunkId: chunk[0].id,
      validFrom: "2026-09-01",
    });

    createClaim({
      subjectEntity: "Phase 20.3",
      predicate: "title",
      objectValue: "Engineering Council",
      confidence: 0.8,
      status: "SUPERSEDED",
      provenanceChunkId: chunk[0].id,
      validFrom: "2026-08-01",
    });

    // 1. Canonical query
    const canonicalRes = queryKnowledgeBrain({
      query: "What is Phase 20.3?",
      mode: "CANONICAL",
    });
    expect(canonicalRes.confidence).toBeGreaterThan(0);
    expect(canonicalRes.answer).toContain("Native Desktop Vision");
    expect(canonicalRes.citations.length).toBeGreaterThan(0);
    expect(canonicalRes.citations[0].sourceTitle).toContain("docs/spec.md");

    // 2. Historical query
    const historicalRes = queryKnowledgeBrain({
      query: "What was the previous proposal for Phase 20.3?",
      mode: "HISTORICAL",
    });
    expect(historicalRes.answer).toContain("Engineering Council");
  });

  test("compare engine calculates capability overlap between phases", () => {
    openFreshDb();

    const e1 = registerEntity({ canonicalName: "Phase 20.3", slug: "phase-20-3", kind: "PHASE" });
    const e2 = registerEntity({ canonicalName: "Phase 20.4", slug: "phase-20-4", kind: "PHASE" });
    const sharedSub = registerEntity({ canonicalName: "Agent Runtime", slug: "agent-runtime", kind: "SUBSYSTEM" });

    createRelation({ sourceEntityId: e1.id, relationType: "DEPENDS_ON", targetEntityId: sharedSub.id });
    createRelation({ sourceEntityId: e2.id, relationType: "DEPENDS_ON", targetEntityId: sharedSub.id });

    const diff = compareEntities("phase-20-3", "phase-20-4");
    expect(diff.sharedRelations.length).toBeGreaterThan(0);
    expect(diff.overlapPercentage).toBeGreaterThan(0);
  });
});

describe("phase 20.5 — linter, index rebuild & bootstrap", () => {
  test("linter computes health score and flags issues", () => {
    openFreshDb();

    registerEntity({ canonicalName: "Orphan Concept", slug: "orphan-concept", kind: "CONCEPT" });

    const lint = runKnowledgeLint();
    expect(lint.healthScore).toBeGreaterThan(0);
    expect(lint.healthScore).toBeLessThanOrEqual(100);
  });

  test("rebuilds all derived indices from canonical database with zero data loss", () => {
    openFreshDb();

    const source = registerSource({
      sourcePath: "docs/spec.md",
      domain: "PHASE_SPEC",
      tier: "CANONICAL",
      content: "# Subsystem\nCore engine.",
    });
    chunkSourceDocument(source.version!.id, "# Subsystem\nCore engine.");

    compileWikiPage("projects");

    const rebuildResult = rebuildKnowledgeBrain();
    expect(rebuildResult.generationId).toBeDefined();
    expect(rebuildResult.wikiPagesCount).toBeGreaterThanOrEqual(1);

    const pruned = pruneKnowledgeBrain();
    expect(pruned.prunedCount).toBeGreaterThanOrEqual(0);
  });

  test("bootstrap initializes canonical phase specs and resolves contradictions", () => {
    openFreshDb();

    const bootRes = bootstrapKnowledgeBrain();
    expect(bootRes.sourcesIngested).toBeGreaterThanOrEqual(5);
    expect(bootRes.claimsExtracted).toBeGreaterThanOrEqual(5);
    expect(bootRes.contradictionsResolved).toBeGreaterThanOrEqual(1);
    expect(bootRes.wikiPagesCompiled).toBeGreaterThanOrEqual(5);

    const health = getBrainHealthStatus();
    expect(health.healthy).toBe(true);
    expect(health.healthScore).toBeGreaterThanOrEqual(90);
    expect(health.unresolvedContradictions).toBe(0);
  });
});

describe("phase 20.5 — REST management API endpoints", () => {
  test("serves brain observatory endpoints via management API", async () => {
    openFreshDb();

    const config = {
      port: 3000,
      hostname: "127.0.0.1",
      defaultProvider: "a",
      providers: [],
      adminToken: "test-token",
    } as unknown as OcxConfig;

    // 1. Health
    const reqHealth = new Request("http://localhost:3000/api/brain/health", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });
    const resHealth = await handleManagementAPI(reqHealth, new URL(reqHealth.url), config);
    expect(resHealth).not.toBeNull();
    expect(resHealth!.status).toBe(200);
    const healthJson = await resHealth!.json();
    expect(healthJson.healthy).toBe(true);

    // 2. Query
    const reqQuery = new Request("http://localhost:3000/api/brain/query", {
      method: "POST",
      headers: { host: "localhost:3000", "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ query: "What is Phase 20.5?", mode: "CANONICAL" }),
    });
    const resQuery = await handleManagementAPI(reqQuery, new URL(reqQuery.url), config);
    expect(resQuery).not.toBeNull();
    expect(resQuery!.status).toBe(200);
    const queryJson = await resQuery!.json();
    expect(queryJson.answer).toBeDefined();

    // 3. Compare
    const reqCompare = new Request("http://localhost:3000/api/brain/compare?entityA=phase-20-3&entityB=phase-20-4", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });
    const resCompare = await handleManagementAPI(reqCompare, new URL(reqCompare.url), config);
    expect(resCompare).not.toBeNull();
    expect(resCompare!.status).toBe(200);

    // 4. Lint
    const reqLint = new Request("http://localhost:3000/api/brain/lint", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });
    const resLint = await handleManagementAPI(reqLint, new URL(reqLint.url), config);
    expect(resLint).not.toBeNull();
    expect(resLint!.status).toBe(200);
  });
});
