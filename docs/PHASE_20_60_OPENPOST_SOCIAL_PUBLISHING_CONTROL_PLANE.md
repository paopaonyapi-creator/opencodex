# Phase 20.60 — Pao-hubPro × OpenPost: Social Publishing Control Plane

Agentic social publishing orchestration, multi-platform content rendition,
durable scheduling coordination, idempotent dispatch, reconciliation, and
policy-governed media automation around a separately deployed **OpenPost**
instance.

- **Upstream:** https://github.com/getopenpost/openpost (AGPL-3.0-only)
- **Verified against:** upstream OpenAPI document (`docs.openpo.st/openapi.json`)
  and docs at implementation time; upstream release pinned in
  `integrations/openpost/VERSION` (4.33.0). The phase spec's "verified v4.12.0
  (2026-08-30)" was stale — upstream had moved to 4.33.0; the API shapes used
  here were re-verified against the live OpenAPI document.
- **Boundary:** OpenPost is an external service, never vendored. See
  `docs/legal/openpost-integration.md`.

## Architectural principle

> **Pao-hubPro decides what should happen, under what policy and approval.
> OpenPost executes provider-facing publishing.**

```text
Pao agents → Social Publishing control plane (this module)
                  │  intent · policy · approval · idempotency · audit
                  ▼
        OpenPost HTTP API /api/v1        (external, AGPL-3.0-only)
                  ▼
        Provider queues → X / Mastodon / TikTok / …
                  ▼
        Delivery + analytics signals → reconciliation → learning loop
```

## What ships in this phase (P0 vertical slice)

| Area | Where | Notes |
|---|---|---|
| Instance registry | `sp_openpost_instances` | multiple OpenPost deployments; health test; account/capability sync |
| HTTP adapter | `src/agent-os/social-publishing/openpost/` | typed client over an injectable JSON transport; real upstream endpoints |
| Master publication model | `sp_publications` + `sp_publication_assets` | source assets, provenance, lifecycle state machine |
| Rendition engine | `renditions.ts` | capability-driven per-account drafts; unknown capability never treated as supported |
| Policy engine | `policy.ts` | pure rule functions with ruleIds; explainable denials |
| Approval gate | `sp_approvals` + service | human-required by default; approvals bound to per-rendition content hashes |
| Asset handoff | `assets.ts` | SHA-256 recompute, magic-byte MIME, two-phase upload-session with upstream `client_sha256` dedupe |
| Delivery executor | `service.ts` | idempotency keys, bounded backoff (15s→60s→5m→20m→60m ±20% jitter), ambiguous-outcome parking |
| Reconciliation | `service.ts` | remote publication/event sync → normalized delivery states |
| Analytics | `sp_analytics_snapshots` | normalized snapshots; missing metrics stay null, raw payload retained |
| MCP tools | `mcp-tools.ts` | 12 Pao-owned tools (spec §22 names), R0–R3 tiers |
| Management API | `/api/agent-os/social-publishing/*` | prefix-decode dispatcher, chain-linked from `agent-os-routes.ts` |
| UI | `gui/src/pages/SocialPublishing.tsx` | overview, accounts, publications, approvals, jobs, audit tabs |
| Deploy assets | `integrations/openpost/` | pinned compose, env example, ops README |
| Tests | `tests/social-publishing.test.ts` | 37 tests against a deterministic in-memory OpenPost |

## Upstream contract deltas (spec vs reality)

The spec asked for endpoint-agnostic internal names and explicitly required
adapting to the real upstream contract. Deltas worth recording:

- **Base path** is `/api/v1` with bearer tokens (`Authorization: Bearer`),
  scopes like `api:read`/`api:write`.
- **Media upload is two-phase**: `POST /media/upload-session` (with
  `client_sha256`) → direct storage PUT → `POST /media/upload-session/{id}/complete`.
  Upstream deduplicates on `client_sha256` (`deduped: true`), which the spec's
  §10.1 duplicate-upload rule maps onto directly.
- **`expected_revision`** is a mandatory optimistic-concurrency field on
  schedule/publish/cancel/rendition mutations; the executor reads the remote
  revision before acting.
- **Per-rendition delivery detail** (state, `recovery_action`
  `none|retry|reconcile|manual_resolution`, external id, error fields) lives on
  the publication's renditions and its lifecycle-event stream — this is what
  reconciliation normalizes.
- **Validation** exists upstream (`POST /publications/{id}/validate`) and is
  merged with local capability validation when a remote publication exists.
- **Analytics** is workspace-level (`GET /analytics` → Overview with
  `summary.views.total` etc.); per-publication metric shapes are upstream-owned
  and only the summary level is normalized this phase. Missing metrics are
  stored as null, never zero.
- **"Rendition"** is upstream's word for the per-account draft; the spec's
  usage matches upstream's `renditions` subresource on publications.
- The spec's suggested `mcp:read`/`mcp:full` scopes were not found in the
  OpenAPI document; MCP exists upstream (CLI/MCP downloads, `GET /mcp/activity`)
  but token-scoped MCP details are version-dependent. The module records
  `mcp_endpoint`/`mcp_scope` on the instance and uses HTTP as the mutation
  transport regardless (spec §9.3 default `hybrid`, mutations never duplicated
  across transports).

## Governance decisions (honest scope accounting)

- **Publication-level dispatch jobs.** OpenPost's schedule/publish-now act on
  the *publication*, not per-rendition. One idempotent job per operation; the
  key derives from the aggregate content hash of all renditions (spec §16's
  per-rendition key formula adapted, documented here).
- **Schedule is part of approved content.** Scheduling moves the rendition
  hash when outside the 60s tolerance, so the schedule must be bound before
  approval; moves outside tolerance after approval are refused with
  `SOCIAL_APPROVAL_STALE` (spec §14.3).
- **Approval records are per rendition.** Each record binds that rendition's
  exact content hash; the executor re-verifies server-side — agent-side claims
  are never sufficient (spec §37.9).
- **Ambiguity before resubmission.** Timeout/abort after a possible submission
  parks the job in `reconciliation_required`; the correlated lookup
  (`metadata.pao_publication_id`) recovers the remote publication so a retried
  dispatch never duplicates a create.
- **Deferred (P1/P2, extension points exist):** webhook/event ingestion
  (upstream has `external-webhooks`; the reconcile loop covers the need
  offline), per-publication analytics normalization, optimal-time
  recommendation, campaign grouping, quiet-window cadence policies,
  agent registry entries for the four logical agents (their capabilities ship
  as the MCP tools with risk tiers instead).
- **Feature flag:** everything is inert unless
  `PAO_SOCIAL_PUBLISHING_ENABLED=true`; the module is lazy-activated by routes
  and MCP tools, never imported from the core request path, and the worker
  registers teardown in `optional-shutdown-hooks`.

## Database

Schema v47 → **48**: `sp_openpost_instances`, `sp_accounts`,
`sp_publications`, `sp_publication_assets`, `sp_renditions`,
`sp_policy_evaluations`, `sp_approvals`, `sp_delivery_jobs`,
`sp_analytics_snapshots`, `sp_audit` (+ indexes). Additive
`CREATE TABLE IF NOT EXISTS` only; reversible by dropping the `sp_*` tables.

## Security posture

- OpenPost API tokens resolve via secret refs (`env:` or files under
  `$OPENCODEX_HOME/social-publishing/secrets/`); never stored in SQLite,
  never returned to agents or browsers, never logged (bearer redaction in
  `secrets.ts`, exercised by tests).
- Provider OAuth credentials never enter Pao-hubPro.
- Instance base URLs are protocol-checked (http/https only) at registration;
  instance registration is an operator action through the management API
  (admin-token / GUI-session principal, like every management route).
- All high-impact operations run policy evaluation + hash-bound approval
  verification inside the service before any remote call.
- `sp_audit` records every integration, publication, approval, dispatch,
  retry, reconciliation, and analytics action.

## Verification

`bun run typecheck` — no errors in the phase's files (pre-existing errors in
`agent-platform`, `capability-lab`, `mobile`, `skill-gate` sources are
untouched by this phase). `bun test tests/social-publishing.test.ts` — 37 pass.
Route-registry scanner green (one pre-existing in-flight guard shape in
`capability-lab-routes.ts:23` also repaired to the recognized anchor form —
no behavior change). See `PHASE_20_60_REPORT.md` for the full report.
