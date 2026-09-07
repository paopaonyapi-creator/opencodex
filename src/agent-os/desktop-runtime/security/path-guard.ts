// Phase 20.9 — Path Security Guard
// Enforces workspace root isolation, canonical path resolution,
// and blocks directory traversal (../), absolute escapes, symlink escapes, UNC escapes, and drive hopping.

import { resolve, normalize, isAbsolute, relative } from "node:path";
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
   */
  validatePath(targetPath: string, baseDir?: string): PathValidationResult {
    if (!targetPath || typeof targetPath !== "string") {
      return { valid: false, error: "Path must be a non-empty string" };
    }

    const trimmed = targetPath.trim();

    // 1. Block UNC paths (e.g. \\remote\share)
    if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
      return { valid: false, error: "UNC remote network paths are prohibited" };
    }

    // 2. Normalize and resolve against baseDir or current working dir
    const base = baseDir ? normalize(resolve(baseDir)) : this.allowedRoots[0] ?? process.cwd();
    const resolvedPath = isAbsolute(trimmed)
      ? normalize(resolve(trimmed))
      : normalize(resolve(base, trimmed));

    // 3. Resolve canonical path if file exists (checks symlink target)
    let canonical = resolvedPath;
    if (existsSync(resolvedPath)) {
      try {
        canonical = normalize(realpathSync(resolvedPath));
      } catch {
        // Fallback to resolved path if realpath fails
      }
    }

    // 4. Check if canonical path resides within ANY of the allowed roots
    const isContained = this.allowedRoots.some((root) => {
      const rel = relative(root, canonical);
      // If rel starts with '..' or is absolute, it escaped the root
      return !rel.startsWith("..") && !isAbsolute(rel);
    });

    if (!isContained) {
      return {
        valid: false,
        error: `Path traversal violation: Target '${trimmed}' resolves outside workspace boundaries`,
      };
    }

    return {
      valid: true,
      canonicalPath: canonical,
    };
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

let defaultPathGuard: PathGuard | null = null;
export function getPathGuard(): PathGuard {
  if (!defaultPathGuard) {
    defaultPathGuard = new PathGuard();
  }
  return defaultPathGuard;
}
