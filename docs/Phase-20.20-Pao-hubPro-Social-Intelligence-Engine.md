# Phase 20.20 — Pao-hubPro Social Intelligence Engine × Social Media Scraping API Router

> **Project:** Pao-hubPro
> **Phase:** 20.20
> **Status:** Core implemented and tested; dashboard and several operational surfaces deferred (accounted below)
> **Date:** 2026-09-11
> **Specification:** "Phase 20.19 — Pao-hubPro Social Intelligence Engine" working document (user-provided)
> **Reference:** `cporter202/social-media-scraping-apis` used as a catalog-architecture reference only; no code copied

## Numbering correction

The specification document names this phase 20.19. This repository already spent
**20.19 on the Universal Browser Provider** (`docs/Phase-20.19-Pao-hubPro-Universal-Browser-Provider.md`),
so the Social Intelligence Engine lands as **20.20**. Nothing in the spec's content
changed — only the number.

## What this phase is

A provider-agnostic Social Intelligence subsystem under `src/agent-os/social/`, built
alongside (not replacing) the Phase 20.10 `trends/` module. The trends module remains a
single-provider (Apify, mock-first) research pipeline; this phase adds the general
abstraction the spec asks for: a provider interface, a classified tool registry, an
explainable router, a central cost guard with approval semantics, a bounded-fallback
run lifecycle, normalized evidence with provenance, and an original-concept Adobe
Stock opportunity adapter.

## Section-by-section accounting

| Spec | Status | Notes |
|---|---|---|
| A. Provider abstraction | **Built** | `SocialDataProvider` interface (`provider.ts`); registry slot so future providers plug in without touching the research layer |
| Apify adapter | **Built, mock-first** | Live paths implemented against Apify Store API (`/v2/store`, paginated, bounded retry/backoff/timeout) and `run-sync-get-dataset-items`; `PAO_SOCIAL_MOCK_MODE` defaults **true** so offline/test behavior needs no token. Live runs have no automated coverage — first live contact will surface issues |
| B. Tool registry | **Built** | `social_tools` keyed by `(provider, externalId)`; classification, pricing state, internal reliability counters; missing metadata stays null |
| C. Discovery/refresh | **Built** | Idempotent upsert; missing tools are disabled (stale), never deleted; operator overrides (`enabled_source='operator'`) survive refresh; reappearing auto-disabled tools are restored; refresh summaries persisted |
| D. Capability taxonomy | **Built** | 22 capabilities, 14 platforms; deterministic keyword classifiers; `multi` only on explicit cross-platform titles; unknown stays unknown |
| E. Router | **Built** | Weighted scoring 35/20/15/15/10/5 with per-candidate reasons and risks; capability mismatch and over-budget are hard rejects; unknown metrics score neutral 0.5 with a risk note — never a perfect score |
| F. Cost Guard | **Built** | Five states (`allow`, `allow_with_warning`, `require_approval`, `block_budget_exceeded`, `block_unknown_cost`); daily/monthly/job ceilings from the usage ledger; estimated vs actual kept separate everywhere; every fallback candidate re-passes the gate |
| G. Run lifecycle + fallback | **Built** | Spec state machine on `social_research_jobs`; bounded attempts (`SOCIAL_MAX_PROVIDER_ATTEMPTS`, `SOCIAL_MAX_RETRIES_PER_TOOL`); fallback only on retryable codes; non-retryable failures terminate immediately |
| H. Normalization | **Built** | `NormalizedContentItem` with full provenance; common provider field variants mapped; unsafe URLs dropped; only normalized rows are stored (no raw-payload persistence exists to bound) |
| I. Dedupe | **Built** | Layered: platform+externalId → canonical URL (tracking params stripped) → conservative fingerprint (platform+author+text head+day). Similar text alone never merges posts |
| J. Trend intelligence | **Built** | Keyword/hashtag frequency, cross-platform recurrence, format recurrence — computed only from evidence rows, every signal carries its evidence refs |
| K. Adobe Stock handoff | **Built (adapter)** | `SocialStockOpportunity` with `evidenceConfidence` separate from `opportunityScore`; the score ships with a `scoreBasis` string stating it is a heuristic over observed social signals, not demand. Requires ≥ 3 unique evidence items before proposing anything |
| L. MCP tools | **Built** | All 12 spec tools as `SOCIAL_MCP_TOOLS` (dotted names, e.g. `social.route.preview`); `social.approve` is expressed through `POST /api/social/research {action:"approve"}` returning a single-use token |
| M. Database | **Built** | Schema **v26**: 9 additive `social_*` tables, all `CREATE IF NOT EXISTS`, indexes on provider/platform/status/created columns; no destructive migration |
| N. API | **Built** | 11 literal-guarded routes under `/api/social/*`, declared in the route registry with a `deferred-verb` exemption (this document is the owner doc). The deferred routes are: `GET /api/social/status`, `GET /api/social/providers`, `GET /api/social/tools`, `POST /api/social/registry/refresh`, `POST /api/social/route/preview`, `POST /api/social/run`, `GET /api/social/runs`, `POST /api/social/research`, `GET /api/social/research`, `GET /api/social/usage`, `GET /api/social/mcp-tools` |
| O. Dashboard | **Not built** | The five UI screens are deferred; the REST API + MCP surface expose all underlying data. GUI work also has its own PR screenshot requirements |
| P. Security | **Built (server side)** | Token never leaves the server; URL policy blocks non-HTTP schemes, credentials-in-URL, loopback/private/link-local/metadata targets; input clamps (`maxItems` hard limit); budget and approval gates are permission-model-agnostic until the dashboard lands |
| Q. Audit | **Partial** | Refresh summaries, run rows, fallback history, and usage ledger are persisted; the spec's named `SOCIAL_*` audit events are not wired into the platform audit stream yet |
| R. Observability | **Partial** | Structured fields live on the run/job/ledger rows; no separate structured log emitter was added |
| S. Tests | **Built** | `tests/social-intelligence.test.ts`: 35 tests covering classifiers, URL policy, error taxonomy, refresh idempotence/staleness/operator-override, routing, all five budget states, the full approval token flow (single use, expiry, amount, wrong token), fallback bounds, non-retryable termination, unknown-cost block, budget-block mid-life, normalization, layered dedupe, and the MCP surface (preview executes nothing) |
| T. Quality gate | **Reported below** | |

## Approval token design

`approveJob(jobId, {maxUsd})` issues one token, stored only as a SHA-256 digest with a
10-minute expiry and the approved maximum. Consumption verifies hash, expiry, and
amount, then clears the hash — single use by construction. There is no standing
"approve all" token. Fallback candidates run under the same approved ceiling instead
of demanding a fresh token, but still re-pass the budget ceilings.

## Safety properties

1. **No run bypasses the Cost Guard.** The initial decision, approval consumption,
   and every fallback candidate's pre-run check all go through the same `decide()`.
2. **`social.route.preview` cannot execute.** It reads the registry and provider
   metadata only; a test asserts zero provider runs exist after a preview.
3. **Unknown cost blocks paid auto-run.** A paid (or unknown-pricing) tool without a
   verifiable estimate answers `UNKNOWN_COST_BLOCKED` under the safe default.
4. **Evidence honesty.** Trend and opportunity outputs carry explicit labels ("not
   buyer demand"); opportunity scores explain their basis; unknown stays null.
5. **No scraped-media-to-stock path exists.** The adapter emits original-concept
   directions only; nothing in this phase touches asset generation or submission.
6. **Stale means disabled, never deleted.** Catalog refresh cannot lose a known tool.

## What is deliberately not built

- Dashboard screens (Overview, Tool Registry, Research Builder, Run History,
  Budget & Policy) — API/MCP parity first.
- AI-assisted classification (spec allows it only as a secondary, labeled step).
- Async Apify runs (`getRunStatus`/`cancelRun` are stubs; run-sync resolves inline).
- Scheduled registry refresh (manual only, per spec default).
- Cache layer, raw-payload retention controls, and `SOCIAL_*` audit-stream events.

## Quality gate

| Check | Result |
|---|---|
| `bun run typecheck` | PASS |
| Focused suites (`social-intelligence`, `management-route-registry`, `trend-intelligence`, `stock-autonomous-pipeline`, `server-auth`) | PASS — 164 tests, 0 fail |
| `bun run privacy:scan` | PASS |
| Route registry reconciliation | PASS — 13 tests. Note: this suite was **already red on this branch before this phase** (2 of 3 failures pre-dated it); the scanner now classifies namespace anchors (decline/decode/delegation guards) explicitly, which resolved all three |
| `bun run test` (full) | NOT RUN for this scoped change per `AGENTS.md`; run before PR-ready |
| Production build / GUI lint | NOT AVAILABLE for this phase (no GUI changes) |

## Environment variables (new)

```dotenv
SOCIAL_INTELLIGENCE_ENABLED=true
SOCIAL_DEFAULT_MAX_JOB_USD=0.10
SOCIAL_DAILY_BUDGET_USD=1.00
SOCIAL_MONTHLY_BUDGET_USD=10.00
SOCIAL_REQUIRE_APPROVAL_OVER_USD=0.05
SOCIAL_ALLOW_UNESTIMATED_PAID_RUN=false
SOCIAL_ALLOW_PAID_AUTO_RUN=false
SOCIAL_MAX_PROVIDER_ATTEMPTS=3
SOCIAL_MAX_RETRIES_PER_TOOL=1
SOCIAL_MAX_ITEMS_DEFAULT=100
SOCIAL_MAX_ITEMS_HARD_LIMIT=1000
PAO_SOCIAL_MOCK_MODE=true        # mock-first; set false + APIFY_API_TOKEN for live
APIFY_API_TOKEN=                 # server-side only, never sent to clients
```

## Local walkthrough

```bash
bun test tests/social-intelligence.test.ts          # subsystem suite
bun run typecheck
# live server:
bun run src/cli/index.ts start --port <port>
curl -s localhost:<port>/api/social/status
curl -s -X POST localhost:<port>/api/social/registry/refresh -d '{"provider":"apify"}'
curl -s -X POST localhost:<port>/api/social/route/preview -d '{"platform":"tiktok","capabilities":["search_videos"],"maxCostUsd":0.05}'
```
