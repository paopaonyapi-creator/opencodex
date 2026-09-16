# Phase 20.30 — Pao-hubPro × FCC-inspired Universal AI Coding Gateway & Multi-Provider Router

> **Status:** Implemented (control-plane slice: Pao aliases, mode/task/capability/cost/budget routing policies, route preview + explain; execution stays in the existing proxy)  
> **Reference:** Alishahryar1/free-claude-code (MIT) — concepts only; no code copied  
> **Critical architecture decision:** this repository **is already** a universal provider proxy (`src/router.ts`, `src/providers/`, `src/adapters/`, `src/compatibility/` — Anthropic Messages + OpenAI Responses compatibility, provider adapters, health, quotas, fallback). Per spec §59 ("do not duplicate subsystems") Phase 20.30 adds the **missing control plane** over that core instead of a second gateway.

## What this phase adds (and why it's not a duplicate)

The existing proxy already handles protocol compatibility, provider adapters, model catalog, health/quotas, retries, and fallback **execution**. What it lacked is the policy/cost/budget control plane and explainability:

- **Pao aliases** (doc §31): `pao/auto`, `pao/free`, `pao/local`, `pao/coding`, `pao/reasoning`, `pao/fast`, `pao/reviewer`, `pao/premium` — each mapping to a routing policy, resolvable dynamically.
- **Routing modes** (doc §15): free-first, cheapest-first, balanced, quality-first, local-first, paid-only, manual.
- **Policy + capability + budget filters** (doc §12-§17): allow/deny provider lists, tools/vision/reasoning requirements, free/local-only constraints, quota-exhausted elimination, **budget guard** (100% → paid denied; ≥90% → premium restricted), per-request cost ceilings.
- **Scoring engine** (doc §21): configurable weights (quality/capability/health/quota/cost/preference) — defined in ONE place (`ACTIVE_WEIGHTS`).
- **Fallback planner** (doc §22): ordered, score-sorted, loop-free (deduplicated by model id).
- **Route preview + explain** (doc §34-§35): selected/candidates/rejected with reasons and estimated cost — **never executes**.
- **Route events** (doc §37-§38, §65): recorded with alias/task/selected model/cost/reason.

## REST surface (ownerDoc for the route-registry deferral)

```text
GET  /api/agent-os/ai-gateway/status          (aliases + budget + note)
GET  /api/agent-os/ai-gateway/aliases
POST /api/agent-os/ai-gateway/aliases          (alias → policyId mapping)
POST /api/agent-os/ai-gateway/route-preview    (dry; requires candidates from the proxy catalog)
GET  /api/agent-os/ai-gateway/budget
POST /api/agent-os/ai-gateway/budget           (set daily limit)
GET  /api/agent-os/ai-gateway/audit            (route events)
```

Execution keeps flowing through the existing proxy endpoints (`/v1/responses`, `/v1/messages`, `/v1/models`, health) — those are the repo's own implemented protocol paths, unchanged.

## Files

`src/agent-os/ai-router/types.ts` + `router.ts` (filters, scoring, fallback, budget, preview, explain, store over `ai_aliases`/`ai_routing_policies`/`ai_budget_counters`/`ai_route_events` tables), `src/server/management/ai-gateway-routes.ts`, `tests/ai-router.test.ts`.

## Honest mapping of the spec to this repo

| Spec area | Status |
|---|---|
| Protocol compat (Anthropic/OpenAI Responses/SSE/tools) | **Already shipped** by the repo core — unchanged |
| Provider abstraction + registry | **Already shipped** (`src/providers/`, `src/adapters/`) — unchanged |
| Health/quota/fallback execution | **Already shipped** in the proxy router — unchanged |
| Pao aliases/modes/policies/budget/preview/explain | **New in this phase** (`ai-router/`) |
| Codex/Hermes/Claude launchers | Existing repo integrations already point agents at the proxy; alias layer now steers them |
| Reviewer Council diversity constraint | Modeled (`distinctProviderFamilies` on the reviewer policy); wiring into council execution is follow-up |
| Full dashboard pages | Follow-up (route-preview/audit REST is done) |
| Per-provider circuit breakers/quotas | Existing proxy behavior; deep integration with `ai_budget_counters` is follow-up |

## Tests

`tests/ai-router.test.ts` — **12/12**: tools/vision/quota filters, free-first and local-first exclusion, budget deny at 100% + premium restriction at ≥90%, score ordering, loop-free fallback plan, builtin alias/policy seeding, preview/explain with selection + actionable no-route note, budget round-trip + route events.

## Security

No secrets in this module (provider credentials stay in the proxy's existing config paths); preview/explain never executes; no LLM in the routing path; budget denies are audited as route events.

## Rollback

Remove the `ai-gateway` dispatch branch + 7 registry entries; drop `ai_*` tables. The proxy router is untouched.
