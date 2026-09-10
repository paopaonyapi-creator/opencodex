// Phase 20.18 — Pao Grok Production Bridge: configuration.
//
// Configuration is read from the environment and NEVER contains a credential value
// that is echoed back. The bridge token is derived from a seed the operator supplies,
// so the raw seed does not have to be the wire credential.

import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "../agent-os/browser-provider/bridge";
import type { BridgeConfig } from "../agent-os/browser-provider/bridge";

/**
 * Derive the bridge token.
 *
 * Three sources, in order of preference, and the order matters: an explicit token
 * wins, then a seed the operator supplies, then a machine-stable default derived from
 * the user profile. The last one exists so a local single-user install works without
 * configuration — and it is deliberately NOT a secret, which is why pairing exists:
 * possession of the token is not sufficient to attach without having completed a
 * pairing exchange.
 */
export function resolveBridgeToken(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.PAO_BRIDGE_TOKEN?.trim();
  if (explicit && explicit.length > 0) return explicit;
  const seed = env.PAO_BRIDGE_SEED?.trim();
  if (seed && seed.length > 0) {
    return createHash("sha256").update(`pao-grok-bridge:${seed}`).digest("hex");
  }
  return createHash("sha256").update(`pao-grok-bridge:${homedir()}`).digest("hex");
}

/**
 * Extension ids allowed to call the bridge.
 *
 * An empty list means NO extension may attach. That is the correct default: the
 * operator must name the id they loaded, which also means an unrelated extension
 * cannot reach the bridge even if it learns the port and token.
 */
export function resolveAllowedExtensionIds(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.PAO_BRIDGE_EXTENSION_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function buildDefaultBridgeConfig(
  env: Record<string, string | undefined> = process.env,
): BridgeConfig {
  return {
    // Host is intentionally not read from the environment. See bridge-server.ts.
    host: DEFAULT_BRIDGE_HOST,
    port: Number(env.PAO_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT,
    token: resolveBridgeToken(env),
    allowedExtensionIds: resolveAllowedExtensionIds(env),
    downloadsRoot: env.PAO_BRIDGE_DOWNLOADS_ROOT?.trim() || join(process.cwd(), "downloads"),
  };
}

/** Masked view for the dashboard. Never returns the token. */
export function describeBridgeConfig(
  config: BridgeConfig,
): { host: string; port: number; tokenConfigured: boolean; allowedExtensionCount: number; downloadsRoot: string } {
  return {
    host: config.host,
    port: config.port,
    tokenConfigured: config.token.length > 0,
    allowedExtensionCount: config.allowedExtensionIds.length,
    downloadsRoot: config.downloadsRoot,
  };
}

export function newPairingClientId(): string {
  return randomUUID();
}

