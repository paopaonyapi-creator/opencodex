# Memory Plane OAuth (Phase 20.41)

Remote MCP clients authenticate with OAuth 2.1 patterns instead of a
static master key. Implemented in `src/agent-os/memory-plane/oauth.ts`,
exposed under `/api/memory/oauth/*` and `/api/memory/.well-known/*`.

## Discovery (body-validated, not status-trusted)

- `GET /api/memory/.well-known/oauth-authorization-server`
  → issuer, authorization/token/revocation endpoints, registration
  endpoint (when DCR on), `code_challenge_methods_supported: ["S256"]`,
  `grant_types_supported: ["authorization_code","refresh_token"]`,
  `scopes_supported` from the canonical registry.
- `GET /api/memory/.well-known/oauth-protected-resource`
  → resource, authorization servers, supported scopes, bearer-in-header.

## Flows

1. **DCR** — `POST /api/memory/oauth/register` with `client_name`,
   `redirect_uris` (absolute http(s), exact-match enforced), `scope`
   (canonical scopes only). Rate-limited. Public clients use
   `token_endpoint_auth: "none"`; confidential clients receive a secret
   (shown once, stored hashed).
2. **Consent** — an operator approves the client per scope via
   `POST /api/memory/oauth/clients/decide` (dashboard OAuth Clients tab).
   No consent → `CONSENT_REQUIRED` at authorize time.
3. **Authorize** — `code_challenge_method: S256` only (`plain` → 400);
   issues a one-time code valid for 120 s bound to client + redirect.
4. **Token** — `grant_type=authorization_code` with `code_verifier`;
   PKCE recomputation must match. Returns a short-lived access token and
   a rotating refresh token.
5. **Refresh** — `grant_type=refresh_token`; the old token is marked
   rotated and the new tokens stay in the SAME family. Replaying a
   rotated/revoked token revokes the entire family (reuse detection).
6. **Revoke** — `POST /api/memory/oauth/revoke` burns the family.

## Using a token

```bash
curl -X POST :10100/api/memory/recall \
  -H "authorization: Bearer at_..." \
  -d '{"query":"...","mode":"hybrid"}'
```

The server maps the bearer token to canonical scopes and evaluates the
tool's required scope per call. `401` with an absent/expired/revoked
token is expected and asserted by tests.

## Testing the contract

`bun test tests/memory-plane.test.ts` validates discovery bodies field by
field, DCR, PKCE success + plain rejection, exact redirect matching,
one-time codes, expiry, rotation, reuse detection, downscoping inputs,
and revocation.

## Configuration

```env
MEMORY_OAUTH_ENABLED=true
MEMORY_OAUTH_DCR_ENABLED=true
MEMORY_OAUTH_ISSUER=            # e.g. http://127.0.0.1:10100 (or your proxy URL)
MEMORY_OAUTH_ACCESS_TOKEN_TTL_SECONDS=900
MEMORY_OAUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
```

No tokens, secrets, or memory content appear in logs or audit events.
