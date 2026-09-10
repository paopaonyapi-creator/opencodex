# Phase 20.15 — Pao-hubPro Domain Control Plane × DigitalPlat Domain-OSS

Status: Implemented, core verified. Not yet exercised against a live provider.

## What this phase is

A Domain Control Plane that lets Pao-hubPro, its dashboard, MCP agents, ChatGPT, and
Codex workflows inspect and safely manage domains, DNS records, reverse-proxy routes,
TLS state, deployment-to-domain bindings, approvals, rollback, and audit history.

The design rule is one sentence: **nothing mutates DNS without a diff, a risk
classification, and an approval that is bound to that exact operation.**

## Numbering note

This work is numbered **20.15**, not 20.14 as the planning document proposed.
`20.14` was already in use twice in this repository's history (Visual Knowledge &
Media Memory, and the End-to-End Stock Pipeline), so reusing it would have collided.
The existing scheme treats the base phase as the umbrella product line and the decimal
as the feature line, which is why the next free decimal is 20.15.

## Safety pipeline

Every mutation walks this path, and `service.ts` is the only module that may run the
steps from Execute onward:

```text
Observe -> Plan -> Diff -> Policy -> Approval -> Execute -> Verify -> Audit
```

| Step | What it does | Where |
| --- | --- | --- |
| Observe | Read authoritative provider state | `providers/*.ts` |
| Plan | Build the intended record set | `diff.ts` |
| Diff | Compare observed vs intended, field by field | `diff.ts` |
| Policy | Allowlist, hostname validation, risk tier | `policy.ts` |
| Approval | Persist, bind, and expire an approval | `store.ts`, `service.ts` |
| Execute | One controlled provider write | `service.ts` |
| Verify | Re-read provider state; bounded DNS/TLS/HTTP checks | `service.ts`, `verification.ts` |
| Audit | Append-only audit row for every outcome | `store.ts` |

## Three distinct mutation modes

Collapsing these is how either the approval queue or the write path goes wrong, so they
are separate and tested separately:

| Mode | Trigger | Behaviour |
| --- | --- | --- |
| `preview` | explicit `dry_run: true` | Returns the diff. Creates **no** approval row. |
| `approval_required` | agent actor, no approval id | Returns the diff and records a **pending** approval. Does not write. |
| `execute` | anything else | Still passes the approval gate; refuses without a granted approval id. |

A `dry_run` preview deliberately does not enqueue an approval: the dashboard separates
"Dry Run" from "Request Approval", and a preview that created rows would turn the
approval list into noise and train an operator to bulk-approve.

## What is enforced (and proven by tests)

- Agent mutations never write by default, even when the caller passes `dry_run: false`.
- **An empty allowlist freezes every mutation.** Deny-by-default, not allow-by-default.
- Allowlist matching is boundary-aware: `example.com` admits `www.example.com` and never
  `notexample.com`.
- An approval is bound to one operation **and** one resource, and expires.
- Record types outside the first-release set (A, AAAA, CNAME, TXT) cannot execute at all.
- Provider state is re-read after every write; `settled: false` is reported honestly
  rather than as success.
- An ambiguous write is reported with `requiresStateReread` and is never retried.
- Every outcome — dry run, refusal, denial, failure, success — writes an audit row.
- Rollback is a new audited mutation with its own approval, never a silent undo.

## Provider abstraction

```text
DomainProvider
+-- FakeDomainProvider        in-memory, deterministic, no credential
+-- DomainOssProvider         DigitalPlat Domain-OSS over REST
```

The MCP layer never calls a provider directly. A new provider is a new adapter, not a
new call path.

### DigitalPlat Domain-OSS integration boundary

Domain-OSS is treated as an **independent external service reached over HTTP**. No
upstream source is vendored or copied into this repository.

This is a licensing requirement, not only a preference: **upstream Domain-OSS is
AGPL-3.0**. Keeping it at arm's length across its REST API is what keeps this
repository's MIT position unambiguous. Do not vendor, copy, or link its source.

The API surface was read from upstream source at integration time
(`domain_oss/routes/api.py`, `docs/API.md`) rather than assumed from the planning
document:

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/api/v1/domains` | `domains:read` |
| GET | `/api/v1/domains/{id}` | `domains:read` |
| GET | `/api/v1/domains/{id}/records` | `dns:read` |
| POST | `/api/v1/domains/{id}/records` | `dns:write` |
| PATCH | `/api/v1/domains/{id}/records/{record_id}` | `dns:write` |
| DELETE | `/api/v1/domains/{id}/records/{record_id}` | `dns:write` |
| POST | `/api/v1/domains/{id}/acme-challenges` | `acme:write` |
| DELETE | `/api/v1/domains/{id}/acme-challenges/{token}` | `acme:write` |

Two upstream facts materially shaped the implementation:

1. **Writes are asynchronous.** `POST` returns `201` with `{ data, job_id, sync_status }`
   and `PATCH` returns `{ data, jobs }`. The change is applied by a worker, so the write
   response is not evidence that anything changed. This is why verification re-reads
   provider state instead of trusting the response.
2. **PATCH is the update verb**, and a successful record delete returns `204` with an
   empty body.

Upstream also enforces its own constraints that this layer surfaces rather than
duplicates: a `409` when a CNAME would share a name with other records, and a `403`
when a record type or wildcard is disabled for the zone.

## Verified record types

This release enables autonomous mutation of **A, AAAA, CNAME, and TXT** only.
`MX`, `NS`, `CAA`, `SRV`, and wildcard/apex migration are classified elevated and
cannot be executed by an agent flow even with an approval, until the
approval/audit/rollback path has more production mileage.

## MCP tools

Tool naming follows this repository's existing flat snake_case convention (as in
`media_memory_search`, `video_analyze`); the dotted namespace is presentation, and each
tool's description names it. 32 tools are registered (domain 11, dns 10, ssl 4,
deployment 7):

```text
domain.*      domain_list, domain_get, domain_status, domain_nameservers,
              domain_provider, domain_health, domain_list_approvals,
              domain_audit_log, domain_metrics, domain_validate_target,
              domain_mask_secret
dns.*         dns_list_zones, dns_list_records, dns_get_record, dns_resolve,
              dns_diff, dns_check_propagation, dns_create_record,
              dns_update_record, dns_delete_record, dns_restore_record
ssl.*         ssl_status, ssl_inspect, ssl_request, ssl_verify
deployment.*  deployment_plan, deployment_list, deployment_get,
              deployment_attach_domain, deployment_detach_domain,
              deployment_check_route, deployment_health
```

Every mutating tool accepts `dry_run`, `approval_id`, `request_id`,
`idempotency_key`, `reason`, and `actor`. No tool returns a credential.

`ssl_request` is marked read-only on purpose: it creates no certificate order. With
Caddy automatic HTTPS, issuance follows from a live route, so the tool reports the ACME
path rather than fabricating an order.

## Management API

```text
GET    /api/agent-os/domains                  overview, metrics, masked credentials
GET    /api/agent-os/domains/zones            zones + allowlist verdict
GET    /api/agent-os/domains/records          records for ?hostname=
GET    /api/agent-os/domains/records/diff     intended-vs-observed diff
GET    /api/agent-os/domains/approvals        approval queue (?status=)
GET    /api/agent-os/domains/audit            append-only audit trail
GET    /api/agent-os/domains/providers        provider descriptors + credential state
GET    /api/agent-os/domains/bindings         domain-to-deployment bindings
POST   /api/agent-os/domains/records          create or update
POST   /api/agent-os/domains/records/delete   delete
POST   /api/agent-os/domains/records/restore  rollback to a prior state
POST   /api/agent-os/domains/approvals/decide grant | deny
POST   /api/agent-os/domains/deployment/plan  build a reviewable plan
POST   /api/agent-os/domains/deployment/attach
POST   /api/agent-os/domains/deployment/detach
```

Requests arriving over HTTP are treated as agent-originated unless the caller says
otherwise. The admin token is readable by anything running as the user, so it is not
evidence of a human decision; the approval id is.

## Reverse proxy

There was no reverse proxy in this repository before this phase. The adapter is
deliberately thin: Caddy's admin API directly, no config templating, and no shell
interpolation of user input.

Routing targets pass an SSRF boundary before they reach a route. Loopback, private
(10/8, 172.16/12, 192.168/16), link-local including `169.254.169.254`, and multicast
addresses are refused. IPv6 targets are refused outright rather than accepted without a
private-range check.

`CADDY_ADMIN_URL` unset means the adapter reports itself unavailable and deployment
steps say so in their output, rather than silently doing nothing and looking successful.

## Data model

Additive tables on the existing Agent OS SQLite handle — no second database, no
migration tool, no container:

`dc_domains`, `dc_records_cache`, `dc_approvals`, `dc_audit_events`, `dc_idempotency`,
`dc_deployment_bindings`, `dc_provider_credentials`, `dc_verification_runs`

`dc_records_cache` is a cache and never a source of truth: every verification re-reads
the provider and overwrites it. `dc_audit_events` is append-only by convention — no
code path updates or deletes a row.

`dc_provider_credentials` stores a **reference** (an environment variable name) and a
masked preview. It never stores a credential value.

## Standardized errors

```text
PROVIDER_AUTH_FAILED  DOMAIN_NOT_ALLOWED   APPROVAL_REQUIRED  APPROVAL_EXPIRED
RECORD_CONFLICT       PROVIDER_TIMEOUT     AMBIGUOUS_MUTATION DNS_VERIFY_TIMEOUT
TLS_PROVISION_FAILED  PROXY_CONFIG_FAILED  HEALTH_CHECK_FAILED PROVIDER_UNAVAILABLE
VALIDATION_FAILED     IDEMPOTENCY_CONFLICT
```

Each carries `retryable` and `next_action`. `AMBIGUOUS_MUTATION` is explicitly
`retryable: false` with the instruction to re-read authoritative state — re-sending a
write whose response was lost is how duplicate records appear.

## Files

```text
src/agent-os/domain-control/
  types.ts        record, risk, approval, audit, and error model
  policy.ts       hostname validation, allowlist, risk classification
  diff.ts         intended-vs-observed diff engine (pure)
  config.ts       environment configuration + secret masking and redaction
  store.ts        SQLite persistence
  service.ts      THE SAFETY PIPELINE
  verification.ts bounded propagation polling, TLS, HTTP health
  proxy.ts        reverse-proxy adapter (Caddy) + SSRF boundary
  deployment.ts   plan / attach / detach orchestration
  mcp-tools.ts    the 32-tool suite
  providers/base.ts, providers/fake.ts, providers/domain-oss.ts
src/server/management/domain-control-routes.ts   management REST API
```

## Validation

```bash
bun test tests/domain-control-policy.test.ts \
         tests/domain-control-diff.test.ts \
         tests/domain-control-service.test.ts \
         tests/domain-control-secrets.test.ts \
         tests/domain-control-verification.test.ts \
         tests/domain-control-provider.test.ts \
         tests/domain-control-proxy.test.ts \
         tests/domain-control-mcp-tools.test.ts \
         tests/domain-control-deployment.test.ts \
         tests/domain-control-routes.test.ts
bun run typecheck
bun run privacy:scan
```

Result: 136 tests pass, 0 fail (593 assertions). Typecheck clean. Privacy scan green.

### Known pre-existing failure

`tests/management-route-registry.test.ts` reports one failure ("the scanner resolves a
method for every route guard it finds") that **pre-dates this phase** and was confirmed
by stashing this phase's changes and re-running at HEAD. It concerns route guards in
other subsystem modules and contains no domain-control entries. This phase did not add
to it: the dispatcher uses a bare prefix test with no equality literal, precisely so it
would not introduce an unresolvable route guard.
+### Unrelated defect found while validating (not fixed here)

`tests/chatbox-agent-desktop-runtime.test.ts` writes into a **tracked repository file**
when it runs. The test POSTs to `/api/desktop-agent/governance/debt`; the route resolves
its ledger through `getDebtLedger()` with no path, which falls back to
`process.cwd()/docs/governance/technical-debt.md`. Every run therefore appends a
`DEBT-<date>-00N` entry owned by `test-agent` to `docs/governance/technical-debt.md`.

Reproduced directly: `rg -c '^## DEBT-'` returned 3 before
`bun test tests/chatbox-agent-desktop-runtime.test.ts` and 4 after, with `git status`
showing the file modified. The emitted entry is dated in UTC, so it can carry
yesterday's date and look like someone else's edit.

It is left unfixed because it is outside this phase: the fix belongs in
`src/agent-os/governance/debt-ledger.ts` or `desktop-agent-routes.ts` (accept an
injected path, as `tests/ponytail-governance.test.ts` already does) or in the test
itself. The pollution produced during this session was removed, and the working tree
matches HEAD exactly.

## Enabling it for real

1. Set `DOMAIN_CONTROL_ENABLED=true`.
2. Set `DOMAIN_CONTROL_ALLOWLIST` to the zones you own. Nothing is mutable before this.
3. Set `DOMAIN_OSS_BASE_URL` and a **scoped** `DOMAIN_OSS_API_KEY`.
4. Rehearse against the fake provider first: `DOMAIN_DEFAULT_PROVIDER=fake`.
5. Test a staging zone end to end, including rollback and a simulated provider timeout.
6. Only then point `DOMAIN_DEFAULT_PROVIDER` at `domain_oss`.

Keep `DOMAIN_REQUIRE_APPROVAL=true`. Turning it off removes the gate that this entire
phase exists to provide.

## Not in this release

Registrar billing, automated paid-domain purchase or transfer, email hosting, DNSSEC
automation, multi-region authoritative DNS, public multi-tenant SaaS, and any DNS
mutation without approval.

## Dashboard

Not implemented. The management API, the MCP tool suite, and the full safety pipeline
are in place and tested; the `Infrastructure -> Domains` UI described in the planning
document has not been built. Its navigation surface is currently occupied by this
repository's own pages, so the UI placement needs a decision before implementation.
