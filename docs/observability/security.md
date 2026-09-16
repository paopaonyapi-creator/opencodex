# Observability Security Model (Phase 20.40)

## Read-only invariant

- No endpoint, MCP tool, or internal path can mutate a monitored transcript, kill/restart a process, or send a prompt. No `agent.kill` / `agent.restart` / `agent.send_prompt` / `agent.run_command` exists.
- Integrity verification streams the file through SHA-256 and writes only a Pao-owned record; verified in tests that transcript bytes and mtime are unchanged through scans, alias writes and verification.

## Network & auth

- Observability routes live under the management API (`/api/agent-os/observability/*`) and inherit its admin-token auth and loopback default binding. There is no separate listener and no unauthenticated surface.
- CORS follows the existing management allowlist; credentials are never accepted in URL query strings.
- `OBSERVABILITY_ENABLED=false` disables the plane entirely: routes answer `{enabled:false}` and no filesystem/process scanning occurs.

## Path safety

- Sources must resolve inside their configured root; `realpath` resolution catches symlink escapes (directory symlinks are never followed).
- Discovery walks a bounded file count and depth; files deleted mid-scan are handled softly.
- Integrity endpoints operate ONLY on the registered source path of an observed session — arbitrary file paths are structurally unrequestable.

## Privacy

- Absolute paths are hidden from API/UI output by default (`OBSERVABILITY_EXPOSE_ABSOLUTE_PATHS=false`) and not persisted (`OBSERVABILITY_PERSIST_ABSOLUTE_PATHS=false`); a SHA-256 path hash is the durable correlation key.
- Content previews are redacted and bounded; persistence of previews can be disabled (`OBSERVABILITY_PERSIST_CONTENT_PREVIEW=false`).
- Raw process command lines are never persisted — only a hash (and on Windows `tasklist` does not expose them at all).

## Redaction

Centralized layering: repo-wide 20.35 regex scrubber + 20.28 key-name scrubber, extended with OpenAI/Anthropic key, GitHub token, Slack token, bearer, JWT, database-URL and private-key patterns. Applied before any persistence, API response, or MCP output. Originals are never logged. Unit tests cover every pattern class plus nested-structure sanitization.

## Process scanning

`spawnSync` with a literal binary and literal flag arrays (`tasklist /fo csv /nh` on Windows, `ps -eo pid=,comm=` on Unix), 5s timeout, output caps, 10s shared cache, fail-soft (`unknown`, never "stopped"). No shell interpolation anywhere; no PowerShell execution-policy changes.

## Data handling

- Bounded retention (default: events 7d, scan cycles 7d, process evidence 24h, alerts/integrity 30d) runs in batches against Pao-owned tables only; source transcripts are never touched.
- No stack traces or raw payloads reach ordinary API error responses.
