# Memory Plane MCP Tools (Phase 20.41, spec §21-§22)

Registered in the CENTRAL Pao-hubPro WebMCP gateway (no second MCP
endpoint). Logical contracts are stable; tool names follow the repo's
snake_case convention.

## P0 tools

| Tool | Risk class | Scope | Notes |
|---|---|---|---|
| `memory_info` | READ_ONLY | authenticated | capability/provider metadata only |
| `memory_remember` | WRITE_REVERSIBLE | memory:write | revision snapshot; `idempotencyKey` supported; survives embedding failure |
| `memory_recall` | READ_ONLY | memory:read | keyword/semantic/hybrid; honest mode/degradation reporting |
| `memory_observe` | WRITE_REVERSIBLE | memory:write | evidence-backed, never auto-promoted |
| `memory_forget_preview` | DESTRUCTIVE_PREVIEW | memory:delete | impact snapshot + signed receipt |
| `memory_forget_confirm` | DESTRUCTIVE_CONFIRM | memory:delete | exact execution; stale → conflict |
| `memory_rebuild_preview` | DESTRUCTIVE_PREVIEW | memory:admin | bounded rebuild plan |
| `memory_rebuild_confirm` | ADMIN | memory:admin | bounded batches; per-memory source recheck |
| `memory_stats` | READ_ONLY | memory:read | counts + provider health, no secrets |
| `memory_trace_list` | READ_ONLY | memory:trace | query hashes only |
| `memory_trace_get` | READ_ONLY | memory:trace | result provenance (rev/hash/rank/scores) |

## P1 tools shipped with P0

`memory_list_workspaces`, `memory_list_projects`, `memory_list_tags`
(memory:read). Digest, time-bounded search, agent listing and
`memory_list_tools` remain P1 (contracts reserved in types.ts).

## Explicitly NOT implemented (spec §29, §59)

`agent.kill`, `agent.restart`, `agent.send_prompt`, `agent.run_command`
— the Memory Plane has no execution or control tools.

## Example: memory_remember

```json
{
  "title": "Use preview before destructive mutations",
  "content": "All destructive memory operations require preview and an exact server-issued confirmation receipt.",
  "kind": "decision",
  "authority": "authoritative",
  "tags": ["safety", "memory", "architecture"]
}
```

Response:

```json
{
  "memoryId": "mem_...",
  "revision": 1,
  "sourceHash": "sha256:...",
  "indexing": { "status": "ready", "chunks": 1, "provider": "local-hash", "degradeReason": null },
  "duplicate": false
}
```

## Example: stale preview (spec §56)

1. `memory_forget_preview(mem_A)` → snapshot revision 3 / hash H3
2. Another actor edits mem_A → revision 4 / hash H4
3. `memory_forget_confirm(mem_A, oldReceipt)` → conflict `stale_preview`
4. A fresh preview + confirm is required; nothing was mutated in step 3.
