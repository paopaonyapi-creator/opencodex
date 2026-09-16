# Graft integration (Phase 20.62)

Upstream: https://github.com/trailhq/Graft — package `@nanonets/graft`,
"build a repo's context graph as a folder of linked markdown files".

## Compatibility record

| Field | Value |
|---|---|
| Package | `@nanonets/graft` |
| Pinned version | `0.18.0` (npm latest, published 2026-09-10) |
| License | MIT (verified via npm registry + repo) |
| Runtime requirement | Node.js `>=20` |
| Verified on | 2026-09-16 |
| Version policy | `compatible` (same major+minor) by default; `exact` optional |
| Install strategy | controlled installed tool on the operator host (`PAO_GRAFT_BIN`), not an unpinned runtime install |

Graft is **not vendored** and **not a runtime dependency** of Pao-hubPro. The
adapter shells out to the `graft` binary through a runner seam (argv arrays
only) and fails closed when the binary is missing or drifted. The Pao-side
adapter code in `src/agent-os/code-intelligence/` is original.

## Verified CLI surface used by the adapter

| Provider operation | Command |
|---|---|
| `buildGraph` | `graft build [--deep] [--extensions …]` |
| `checkFreshness` | `graft check --json` (exit 1 + JSON on drift) |
| `findCode` | `graft ask "<question>" --json [--in <scope>]` |
| `getFileApi` | `graft skeleton <file>` |
| `findAll` | `graft grep <pattern> [-i] [--in <scope>]` |
| `traceCalls` | `graft callers <symbol> --direction in\|out -d N` |
| `blastRadius` | `graft blast --format json --depth all [--base <ref>]` |
| `getRepositoryMap` | `graft map [--max-dirs N]` |
| health/version | `graft version` |

JSON output is used where documented (`ask --json`, `check --json`,
`blast --format json`); the rest is parsed defensively and bounded.

## MCP

Graft ships an MCP server (`graft mcp`) with tools `graft_find_code`,
`graft_file_api`, `graft_trace_calls`, `graft_find_all`, `graft_repo_map`,
`graft_check_freshness`. **Pao-hubPro never exposes the raw Graft MCP to
agents or browsers.** Agents use the Pao-owned Context Gateway tools
(`pao_repo_map`, `pao_find_code`, `pao_file_api`, `pao_find_all`,
`pao_trace_dependencies`, `pao_check_code_context`, `pao_get_impact_report`)
which add identity, scope, path policy, budgets, evidence, and audit.

## Telemetry

Disabled by default: the runner always injects `DO_NOT_TRACK=1` into the
Graft process environment, independent of the host shell. Operators may opt
in explicitly via `PAO_GRAFT_TELEMETRY=true`; the setting never re-enables
itself on upgrade and is surfaced in `GET /api/agent-os/code-intelligence/provider/status`.

## Deep enrichment (Tier 2)

Off by default (`PAO_GRAFT_DEEP_ENRICHMENT=false`). When enabled, upstream
`--deep` calls the model provider configured for Graft (its own env keys) —
Pao-hubPro never injects its own provider keys into agent prompts, and deep
enrichment never becomes a prerequisite for the structural tier.

## Machine-wide configuration guard

Upstream `graft init` can write user-level agent configuration
(`~/.codex/**`, `~/.claude/**`, `.claude/`, `AGENTS.md`, MCP configs).
Pao-hubPro never invokes `graft init`; `PAO_CODEINTEL_ALLOW_MACHINE_WIDE_CONFIG`
defaults to **false** and every attempt to bypass the guard is audited
(`codeintel.machine_config.denied`).

## Known limitations

- Request/response schemas beyond the JSON flags above are undocumented
  upstream; the parser normalizes defensively and degrades to empty results
  rather than guessing.
- Graph state is a regenerable local cache (`graft/`); it is gitignored by
  upstream and never treated as a canonical Pao record.
- `callers` text output parsing is best-effort (no JSON flag documented).

## Upgrade procedure

1. Read the upstream changelog; note renamed/removed CLI flags or MCP tools.
2. Install the new version on a staging host (`npm i -g @nanonets/graft@<ver>`).
3. Update `PAO_GRAFT_PINNED_VERSION`; run the fixture integration tests
   (`bun test tests/code-intelligence.test.ts`).
4. Re-verify telemetry stays off and the machine-config guard holds.
5. Record the new version here and in the phase report; operator approves rollout.

## Rollback procedure

Set `PAO_GRAFT_ENABLED=false` — the module goes inert (lazy-activated from
routes/MCP only). Read-only fallback results are explicitly marked
reduced-confidence; high-risk gates block without the provider. Canonical
records (registry, evidence, impact reports, audit) live in Pao SQLite and
survive removal; the `graft/` cache directory can be deleted freely.
