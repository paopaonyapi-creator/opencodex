# Phase 20.17 — Pao-hubPro × Experiential Adaptive LLM Gateway

Status: Adaptive routing layer, Experiential adapter, and pinned upstream boundary
implemented and tested. Dashboard integration is a first slice. No live upstream
gateway has been exercised.

## Numbering

The planning document proposed 20.16, but that number is the Multi-AI Control Plane
from the previous turn, and 20.15 is the Domain Control Plane before it. This work is
**20.17**.

## The finding that shaped this phase

`src/ai-gateway/` already existed. Phase 20.13 built an "Experiential Adaptive AI
Gateway" with: aliases (`pao-fast`, `pao-code`, `pao-reasoning`, `pao-review`, …), a
deterministic rule-based router, budget ceilings with fail-closed unknown pricing,
provider registry with health caching, privacy classes, identity policy, guardrails,
and a trace ledger. It has six test files and 96 passing tests.

The spec's own instruction is decisive here: *"Prefer modifying existing abstractions
over duplicating them"* and *"Do not create duplicate modules when equivalent
abstractions already exist."* Rebuilding would have produced two routers competing to
route the same traffic.

So this phase **extends** that gateway. What it adds is the layer that was genuinely
missing: deciding WHICH model class a task needs, rather than resolving an alias the
caller already chose.

## Upstream verification

Verified before implementing, not assumed:

| Claim in the spec | Verified |
| --- | --- |
| `experientiallabs/experiential` exists | Yes, public repository |
| Version `0.7.63` | Yes, and it is the latest release |
| Apache-2.0 | Yes — no licensing obstacle |
| OpenAI-compatible API | Yes: `/v1/models`, `/v1/chat/completions` |
| Python `>=3.12` | Yes, per upstream |

Note on the search path: a repository search for `experientiallabs` surfaced three
forked mirrors and not the upstream itself, which is the kind of result that invites a
wrong conclusion about a project not existing. Direct API reads confirmed it.

**Integration boundary:** upstream is called over HTTP as an independent service. No
upstream Python module is imported into this runtime. Being Apache-2.0, that isolation
is an architectural choice rather than a legal one — upstream ships on its own cadence
with its own dependency tree, and importing across the boundary would couple this
repository to internals the project does not version as API.

## What was added

### Task classification (`routing/adaptive.ts`)

Decides the task kind, complexity, and sensitivity, then suggests an alias and builds
an escalation ladder. Two decisions are worth stating because the opposite choice is
the tempting one:

- **Unspecified complexity assumes 3, not 1.** Defaulting to trivial would send every
  unlabelled request down the cheapest route, which is the place a wrong guess is
  hardest to notice.
- **A credential keyword RAISES sensitivity and cannot be talked down.** Under-
  classifying is the direction that leaks, so a task mentioning `api key` or `secret`
  is treated as sensitive even when the caller declared `public`.

### Route levels L0–L4

Level is **derived from the catalog's own pricing**, not configured. A configured level
drifts from the pricing it is supposed to describe, and a stale level is how a premium
model ends up on the cheap rung. Unknown pricing maps to L3, not L0 — the budget layer
fails closed on unpriceable models, and ranking them as free would defeat that by
preferring them.

### Free-first, safely

`routing/candidates.ts` reorders candidates **after** the capability, privacy, budget,
and health filters have run. That ordering is what makes free-first safe: the cheap
option is only ever considered among options that are otherwise acceptable, so price
cannot promote a candidate that cannot do the job.

### Escalation (`routing/escalation.ts`)

Four rules, each blocking a specific mistake:

| Failure class | Behaviour | Why |
| --- | --- | --- |
| `auth_failure`, `policy_denial`, `budget_denial`, `local_only_violation` | **stop** | Will fail identically one rung higher; auth retries risk a lockout |
| `provider_timeout`, `provider_5xx`, `provider_unreachable` | retry same rung first | Transient; escalation costs quality budget a retry does not |
| `capability_mismatch`, `insufficient_quality` | escalate immediately | A property of the model, so retrying it is wasted |
| any, on a restricted task | **stop** | A privacy floor may not be climbed |

### Circuit breaker with five health states

`CLOSED -> OPEN -> HALF_OPEN -> CLOSED`, with `HEALTHY`, `DEGRADED`, `RATE_LIMITED`,
`UNAVAILABLE`, and `DISABLED`. Two behaviours matter:

- **An auth failure opens the circuit immediately** rather than counting toward a
  threshold. A wrong credential cannot fix itself, and retrying is how an account gets
  locked.
- **A rate limit uses a shorter cooldown than a hard failure.** A rate limit clears on
  its own; degradation needs a successful probe.

`DEGRADED` still serves — it is a warning, not an outage. The breaker overrides a cached
healthy result, because a health check that ran minutes ago is exactly the stale answer
that routes a request into a dead provider.

### Pinned upstream (`upstream-lock.ts`)

`config/ai-gateway/upstream.lock.yaml` records the version, the license, the verified
date, and the **contract** — the exact endpoints this repository depends on. A test
guards the committed artifact, not merely the parser, so a future edit that floats the
version fails.

A floating range (`latest`, `>=0.7`, `^0.7.63`, `0.7.*`) is a hard failure rather than
a warning. The version probe against a running gateway reports `unknown` when upstream
does not report a version, instead of inventing a mismatch.

### Router lifecycle (`routing/lifecycle.ts`)

`DRAFT -> OFFLINE_TESTED -> REVIEWED -> CANARY -> ACTIVE -> DEPRECATED -> ROLLED_BACK`.
The single edge into `ACTIVE` is from `CANARY`, and that edge is the promotion gate:
no code path can move a fresh artifact straight into serving traffic. Every transition
records who, when, and why.

### Emergency direct bypass, off by default

`PAO_LLM_DIRECT_BYPASS=false`. Three independent gates must pass: the feature is on, it
was turned on **explicitly** (only the literal string `true` counts — `1`, `yes`, and
`TRUE` do not), and the target provider is on the allowlist. An empty allowlist routes
nothing even when enabled.

Only a gateway outage justifies it. A single provider error, a rate limit, or a
capability mismatch is what normal fallback is for, and treating those as emergencies
would make the exception routine. It bypasses the GATEWAY, never a permission.

## What was deliberately NOT rebuilt

| Spec requirement | Already existed in Phase 20.13 |
| --- | --- |
| OpenAI-compatible gateway | `server.ts`, six routes |
| BYOK provider connections | `providers/` — 4 adapters + registry |
| Model aliases | `aliases.ts` + `config/ai-gateway/aliases.yaml` |
| Cost-aware routing | `routing/router.ts` scoring |
| Fallback | `getFallbackCandidates` with non-eligible codes |
| Per-agent policy | `identities` in `policies.yaml` |
| Usage / telemetry / traces | `traces/ledger.ts` with content modes |
| Budget control | `auth/budget.ts`, fail-closed on unknown pricing |
| Reviewer independence | `council/roles.ts` provider-family selection |
| Secret redaction | `guardrails/engine.ts` + `secret-redactor.ts` |

## Files

```text
src/ai-gateway/routing/adaptive.ts      classification, route levels, breaker, health
src/ai-gateway/routing/candidates.ts    free-first ranking, capability filter, locality
src/ai-gateway/routing/escalation.ts    bounded ladder with a privacy floor
src/ai-gateway/routing/lifecycle.ts     router promotion gate, direct bypass
src/ai-gateway/providers/experiential.ts OpenAI-compatible adapter
src/ai-gateway/upstream-lock.ts         pin verification and version probe
config/ai-gateway/upstream.lock.yaml    the pinned contract
docs/runbooks/llm-router-rollback.md
docs/runbooks/llm-router-upgrade.md
```

## Validation

```bash
bun test tests/ai-gateway-adaptive.test.ts tests/ai-gateway-experiential.test.ts
  -> 60 pass, 0 fail
bun test tests/ai-gateway-{core,routing,budget,traces,council,guardrails}.test.ts
  -> 96 pass, 0 fail (no regression)
bun run typecheck   -> clean
```

### Defects found by these tests in my own code

Worth recording because each was a real bug, not a test artifact:

1. **The lock parser missed contract routes.** A `path:` line is a continuation of a
   `- method:` list item and carries no leading dash, so requiring one produced an empty
   contract list. A lock file documenting no dependency surface looks exactly as valid
   as one that does.
2. **Escalation stopped when the current alias was not a ladder rung.** That is
   precisely the capability-mismatch case escalation exists to fix, so stopping there
   defeated the feature.
3. **A test resolved a lock path with `.pathname`**, which is percent-encoded. Under a
   workspace with a space in its name the file was never found, and the error said the
   lock file was missing.

## Not done

- **No live Experiential gateway has been exercised.** The adapter is tested against a
  stubbed transport, so it matches the DOCUMENTED contract; nothing proves a running
  gateway behaves as documented. This needs `pip install experiential==0.7.63` and a
  real key.
- **Adaptive/learned routing is not enabled.** Trace export suitable for upstream router
  optimization is not wired; the lifecycle states exist to gate it when it is.
- **Grok/xAI native support is not assumed.** No provider was added, per the spec's
  instruction not to assume native support.
- **Streaming is not implemented.** The adapter requests `stream=false`.
- **Dashboard shows the gateway's existing usage views.** A dedicated adaptive-routing
  panel (ladder decisions, escalation counts, breaker state) is not built.

## Next step

The honest next step is to stand up a real gateway and run the contract tests against
it: `pip install experiential==0.7.63`, `exp`, then confirm `/v1/models`, one
completion, and an auth rejection with a wrong key. Until that happens, everything here
is verified against a documented contract rather than a running system — and that
distinction is the whole reason the upgrade runbook insists on step 4.

