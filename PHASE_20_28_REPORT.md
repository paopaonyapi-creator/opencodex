# PHASE 20.28 REPORT — Governed Agent Computer & Safe Execution Fabric

## 1. Executive summary

Pao-hubPro gained an authoritative **Pao Governance Gateway**: one pipeline
(grant → risk → deny-first fail-closed policy → blocking human approval →
pre-action audit → provider dispatch → post-action audit) that every governed
side effect must traverse. Acceptance scenarios A–J from the spec pass as
automated tests. OpenBot was used as a concepts-only reference; no code or
runtime dependency was introduced.

## 2. Repository preflight findings

Documented in `PHASE_20_28_IMPLEMENTATION_PLAN.md`: existing execution paths
are the cockpit session launcher, the media/browser controlled runners, MCP
tool surfaces, and per-phase controlled providers. `src/agent-os/governance/`
already exists as the Ponytail minimal-code module, so the new subsystem is
`src/agent-os/governance-gateway/`.

## 3–4. Architecture & files

- `src/agent-os/governance-gateway/types.ts` — ActionRequest/PolicyDecision/
  ExecutionResult/CapabilityGrant/Approval/AuditEvent/provider contract,
  structured condition DSL, error taxonomy.
- `policy-engine.ts` — deny → approval → allow → default-deny evaluator;
  broken deny rules fail closed, broken allow rules never grant; baseline
  policy pack.
- `store.ts` — additive `gov_*` tables; idempotent action requests; hash-
  chained append-only audit; global state (kill switch).
- `gateway.ts` — `governedDispatch()` pipeline, deterministic risk classifier,
  secret redactor, LocalWorkspaceProvider (file read/write/delete), kill
  switch, human-takeover control modes, one-shot approved dispatch.
- `src/server/management/governance-routes.ts` + route-registry entries +
  dispatch branch in `agent-os-routes.ts`.

## 5. Migrations

Additive `gov_*` tables on the shared Agent OS SQLite store; no existing
table/column modified; rollback = drop `gov_*` + remove the route block.

## 6–8. Flow, providers, MCP

Pipeline per §2. Local provider performs governed file read/write/delete
within workspace + grant patterns. Docker/browser/MCP providers are registry
slots with honest `GOVERNANCE_PROVIDER_DISABLED` failures. MCP governance is
modeled (unknown → unknown effect → high risk minimum); wiring every existing
MCP call through the gateway is the Stage B/C follow-up.

## 9–11. Policies, approval UX, audit

Baseline JSON policy with structured conditions (no eval); approvals persist a
redacted argument preview and a one-shot payload; the audit ledger is
append-only with `prev_event_hash/event_hash` linking and correlation IDs.

## 12–13. Security & tests

Invariants + regressions listed in `docs/phase-20.28/README.md` §8 —
**15/15 tests pass**. Fail-closed semantics verified for missing/malformed
policies and broken allow rules.

## 14–15. Commands & results

`bun run typecheck` ✅ · `bun test ./tests/governance-gateway.test.ts` 15/15 ✅ ·
`lint:gui` / `build:gui` / `privacy:scan` ✅ · connected suites (20.24–20.27)
re-run green.

## 16. Backward compatibility

Nothing pre-existing was rewired; the gateway is additive and opt-in through
its dispatch surface; all prior phase suites pass unchanged.

## 17–19. Limitations, manual steps, rollback

See `docs/phase-20.28/README.md` §9 (governed performers for shell/browser/
MCP, dashboard pages, policy editor/simulator, delegation budgets, SSE events)
and §11 (rollback).

## 20. Recommended Phase 20.29

Autonomous Runtime Scheduler, Durable Agent Jobs & Governed Recovery
(doc §75) — after governed performers cover shell/browser/MCP.
