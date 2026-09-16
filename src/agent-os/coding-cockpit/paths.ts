// Phase 20.39 — Path security (spec §37). Every path-sensitive operation
// canonicalizes both root and target, rejects null bytes and malformed input,
// and refuses anything that escapes the workspace root. Denied escapes are
// surfaced so the caller can audit them.

import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { isInsideWorkspace } from "../control-plane/policy";
import { CockpitError } from "./types";

export function canonicalizePath(input: string, label = "path"): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new CockpitError("VALIDATION_ERROR", `${label} must be a non-empty string`);
  }
  if (input.includes("\0")) {
    throw new CockpitError("PATH_OUTSIDE_WORKSPACE", `${label} contains a null byte`);
  }
  const resolved = resolve(input);
  if (!isAbsolute(resolved)) {
    throw new CockpitError("PATH_OUTSIDE_WORKSPACE", `${label} did not resolve to an absolute path`);
  }
  return normalize(resolved);
}

/** Canonicalize a workspace root. Traversal is collapsed by resolve(); the
 *  result is always an absolute normalized directory path. */
export function canonicalizeRoot(rootPath: string): string {
  const canonical = canonicalizePath(rootPath, "workspace root");
  const statLike = canonical.split(sep).filter((segment) => segment.length > 0);
  if (statLike.length === 0) {
    throw new CockpitError("VALIDATION_ERROR", "workspace root is empty");
  }
  return canonical;
}

/** Resolve a target inside a workspace. Throws PATH_OUTSIDE_WORKSPACE when the
 *  canonical target escapes the canonical root (spec §37.4). */
export function resolveInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const root = canonicalizeRoot(workspaceRoot);
  const target = canonicalizePath(targetPath, "target path");
  if (!isInsideWorkspace(target, root)) {
    throw new CockpitError(
      "PATH_OUTSIDE_WORKSPACE",
      "target escapes the workspace root",
      { workspaceRoot: root, targetPath: target },
    );
  }
  return target;
}

/** True when the target stays inside the root (non-throwing variant for policy
 *  scoring). Null bytes and malformed input count as outside. */
export function staysInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  try {
    resolveInsideWorkspace(workspaceRoot, targetPath);
    return true;
  } catch {
    return false;
  }
}

/** Display helper: workspace-relative path, POSIX separators for stable UI. */
export function relativizeForDisplay(workspaceRoot: string, targetPath: string): string {
  try {
    const root = canonicalizeRoot(workspaceRoot);
    const target = canonicalizePath(targetPath, "target path");
    const rel = relative(root, target);
    if (rel === "") return ".";
    if (rel.startsWith("..") || isAbsolute(rel)) return target.split(sep).join("/");
    return rel.split(sep).join("/");
  } catch {
    return "(invalid path)";
  }
}
