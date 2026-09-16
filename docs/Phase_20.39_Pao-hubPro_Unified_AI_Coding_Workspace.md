# Phase 20.39 — Pao-hubPro × ARRA-inspired Claude Code Native Session Cockpit, Local CLI Bridge & Unified AI Coding Workspace

Owner document for the Phase 20.39 route-registry verb deferral
(`CODING_WORKSPACE_VERB_DEFERRAL`). This file records the shipped scope,
the reuse map, and the follow-up CLI/dashboard verbs intentionally
deferred.

## What shipped

- **Module**: `src/agent-os/coding-cockpit/` (16 files, clean-room
  implementation; no upstream ARRA/cc-chat-ui code).
- **Database**: schema v39 — `cc_workspaces`, `cc_providers`,
  `cc_provider_instances`, `cc_sessions`, `cc_session_events`,
  `cc_runs`, `cc_tool_executions`, `cc_context_refs`, `cc_approvals`,
  `cc_locks`, `cc_usage`, `cc_artifacts`, `cc_audit`. Additive
  `CREATE TABLE IF NOT EXISTS` only.
- **REST**: 34 full-literal routes under `/api/agent-os/coding-workspace/*`
  (the 20.27 agency cockpit keeps `/api/agent-os/cockpit`).
- **SSE**: `GET …/sessions/stream?id=` with event ids, replay via
  `after`/`Last-Event-ID`, 15s keep-alives, disconnect-safe fan-out.
- **WebMCP**: 13 `cockpit_*` tools; mutating tools route through the
  policy → approval → lock → audit pipeline.
- **GUI**: `gui/src/pages/CodingWorkspace.tsx` (sidebar / conversation /
  inspector / composer), hash page `coding-workspace`, nav keys ×10
  locales.
- **Tests**: `tests/coding-cockpit.test.ts` — 32 tests covering the
  spec §48 mandatory security cases (path escape, writer conflict,
  expired-lease reclaim, healthy-takeover gate, policy deny, secret
  redaction) plus policy/risk tables, approval binding, event
  idempotency/replay, mock lifecycle, native import idempotency, usage
  source separation.

## Reuse map (nothing duplicated)

| Spec area | Reused |
|---|---|
| Process execution (§20, §33) | 20.24 `runProcessSafely` (allowlist extended with `claude`/`codex` CLIs, exactly how 20.33 added git/bun) |
| Path containment (§37) | 20.27 `isInsideWorkspace` + new canonicalization/null-byte guards |
| Redaction (§36) | 20.35 `redactSecrets` + 20.28 `redactValue`, key-name scrub |
| Codex adapter (§9) | Wraps 20.21 `CodexRuntimeService`/`CodexEventBus`/`CodexDetector` — no 20.21 duplication |
| Auth/LAN (§21) | Existing management API auth (admin token, loopback) |
| MCP (§40) | Existing WebMCP definition pattern (`../video/mcp-tools`) |
| Patterns | Store-boundary runners, human-actor invariants, `perform` vocabulary from 20.33–20.38 |

## Deferred verbs (this deferral's scope)

CLI/dashboard verbs beyond the shipped REST+GUI surface are deferred to
the Phase 20.39 dashboard/CLI follow-up and recorded here: none of the
shipped routes are placeholders; the deferral covers only additional
ergonomic verbs (e.g. a `ocx coding-workspace …` CLI subcommand family),
per the registry's deferred-verb convention.

## Security constraints verified (spec §53)

- Read-only default execution level; PRIVILEGED never automatic.
- `--dangerously-skip-permissions` triple-gated (env + trust + explicit flag), default OFF.
- Approvals single-use, hash-bound to exact action parameters, human-actor-only.
- One-writer lock atomic via partial UNIQUE index; takeover audited.
- No unrestricted shell endpoint; argv-only allowlisted bridge.
- Context refs and tool paths cannot escape the workspace root.
- Secrets redacted before audit/event persistence (regex + key-name).
- Usage unknowns stay unknown — nothing invented.
