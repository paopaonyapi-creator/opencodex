// Phase 20.9 — Path Security Guard
// Enforces workspace root isolation, canonical path resolution,
// and blocks directory traversal (../), absolute escapes, symlink escapes, UNC escapes, and drive hopping.

import { resolve, normalize, isAbsolute, relative, dirname, basename } from "node:path";
import { realpathSync, existsSync } from "node:fs";

export interface PathValidationResult {
  valid: boolean;
  canonicalPath?: string;
  error?: string;
}

export class PathGuard {
  private allowedRoots: string[];

  constructor(allowedRoots: string[] = [process.cwd()]) {
    this.allowedRoots = allowedRoots.map((r) => normalize(resolve(r)));
  }

  setAllowedRoots(roots: string[]): void {
    this.allowedRoots = roots.map((r) => normalize(resolve(r)));
  }

  getAllowedRoots(): string[] {
    return [...this.allowedRoots];
  }

  /**
   * Validates if a target path stays safely within one of the allowed workspace roots.
   *
   * The critical case is a NON-EXISTENT leaf reached through an EXISTING symlinked
   * directory. realpathSync cannot resolve a path that is not there, so the original
   * implementation fell back to the lexical path, which still reads as contained — and
   * the subsequent write creates the file outside the workspace. A write tool is
   * exactly the caller that must not have this gap, so the deepest EXISTING ancestor is
   * resolved instead and the unresolved remainder is re-attached to it.
   */
  validatePath(targetPath: string, baseDir?: string): PathValidationResult {
    if (!targetPath || typeof targetPath !== "string") {
      return { valid: false, error: "Path must be a non-empty string" };
    }

    const trimmed = targetPath.trim();

    // 1. Block UNC paths (e.g. a double-backslash remote share)
    if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
      return { valid: false, error: "UNC remote network paths are prohibited" };
    }

    // 2. Normalize and resolve against baseDir or the first allowed root
    const base = baseDir ? normalize(resolve(baseDir)) : this.allowedRoots[0] ?? process.cwd();
    const resolvedPath = isAbsolute(trimmed)
      ? normalize(resolve(trimmed))
      : normalize(resolve(base, trimmed));

    // 3. Canonicalize, walking up to the deepest ancestor that exists so that a
    //    symlinked directory is resolved even when the leaf does not exist yet.
    const canonical = resolveCanonicalPath(resolvedPath);

    // 4. Check if the canonical path resides within ANY of the allowed roots.
    //    The roots are canonicalized too: an allowed root that is itself a symlink
    //    would otherwise fail to match its own resolved children.
    const isContained = this.allowedRoots.some((root) => {
      const canonicalRoot = resolveCanonicalPath(root);
      const rel = relative(canonicalRoot, canonical);
      return !rel.startsWith("..") && !isAbsolute(rel);
    });

    if (!isContained) {
      return {
        valid: false,
        error: `Path traversal violation: Target '${trimmed}' resolves outside workspace boundaries`,
      };
    }

    return { valid: true, canonicalPath: canonical };
  }

  /**
   * Checks if path is safe, throwing an error if it escapes.
   */
  assertSafePath(targetPath: string, baseDir?: string): string {
    const result = this.validatePath(targetPath, baseDir);
    if (!result.valid || !result.canonicalPath) {
      throw new Error(result.error ?? `Invalid path: ${targetPath}`);
    }
    return result.canonicalPath;
  }
}

/**
 * Canonicalize a path by resolving the deepest ancestor that exists and re-attaching
 * the unresolved remainder.
 *
 * Why not plain realpathSync: it throws on a path that does not exist yet, so a
 * caller creating a new file had no canonical form to check and fell back to the
 * lexical one. Walking up means a symlinked directory in the middle of the path is
 * still resolved, which is what closes the create-through-a-symlink escape.
 */
function resolveCanonicalPath(target: string): string {
  let current = normalize(resolve(target));
  const trailing: string[] = [];

  // Bounded by path depth: every iteration strips one segment or terminates.
  for (let depth = 0; depth < 256; depth += 1) {
    if (existsSync(current)) {
      let canonical = current;
      try {
        canonical = normalize(realpathSync(current));
      } catch {
        // A realpath failure on an existing path is unusual; keeping the lexical
        // form here is safe because the containment check still applies to it.
      }
      if (trailing.length === 0) return canonical;
      trailing.reverse();
      return normalize(resolve(canonical, ...trailing));
    }
    const parent = dirname(current);
    if (parent === current) return normalize(resolve(target));
    trailing.push(basename(current));
    current = parent;
  }
  return normalize(resolve(target));
}

let defaultPathGuard: PathGuard | null = null;

export function getPathGuard(): PathGuard {
  if (!defaultPathGuard) {
    defaultPathGuard = new PathGuard();
  }
  return defaultPathGuard;
}
