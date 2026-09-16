# Phase 20.34 — Pao-hubPro × Lead Gen API Stack: Lead Intelligence Control Plane

> **Status:** Implemented (P0 scope, reuse-first)
> **Reference:** `cporter202/lead-gen-api-stack` — treated as a provider **catalog / research seed** only (spec §2); no upstream code, no affiliate rankings, nothing hardcoded
> **Validated:** 2026-09-13

---

## 0. What this phase is

Pao-hubPro gains a **Lead Intelligence Control Plane**: multi-provider B2B/local-business
discovery, enrichment, verification abstraction, normalization, deduplication,
provenance, deterministic scoring, cost-aware routing, budget control, suppression /
compliance, WebMCP tools, REST surface, dashboard, and CSV/JSON export.

The governing axioms (spec §1) are enforced structurally:

```text
Discovery  != Truth          → found contact points start verification_status=unknown
Enrichment != Verification   → separate provider capability + verification layer
Verification != Permission   → export/suppression gates; outreach does not exist
Automation  != Outreach      → EXTERNAL_OUTREACH_AUTO_SEND is wired false permanently
```

## 1. Reuse map (spec §47, §54)

| Spec area | Verdict | Notes |
| --- | --- | --- |
| Database | **ADAPTED** | spec suggests PostgreSQL; the repo runs one Bun-native SQLite store — 14 additive `lead_*` tables in the shared migration (spec §7 explicitly says to map to the existing structure) |
| SSRF policy for the website crawler | **REUSED** | Phase 20.24 `validateAndNormalizeUrl` (loopback/private/link-local/metadata blocked) guards every crawled URL; the crawler is same-domain-only, page/size/time bounded |
| MCP tool pattern | **REUSED** | `WebMcpToolDefinition` registry (`LEAD_INTELLIGENCE_MCP_TOOLS`, 18 tools, R0–R3 tiers per spec §26) |
| Audit / events | **REUSED** | `lead_audit` table + `recordAgentEvent` trail (`lead.search.completed`, `lead.pipeline.completed`, `lead.export.created`) |
| Human-approval invariant | **REUSED** | the cockpit/governance `HUMAN_ACTOR_PATTERN` gates job approval and suppression removal |
| Job model | **ADAPTED** | spec's search/enrichment/verification jobs → one `lead_jobs` table with a `type` column (same lifecycle, fewer tables) |
| Providers | **NEW** | mock (deterministic fixtures), website-contact crawler, config-driven Apify actor (flag-off), config-driven custom HTTP |

## 2. Net-new modules (`src/agent-os/leads/`)

| File | Role |
| --- | --- |
| `types.ts` | canonical lead model, provider contract, job/pipeline types (§8, §9) |
| `errors.ts` | machine-readable taxonomy (§38), retryable set, message sanitization |
| `flags.ts` | §49 flags; `externalActions` is `false` by construction |
| `normalize.ts` | domain/email/phone(E.164 only with country evidence)/company-name canonicalization, composite dedupe keys, contact merge (§16-§17) |
| `providers.ts` | 4 adapters; Apify data plane is a fixed-host allowlist; secrets resolve from env at call time via `secret_ref` and are never logged |
| `policy.ts` | routing strategies (CHEAPEST/BEST_QUALITY/FASTEST/BALANCED/MANUAL) with the spec's default weights, hard budget rules (overrun cap, per-lead cap, approval threshold), versioned scoring profiles, suppression matching |
| `store.ts` | static-SQL persistence over the v34 tables |
| `runner.ts` | provider-execution boundary: the orchestrator persists a sanitized job and hands the runner only the job id; the runner reloads the persisted record |
| `service-core.ts` | jobs (search/enrich/verify/score/export), pipelines, dedupe/merge, provenance evidence, audit |
| `mcp-tools.ts` | 18 `lead_*` WebMCP tools with bounded responses |

Database: `AGENT_OS_SCHEMA_VERSION` 33 → **34**, additive migration, no existing table touched.

## 3. REST surface (25 routes, `/api/agent-os/leads/*`)

`POST /search` · `POST /cost-estimate` (pre-run preview, §15) · `GET /jobs` ·
`POST /jobs/{detail,approve,cancel}` (approve is human-only) · `GET /leads` ·
`POST /detail` · `POST /{enrich,verify,score}` · `GET /providers` ·
`POST /providers/{test,enable}` · `GET /pipelines` · `POST /pipelines/{run,detail}` ·
`POST /exports{,/detail}` · `GET /suppression` · `POST /suppression{,/remove,/check}` ·
`GET /audit` · `GET /costs`. All full-literal guards, ids in body, registered under
`LEAD_VERB_DEFERRAL`.

## 4. Behavior highlights

- **Cost before run:** the dashboard and `lead_cost_estimate` MCP tool estimate spend
  from provider pricing metadata before any paid call; jobs exceeding the hard cap are
  `blocked` (unapprovable); jobs above `requireApprovalAbove` land `waiting_approval`
  and only a human actor can release them.
- **Dedupe (§17):** exact canonical keys (domain → person@domain → company name → person
  name); repeat discoveries corroborate (merge contact points at best confidence, append
  source records) instead of forking rows. Fuzzy matching is a documented follow-up and
  never auto-merges.
- **Provenance (§18, §6.2):** every contact point carries source provider + confidence +
  verification state; `lead_field_evidence` and `lead_source_records` keep the evidence
  chain; JSON export preserves it.
- **Scoring (§20-§21):** versioned deterministic profiles (`local-business-basic`,
  `b2b-decision-maker`) with reasons; the AI layer is flag-gated and never acts alone —
  no auto-contact exists to act with.
- **Suppression (§22):** email/phone/domain/company/person matching against six reasons;
  the pipeline marks hits `suppressed`; export skips them and audits row counts,
  requester and timestamp.
- **Waterfall routing (§14.3):** candidates are filtered (enabled, capability, health,
  budget) then ordered by strategy; enrichment falls through to contact discovery and
  verification providers.

## 5. Tests (17)

Normalization matrix (domain/email/phone/canonical keys), contact merge, strategy
ordering + health rejection, hard budget rules, mock search → persist → repeat-run
merge, enrich → verify → score lifecycle with provenance, budget approval gate with
human-only invariant and unapprovable budget-exceeded jobs, pipeline end-to-end with
suppression, export gating + audit, structural outreach lock, SSRF refusal through the
shared policy, suppression coverage matrix, provider flag defaults.

## 6. Honest accounting / follow-ups

- Fuzzy dedupe (§17 composite/fuzzy with `review_required`) is stubbed at the exact-key
  layer only — no fuzzy scorer ships in this phase.
- AI-assisted qualification (§20 layer B) has the flag and response shape but no LLM
  wiring; deterministic scoring is the sole score source.
- Apify/Custom HTTP adapters are config-driven and flag-gated OFF; they have never been
  pointed at a live upstream — contract fixtures are a follow-up (§40 contract tests).
- Retention sweeps (`LEAD_RAW_RETENTION_DAYS`) are config-declared but the sweeper job
  is a follow-up.
- Outreach/Campaign/CRM remain P2 and are structurally absent (no executor exists to
  flag on).
