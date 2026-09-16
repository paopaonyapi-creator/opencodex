# Upstream Reference (Phase 20.40 licensing guardrail)

| Field | Value |
|---|---|
| Upstream URL | https://github.com/Soul-Brews-Studio/jsonl-liveness |
| Date checked | 2026-09-13 |
| License detected | Not verified as compatible at implementation time (no explicit compatible license was confirmed in this environment) |
| Implementation decision | **Clean-room re-implementation.** No upstream source code, test fixtures, UI implementation, or distinctive comments were copied. |

## Concept mapping (architecture only)

| Upstream concept | Pao-hubPro Phase 20.40 equivalent |
|---|---|
| hot / warm / cool / dead | `active` / `recent` / `idle` / `stale` (and `unknown` when evidence is insufficient; "dead" is never a verdict) |
| JSONL scanner | pluggable `ObservabilityAdapter` contract + `scanner.ts` |
| stat revision | `revisionOf()` FileRevisionEvidence (mtime + ctime + size + file id) |
| recent record | `NormalizedAgentEvent` |
| PID evidence | `ProcessEvidence` engine (cached argv-only OS scan + Pao child-process registry) |
| timeline | Fleet timeline (`/timeline`, bounded, filterable) |
| snapshot | `FleetSnapshot` (single-flight shared scan) |
| session detail | Session Inspector (REST detail + dashboard tab) |
| SHA-256 check | `IntegrityEngine` (on-demand, cached by revision, force bypass) |
| names.json | `observability_aliases` table (Pao-owned metadata; source untouched) |
| SSE snapshot | `GET /api/agent-os/observability/events/stream` with monotonic sequence + replay token |

## Deliberate divergences

- No per-client scanning: one shared single-flight backend scan fans out to all clients.
- No background timers: scans run on demand behind a min-interval gate (simpler, additive-safe, same effect).
- Process evidence on Windows uses `tasklist` CSV via literal argv (no PowerShell, no execution-policy changes); name-only OS matches carry 0.05 confidence and never claim session association.
- `not_observed` and `unknown` exist as first-class process states; upstream's "dead" is intentionally absent.
- The Codex adapter reads the Phase 20.21 runtime tables instead of scraping Codex-owned files (higher fidelity, no undocumented file assumptions).
