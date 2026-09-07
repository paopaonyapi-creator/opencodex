# Hybrid Search, Graph Neighborhood Queries & Query Planning

> **Phase 20.5 Search & Retrieval Engine**  
> Lexical Indexing, Graph Traversal, Query Planner & Citation Assembly

---

## 1. Multi-Index Hybrid Search

The Knowledge Brain provides unified search across four distinct knowledge dimensions via `src/agent-os/brain/search.ts`:

1. **Living Wiki Pages**: Title, summary, and slug matching against current compiled pages.
2. **Atomic Claims**: Predicate and object value matching against active and verified assertions.
3. **Canonical Entities**: Canonical name, alias, and description matching.
4. **Source Documents**: Title, file path, and chunk content matching.

```typescript
export interface SearchHit {
  id: string;
  kind: "wiki" | "claim" | "entity" | "source";
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}
```

---

## 2. Graph Traversal & Cycle Tolerance

The Persistent Knowledge Graph (`src/agent-os/brain/graph.ts`) enables multi-hop traversal over typed relations (`DEPENDS_ON`, `SUPERSEDES`, `IMPLEMENTS`, `PART_OF`):

```typescript
export function getKnowledgeGraph(rootEntityId: string, depth = 2): KnowledgeGraphTopology
```

### Cycle Tolerance:
Because complex software architectures often possess cyclic dependencies or bidirectional links, the BFS traversal maintains a strict `visitedNodes` Set. If a cycle is encountered (e.g. $A \rightarrow B \rightarrow A$), the traversal records the edge but halts expansion along that branch, preventing infinite recursion.

---

## 3. Query Planner: Canonical vs. Historical Queries

The Query Planner (`src/agent-os/brain/query-planner.ts`) analyzes the semantic intent of user questions and executes one of two retrieval strategies:

### A. CANONICAL Mode (Default)
- Targets currently `ACTIVE` and `VERIFIED` claims.
- Filters out superseded or draft hypotheses.
- Synthesizes answers based on current ratified architectural state.

### B. HISTORICAL Mode
- Explicitly queries `SUPERSEDED` and `REVOKED` claims.
- Traces the timeline of changes, ADR rationale, and past proposals.
- Explains *why* a particular architecture decision changed.

### Citation Generation:
Every answer produced by the query planner is accompanied by verifiable citations:
```json
{
  "sourceTitle": "docs/PHASE_20_5_PAO_LIVING_KNOWLEDGE_BRAIN_LLM_WIKI_PERSISTENT_KNOWLEDGE_GRAPH.md",
  "chunkHeading": "System Architecture",
  "claimPredicate": "architecture",
  "confidence": 0.99
}
```
