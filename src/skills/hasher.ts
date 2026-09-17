// SHA-256 utility functions reused by security and credentials modules.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Compute SHA-256 digest of utf-8 string or buffer. */
export function sha256(content: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/** Compute SHA-256 digest of a file on disk. */
export function sha256File(filePath: string): string {
  const buffer = readFileSync(filePath);
  return sha256(buffer);
}

/**
 * Deterministically compute canonical content SHA-256 for a Skill.
 * Sorts all file paths (including entry SKILL.md) and combines individual hashes.
 */
export function computeSkillContentHash(
  entryFileContent: string,
  bundledFiles: Record<string, string | Buffer> = {},
  entryFileName = "SKILL.md",
): { contentSha256: string; filesSha256: Record<string, string> } {
  const filesSha256: Record<string, string> = {};
  filesSha256[entryFileName] = sha256(entryFileContent);

  for (const [relPath, content] of Object.entries(bundledFiles)) {
    filesSha256[relPath] = sha256(content);
  }

  const sortedPaths = Object.keys(filesSha256).sort();
  const manifest = sortedPaths.map((p) => `${p}:${filesSha256[p]}`).join("\n");

  return {
    contentSha256: sha256(manifest),
    filesSha256,
  };
}
