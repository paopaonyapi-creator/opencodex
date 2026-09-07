# Knowledge Brain Architecture & Storage Model

> **Phase 20.5 Architecture Blueprint**  
> Local-First SQLite v11 Schema, Memory Topology & Dual Storage Synchronization

---

## 1. Relational Database Schema (Schema v11)

The Knowledge Brain resides in `agent-os.sqlite3` with SQLite WAL (Write-Ahead Logging) mode, enabling concurrent reads alongside transactional writes.

```
+-----------------------------------------------------------------------------------+
|                              agent-os.sqlite3                                     |
+-----------------------------------------------------------------------------------+
|  knowledge_sources        -> source_versions        -> source_chunks              |
|  knowledge_entities       -> entity_aliases                                       |
|  knowledge_claims         -> claim_provenance                                     |
|  knowledge_relations                                                              |
|  knowledge_decisions                                                              |
|  contradiction_cases                                                              |
|  wiki_pages               -> wiki_revisions         -> wiki_source_links          |
|  ingestion_runs           -> compilation_runs       -> index_generations          |
|  query_evidence                                                                   |
+-----------------------------------------------------------------------------------+
```

### Table Definitions

1. **`knowledge_sources`**: Canonical registry of raw documents, specs, session logs, code repos, and notes.
2. **`source_versions`**: Immutable versions of ingested source documents, indexed by SHA-256 content hash.
3. **`source_chunks`**: Fine-grained structural slices with line offsets (`start_line`, `end_line`), byte offsets, and Markdown heading anchors.
4. **`knowledge_entities`**: Normalized business and technical concepts (`PROJECT`, `PHASE`, `SUBSYSTEM`, `MODEL`, `CONCEPT`).
5. **`entity_aliases`**: Case-insensitive and slug-normalized lookup indexes for entity aliases.
6. **`knowledge_claims`**: Atomic assertions `(subject, predicate, object)` with confidence scores, validity ranges, and lifecycle statuses (`DRAFT`, `ACTIVE`, `VERIFIED`, `DISPUTED`, `SUPERSEDED`, `REVOKED`).
7. **`claim_provenance`**: Direct foreign-key linkage from claims to exact source chunk IDs and version IDs.
8. **`knowledge_relations`**: Directed typed relationships (`DEPENDS_ON`, `IMPLEMENTS`, `SUPERSEDES`, `PART_OF`, `CONFLICTS_WITH`, `REFERENCES`).
9. **`knowledge_decisions`**: Architecture Decision Records (ADRs) with rationale, alternatives, and effective timestamps.
10. **`contradiction_cases`**: Detected divergence between active claims, tracking severity, proposed resolutions, and canonical claim IDs.
11. **`wiki_pages`**: Metadata and pointers for the compiled Living Wiki.
12. **`wiki_revisions`**: Immutable revision logs containing full markdown snapshots and content hashes.
13. **`wiki_source_links`**: Many-to-many relationship linking wiki pages to underlying source document versions.
14. **`ingestion_runs`**: Audit log of ingestion batches, durations, and status counts.
15. **`compilation_runs`**: Audit log of wiki compilation passes.
16. **`query_evidence`**: Audit log of queries, assembled evidence, and user citations.
17. **`index_generations`**: Rebuild tracking ensuring atomic index generation cutovers.

---

## 2. Memory Hierarchy & Dual Storage Model

The Living Knowledge Brain implements a **hybrid dual-storage architecture**:

```
           +---------------------------------------+
           |       LLM / Human Operator            |
           +-------------------+-------------------+
                               |
            +------------------v------------------+
            |      Dual Storage Synchronization   |
            +---------+-----------------+---------+
                      |                 |
          +-----------v----+       +----v-------------+
          | SQLite DB v11  |       | Filesystem Disk  |
          | Metadata & DAG |       | Markdown (.md)   |
          +----------------+       +------------------+
          | Entities       |       | Frontmatter      |
          | Claims         |       | Auto-Generated   |
          | Relations      |       | Human Curated    |
          | Provenance     |       | (<!-- PAO:...>)  |
          +----------------+       +------------------+
```

### File System Directory Structure
```
.agent-os/
  ├── agent-os.sqlite3           # Primary relational database (WAL mode)
  ├── agent-os.sqlite3-wal       # Write-ahead log
  └── wiki/                      # Living Wiki Markdown files
      ├── projects/
      │   └── pao-hubpro.md
      ├── phases/
      │   ├── phase-19.md
      │   ├── phase-20.md
      │   ├── phase-20-1.md
      │   ├── phase-20-2.md
      │   ├── phase-20-3.md
      │   ├── phase-20-4.md
      │   └── phase-20-5.md
      └── concepts/
          └── persistent-knowledge-graph.md
```

### Human Section Preservation Protocol
The compiler ensures that human operators can safely edit Living Wiki pages directly in their editor (VS Code, Cursor, Antigravity). The boundary is strictly preserved:

```markdown
<!-- PAO:HUMAN-START -->
CRITICAL ARCHITECTURAL NOTE:
Any modification to RunPod GPU routing thresholds must adhere to ADR-2026-09.
<!-- PAO:HUMAN-END -->
```

When `compileWikiPage` runs:
1. The compiler reads the file from disk first.
2. If `<!-- PAO:HUMAN-START -->` is found, the inner content is extracted and injected into the newly compiled page.
3. System-derived sections (`Summary`, `Key Claims`, `Relationships`, `Source Evidence`) are regenerated from current active claims.
4. The page is written atomically back to disk.
