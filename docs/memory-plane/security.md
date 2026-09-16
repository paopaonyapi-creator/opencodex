# Memory Plane Security (Phase 20.41)

## Scopes (spec §24)

Canonical registry — the single source for MCP tools, OAuth metadata,
docs and policy:

```text
memory:read    recall / metadata
memory:write   remember / observe / digest   (never implies delete)
memory:delete  destructive mutation rights   (never implied by write)
memory:trace   trace inspection
memory:admin   includes all memory scopes
```

Alternative spellings (`memory:rw`) are rejected, not normalized. Scope
evaluation runs server-side on EVERY protected call — including system
and dashboard actors (no anonymous write/delete path, no audit bypass).

## OAuth 2.1 (spec §23, §43)

- Authorization-code grant with **PKCE S256 mandatory** (`plain` rejected).
- **DCR** for compatible MCP clients (disable with
  `MEMORY_OAUTH_DCR_ENABLED=false`).
- Short-lived one-time authorization codes (120 s), exact redirect-URI
  matching, per-scope operator consent required before code issuance.
- Short-lived access tokens (`MEMORY_OAUTH_ACCESS_TOKEN_TTL_SECONDS`,
  default 900), **rotating refresh tokens** with family-based reuse
  detection — replaying a rotated refresh token revokes the whole family.
- Token hashing: only sha256 hashes are persisted; raw tokens are never
  logged, stored in URLs, or shown in the dashboard.
- Revocation endpoints + client disable; discovery metadata advertises
  only implemented features (`refresh_token` grant is implemented and
  advertised; nothing speculative).

## Preview-confirm mutations (spec §3.5, §16)

Forget/rebuild require a preview whose impact snapshot is server-computed
and a confirmation receipt that is HMAC-signed (fail-closed: no signing
secret → destructive confirmation disabled). Confirmation re-validates
signature, expiry, consumption, and target revision+hash — stale state
returns a conflict without mutating. Replayed receipts are rejected.
Historical trace and supersession snapshots survive forgetting.

## Privacy (spec §31)

- No raw bearer/refresh tokens, memory bodies, or full queries in logs.
- Traces store query hashes only — documented as correlation, **not
  anonymization** (low-entropy queries remain linkable).
- The local embedding provider sends nothing off-host; a remote provider
  is only used when explicitly configured, and the dashboard shows which
  provider receives text.
- Audit events carry IDs and metadata, never private content.
- Rate limits on DCR/token endpoints and expensive recall paths; request
  size capped by `MEMORY_MAX_CONTENT_BYTES`.

## Error hygiene

Typed error codes (`MEMORY_SCOPE_DENIED`, `REVISION_CONFLICT:409`,
`NOT_FOUND`, `CONSENT_REQUIRED`, `INVALID_REDIRECT_URI`, …) — no stack
traces, no secret material in messages.
