# Phase 20.17 — Baseline report

Required by the phase spec Step 0: what already exists, and where the new work
integrates. Written after inspecting the repository, before implementing.

## 1. Runtime and conventions

| Aspect | Finding |
| --- | --- |
| Language | Bun-native strict TypeScript (`bun run typecheck` is `tsc --noEmit`) |
| Package manager | Bun (`bun.lock`; `bunfig.toml`) |
| Server | `Bun.serve`, no compile step |
| Database | SQLite through `openAgentOsDb()` in `src/agent-os/db.ts`, additive tables, `schema_meta` version pointer |
| Tests | flat `tests/*.test.ts` run by `bun scripts/test.ts` |
| Dashboard | React + Vite in `gui/`, served from `gui/dist`, ten locales |
| Python | **Not present.** The spec's Python/pytest/uv instructions do not apply to this runtime |

## 2. The finding that determined the shape of this phase

**`src/ai-gateway/` already exists**, built by Phase 20.13 as an *Experiential Adaptive
AI Gateway*. It is a working OpenAI-compatible gateway with:

```text
server.ts              six routes, auth, budget admission, guardrails
config.ts              config loader from config/ai-gateway/*.yaml + env flags
aliases.ts             pao-* alias resolution from config
types.ts               provider, model, alias, budget, identity, trace, route types
routing/router.ts      deterministic rule-based router v1
providers/             registry + openai, anthropic, gemini, openai-compatible
auth/budget.ts         global + per-identity ceilings, fail-closed unknown pricing
auth/identity.ts       key to identity resolution
council/               reviewer selection, provider-family independence
guardrails/engine.ts   input/output secret scanning
traces/ledger.ts       JSONL trace ledger with content modes
```

Six test files cover it: `ai-gateway-{core,routing,budget,traces,council,guardrails}.test.ts`
— 96 passing tests.

### Why this mattered

The spec asks for an "Adaptive LLM Gateway / Model Router". Read literally as a
greenfield build, it would have produced a second router competing with this one for
the same traffic. The spec also says, in its operating rules:

> Prefer modifying existing abstractions over duplicating them.
> Do not create duplicate modules when equivalent abstractions already exist.

So the decision was: **extend**. What follows is the gap analysis that made the
extension concrete rather than nominal.

## 3. Gap analysis — spec requirement vs. existing capability

### Already implemented (reused unchanged)

| Spec section | Existing implementation |
| --- | --- |
| OpenAI-compatible gateway | `server.ts` |
| BYOK provider connections | `providers/registry.ts`, `config/ai-gateway/providers.yaml` |
| Model aliases (`pao-*`) | `aliases.ts`, `config/ai-gateway/aliases.yaml` |
| Cost-aware routing | `routing/router.ts` priority scoring |
| Fallback with non-eligible codes | `getFallbackCandidates` |
| Per-agent policy and budgets | `config/ai-gateway/policies.yaml`, `budgets.yaml` |
| Usage, telemetry, trace ledger | `traces/ledger.ts` |
| Budget guard, fail-closed | `auth/budget.ts` |
| Privacy class | `RoutingRequest.privacyClass`, identity `localOnly` |
| Reviewer independence | `council/roles.ts` provider-family selection |
| Secret redaction | `guardrails/engine.ts` |

### Missing (this phase builds)

| Gap | Why it was missing |
| --- | --- |
| **Task classification** | v1 resolves the alias the CALLER chose; nothing decided which alias a task needed |
| **Route levels L0–L4** | v1 used a numeric priority, with no notion of cost tier |
| **Free-first** | no cost-preference concept existed |
| **Escalation ladder** | v1 had fallback (another model for this request) but no bounded climb toward quality |
| **Circuit breaker** | `ProviderRegistry.isHealthy` was a cache with no state machine |
| **Five health states** | `ProviderHealth.healthy` is a boolean |
| **Four sensitivity levels** | `privacyClass` is `local-only \| standard` — two levels |
| **Experiential adapter** | no `experiential` provider type existed |
| **Upstream version pin** | no lock file |
| **Router lifecycle states** | no promotion gate |
| **Direct bypass** | no emergency path, and none was needed until now |

## 4. Integration points

```text
gui/src/pages/AiGateway.tsx          existing dashboard surface
src/server/management/                management API (no ai-gateway routes registered)
src/ai-gateway/index.ts               the activation surface; extended here
config/ai-gateway/*.yaml              existing config directory; upstream.lock.yaml added
```

The new modules live under `src/ai-gateway/routing/` beside the existing `router.ts`,
which is untouched. That is deliberate: `routeRequest` keeps its deterministic
alias→model behaviour, and the adaptive layer decides the alias before calling it.
A change to policy therefore cannot silently alter how an alias maps to a model.

## 5. Upstream verification (before implementing)

| Spec claim | Result |
| --- | --- |
| `experientiallabs/experiential` | Confirmed public repository |
| `experiential==0.7.63` | Confirmed, and it is the latest release |
| License | **Apache-2.0** — no obstacle to service-boundary integration |
| Python `>=3.12` | Confirmed |
| OpenAI-compatible API | Confirmed: `/v1/models`, `/v1/chat/completions` |
| Local gateway via `exp` | Confirmed in upstream README |

**Search caveat worth recording:** a repository search for `experientiallabs` returned
three forked mirrors and not the upstream itself. A conclusion drawn from search results
alone would have been "this project may not exist". Direct API reads settled it.

## 6. What was explicitly NOT touched

- MCP permission model
- local file sandbox, workspace boundary, shell authorization
- browser permissions
- RBAC and identity resolution outside the gateway
- Reviewer Council orchestration
- Stock production workflow
- `routing/router.ts` (extended around, not modified)

## 7. Remaining ambiguity

- Whether Grok/xAI exposes a native provider path in this stack. Not assumed; no
  provider was added, and the spec forbids silently substituting a model.
- Whether the environment has a local OpenAI-compatible endpoint to serve as an L0
  candidate. The code supports one; configuration does not yet name one.

