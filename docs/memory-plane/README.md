# Memory Plane (Phase 20.41)

A trustworthy, provider-agnostic, MCP-native shared memory plane: every
Pao-hubPro agent (Codex, Claude, local LLMs, reviewers, browser agents)
reads and writes the same governed memory with explicit authority,
provenance, revisioned history, explainable recall, preview-confirm
mutations and scoped OAuth for remote clients. Clean-room implementation
inspired by Arra Memory Lab concepts — no upstream code.

## The five guarantees

1. **Authority** — every memory is `authoritative` / `derived` /
   `observed` / `ephemeral`. Promotion is explicit; low-trust agents
   cannot write authoritative memories.
2. **Immutable history** — every canonical edit creates a revision
   snapshot with a deterministic content hash; history is never
   overwritten.
3. **Honest recall** — every response reports requested vs effective
   mode, degradation state + reason, provider, rank provenance, score
   components, revision + content hash.
4. **Safe mutation** — forget/rebuild are preview-first with server-signed
   receipts; stale state returns a conflict and mutates nothing.
5. **Portable providers** — store/vector/embedding adapters; the P0
   embedding provider is a local deterministic hashing provider (no
   network, no memory text leaves the host).

## Quick start

```bash
# memory plane is enabled by default (MEMORY_ENABLED=true)
bun run src/cli/index.ts start --port 10100

# remember
curl -X POST :10100/api/memory/memories -H "authorization: Bearer $TOKEN" \
  -d '{"title":"...","content":"...","kind":"decision","authority":"authoritative"}'

# recall (hybrid default)
curl -X POST :10100/api/memory/recall -H "authorization: Bearer $TOKEN" \
  -d '{"query":"what safety rule applies before deleting memory?","mode":"hybrid"}'
```

Dashboard: `#/memory-plane` — Overview, Explorer, Recall Lab, Mutation
Safety, OAuth Clients.

## Documentation map

- [architecture.md](./architecture.md) — planes, pipeline, degradation
- [security.md](./security.md) — scopes, OAuth, redaction, privacy
- [mcp-tools.md](./mcp-tools.md) — tool contracts + risk classes
- [oauth.md](./oauth.md) — flows, DCR, PKCE, rotation
- [operations.md](./operations.md) — preflight, verify, backup, troubleshooting

## Local-only mode

With `MEMORY_EMBEDDING_PROVIDER=local` (default) nothing leaves the host:
keyword recall always works, semantic recall uses the local hashing
provider, remote providers stay disabled. With `MEMORY_ENABLED=false` the
plane is fully off and routes answer a clear disabled state.

## Deviations from the spec's literal text

- The canonical table is `memory_items`, not `memories`: a legacy
  Phase-18 `memories` table already exists in the shared store and is left
  untouched (spec §48 migration strategy, §6 naming adaptation clause).
- MCP tool names use the repo's snake_case convention (`memory_remember`)
  with stable logical contracts per spec §21.
- SQLite FTS5 availability varies across Bun builds; keyword recall uses
  transparent in-process normalized term scoring (spec §10.1 permits a
  fallback strategy).
