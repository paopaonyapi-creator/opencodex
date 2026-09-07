# Living Wiki Engine & Human Preservation

> **Phase 20.5 Living Wiki Documentation**  
> Dual Storage, Automated Markdown Compilation & Bidirectional Human Preservation

---

## 1. Concept: The Self-Updating Knowledge Base

Traditional project wikis suffer from rapid rot: as specifications evolve and code merges, documentation becomes obsolete. Conversely, purely AI-generated documentation destroys human context, editorial nuance, and critical edge-case warnings.

The **Pao Living Wiki** solves this dilemma through **bi-directional synchronization with preserved human zones**.

---

## 2. Page Structure & Markdown Layout

Each compiled Living Wiki page (`.agent-os/wiki/**/*.md`) follows a rigorous, uniform layout:

```markdown
---
id: page_8923fd21
slug: phase-20-5
title: "Phase 20.5 — Living Knowledge Brain"
type: phase
status: current
updated_at: "2026-09-07T12:00:00.000Z"
source_set_hash: "3a4f89..."
entity_id: "ent_98319f"
aliases:
  - "Living Knowledge Brain"
  - "LLM Wiki"
---

# Phase 20.5 — Living Knowledge Brain

## Summary
Universal persistent knowledge graph and Living Wiki with local-first SQLite persistence.

## Key Claims & Decisions
- **topic:** Living Knowledge Brain × LLM Wiki *(source: ver_98a21)*
- **architecture:** Local-First Persistent SQLite Graph *(source: ver_98a21)*
- **verification:** 42 Verification Points *(source: ver_98a21)*

## Relationships
- **PART_OF** → [[Pao-hubPro]]
- **SUPERSEDES** ← [[Phase 20.4]]

## Operator & Human Notes
<!-- PAO:HUMAN-START -->
*Add operator observations, architectural rationale, or manual overrides here. This block is preserved across automatic compilations.*
<!-- PAO:HUMAN-END -->

## Source Evidence
- **Phase 20.5 Spec** (docs/PHASE_20_5_PAO_LIVING_KNOWLEDGE_BRAIN_LLM_WIKI_PERSISTENT_KNOWLEDGE_GRAPH.md, version `ver_98a21`)
```

---

## 3. Human Preservation Guarantee

The boundary markers:
```markdown
<!-- PAO:HUMAN-START -->
... human notes ...
<!-- PAO:HUMAN-END -->
```
are strictly guarded by `src/agent-os/brain/wiki-compiler.ts`.

### Compilation Algorithm:
1. **Read-Before-Write**: If the file exists on the local filesystem, read its text content before compilation begins.
2. **Zone Extraction**: Regex extract the string between `<!-- PAO:HUMAN-START -->` and `<!-- PAO:HUMAN-END -->`.
3. **Draft Assembly**: Compile updated claims, graph relations, and source citations from SQLite.
4. **Injection**: Inject the extracted human content verbatim back into the `## Operator & Human Notes` section.
5. **Atomic Commit**:
   - Upsert `wiki_pages` table row in SQLite.
   - Insert new immutable snapshot in `wiki_revisions`.
   - Update `wiki_source_links`.
   - Atomically overwrite disk file via temporary swap (`.tmp` -> `.md`).

If the human note was modified, `is_human_curated` is flagged as `1` in SQLite metadata.
Rebuilding the entire knowledge base from scratch preserves all human notes intact.
