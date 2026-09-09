/**
 * Pao AI Gateway — Identity management.
 *
 * Every gateway key belongs to one identity. Identities control:
 * - which aliases are accessible
 * - per-request and daily spend ceilings
 * - external provider access
 * - local-only restrictions
 */

import type { GatewayIdentity, GatewayConfig } from "../types";

/**
 * Authenticate a gateway request by API key.
 * Returns the identity associated with the key, or null if unauthorized.
 *
 * In v1, keys are simple bearer tokens mapped to identity ids.
 * Format: "pao-gw-{identityId}-{random}" stored as env var PAO_GW_KEY_{IDENTITY_ID}.
 */
export function authenticateRequest(
  authHeader: string | null,
  config: GatewayConfig,
): GatewayIdentity | null {
  if (!authHeader) return null;

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (!token) return null;

  // Check for admin master key
  const adminKey = process.env.PAO_AI_GATEWAY_ADMIN_KEY;
  if (adminKey && token === adminKey) {
    return config.identities.find(i => i.id === "admin-pao") ?? null;
  }

  // Check identity-specific keys
  for (const identity of config.identities) {
    const envKey = `PAO_GW_KEY_${identity.id.toUpperCase().replace(/-/g, "_")}`;
    const expectedKey = process.env[envKey];
    if (expectedKey && token === expectedKey) {
      return identity;
    }
  }

  // Fallback: if no keys are configured at all, use admin identity for development
  const anyKeyConfigured = config.identities.some(i => {
    const envKey = `PAO_GW_KEY_${i.id.toUpperCase().replace(/-/g, "_")}`;
    return !!process.env[envKey];
  });

  if (!anyKeyConfigured && !adminKey) {
    // Development mode: no keys configured, use admin
    return config.identities.find(i => i.id === "admin-pao") ?? config.identities[0] ?? null;
  }

  return null;
}

/**
 * Authenticate an admin-only management request.
 * Only the master admin key authorizes admin endpoints — identity keys never do.
 */
export function authenticateAdminRequest(
  authHeader: string | null,
  config: GatewayConfig,
): GatewayIdentity | null {
  const adminKey = process.env.PAO_AI_GATEWAY_ADMIN_KEY;
  if (!adminKey) {
    // Development mode: no admin key configured, permit admin
    return config.identities.find(i => i.id === "admin-pao") ?? config.identities[0] ?? null;
  }
  if (!authHeader) return null;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  if (!token || token !== adminKey) return null;
  return config.identities.find(i => i.id === "admin-pao") ?? null;
}

/**
 * Check whether an identity is allowed to use a specific alias.
 */
export function isAliasPermitted(identity: GatewayIdentity, alias: string): boolean {
  if (identity.deniedAliases?.includes(alias)) return false;
  if (identity.allowedAliases.length === 0) return true; // No whitelist = all allowed
  return identity.allowedAliases.includes(alias);
}

/**
 * Check whether an identity is allowed to use external (non-local) providers.
 */
export function isExternalProviderAllowed(identity: GatewayIdentity): boolean {
  return identity.externalProviderAccess !== false;
}
