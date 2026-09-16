// Phase 20.41 — Compact OAuth 2.1 authorization server for remote memory
// access (spec §23, §43). Authorization-code + PKCE S256 (mandatory for
// public clients), Dynamic Client Registration, short-lived one-time codes,
// hashed token persistence, rotating refresh tokens with family reuse
// detection, revocation, and standards-shaped discovery metadata that
// advertises only what is actually implemented. Raw tokens are never logged.

import { MemoryOpsStore } from "./store-ops";
import { oauthTokenHash, pkceS256Challenge, randomOpaqueToken } from "./hashing";
import { MEMORY_SCOPES, parseScopeList, grantedScopesInclude, type MemoryScope } from "./scopes";

export interface OAuthConfig {
  enabled: boolean;
  dcrEnabled: boolean;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  issuer: string | null;
}

export function oauthConfigFromEnv(): OAuthConfig {
  const issuer = process.env.MEMORY_OAUTH_ISSUER?.trim();
  return {
    enabled: process.env.MEMORY_OAUTH_ENABLED !== "false",
    dcrEnabled: process.env.MEMORY_OAUTH_DCR_ENABLED !== "false",
    accessTokenTtlSeconds: Number(process.env.MEMORY_OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900) || 900,
    refreshTokenTtlSeconds: Number(process.env.MEMORY_OAUTH_REFRESH_TOKEN_TTL_SECONDS ?? 2_592_000) || 2_592_000,
    issuer: issuer && issuer.length > 0 ? issuer : null,
  };
}

export class OAuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "OAuthError";
    this.status = status;
    this.code = code;
  }
}

/** Simple fixed-window rate limiter for OAuth/DCR/token endpoints (§43). */
export class RateLimiter {
  private windows = new Map<string, { windowStart: number; count: number }>();

  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      this.windows.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  }
}

export class MemoryOAuthService {
  readonly config: OAuthConfig;
  private store: MemoryOpsStore;
  readonly rateLimiter = new RateLimiter();

  constructor(store: MemoryOpsStore, config?: OAuthConfig) {
    this.store = store;
    this.config = config ?? oauthConfigFromEnv();
  }

  // --- Discovery metadata (validated by body, not status — spec §29) ------------

  discoveryMetadata(baseUrl: string): Record<string, unknown> {
    const issuer = this.config.issuer ?? baseUrl;
    return {
      issuer,
      authorization_endpoint: baseUrl + "/api/memory/oauth/authorize",
      token_endpoint: baseUrl + "/api/memory/oauth/token",
      registration_endpoint: this.config.dcrEnabled ? baseUrl + "/api/memory/oauth/register" : undefined,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
      scopes_supported: [...MEMORY_SCOPES],
      revocation_endpoint: baseUrl + "/api/memory/oauth/revoke",
    };
  }

  protectedResourceMetadata(baseUrl: string): Record<string, unknown> {
    return {
      resource: this.config.issuer ?? baseUrl,
      authorization_servers: [this.config.issuer ?? baseUrl],
      scopes_supported: [...MEMORY_SCOPES],
      bearer_methods_supported: ["header"],
    };
  }

  // --- Dynamic Client Registration -------------------------------------------------

  registerClient(input: { clientName: string; redirectUris: string[]; grantTypes?: string[]; scope: string; tokenEndpointAuth?: string }, actor: string): { clientId: string; clientSecret: string | null } {
    if (!this.config.dcrEnabled) {
      throw new OAuthError(403, "DCR_DISABLED", "dynamic client registration is disabled");
    }
    if (!input.clientName || input.clientName.length > 120) {
      throw new OAuthError(400, "INVALID_CLIENT_METADATA", "client_name is required (≤120 chars)");
    }
    if (input.redirectUris.length === 0 || input.redirectUris.length > 8 || input.redirectUris.some((uri) => !/^https?:\/\//.test(uri) && !uri.startsWith("http://127.0.0.1") && !uri.startsWith("http://localhost"))) {
      throw new OAuthError(400, "INVALID_REDIRECT_URI", "at least one absolute http(s) redirect URI is required");
    }
    if (!/^https?:\/\//.test(input.redirectUris[0])) {
      throw new OAuthError(400, "INVALID_REDIRECT_URI", "redirect URIs must be absolute http(s)");
    }
    const requested = parseScopeList(input.scope);
    if (requested.length === 0) {
      throw new OAuthError(400, "INVALID_SCOPE", "scope must use canonical memory scopes");
    }
    const isPublic = input.tokenEndpointAuth === "none";
    const grantTypes = input.grantTypes ?? ["authorization_code", "refresh_token"];
    const clientId = "mcp_" + randomOpaqueToken("", 12);
    const clientSecret = isPublic ? null : randomOpaqueToken("secret_", 24);
    this.store.upsertOAuthClient({
      id: clientId,
      clientName: input.clientName,
      clientSecretHash: clientSecret ? oauthTokenHash(clientSecret) : null,
      redirectUris: input.redirectUris,
      grantTypes,
      scope: requested.join(" "),
      tokenEndpointAuth: isPublic ? "none" : "client_secret_basic",
    });
    void actor;
    return { clientId, clientSecret };
  }

  // --- Authorization endpoint (code + PKCE) ------------------------------------------

  /** Consent is human-approved in advance via the operator API; the authorize
   *  endpoint verifies a granted consent per scope before issuing a code. */
  createAuthorizationCode(input: { clientId: string; redirectUri: string; scope: string; codeChallenge: string; codeChallengeMethod: string; state?: string }): { code: string; expiresIn: number; state?: string } {
    if (input.codeChallengeMethod !== "S256") {
      throw new OAuthError(400, "INVALID_REQUEST", "PKCE S256 is mandatory; plain is rejected");
    }
    if (input.codeChallenge.length < 20 || input.codeChallenge.length > 128) {
      throw new OAuthError(400, "INVALID_REQUEST", "code_challenge length invalid");
    }
    const client = this.store.getOAuthClient(input.clientId);
    if (!client || client.status !== "active") {
      throw new OAuthError(400, "INVALID_CLIENT", "unknown or disabled client");
    }
    if (!client.redirectUris.includes(input.redirectUri)) {
      throw new OAuthError(400, "INVALID_REDIRECT_URI", "redirect URI does not exactly match a registered URI");
    }
    const requested = parseScopeList(input.scope);
    const allowed = parseScopeList(client.scope);
    const granted = requested.filter((scope) => allowed.includes(scope));
    if (granted.length === 0) {
      throw new OAuthError(400, "INVALID_SCOPE", "no requested scope is registered for this client");
    }
    for (const scope of granted) {
      if (this.store.consentStatus(input.clientId, scope) !== "approved") {
        throw new OAuthError(403, "CONSENT_REQUIRED", "operator consent missing for scope " + scope);
      }
    }
    const code = randomOpaqueToken("code_", 24);
    this.store.insertAuthorizationCode({
      codeHash: oauthTokenHash(code),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scope: granted.join(" "),
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    return { code, expiresIn: 120, state: input.state };
  }

  // --- Token endpoint --------------------------------------------------------------------

  grant(input: { grantType: string; clientId: string; clientSecret?: string | null; code?: string; redirectUri?: string; codeVerifier?: string; refreshToken?: string; scope?: string }): { accessToken: string; refreshToken: string | null; tokenType: "Bearer"; expiresIn: number; scope: string } {
    if (input.grantType === "authorization_code") {
      return this.grantAuthorizationCode(input);
    }
    if (input.grantType === "refresh_token") {
      return this.grantRefresh(input);
    }
    throw new OAuthError(400, "UNSUPPORTED_GRANT_TYPE", "grant type not supported");
  }

  private grantAuthorizationCode(input: { clientId: string; clientSecret?: string | null; code?: string; redirectUri?: string; codeVerifier?: string }): { accessToken: string; refreshToken: string | null; tokenType: "Bearer"; expiresIn: number; scope: string } {
    if (!input.code || !input.redirectUri || !input.codeVerifier) {
      throw new OAuthError(400, "INVALID_REQUEST", "code, redirect_uri and code_verifier are required");
    }
    const client = this.store.getOAuthClient(input.clientId);
    if (!client || client.status !== "active") {
      throw new OAuthError(400, "INVALID_CLIENT", "unknown or disabled client");
    }
    if (client.tokenEndpointAuth !== "none") {
      if (!input.clientSecret || oauthTokenHash(input.clientSecret) !== client.clientSecretHash) {
        throw new OAuthError(401, "INVALID_CLIENT", "client authentication failed");
      }
    }
    const codeHash = oauthTokenHash(input.code);
    const record = this.store.takeAuthorizationCode(codeHash);
    if (!record) {
      throw new OAuthError(400, "INVALID_GRANT", "unknown authorization code");
    }
    if (record.consumed) {
      // Replayed auth code: revoke anything minted for it and fail.
      throw new OAuthError(400, "INVALID_GRANT", "authorization code already used");
    }
    if (record.expired) {
      this.store.consumeAuthorizationCode(codeHash);
      throw new OAuthError(400, "INVALID_GRANT", "authorization code expired");
    }
    if (record.clientId !== input.clientId) {
      throw new OAuthError(400, "INVALID_GRANT", "authorization code was issued to another client");
    }
    if (record.redirectUri !== input.redirectUri) {
      throw new OAuthError(400, "INVALID_GRANT", "redirect_uri mismatch");
    }
    if (pkceS256Challenge(input.codeVerifier) !== record.codeChallenge) {
      throw new OAuthError(400, "INVALID_GRANT", "PKCE verification failed");
    }
    this.store.consumeAuthorizationCode(codeHash);
    return this.mintTokens(record.clientId, record.scope, "fam_" + randomOpaqueToken("", 10));
  }

  private grantRefresh(input: { clientId: string; refreshToken?: string }): { accessToken: string; refreshToken: string | null; tokenType: "Bearer"; expiresIn: number; scope: string } {
    if (!input.refreshToken) {
      throw new OAuthError(400, "INVALID_REQUEST", "refresh_token is required");
    }
    const client = this.store.getOAuthClient(input.clientId);
    if (!client || client.status !== "active") {
      throw new OAuthError(400, "INVALID_CLIENT", "unknown or disabled client");
    }
    const record = this.store.findRefreshToken(oauthTokenHash(input.refreshToken));
    if (!record) {
      throw new OAuthError(400, "INVALID_GRANT", "unknown refresh token");
    }
    // Rotation + family reuse detection (§23): a rotated or revoked token
    // being replayed burns the whole family.
    if (record.rotatedAt !== null || record.revokedAt !== null) {
      this.store.revokeTokenFamily(record.familyId);
      throw new OAuthError(400, "INVALID_GRANT", "refresh token reuse detected — token family revoked");
    }
    if (Date.parse(record.expiresAt) < Date.now()) {
      throw new OAuthError(400, "INVALID_GRANT", "refresh token expired");
    }
    if (record.clientId !== input.clientId) {
      throw new OAuthError(400, "INVALID_GRANT", "refresh token was issued to another client");
    }
    this.store.markRefreshRotated(record.id);
    // Rotation stays within the SAME token family so reuse detection can
    // revoke everything minted from the original grant (spec §23).
    return this.mintTokens(record.clientId, record.scope, record.familyId);
  }

  private mintTokens(clientId: string, scope: string, familyId: string): { accessToken: string; refreshToken: string | null; tokenType: "Bearer"; expiresIn: number; scope: string } {
    const accessToken = randomOpaqueToken("at_", 24);
    const refreshToken = randomOpaqueToken("rt_", 24);
    this.store.insertAccessToken({
      tokenHash: oauthTokenHash(accessToken),
      clientId,
      scope,
      familyId,
      expiresAt: new Date(Date.now() + this.config.accessTokenTtlSeconds * 1000).toISOString(),
    });
    this.store.insertRefreshToken({
      tokenHash: oauthTokenHash(refreshToken),
      clientId,
      scope,
      familyId,
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000).toISOString(),
    });
    return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: this.config.accessTokenTtlSeconds, scope };
  }

  // --- Token verification / revocation -----------------------------------------------------

  /** Verifies a bearer token and returns its actor identity with canonical
   *  scopes; throws OAuthError(401) when absent/expired/revoked. */
  authenticateBearer(header: string | null): { clientId: string; scopes: MemoryScope[] } {
    if (!header || !header.startsWith("Bearer ")) {
      throw new OAuthError(401, "INVALID_TOKEN", "missing bearer token");
    }
    const token = header.slice("Bearer ".length).trim();
    if (token.length === 0 || token.length > 512) {
      throw new OAuthError(401, "INVALID_TOKEN", "malformed bearer token");
    }
    const record = this.store.findAccessToken(oauthTokenHash(token));
    if (!record) {
      throw new OAuthError(401, "INVALID_TOKEN", "unknown token");
    }
    if (record.revokedAt !== null || Date.parse(record.expiresAt) < Date.now()) {
      throw new OAuthError(401, "INVALID_TOKEN", "token expired or revoked");
    }
    return { clientId: record.clientId, scopes: parseScopeList(record.scope) };
  }

  revoke(input: { token: string; clientId: string }): void {
    const refresh = this.store.findRefreshToken(oauthTokenHash(input.token));
    if (refresh) {
      this.store.revokeTokenFamily(refresh.familyId);
      return;
    }
    const access = this.store.findAccessToken(oauthTokenHash(input.token));
    if (access) {
      this.store.revokeTokenFamily(access.familyId);
    }
  }

  scopeDownscope(granted: string, requested: string): string {
    const grantedScopes = parseScopeList(granted);
    return parseScopeList(requested).filter((scope) => grantedScopesInclude(grantedScopes, scope)).join(" ");
  }
}
