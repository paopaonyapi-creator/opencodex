# PHASE_20_63_REPORT.md — Pao-hubPro × Public APIs External Capability Registry

Companion design doc: `docs/PHASE_20_63_EXTERNAL_API_REGISTRY.md` (includes
the compatibility record, condensed runbook, and rollback procedure).

## 1. Architecture detected

Bun-native TypeScript; shared SQLite via `src/agent-os/db.ts` (schema v50 →
**51**); management routes under `/api/agent-os/*` with prefix-decode
dispatchers; module conventions from the 20.56–20.62 lineage (pure policy
functions, module audit tables, `WebMcpToolDefinition`, injectable
fetcher/transport seams, `ur-*` GUI pages). No parallel DB/ORM/queue/secret
store introduced.

## 2. Upstream verified

`public-apis/public-apis` @ `536d5c4e5ff25e16c0f27e6bda4c9308ffc5fd33`
(master), MIT, README ≈ 256 KB. Canonical dataset = `### Category` sections
with `API | Description | Auth | HTTPS | CORS` tables; the parser skips
foreign-format sections (verified against the live sponsored block). Known
upstream dead-link issues → presence is discovery evidence only.

## 3. Files added/changed

**New — `src/agent-os/external-apis/`**: `types.ts` (lifecycles + domain +
source contract), `config.ts` (flags §65-§66), `security.ts` (SSRF/egress +
structural redaction), `parser.ts` (source adapter + deterministic parser +
auth normalization + hostname dedupe), `trust.ts` (three-dimension versioned
scoring + data classification), `store.ts` (`eap_*` CRUD), `service.ts`
(sync/diff, lifecycle walker, capability search, tool generation, execution
gateway, circuit breaker, health, credential broker), `mcp-tools.ts` (7
agent-safe tools).

**Changed**: `src/agent-os/db.ts` (v51), `agent-os-routes.ts` (chain link),
`.env.example`.

**New**: `src/server/management/external-apis-routes.ts`,
`tests/external-apis.test.ts`, `gui/src/pages/ExternalApis.tsx` + App/
routing/i18n ×10/oxlint, the design doc above + this report.

## 4. Migration

`AGENT_OS_SCHEMA_VERSION` 50 → 51: `eap_sources`, `eap_snapshots`,
`eap_providers`, `eap_operations`, `eap_credential_profiles`, `eap_tools`,
`eap_health_checks`, `eap_runtime_calls`, `eap_audit` + lifecycle/health/
call indexes. The spec's 24 logical tables are consolidated with equal
control-plane semantics (aliases/scores/evidence on the provider row, spec
snapshots on operations, reviews/revocations/sync runs in audit + snapshots)
— additive, reversible by dropping `eap_*`.

## 5. Source adapter & parser design

`fetchSnapshot` resolves the branch head, pins the SHA, fetches the raw
README, hashes bytes; `parse` accepts canonical headers with or without a
leading pipe, maps rows with a per-row content hash, and skips unmappable
rows + foreign-format sections into warnings; `validate` enforces row-count
floors (10% drop ⇒ quarantine) and category presence. Sync commits
transactionally with add/update/soft-remove diffs (HTTPS downgrades and
auth additions raise review events); last known-good survives every failure.

## 6-9. Registry / capabilities / health / credentials

- Provider + operation lifecycle state machines enforced per spec §8-§9
  (forward-path walking for automatic pipeline stages; `revoked` reopens only
  through operator `review_required`).
- Capability ontology `<domain>.<resource>.<action>` with evidence-bearing
  classification and explainable search ranking (match count, approval,
  health, credential-free, trust).
- Health checks are safe, bounded probes producing evidence only — never
  approval; failures feed the circuit breaker.
- Trust/risk/confidence computed by `eap-trust-1` policy; persisted with
  evidence factors.

## 10. SSRF/egress + 11. policy/approval + 12. MCP + 13. gateway

- `validateOutboundUrl`: https-only default, loopback/RFC1918/CGNAT/
  link-local/metadata/multicast + IPv6 ULA/loopback + decimal/hex/octal
  encoded hosts + userinfo + `file:`/`gopher:`/`ftp:` all blocked; redirect
  revalidation + caps.
- Three policy layers (provider existence, operation/tool exposure, runtime
  call) fail closed; mutating/sensitive operations require approval;
  generated tools are **disabled by default**, bind to internal operation
  IDs (no URL fields), strip secret-shaped schema fields, and require the
  contract-test → approval → enable chain.
- Execution gateway: enablement → revocation/circuit → data-class policy →
  local rate limit → credential resolution (opaque refs, no cross-identity
  fallback) → SSRF validation → fetch (timeout/size-capped) → response
  validation + redaction → runtime-call + audit records.

## 14-16. Routes / MCP / flags

See the design doc's Surfaces section. Route tests cover health, sync,
capability search with `whyRanked`, mcp-tools listing, and the full
lifecycle transition path through the API.

## 17. Tests run (exact results)

`bun test tests/external-apis.test.ts` — **20 pass / 0 fail** (130 expect
calls): parser (canonical rows, foreign-format skip, auth normalization,
duplicate hostnames, malformed rows), drift quarantine + last-known-good
preservation, snapshot SHA pinning, the full SSRF suite (14 blocked URL
forms), structural redaction, trust dimension separation, data classes,
lifecycle machine (12 states, illegal jumps refused), the §68 E2E (sync →
classify → review/approve → generate disabled tool → contract test → approve
→ enable → execute → revoke → execution denied with evidence preserved),
circuit breaker, credential broker (server-side injection, secret never in
records), mutation-default-strict policy, and feature-flag gating. Plus the
cross-phase regression set in §19.

## 18. Build result

`bun run typecheck` — 0 errors in phase files (pre-existing errors elsewhere
untouched). GUI tsc + `vite build` clean; `lint:gui` 0 warnings/0 errors;
`privacy:scan` 0 findings in phase files. No real credentials committed
(fixture secrets are `not-real` placeholders).

## 19. Remaining risks / TODOs

- OpenAPI/spec enrichment + auto-discovery (spec §16-§18) is flag-gated but
  the discovery crawler is not implemented this phase — operations are
  classified from operator/worker-supplied schemas (Stage C work).
- Worker-runtime job integration (spec §49-§50) is represented by the
  service methods; scheduled workers land with Stage B/C enablement.
- Live health probing is off by default; safe-probe recipes per provider are
  operator configuration.

## 20. Rollback procedure

`PAO_EXTERNAL_API_REGISTRY_ENABLED=false` (module inert; lazy-activated from
routes/MCP only). Keep registry read-only; retain audit/snapshot/call
evidence; revoke affected credential profiles if compromise is suspected.
Schema rollback: drop `eap_*` tables + revert the version constant only if
no later migration landed. Full procedure in the design doc.

STATUS: **READY**
