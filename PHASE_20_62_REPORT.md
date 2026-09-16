# PHASE_20_62_REPORT.md — Pao-hubPro × Graft Code Intelligence Control Plane

Implementation report for Phase 20.62. Compatibility record:
`docs/integrations/graft.md`. Security model: `docs/security/code-intelligence.md`.
Runbook: `docs/runbooks/graft-code-intelligence.md`.

## A. Architecture discovered

- **Pao-hubPro:** Bun-native TypeScript; shared SQLite via `src/agent-os/db.ts`
  (schema v49 → **50**); management routes under `/api/agent-os/*` with
  prefix-decode dispatchers; module conventions from the capability-lab /
  social-publishing / agent-runtime lineage (pure policy functions, module
  audit tables, `WebMcpToolDefinition`, injectable seams, `ur-*` GUI pages).
- **Upstream Graft:** `@nanonets/graft@0.18.0` (npm latest, published
  2026-09-10), MIT, Node `>=20`. CLI verified against the README: `build`
  (structural tree-sitter, no LLM key), `ask --json`, `skeleton`, `callers
  --direction/-d`, `grep`, `map`, `blast --format json`, `check --json`
  (exit 1 on drift), `version`; telemetry off via `DO_NOT_TRACK=1` /
  `graft telemetry disable`; MCP tools match the spec's six names.

## B. Files added/changed

**New — `src/agent-os/code-intelligence/`**

- `types.ts` — provider-neutral contract, scope model, graph lifecycle,
  risk/impact/evidence/context-pack models, audit event names
- `config.ts` — `PAO_CODEINTEL_*` / `PAO_GRAFT_*` (safe defaults)
- `scope.ts` — path canonicalization, default-deny sensitive prefixes
  (glob-correct), traversal rejection, CLI-argument validation, cross-repo gate
- `risk.ts` — §16 factor scoring, configurable thresholds, §17 policy per
  level with freshness gate, §29 escalation rule
- `store.ts` — `ci_*` CRUD, audit (static SQL only)
- `fingerprint.ts` — working-tree fingerprint (HEAD + porcelain), not just SHA
- `provider/graft/runner.ts` — runner seam; execFile implementation with
  argv arrays, scrubbed env, timeout/kill, capped output
- `provider/graft/adapter.ts` — GraftProvider + output parsers + version gate
- `provider/fallback.ts` — reduced-confidence filesystem fallback
- `service.ts` — Context Gateway: registry, lifecycle, scoped queries +
  evidence, Pre-Edit Impact Gate, Post-Edit Verification (impact delta),
  context packs, cross-repo federation, provider status, machine-config guard
- `mcp-tools.ts` — 8 Pao-owned tools (`pao_repo_map`, `pao_find_code`,
  `pao_file_api`, `pao_find_all`, `pao_trace_dependencies`,
  `pao_check_code_context`, `pao_get_impact_report`, `pao_create_impact_report`)

**Changed**

- `src/agent-os/db.ts` — v50 (6 `ci_*` tables + `ci_audit`, indexes)
- `src/server/management/agent-os-routes.ts` — chain link
- `.env.example` — Phase 20.62 block

**New — routes/tests/docs/GUI**

- `src/server/management/code-intelligence-routes.ts`
- `tests/code-intelligence.test.ts`, `tests/helpers/graft-fake.ts`
- `gui/src/pages/CodeIntelligence.tsx`, App/routing/i18n ×10, oxlint entry
- the three docs above + this report

## C. DB migrations

`AGENT_OS_SCHEMA_VERSION` 49 → 50: `ci_repositories`,
`ci_workspace_repositories`, `ci_graph_builds`, `ci_evidence`,
`ci_impact_reports`, `ci_provider_status`, `ci_audit` + indexes
(repository/time, risk level, workspace membership). Additive only.

## D. API routes (all under `/api/agent-os/code-intelligence`)

`GET health` · `GET provider/status` · `GET|POST repositories` ·
`repositories/:id` (GET) · `repositories/:id/{build,check,map,find,file-api,
find-all,trace,impact,post-edit-verify,context-pack,evidence,impact-reports}`
· `GET impact-reports[/:id]` · `POST workspace/join` · `GET audit` ·
`GET mcp-tools`. Build/registration are operator actions; all queries
authenticate through the service and enforce scope server-side.

## E. Security decisions

- Raw Graft MCP is never exposed; agents use Pao-owned wrappers that enforce
  identity → scope → path policy → budget → evidence → audit.
- Repository roots come only from the operator registry; registration
  canonicalizes paths via realpath (symlink escapes reject).
- Sensitive prefixes are always denied (`.env`, `secrets/`, `*.pem`, …) with a
  glob matcher that cannot over-match (regression-tested).
- CLI invocation: argv arrays, `assertSafeCliArg` rejects option-shaped
  values, env scrubbed to `PATH`/`HOME`/`DO_NOT_TRACK=1`, hard timeout, output cap.
- Telemetry force-disabled at the process level; machine-wide agent-config
  writes (`graft init`) denied by default and audited.
- Evidence binds to a working-tree fingerprint; HIGH/CRITICAL requires fresh
  graph; HIGH on stale blocks; CRITICAL blocks autonomous mutation;
  post-edit delta escalates on risk growth or new dependents.
- Context packs label repository-derived text as **data, not instructions**.

## F. Tests run/results

`bun test tests/code-intelligence.test.ts` — **34 pass / 0 fail** (129 expect
calls): scope/traversal/sensitive-prefix/cross-repo/CLI-arg rules; risk
scoring, thresholds, policy per level, freshness gate, escalation; lifecycle
transitions; all four output parsers; version parsing + compatible/exact
policies; telemetry env; adapter argv discipline (including flag-injection
rejection and depth capping); check-drift mapping; registration
dedupe; build→ready lifecycle with audited records; evidence persistence +
scope-violation audit; impact gate LOW vs CRITICAL (protected auth path,
stale graph → blocked); high-risk fresh → independent review; post-edit delta
escalation; provider-unavailable fallback (reduced confidence) + high-risk
block; multi-repo cross-repo denial; machine-config denial; bounded context
pack with the data-not-instructions constraint; stale-surfacing; route tests.

Also re-run in the final gate: `management-route-registry`,
`repo-hygiene`, `agent-os-routes`, `social-publishing`, `agent-runtime`
(see §I).

## G. Known limitations / remaining enhancements

- Only the documented JSON flags are parsed structurally; `map`/`skeleton`/
  `grep`/`callers` remain text-based best-effort parsing (upstream has no
  documented JSON for them at 0.18.0).
- Cross-repo federation resolves sibling repositories in an approved
  workspace but per-child graph federation relies on Graft's workspace mode;
  deep integration (fused scope labels) lands with a live Graft install.
- The actual `graft` binary is not installed in this environment — the
  adapter is verified through the runner/provider seams with deterministic
  fakes, exactly so a live-binary conformance pass can be added later without
  touching domain code.
- Affected-test selection uses blast-radius evidence; wiring it into the
  20.61 test planner as a hard requirement is follow-up work.

## H. Pinned upstream

`@nanonets/graft@0.18.0`, MIT, Node >=20 — recorded in
`docs/integrations/graft.md`; runtime gate fails closed on drift.

## I. Verification summary

| Gate | Result |
|---|---|
| `bun run typecheck` | 0 errors in phase files (pre-existing errors elsewhere untouched) |
| `bun test tests/code-intelligence.test.ts` | 34/34 pass |
| Focused regression set (route-registry, repo-hygiene, agent-os-routes, social-publishing, agent-runtime) | all pass (see final gate run) |
| `lint:gui` / GUI tsc / vite build | clean |
| `privacy:scan` | 0 findings in phase files |

## J. Rollback

`PAO_GRAFT_ENABLED=false` renders the module inert (lazy-activated from
routes/MCP only; never on the core request path). Fallback results are
explicitly reduced-confidence; high-risk gates block without the provider.
Schema v50 is additive — drop the `ci_*` tables and revert the version
constant only if no later migration landed. Canonical audit/evidence/impact
history persists in SQLite.
