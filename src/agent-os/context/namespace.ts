/**
 * Pao Context Control Plane — canonical viking:// namespace + identity
 * mapping (Phase 20.53 §8-9).
 *
 * Every important context object gets a deterministic canonical URI. Peer
 * identity derives from the git origin (never from directory names, temp
 * clone paths, free text, or model output).
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Namespace layout (spec §8)
// ---------------------------------------------------------------------------

export const PAO_SHARED_ROOT = "viking://resources/pao-hubpro/";

export const SHARED_ROOTS = {
  project: `${PAO_SHARED_ROOT}project/`,
  phases: `${PAO_SHARED_ROOT}phases/`,
  repos: `${PAO_SHARED_ROOT}repos/`,
  docs: `${PAO_SHARED_ROOT}docs/`,
  references: `${PAO_SHARED_ROOT}references/`,
} as const;

/**
 * URI builder for the shared namespace. Rejects anything that would escape
 * the pao-hubpro root or inject path traversal.
 */
export function buildSharedUri(subPath: string): string {
  const segments = subPath.replace(/\\/g, "/").split("/");
  // Path traversal is REJECTED, not silently normalized: a caller asking for
  // "../x" gets an error, never a URI outside the shared root.
  if (segments.some(segment => segment === "..")) {
    throw new Error("CTX_INVALID_URI: path traversal is not permitted");
  }
  const cleaned = segments.filter(segment => segment !== "" && segment !== ".").join("/");
  if (cleaned === "") {
    throw new Error("CTX_INVALID_URI: empty shared resource path");
  }
  return `${PAO_SHARED_ROOT}${cleaned}`;
}

/** Canonical URI for a phase document, e.g. phases/20.51-9router. */
export function phaseUri(phaseSlug: string): string {
  return buildSharedUri(`phases/${phaseSlug}`);
}

/**
 * Deterministic peer id from a git origin URL:
 *   github.com/acme/pao-hubpro  ->  github.com-acme-pao-hubpro
 * Anything not resolvable to host+path hashes to a stable opaque id rather
 * than falling back to a directory name.
 */
export function derivePeerId(gitOrigin: string): string {
  const trimmed = gitOrigin.trim();
  if (trimmed === "") throw new Error("CTX_INVALID_IDENTITY: empty git origin");
  let hostAndPath: string | null = null;
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) hostAndPath = `${sshMatch[1]}-${sshMatch[2]}`;
  else if (httpsMatch) hostAndPath = `${httpsMatch[1]}-${httpsMatch[2]}`;
  if (!hostAndPath) {
    // Unrecognized origin form: stable hash, clearly not a path-derived name.
    const hash = createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
    return `origin-${hash}`;
  }
  const normalized = hostAndPath
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized;
}

/** Deterministic user namespace root. */
export function userRoot(userId: string): string {
  const safe = userId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (safe === "") throw new Error("CTX_INVALID_IDENTITY: empty user id");
  return `viking://user/${safe}/`;
}

/** Deterministic peer namespace under a user. */
export function peerRoot(userId: string, peerId: string): string {
  const safePeer = peerId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `${userRoot(userId)}peers/${safePeer}/`;
}

// ---------------------------------------------------------------------------
// URI classification
// ---------------------------------------------------------------------------

export interface ParsedVikingUri {
  readonly namespace: "resources" | "user" | "agent" | "unknown";
  readonly scope: "shared" | "user" | "agent" | "unknown";
  readonly userId?: string;
  readonly path: string;
}

export function parseVikingUri(uri: string): ParsedVikingUri {
  if (uri.startsWith("viking://resources/")) {
    return { namespace: "resources", scope: "shared", path: uri.slice("viking://resources/".length) };
  }
  const userMatch = uri.match(/^viking:\/\/user\/([^/]+)\/(.*)$/);
  if (userMatch) {
    return { namespace: "user", scope: "user", userId: userMatch[1], path: userMatch[2] };
  }
  if (uri.startsWith("viking://agent/")) {
    return { namespace: "agent", scope: "agent", path: uri.slice("viking://agent/".length) };
  }
  return { namespace: "unknown", scope: "unknown", path: uri };
}

/** Whether a URI sits under one of the given roots (string prefix check). */
export function underRoot(uri: string, roots: readonly string[]): boolean {
  return roots.some(root => uri.startsWith(root));
}

/**
 * The spec forbids inventing a writable agent memories path; this guard is
 * the enforcement point for ingestion targets.
 */
export function isForbiddenTarget(uri: string): boolean {
  const lowered = uri.toLowerCase();
  return (
    lowered.startsWith("viking://agent/memories/") ||
    lowered.includes("/../") ||
    lowered.endsWith("/..")
  );
}
