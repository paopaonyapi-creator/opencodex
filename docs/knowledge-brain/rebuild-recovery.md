# Index Rebuild, Pruning & Disaster Recovery

> **Phase 20.5 Rebuild & Zero-Data-Loss Disaster Recovery**  
> Idempotent Re-indexing, Cache Pruning & Atomic Generation Swapping

---

## 1. Zero-Data-Loss Invariant

A fundamental requirement of Phase 20.5 is:
$$\text{Rebuilding the system must NEVER delete canonical entities, claims, decisions, or human-curated wiki notes.}$$

Primary data lives in relational tables:
- `knowledge_sources` & `source_versions`
- `knowledge_entities`
- `knowledge_claims` & `claim_provenance`
- `knowledge_decisions`
- `<!-- PAO:HUMAN-START -->` filesystem sections

All search indices, query caches, and derived markdown tables are disposable projections that can be reconstituted at any time.

---

## 2. Rebuild Execution (`rebuildKnowledgeBrain`)

Located in `src/agent-os/brain/rebuild.ts`:

1. **Generation Allocation**: Creates a new generation ID: `gen_<timestamp>_<uuid>`.
2. **Entity & Claim Scan**: Traverses all active entities and claims from SQLite.
3. **Living Wiki Recompilation**: Iterates through each registered page, reads preserved human notes from existing files, re-synthesizes markdown, and atomically updates `wiki_pages` and `wiki_revisions`.
4. **Generation Activation**: Updates `index_generations` marking the generation as active.

---

## 3. Safe Cache Pruning (`pruneKnowledgeBrain`)

Located in `src/agent-os/brain/rebuild.ts`:

```typescript
export function pruneKnowledgeBrain(olderThanDays = 30): PruneResult
```

- Deletes orphaned `source_chunks` whose parent `source_versions` have been tombstoned.
- Prunes temporary search cache entries older than the retention threshold.
- Deletes intermediate compilation scratch files.
- **Never deletes** active or superseded claims, decisions, or current wiki revisions.
