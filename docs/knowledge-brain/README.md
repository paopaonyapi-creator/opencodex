# Pao Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph

> **Phase 20.5 Autonomous Knowledge System for Pao-hubPro (`opencodex`)**
> Local-First, Zero-Cloud, Deterministic Provenance, and Self-Healing Knowledge Architecture

---

## 1. Overview

The **Pao Living Knowledge Brain** is an autonomous, persistent, local-first knowledge engine designed to unify architectural specifications, operational session history, code artifacts, and engineering decisions into a continuous **Living Wiki** and **Persistent Knowledge Graph**.

Unlike ephemeral RAG solutions that re-vectorize flat text repeatedly, the Living Knowledge Brain maintains:
- **Canonical relational state** in local SQLite (`agent-os.sqlite3`, schema v11, WAL mode).
- **Dual-storage Living Wiki** where human notes in `<!-- PAO:HUMAN-START -->` ... `<!-- PAO:HUMAN-END -->` sections remain permanently immutable across automated re-compilations.
- **Strict claim-level provenance**, tying every capability, status, or design decision back to exact source files, version hashes, and line ranges.
- **Non-destructive contradiction detection and auto-resolution**, transitioning superseded historical claims into verifiable past states (`SUPERSEDED`) while preserving full forensic auditability.

---

## 2. Core Architecture Subsystems

The Knowledge Brain consists of 10 modular, decoupled subsystems located in `src/agent-os/brain/`:

| Subsystem | File | Responsibility |
|:---|:---|:---|
| **Sources & Ingestion** | [`sources.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/sources.ts) | Canonical source registry, SHA-256 fingerprinting, idempotent updates, secret exclusion. |
| **Document Parsers** | [`parsers.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/parsers.ts) | Markdown structure parsing, code block extraction, line range & byte offset preservation. |
| **Hierarchical Chunking** | [`chunks.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/chunks.ts) | Heading-aware chunk splitting, anchor stability, and chunk-to-source-version linkages. |
| **Entity Resolution** | [`entities.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/entities.ts) | Canonical entity registry, slug generation, alias normalization, and cross-phase resolution. |
| **Claims & Provenance** | [`claims.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/claims.ts) | Atomic knowledge assertions, confidence weights, temporal validity, and status lifecycles. |
| **Graph & Relations** | [`relations.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/relations.ts) / [`graph.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/graph.ts) | Typed directed relations (`DEPENDS_ON`, `SUPERSEDES`, `IMPLEMENTS`) and BFS neighborhood queries. |
| **Architecture Decisions** | [`decisions.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/decisions.ts) | Canonical ADR ledger, ratification workflows, and supersession links. |
| **Contradiction Engine** | [`contradictions.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/contradictions.ts) | Automated detection of diverging active claims, ADR-based auto-resolution without data loss. |
| **Living Wiki Engine** | [`wiki-compiler.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/wiki-compiler.ts) / [`wiki-storage.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/wiki-storage.ts) | Dual-storage markdown compilation, human preservation markers, atomic file updates. |
| **Search & Query Planner** | [`search.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/search.ts) / [`query-planner.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/src/agent-os/brain/query-planner.ts) | Hybrid entity/claim/wiki search, citation assembly, CANONICAL vs HISTORICAL query modes. |

---

## 3. Quick Start & Operating Commands

### Ingesting & Bootstrapping Existing Phase Docs
```typescript
import { bootstrapKnowledgeBrain } from "./src/agent-os/brain";

// Ingests Phase 19, 20, 20.1, 20.2, 20.3, 20.4, 20.5 specs,
// creates canonical entities, extracts claims, resolves roadmap contradictions,
// and compiles the initial Living Wiki pages.
const summary = bootstrapKnowledgeBrain();
console.log(`Ingested ${summary.sourcesIngested} sources, compiled ${summary.wikiPagesCompiled} pages.`);
```

### Running the Brain Health Linter
```typescript
import { runKnowledgeLint } from "./src/agent-os/brain";

const audit = runKnowledgeLint();
console.log(`Brain Health Score: ${audit.healthScore}/100`);
console.log(`Issues detected: ${audit.issues.length}`);
```

### Querying the Brain
```typescript
import { queryKnowledgeBrain } from "./src/agent-os/brain";

// Canonical Answer (Current ratified state)
const canon = queryKnowledgeBrain({
  query: "What is Phase 20.3?",
  mode: "CANONICAL",
});
console.log(canon.answer); // "Phase 20.3 delivers Desktop Vision Control MCP..."

// Historical Answer (Past drafts & superseded plans)
const hist = queryKnowledgeBrain({
  query: "What was the previous proposal for Phase 20.3?",
  mode: "HISTORICAL",
});
console.log(hist.answer); // "Autonomous Engineering Council (Legacy Roadmap Draft)..."
```

### Rebuilding All Derived Indices
```typescript
import { rebuildKnowledgeBrain } from "./src/agent-os/brain";

// Drops derived caches and recompiles all wiki pages and query indices
// directly from primary SQLite claims and entities with ZERO data loss.
const rebuild = rebuildKnowledgeBrain();
console.log(`Rebuilt in ${rebuild.durationMs}ms with generation ${rebuild.generationId}`);
```

---

## 4. Verification & Testing

The Knowledge Brain test suite is covered by:
- [`tests/agent-os-knowledge-brain.test.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/tests/agent-os-knowledge-brain.test.ts): 16 comprehensive unit & integration tests.
- [`tests/agent-os-brain.test.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/tests/agent-os-brain.test.ts): Project scanner and session indexer tests.
- [`tests/agent-os-routes.test.ts`](file:///c:/Users/AD%20PAO/Desktop/paohupbypaoZAZAZA55555/tests/agent-os-routes.test.ts): REST observatory route tests.

Run tests:
```bash
bun test tests/agent-os-knowledge-brain.test.ts
bun run typecheck
bun run lint:gui
bun run build:gui
```
