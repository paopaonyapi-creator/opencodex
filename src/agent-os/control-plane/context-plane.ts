// Phase 20.27 — Shared context plane under the .pao/ project root (doc §29-§34).
//
// Context artifacts are versioned, schema-stamped, and traversal-guarded:
// the resolved target must stay inside the context root (sep-aware prefix
// check — the boundary test that also holds on Windows and for symlinked
// roots). Plaintext secrets never belong in .pao/ artifacts.

import { join, resolve, sep } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export function contextRoot(workspaceRoot: string): string {
  return resolve(process.env.PAO_CONTEXT_ROOT ?? join(workspaceRoot, ".pao"));
}

/**
 * Write a versioned context artifact. Returns the absolute path written.
 * Throws when the resolved path escapes the context root.
 */
export function writeContextArtifact(workspaceRoot: string, relativePath: string, payload: unknown): string {
  const root = contextRoot(workspaceRoot);
  const target = resolve(root, relativePath);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootPrefix)) {
    throw new Error("context artifact path escapes the context root");
  }
  mkdirSync(dirnameSafe(target), { recursive: true });
  const body = JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), data: payload }, null, 2);
  writeFileSync(target, body, "utf8");
  return target;
}

function dirnameSafe(target: string): string {
  const idx = target.lastIndexOf(sep);
  return idx <= 0 ? target : target.slice(0, idx);
}
