# Phase 30.36 — Pao-hubPro × Software Income Playbooks: Business Builder

> **Status:** Implemented (P0 scope, reuse-first)
> **Reference:** `cporter202/software-income-playbooks` — a READ-ONLY external source (spec §2/§6); recon at [`PHASE_30_36_RECON.md`](../PHASE_30_36_RECON.md)
> **Validated:** 2026-09-13

---

## 0. What this phase is

Pao Business Builder adds the **Decision + Monetization layer** over the existing
toolset: import income playbooks from an external reference repository (untrusted
data, normalized with full provenance), maintain an Opportunity Registry, score
opportunities with a configurable weighted engine, compute **Pao Fit** from the live
capability registry, run a fail-closed compliance gate, estimate costs, compare 2–5
opportunities, compile a reduced MVP specification, generate a Codex implementation
pack, and track revenue experiments with KEEP/ITERATE/PIVOT/KILL decisions.

The governing default path (spec §3): **Opportunity → Manual Audit → Productized
Service → … → Micro SaaS** — never an auto-built big SaaS.

## 1. Net-new module (`src/agent-os/business-builder/`)

| File | Role (spec §) |
| --- | --- |
| `types.ts` | canonical Opportunity model + registry entities (§7.2, §8) |
| `sources.ts` | playbook source adapter: key-whitelist Markdown parser, HTML/script/control-char sanitizer, license detection (LICENSE_UNKNOWN fallback), content hashing, local source-directory scan — **structural prompt-injection defense: only whitelisted factual keys survive; instruction-shaped content cannot become a field** (§30-§32) |
| `policy.ts` | weighted score engine (10 dimensions, configurable via `BIZ_WEIGHT_*`, confidence + evidence arrays, §9/§29), **Pao Fit from the derived capability registry** (probes read live module flags/registries — never hardcoded, §10-§11), fail-closed compliance gate (GREEN/YELLOW/RED/UNKNOWN with per-dimension reasons, RED/UNREVIEWED blocks production, §12), cost estimator with break-even (§18), experiment decision engine with evidence (§16) |
| `compiler.ts` | Idea-to-MVP compiler: deterministic scope reduction (anti-SaaS exclusion list, ≤7 features, §14) then the full §34 artifact set incl. `CODEX_IMPLEMENTATION.md` (§35); compilation is BLOCKED while compliance is RED/UNREVIEWED |
| `store.ts` | 10 additive `biz_*` tables (v36): opportunities + version history, sources/imports, capability registry, compliance checks, cost estimates, MVP specs, experiments, audit |
| `service.ts` | orchestration: dry-run/incremental/duplicate-safe imports with manual-edit conflict protection, registry CRUD + versions, scoring, compliance review (human-only), compare, experiments lifecycle — everything audited (`biz_audit` + `business.*` agent events) |
| `mcp-tools.ts` | 14 `business_*` WebMCP tools (§24): list/get/score/compare/import/pao-fit/compliance/cost/compile/codex-pack/experiments/capabilities |

Database: `AGENT_OS_SCHEMA_VERSION` 35 → **36**, additive migration only.

## 2. REST surface (20 routes, `/api/agent-os/business/*`)

Opportunities list/create/detail/score/pao-fit/compliance(+human review)/cost/compare/
compile/codex-pack/archive · import/playbooks (+history) · capabilities (+refresh) ·
experiments (+metrics/evaluate) · audit. Full-literal guards, registered under
`BUSINESS_BUILDER_VERB_DEFERRAL`.

## 3. Security (§31-§32)

- Imported Markdown is sanitized (HTML/script/control-char stripping) and parsed
  through a strict key whitelist — `EXECUTE:`, `system_prompt:`, `shell:` and any
  non-whitelisted key are dropped before they exist as data.
- No code path passes imported text to a process runner; the compiler reads only
  normalized registry fields.
- URLs are not fetched at import time; the operator clones the source locally and the
  adapter reads the directory (cloning automation deliberately out of scope).
- Compliance review and manual-edit-flagged conflicts are human-governed; every
  mutation is audited with actor/reason.

## 4. Tests (14)

Sanitizer + structural injection defense (hostile playbook yields only whitelisted
fields, zero hostile strings); license detection; dry-run → real import → provenance
assertions; duplicate skip, incremental update, manual-edit conflict protection;
weighted scoring + confidence + persisted evidence; Pao Fit from live registry
(available/missing paths); compliance gate states + RED/UNKNOWN compile blocking +
human-only review; cost/break-even; §14 scope reduction; full §34 artifact set written
to disk after review; compare with reasons; the complete decision-rule matrix; the
audited experiment lifecycle.

## 5. Honest accounting / follow-ups

- The AI-assisted scoring layer (spec §28) is deliberately absent — scoring is fully
  deterministic; the provider abstraction hooks exist for a later phase.
- Upstream repo cloning is manual (operator clones; adapter reads the directory);
  automated refresh jobs are a follow-up.
- Fuzzy dedupe remains exact-slug/hash based.
- Outreach/campaign execution stays out of scope (spec §40); experiments track
  metrics entered by the operator.
- First smoke-test opportunity per spec §37: import "Local Review Intelligence"
  (shipped as the deterministic playbook fixture in tests), score, review compliance,
  compile — the pack lands under `BUSINESS_OUTPUT_DIR` (default: config dir).
