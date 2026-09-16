# Observability Architecture (Phase 20.40)

Read-only agent observability for Pao-hubPro: JSONL liveness, session
health and live activity for Claude Code, Codex, Pao-native agents and
user-configured generic JSONL runtimes.

## Planes

```text
Execution Plane (agents, CLIs, runtime tables)
    |  emits evidence (transcript bytes, DB rows, process table, event bus)
    v
Observability Core  (src/agent-os/agent-observability/)
    |  read-only scan -> normalize -> derive -> persist -> alert
    v
REST + SSE + MCP  ->  Agent Fleet dashboard
```

The observability plane NEVER mutates a monitored source, never controls a
process, and never sends prompts. The only writes are Pao-owned metadata
(aliases) and integrity-check records in Pao's own database.

## Core components

| Component | File | Responsibility |
|---|---|---|
| Scanner | `scanner.ts` | stat-first revision tokens, bounded backward tail reads (complete newline-terminated records only), bounded head reads, path/root safety, directory-symlink refusal |
| Adapters | `adapter-claude.ts`, `adapter-misc.ts` | Claude JSONL (~/.claude/projects), Codex (20.21 `codex_runtime_*` tables), Pao-native (20.39 `cc_sessions`/`cc_session_events`), generic JSONL (config-driven field mapping) |
| Normalizer | `normalizer.ts` | five INDEPENDENT state planes + transparent confidence |
| Process evidence | `process-evidence.ts` | cached 10s argv-only OS scan + Pao child-process registry; fail-soft |
| Integrity | `integrity.ts` | on-demand SHA-256, cached by source revision, force bypass |
| Persistence | `persistence.ts` | 9 `observability_*` tables (schema v40), batched retention |
| Engine | `engine.ts` | single-flight shared scan, cache, SSE ring buffer, alerts wiring, stats |
| Alerts | `alerts.ts` | built-in conditions, dedupe keys, cooldown, resolution |

## State planes (independent, evidence-backed)

- **Activity** — `active` (<2m) / `recent` (<15m) / `idle` (<2h) / `stale` / `unknown`, from recorded event timestamps, falling back to file mtime at low confidence. Future timestamps clamp to zero age.
- **Process** — `running` only on exact (registry) PID evidence; scan success without a match is `not_observed` (never "stopped"); scan failure is `unknown`.
- **Execution** — direct event evidence only (open tool call → `tool_running`, explicit end → `completed`, error → `failed`); otherwise `unknown`.
- **Health** — `error` (explicit failure/unreadable), `stalled` (process running + active execution + no progress ≥ threshold + no waiting signal), `degraded` (malformed/conflicting), `healthy`, else `unknown`. Inactivity alone never implies completed.
- **Integrity** — `unchecked` → `verified`/`changed` via on-demand SHA-256. A changed hash reads "content changed since the previous verified revision", never "tampered".

## I/O discipline

- stat first; unchanged revision ⇒ cached result reused, no tail reread, no hashing.
- Tail reads are one bounded window (`OBSERVABILITY_DETAIL_TAIL_MAX_BYTES`, default 256 KiB); an unfinished suffix stays invisible; a record larger than the budget reports `TAIL_LIMIT_REACHED` rather than a truncated parse.
- No full-history indexing during scans; timeline/event endpoints are hard-capped.
- One shared backend scan (single-flight + min-interval) fans out to every client; there is no per-browser scanner and no background timer — scans run on demand from API/SSE/MCP calls.

## Failure isolation

One malformed/unreadable source produces a structured `SessionObservationError` on that session and an adapter-error counter on the scan cycle; every other session remains observable. Adapter exceptions never propagate to callers.
