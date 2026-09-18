# Phase 20.91b — Engineering Skill Runtime (Pao-hubPro × Addy Osmani Agent Skills)

**Status:** IMPLEMENTED (vertical slice — registry, router, context, workflow, evidence, council, policy, REST, MCP, GUI, evals)
**Blueprint:** `Blueprint/Phase_20.91_Pao-hubPro_x_Addy_Osmani_Agent_Skills.md` (proposed renumber **20.93**; open collision with 20.91a Apra Fleet pending user decision)
**Upstream:** `addyosmani/agent-skills` (MIT) — adopted as a **versioned external skill pack**, never a hard fork, never a prompt bundle with tool authority.

## Core law

External skills are **instructions, not authorities**. A skill may request a capability; only Pao-hubPro grants it. No "done" claim without verifiable evidence: an LLM statement is never sufficient — the runtime requires command + exit code + artifact + sha256 captured by the tool runtime.

## Components (`src/agent-os/engineering-skills/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | Domain types, error codes, feature flags (`readEngineeringSkillsFlags`) |
| `registry.ts` | Pack/skill registry: import (inline / local dir / git), commit pinning, integrity hash, malicious-content scan, capability inference, quarantine→candidate→active→rollback, version snapshots, capability-expansion detection, built-in `pao-core` seed |
| `router.ts` | Deterministic routing: intent → risk → candidates (keyword = explicit, intent-only = fill) → **minimal covering set** → route explanation with rejected candidates + reasons |
| `context.ts` | Progressive disclosure L0–L4 with token budgets and deterministic truncation; overflow priority (task/spec → skills → code → evidence → history → drop refs) |
| `workflow.ts` | Lifecycle state machine INTAKE→DEFINE→PLAN→BUILD→VERIFY→REVIEW→READY_TO_SHIP→SHIP→OBSERVE→DONE (+6 exceptional states), evidence-gated transitions, human ship approval with recorded rollback target, anti-rationalization enforcement |
| `evidence.ts` | Immutable evidence records (13 types), runtime-captured sha256, verified only with a captured exit code; `hasVerifiedEvidence` gate |
| `review.ts` | Independent Reviewer Council — 4 lanes (code/test/security/webperf) with trigger rules; severity→blocking policy (critical always, high by default); deterministic aggregation |
| `policy.ts` | Deny-by-default permission classes (§17), risk engine LOW/MEDIUM/HIGH/CRITICAL → R1–R4 gate, audited policy decisions |
| `service.ts` | Facade for routes/MCP/GUI |
| `mcp-tools.ts` | 11 MCP tools (`engineering_skills.*`, R0–R3) |

## REST surface (`/api/agent-os/engineering-skills/*`)

Reads: `health`, `packs`, `packs/{id}`, `skills`, `workflows`, `workflows/{id}` (+`/evidence`, `/reviews`), `policy-decisions`, `audit`.
Writes: `packs/import`, `packs/{id}/validate|promote|rollback|enable|disable`, `routes/explain`, `workflows` (POST), `workflows/{id}/advance|evidence|reviews|approve|cancel|skip-request`.
All entries are declared in `src/server/management/route-registry.ts` (literal + slice mechanisms) with the `ENGINEERING_SKILLS_VERB_DEFERRAL` exemption.

## Pack lifecycle

```text
import → QUARANTINED → validate (integrity + content scan) → CANDIDATE
       → (routing/eval gates) → promote → ACTIVE → rollback → previous snapshot
```

Version updates land in QUARANTINED with a capability-expansion diff (source §33); nothing auto-promotes (`SKILL_PACK_AUTO_UPDATE` is statically false). Upstream files are never modified — sidecar metadata lives in this registry.

## Evidence gates per transition (source §9.1)

| Transition | Required runtime evidence |
| --- | --- |
| DEFINE → PLAN | `artifact_exists` (spec: objective/scope/non-goals/acceptance criteria) |
| PLAN → BUILD | `artifact_exists` (atomic ordered plan + rollback strategy) |
| BUILD → VERIFY | `diff` (changed files from runtime) |
| VERIFY → REVIEW | `test_result` with captured exit code 0 (a captured non-zero → `FAILED_VERIFICATION`) |
| REVIEW → READY_TO_SHIP | verdicts from all required lanes + zero unresolved blocking findings |
| READY_TO_SHIP → SHIP | `approveShip` (human approver + rollback target recorded) |

## Built-in pao-core pack

Seeded on first open (idempotent): 13 lifecycle skills covering DEFINE/PLAN/BUILD/VERIFY/REVIEW/SHIP with trigger keywords/intents, safe permission profiles, and risk levels. This is Pao-hubPro's own content — the Addy Osmani pack is imported via the API pinned to a resolved commit when the operator chooses.

## Feature flags

`PAO_PHASE_20_91_ENABLED` (default true), `PAO_EXTERNAL_SKILL_PACKS_ENABLED` (true), `PAO_ENGINEERING_SKILL_ROUTER_ENABLED` (true), `PAO_EVIDENCE_GATES_ENABLED` (true), `PAO_REVIEWER_COUNCIL_ENABLED` (true), `SKILL_PACK_AUTO_UPDATE=false` (static).

## GUI

Dashboard page `engineering-skills` (Phase 20.91b §31 views, condensed): Routing Inspector (intent/risk/selected/rejected with reasons), Workflow Runs (status pills, advance/cancel), Skill Packs (validate/promote/rollback/enable/disable), Skill Catalog. Nav key `nav.engineeringSkills` localized in all 10 locales.

## Tests

`tests/engineering-skills.test.ts` — 25 tests covering the source's required evals **A–H** (PRD routing, auth-bug routing + security lane, proportionate verification, deploy-production ship gate, malicious-skill quarantine, capability-expansion quarantine, fake-evidence refusal, blocking-finding gate), plus pack pinning/lifecycle/rollback, deny-by-default permissions, anti-rationalization, context budgets, and the audit trail.

## Database (schema v58)

`esk_packs`, `esk_pack_versions` (per-transition snapshots), `esk_skills` (normalized metadata + sidecar `meta_json`), `esk_workflows`, `esk_workflow_steps`, `esk_evidence`, `esk_review_findings`, `esk_policy_decisions`, `esk_audit` — additive to v57; the `sk_*` SkillsGate and `mk_*` marketplace namespaces are untouched.

## Known limitations (P2 wave)

- Eval-runner UX and CLI verbs are deferred (`ENGINEERING_SKILLS_VERB_DEFERRAL`).
- Reviewer lanes are recorded via API/MCP; wiring them to live provider calls (OmniRoute) is the adapter wave.
- Shipping gate models approval + rollback-target recording; deploy execution itself remains outside the runtime (R4).
