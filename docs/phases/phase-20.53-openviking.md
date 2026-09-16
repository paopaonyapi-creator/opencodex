# Phase 20.53 — Pao-hubPro × OpenViking Context Control Plane

> **Status:** Implemented (control-plane core). Honest scope accounting at the end.
> **Upstream:** https://github.com/volcengine/OpenViking (AGPLv3 — external service, never vendored)
> **Primary principle:** Pao owns context policy, governance, identity mapping,
> budgets, memory review, cross-agent orchestration and audit. OpenViking owns
> `viking://` storage, hierarchical retrieval, sessions and memory extraction.

## What was built

A governed context layer in `src/agent-os/context/`, following the repository's
agent-os conventions (shared Agent OS SQLite for governance metadata, standalone
loopback Bun server, hermetic tests against a mock OpenViking surface).

```text
Agents (Codex / Hermes / automation)
        |
        v
ContextService  (src/agent-os/context/)
  ├─ namespace.ts      canonical viking:// URIs, deterministic peer ids from git origin
  ├─ security/         deterministic secret scan + path deny BEFORE the backend sees anything
  ├─ ingest.ts         classify -> sanitize -> checksum -> idempotent job -> add_resource -> wait
  ├─ retrieval.ts      backend search -> policy filter (reason codes) -> budget pack ->
  │                    injection plan -> persisted trace (runs + per-hit allow/deny)
  ├─ governance.ts     review states, pin/suppress/promote (human gate), advisory experience confidence
  ├─ sessions.ts       Pao-conversation -> OpenViking session bindings, idempotent commit, handoffs
  ├─ resilience.ts     backend circuit breaker (auth failures open immediately)
  └─ adapter/          OpenViking HTTP compatibility adapter, defensive normalization
        |
        v
OpenViking sidecar (deploy/openviking/, loopback:1933, AGPLv3, version-pinned)
```

## Hard invariants

- **AGPL boundary**: OpenViking is an external pinned service reached only via
  documented HTTP endpoints; unknown capabilities are reported `false` with
  warnings, never silently emulated.
- **Secrets never enter context**: the deterministic scanner (patterns for API
  keys, private key blocks, bearer headers, cookies, refresh tokens, DB URLs,
  credential assignments, recovery codes) plus path deny rules run before
  ingestion and before memory candidates; secret-like candidates are rejected
  with a `[REDACTED]` placeholder and a high-risk record. Findings never echo
  the secret value.
- **Scope denials fail early**: a request outside `allowedRoots` (e.g. another
  user's `viking://user/bob/…`) is denied Pao-side with `CTX_BLOCKED_SCOPE` and
  audited — it is never forwarded to see if the backend would deny it.
- **Every allow/deny has a stable reason code** (`CTX_ALLOWED_SHARED_RESOURCE`,
  `CTX_BLOCKED_SCOPE`, `CTX_BLOCKED_SUPPRESSED`, `CTX_BLOCKED_POLICY`,
  `CTX_BLOCKED_SECRET`, `CTX_BLOCKED_EXPIRED`, `CTX_BACKEND_UNAVAILABLE`, …),
  persisted per retrieval hit.
- **Memory is governed state**: private low-risk → `auto_accepted_private`;
  shared → `pending_review`; user-confirmed → `approved`. Suppression excludes
  memory from retrieval; pinning is restricted to approved records; promotion
  to shared knowledge requires a human reviewer and records provenance.
- **Degraded, not fake**: backend unreachable → breaker opens, retrieval
  returns `CTX_BACKEND_UNAVAILABLE` (graceful for recall, fail-closed for
  restricted context); no memory is ever written from a degraded run.
- **Rollback is flag-driven** (§113): `PAO_CONTEXT_RETRIEVAL_ENABLED`,
  `PAO_CONTEXT_MEMORY_WRITE_ENABLED`, `PAO_CONTEXT_PEER_MEMORY_ENABLED`,
  `PAO_CONTEXT_AGENT_EVOLUTION`, then `PAO_CONTEXT_ENABLED` — OpenViking data
  stays intact.

## API surface (`/api/context/*`, Bearer `PAO_CONTEXT_ADMIN_KEY`)

`GET /health` (open) · `GET /health|/capabilities` · `GET|POST /sources` ·
`POST /sources/:id/ingest` · `POST /search` (governed retrieval with budget +
trace) · `GET /retrievals/:id` · `GET /memories` (review queue) ·
`POST /memories/:id/approve|reject|pin|unpin|suppress|unsuppress|promote|expire` ·
`GET|POST /sessions` · `POST /sessions/:id/messages|commit` ·
`POST|GET /handoffs` · `POST /handoffs/:id/consume` · `GET /audit`.
Reviewer routes require the actor in `PAO_CONTEXT_REVIEWER_ACTORS`
(empty = nobody, fail closed).

## Configuration (see `.env.example`)

`PAO_CONTEXT_ENABLED` (strict "true") · `PAO_CONTEXT_MODULE_PORT` (8791) ·
`PAO_CONTEXT_ADMIN_KEY` · `PAO_OPENVIKING_URL` (default loopback:1933) ·
`PAO_OPENVIKING_API_KEY` (user-level; env only) · budget profiles
(`fast` / `coding` / `deep_research` / `automation_safe`) · memory policies
(`no_memory` / `user_preferences_only` / `workspace_coding` /
`agent_evolution_reviewed`) · feature flags for staged rollout (§112).

## Tests

34 tests across three files, all passing:
- `tests/context-security.test.ts` — secret detection (documents + memory
  candidates, values never echoed), path deny/review rules, namespace guards
  (traversal rejected, no invented `viking://agent/memories/`), deterministic
  peer derivation from git origin, prompt-injection-as-data.
- `tests/context-engine.test.ts` — capability probe (verifiable surfaces true,
  unverifiable false-with-warning), idempotent ingestion, secret-blocked
  sources, retrieval reason codes (shared/user allowed, cross-user scope
  denial, suppressed exclusion), budget truncation, fail-early scope audit,
  breaker degradation, review-state defaults, permission gates, promotion
  provenance, advisory experience confidence, session lifecycle, handoff
  addressing.
- `tests/context-e2e.test.ts` — the §132 flow through the real HTTP server:
  health/capabilities → ingest phase source → governed retrieval with trace →
  secret blocked → session commit → handoff consume → audit; unauthorized
  access rejected.

## Honest scope accounting

Implemented: everything in the diagram above — namespace/identity, secret
filters, compatibility adapter with capability probe and breaker, governance
store (backends, sources, jobs, retrieval runs/hits, session bindings, memory
governance/reviews/suppressions, experience, handoffs, audit, backups),
ingestion pipeline, retrieval engine with budgets and traces, memory
governance with the human promotion gate, sessions/handoffs, HTTP API, deploy
artifacts, env/config, tests, docs.

Deferred deliberately (follow-ups, not silent gaps):
- **Dashboard UI** (§75): the admin API covers the operator loop; gui/ pages
  come next. The raw-content viewer must render retrieved resources as plain
  text, never HTML.
- **MCP tool surface** (§41-42): the tool names and permission mapping are
  defined; registering `context.*` tools into this repo's MCP runtime is a
  follow-up (read tools unmediated only when policy allows).
- **Codex Memory Plugin installer** (§38): diagnostics belong in a setup
  script that never mutates user config without explicit request.
- **Backup/restore orchestration** (§88-89): the ledger table and capability
  flag exist; wiring OpenViking's documented export/import into scheduled,
  restore-drilled jobs follows once a real pinned backend is deployed.
- **Retention workers** (§86): expiry is enforced at retrieval time now;
  background retention/rollup jobs follow with the scheduler primitive.

## Operations

```bash
# start (loopback only, after deploying the sidecar per deploy/openviking/README.md)
PAO_CONTEXT_ENABLED=true PAO_CONTEXT_ADMIN_KEY=<key> PAO_OPENVIKING_URL=http://127.0.0.1:1933 \
  bun -e 'const { startContextServer } = await import("./src/agent-os/context/index.ts");
           const gw = await startContextServer();
           console.log("context on 127.0.0.1:" + gw.server.port);'

# verify
curl -s http://127.0.0.1:8791/api/context/health
curl -s http://127.0.0.1:8791/api/context/capabilities -H "Authorization: Bearer $PAO_CONTEXT_ADMIN_KEY"
```

Incident paths: backend down → breaker opens, recall degrades explicitly;
secret ingestion attempt → blocked + audited (`CTX_BLOCKED_SECRET`); suspected
leakage → suppress by rule/URI, audit in `/api/context/audit`. Runbooks for
outage, memory corruption, leakage, restore and upgrade are the operator
follow-up listed above.
