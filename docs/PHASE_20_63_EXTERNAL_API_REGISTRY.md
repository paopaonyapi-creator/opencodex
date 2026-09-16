# Phase 20.63 — Pao-hubPro × Public APIs: External Capability Registry

Universal external capability registry, API discovery, health & trust
intelligence, MCP tool generation, and the policy-governed API access gateway
around `public-apis/public-apis` (discovery evidence only — never a trust
authority).

> **Final design rule:** Discovery is not trust. Health is not authorization.
> Generated is not enabled. Public APIs supplies candidates; Pao-hubPro
> supplies governance.

## Architecture and boundaries

```text
Upstream README (pinned commit 536d5c4e…) → ApiCatalogSource → immutable snapshot
  → deterministic parser → normalized registry (eap_providers, raw evidence preserved)
  → trust/risk/confidence (versioned policy eap-trust-1)
  → operations (data-class + risk classification)
  → generated MCP tools (disabled by default, spec-pinned, secret-free schemas)
  → human approval → enabled → API Execution Gateway (policy → status →
    credential broker → SSRF/egress → rate limit → fetch → validate → audit)
```

- `ApiCatalogSource` is replaceable; `PublicApisGithubSource` implements
  fetch-at-pinned-SHA → SHA-256 snapshot → deterministic 5-column table parse
  (`API | Description | Auth | HTTPS | CORS`), skipping foreign-format
  sections (e.g. the upstream sponsored block). Row-drop > 10% quarantines
  the sync; the last known-good registry survives and upstream removals are
  marked `source_presence = removed`, never deleted.
- Lifecycles: provider `discovered → ingested → enriching → observed →
  review_required → approved → active` (+ degraded/suspended/revoked/
  rejected/invalid; `revoked` reopens only via operator `review_required`);
  operation `discovered → schema_parsed → classified → policy_reviewed →
  generated → tested → approved → enabled`. `DISCOVERED ≠ APPROVED`,
  `GENERATED ≠ ENABLED`.
- Trust model: separate `trust_score`, `risk_score`, `confidence` with the
  policy version persisted per assessment. Scores never grant permissions.

## Security invariants (all tested)

- **SSRF/egress:** https-only default; loopback/private/link-local/metadata
  IPv4+IPv6 blocked including decimal/hex/octal-encoded hosts, userinfo
  tricks, `file:`/`gopher:`/`ftp:`; redirect revalidation and caps; every
  egress flows through `executeApproved()` — agents bind to registry
  operation IDs, never URLs.
- **Credentials:** opaque `secretRef` profiles resolved server-side at call
  time; secrets never enter tool schemas (secret-shaped fields stripped
  before generation), prompts, logs, or audit rows (structurally redacted).
- **Prompt injection:** API docs, spec descriptions, and provider responses
  are untrusted data; executable structure derives only from validated
  schemas + policy.
- **Revocation:** immediate tool disablement, circuit-breaker open, call
  denial, evidence preserved.
- **Circuit breakers:** closed → half_open → open on consecutive failures
  (5xx) with `ACTIVE → DEGRADED`.

## Feature flags / rollout

`PAO_EXTERNAL_API_REGISTRY_ENABLED` gates everything; stage flags:
`PAO_PUBLIC_APIS_SOURCE_ENABLED`, `..._ENRICHMENT`, `..._HEALTH_CHECKS`,
`..._OPENAPI_DISCOVERY`, `..._TOOL_GENERATION`, `..._RUNTIME_EXECUTION`
(default **false**). Rollout: A read-only catalog → B health/trust → C spec
enrichment → D disabled tool generation → E approved read-only providers →
F credential-backed → G selected mutating operations (explicit approval).

## Surfaces

- **API:** `/api/agent-os/external-apis/*` — `sync`, `capabilities/search`,
  `providers[/:id/{review,approve,suspend,revoke,health-check,operations,
  credentials}]`, `operations/:id/generate-tool`,
  `tools[/:id/{contract-test,approve,enable,disable}]`, `execute`, `calls`,
  `audit`, `mcp-tools`.
- **MCP (agent-safe):** `external_api_search_capabilities`,
  `external_api_list_providers`, `external_api_get_provider`,
  `external_api_list_operations`, `external_api_get_health`,
  `external_api_request_tool_generation`, `external_api_execute_approved`
  (R3). Approve/revoke stay dashboard-only by design.
- **Dashboard:** External APIs page (registry overview, providers with
  lifecycle/health/trust, impact-style review queue, audit timeline).

## Runbook (condensed)

- **Sync fails / parser drift:** last known-good registry is preserved
  automatically; inspect `eap_snapshots.warnings_json`; fix or pin a new
  upstream SHA; re-run `POST sync`.
- **Provider unreachable:** health engine marks `unreachable` with backoff;
  never auto-approves; `ACTIVE → DEGRADED` on repeated failures.
- **Credential lookup fails:** request denied; never falls back to another
  identity's credential.
- **Policy service fails:** fail closed for external execution.
- **Revocation:** `POST providers/:id/revoke` — cascade disables tools +
  opens the breaker; evidence retained.
- **Rollback:** set `PAO_EXTERNAL_API_REGISTRY_ENABLED=false` (module is
  lazy-activated, never on the core request path); keep registry read-only;
  preserve audit/snapshot/call evidence. Schema v51 is additive — drop
  `eap_*` tables only if no later migration landed.

## Upstream compatibility record

| Field | Value |
|---|---|
| Repository | `public-apis/public-apis` (branch `master`) |
| Pinned commit | `536d5c4e5ff25e16c0f27e6bda4c9308ffc5fd33` |
| License | MIT (GitHub license API + repo) |
| Dataset shape | `### Category` sections; 5-column tables `API/Description/Auth/HTTPS/CORS`; sponsored foreign-format sections skipped by the parser |
| Known upstream issues | deprecated/dead-link reports → presence is discovery evidence only |
| Parser version | `public-apis-readme-1` |
| Verified | 2026-09-16 |
