# Memory Adapters (Phase 20.43)

The adapter registry (`memory_agent_adapters`) seeds three governed
surfaces; all future agents plug into the same contract.

## Codex adapter

Detection/diagnostics (read-only, surfaced in doctor + dashboard health):
- `~/.codex` presence
- PLUR MCP registration inside Codex config
- `~/.codex/hooks.json` integration
- `AGENTS.md` memory-instruction section
- **hook trust: always reported MANUAL** — Codex requires the user to
  trust installed hooks via `/hooks`; this cannot be verified
  programmatically and the reminder is surfaced in every doctor run.

Setup helper (optional, dry-run default): the upstream initialization
equivalent is `npx @plur-ai/cli init --codex`. Pao never overwrites user
hooks without backup/diff; a timestamped backup is created before any
modification, existing hooks are preserved, and the manual `/hooks` trust
step is documented. No auto-installs in production.

## Hermes adapter

- Detects Hermes availability, `plur-hermes` plugin, PLUR CLI presence.
- Installation (`pip install plur-hermes`, `npm install -g
  @plur-ai/cli`) is operator-initiated only — never auto-run.
- Auto-inject/auto-learn capabilities reported per detection.
- Native Hermes→PLUR writes that bypass Pao are labeled
  **external/native PLUR writes** during reconciliation — never presented
  as policy-approved.

## MCP gateway

12 governed tools in the central WebMCP gateway (`pao_memory_learn`,
`pao_memory_recall`, `pao_memory_inject`, `pao_memory_feedback`,
`pao_memory_forget`, `pao_memory_rescope`, `pao_memory_capture`,
`pao_memory_timeline`, `pao_memory_status`, `pao_memory_receipt`,
`pao_memory_sync_preview`, `pao_memory_doctor`). Each has strict
validation, explicit scope, bounded results, no raw filesystem path
exposure, and structured error codes
(`MEMORY_DISABLED`, `MEMORY_ENGINE_UNAVAILABLE`, `MEMORY_POLICY_DENIED`,
`MEMORY_APPROVAL_REQUIRED`, `MEMORY_SECRET_DETECTED`,
`MEMORY_SCOPE_INVALID`, `MEMORY_SCOPE_FORBIDDEN`, `MEMORY_NOT_FOUND`,
`MEMORY_CONFLICT`, `MEMORY_SYNC_DISABLED`, `MEMORY_SYNC_UNSAFE_REMOTE`,
`MEMORY_TIMEOUT`, `MEMORY_UPSTREAM_ERROR`).

Raw destructive sync/delete is NOT exposed to agents; sync execute stays
dashboard-gated.

## Future adapter contract

An adapter registers with: `adapter_key`, display name, type, capability
list, auto-inject/auto-learn flags, default scope, and trust level. All
operations still traverse the Pao policy engine and secret guard —
registry membership never bypasses governance.
