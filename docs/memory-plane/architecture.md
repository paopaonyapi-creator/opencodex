# Memory Plane Architecture (Phase 20.41)

## Planes

```text
AI / Agent Clients (MCP tools, REST, dashboard)
        |
Memory Gateway (scopes, policy, audit, rate limits)
        |
Trustworthy Memory Core (remember / recall / observe / supersede /
                         forget / rebuild / digest / trace)
        |
Source Store (authoritative: memory_items + revisions)
Retrieval Core (keyword / semantic / hybrid + RRF)
Derived Layer (chunks, embeddings — rebuildable, discardable)
```

**The authoritative memory text is the source of truth.** Chunks,
embeddings, observations, digests and traces are derived or operational
and are rebuildable without losing the corpus.

## Remember pipeline (spec §8)

validate → resolve workspace/project/agent → canonicalize fields →
content hash → authoritative write + immutable revision snapshot →
commit → best-effort chunking → best-effort embeddings → index → audit.

**Critical failure contract:** embedding failure keeps the authoritative
memory, marks indexing `pending`/`degraded`, and keyword recall continues.
The write is never rolled back because a provider is down.

## Canonical hashing

`contentHashOf` = sha256 over `{workspaceId, projectId, title, content,
kind, sourcePath}` — mutable operational metadata (revisions, indexing
state) is excluded, so identical canonical content always yields the same
hash (dedupe + idempotent import).

## Chunking (spec §9)

Deterministic whitespace-token sliding window: target 450 tokens,
overlap 60, max 256 chunks/memory, stable ordering, revision+hash
attached per chunk. Rebuild rechecks the source revision/hash before
replacing derived rows.

## Retrieval (spec §10-§13)

- **keyword** — normalized term scoring over title (×3) + content with
  term-frequency clamping; transparent and dependency-free.
- **semantic** — chunk vectors via the `EmbeddingProvider` contract; the
  P0 provider is a local hashing-trick embedding (L2-normalized, cosine
  similarity). Fails explicitly unless fallback is allowed.
- **hybrid** — Reciprocal Rank Fusion, `score = Σ 1/(k + rank)`, k=60;
  works without a reranker.

Degradation: hybrid + provider failure → keyword with `degraded: true,
degradeReason: embedding_provider_failure` (if allowed); semantic-only
without fallback → typed `SEMANTIC_UNAVAILABLE` error; infrastructure
errors keep their real category; trace-write failure never masks recall.

## Provenance (spec §14)

Observations store exact source snapshots: memory id + revision + hash +
evidence JSON. Revising a source never rewrites an existing observation's
evidence — old observations keep pointing at the old revision.

## Supersession (spec §15)

`supersedes A @ revision N / hash H` snapshots are captured at link
creation and never dynamically reinterpreted. Superseded memories drop
out of default recall candidates but remain inspectable.

## Traces (spec §19)

Query hash (sha256) + length + mode + degradation + provider + latency +
per-result rank/score provenance. Raw queries, memory bodies and tokens
are never stored. Retention: `MEMORY_TRACE_MAX_COUNT` /
`MEMORY_TRACE_RETENTION_DAYS` with batched pruning.

## Database (schema v41)

21 additive tables: `memory_workspaces`, `memory_projects`,
`memory_agents`, `memory_items` (canonical pointer), `memory_revisions`,
`memory_tags`, `memory_tag_links`, `memory_chunks`, `memory_embeddings`,
`memory_observations`, `memory_observation_sources`,
`memory_supersession_links`, `memory_search_traces`,
`memory_search_trace_results`, `memory_mutation_previews`,
`memory_idempotency_keys`, `memory_oauth_clients`,
`memory_oauth_authorization_codes`, `memory_oauth_access_tokens`,
`memory_oauth_refresh_tokens`, `memory_oauth_consents`.
