// Phase 20.57 — path validation for untrusted skill file paths. Imported
// skills carry relative paths that must never escape the snapshot or target
// root they are resolved against.

import { isAbsolute, posix, resolve, sep } from "node:path";
import { SkillGateHttpError } from "./types";

function traversalError(): SkillGateHttpError {
  return new SkillGateHttpError("TRAVERSAL_REJECTED", 400, "unsafe skill file path rejected");
}

/**
 * Rejects absolute paths, `..` traversal, and entries outside the root.
 * Returns the resolved absolute path.
 */
export function safeJoin(root: string, relativePath: string): string {
  if (relativePath.length === 0 || isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw traversalError();
  }
  const normalized = posix.normalize(relativePath.split("\\").join("/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw traversalError();
  }
  const resolved = resolve(root, normalized);
  const rootResolved = resolve(root);
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (!resolved.startsWith(rootWithSep)) {
    throw traversalError();
  }
  return resolved;
}

/** True when a relative path stays inside its root (non-throwing variant). */
export function isSafeRelativePath(relativePath: string): boolean {
  try {
    safeJoin(process.cwd(), relativePath);
    return true;
  } catch {
    return false;
  }
}
