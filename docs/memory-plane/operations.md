# Memory Plane Operations (Phase 20.41)

## Preflight (`GET /api/memory/preflight`)

Checks: database reachable, chunk geometry valid
(target > overlap > 0), signing secret state (warns when falling back to
the machine-local generated secret), OAuth issuer configured (warns when
unset), remote embedding provider warning when configured. Exit-style:
`ok: false` lists hard failures.

## Contract verifier (`GET /api/memory/verify`)

Validates response BODIES after deployment: scope registry consistency,
keyword/semantic/hybrid recall smoke tests (effective modes asserted),
embedding provider health, trace hash redaction, migration version.
`ok: false` names the failing check.

## Indexing behavior

- Chunks + embeddings are derived; `indexing_state` per memory is
  `ready` / `pending` / `degraded` and visible on the dashboard.
- A failed embedding never destroys the authoritative write; the memory
  stays recallable by keyword.
- Rebuild (preview → confirm) rechecks each memory's revision/hash
  before replacing derived rows, processes bounded batches
  (`MEMORY_REBUILD_MAX_MEMORIES_PER_CALL`,
  `MEMORY_REBUILD_MAX_CHUNKS_PER_CALL`), skips stale items, and reports
  partial outcomes.

## Retrieval modes

- `keyword` — always available, deterministic.
- `semantic` — requires a healthy provider; fails explicitly unless
  `allowFallback`.
- `hybrid` — RRF fusion; degrades to keyword with an explicit reason.

Keyword-only/local mode: keep `MEMORY_EMBEDDING_PROVIDER=local` (default)
— no memory text leaves the host.

## Backup / export / restore

```bash
# export authoritative corpus + metadata (JSON, deterministic)
curl ":10100/api/memory/export?workspace=pao-hubpro" -H "authorization: Bearer $TOKEN" > memory-backup.json

# restore (dry-run first: reports created/skipped/conflicted by content hash)
curl -X POST :10100/api/memory/import -H "authorization: Bearer $TOKEN" \
  -d '{"workspace":"pao-hubpro","dryRun":true,"items":<backup.memories>}'
curl -X POST :10100/api/memory/import -H "authorization: Bearer $TOKEN" \
  -d '{"workspace":"pao-hubpro","dryRun":false,"items":<backup.memories>}'
```

Embeddings are not required in backups — they are rebuildable via the
bounded rebuild flow.

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `MEMORY_DISABLED` | `MEMORY_ENABLED=false` — enable to activate routes. |
| `MEMORY_SCOPE_DENIED` | Token/actor lacks the canonical scope; re-grant with consent. |
| `REVISION_CONFLICT:409` | Optimistic concurrency — re-read and retry with fresh revision/hash. |
| `stale_preview` | Source changed after preview — issue a fresh preview. |
| `already_consumed` | Receipt replay — previews are single-use. |
| `embedding_provider_unavailable` | Semantic degraded; keyword still works; check provider config. |
| Empty recall | Check workspace + filters; keyword needs terms ≥2 chars present in title/content. |
| Index pending/degraded | Provider was down during write; run bounded rebuild after recovery. |

## Retention

Traces: `MEMORY_TRACE_MAX_COUNT` (count cap) and
`MEMORY_TRACE_RETENTION_DAYS` (age cap), pruned in batches. Operational
data only — authoritative memories are never deleted by retention.
