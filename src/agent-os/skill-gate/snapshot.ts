// Phase 20.57 — immutable snapshot staging for imported skills. Every file is
// read, size-checked, hashed, and written explicitly per file; limits from the
// phase spec (§73) are enforced during staging so oversized content never
// lands in the snapshot store.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SkillGateHttpError, type SkillFileEntry } from "./types";
import { parseFrontmatter, type ParsedFrontmatter } from "./frontmatter";
import { safeJoin } from "./paths";

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 52_428_800;
const MAX_FILE_BYTES = 10_485_760;
const SKILL_ENTRY = "SKILL.md";

export function sha256Bytes(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function contentHashOf(files: SkillFileEntry[]): string {
  const canonical = [...files]
    .map((file) => `${file.relativePath}:${file.sha256}`)
    .sort()
    .join("\n");
  return sha256Bytes(canonical);
}

export function skillEntryName(): string {
  return SKILL_ENTRY;
}

interface WalkedFile {
  absolutePath: string;
  relativePath: string;
}

/** Enumerate regular files under `dir` deterministically, preserving no symlinks. */
function walkFiles(dir: string): WalkedFile[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new SkillGateHttpError("VALIDATION_ERROR", 400, "skill source folder not found");
  }
  const found: WalkedFile[] = [];
  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(current, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        // Symlinks resolve to plain files or are skipped: never preserved, so a
        // snapshot can never reference a location outside its own root.
        if (!existsSync(child) || !statSync(child).isFile()) continue;
        found.push({ absolutePath: child, relativePath });
        continue;
      }
      if (entry.isDirectory()) {
        visit(child, relativePath);
        continue;
      }
      if (entry.isFile()) found.push({ absolutePath: child, relativePath });
    }
  };
  visit(dir, "");
  return found;
}

export interface FileSnapshot {
  files: SkillFileEntry[];
  totalBytes: number;
}

/** Hash every file in a snapshot directory, enforcing size/count/total limits. */
export function snapshotFiles(dir: string): FileSnapshot {
  const walked = walkFiles(dir);
  if (walked.length > MAX_FILES) {
    throw new SkillGateHttpError("LIMIT_EXCEEDED", 413, "skill exceeds the maximum file count");
  }
  const files: SkillFileEntry[] = [];
  let totalBytes = 0;
  for (const file of walked) {
    const stats = statSync(file.absolutePath);
    if (stats.size > MAX_FILE_BYTES) {
      throw new SkillGateHttpError("LIMIT_EXCEEDED", 413, "skill file exceeds the per-file size limit");
    }
    totalBytes += stats.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new SkillGateHttpError("LIMIT_EXCEEDED", 413, "skill exceeds the total size limit");
    }
    files.push({
      relativePath: file.relativePath,
      sizeBytes: stats.size,
      sha256: sha256Bytes(readFileSync(file.absolutePath)),
    });
  }
  if (!files.some((file) => file.relativePath === SKILL_ENTRY)) {
    throw new SkillGateHttpError("VALIDATION_ERROR", 422, "skill folder has no SKILL.md entry file");
  }
  return { files, totalBytes };
}

/** Read a snapshot file back as UTF-8 text (for the scanner and previews). */
export function readSnapshotText(snapshotDir: string, relativePath: string): string | null {
  const target = safeJoin(snapshotDir, relativePath);
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return readFileSync(target, "utf8");
}

/**
 * Copy one snapshot file into a destination path (deployment engine). The
 * write is refused when the destination exists and `overwrite` is false.
 */
export function copySnapshotFile(snapshotDir: string, relativePath: string, targetPath: string, overwrite: boolean): Buffer {
  if (existsSync(targetPath) && !overwrite) {
    throw new SkillGateHttpError("CONFLICT", 409, "refusing to overwrite an existing file");
  }
  const source = safeJoin(snapshotDir, relativePath);
  const data = readFileSync(source);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, data);
  return data;
}

export interface LocalImportInput {
  sourceDir: string;
  snapshotsRoot: string;
  namespace: string;
  slug: string;
  version: string;
}

export interface LocalImportSnapshot {
  snapshotDir: string;
  files: SkillFileEntry[];
  contentSha256: string;
  entryText: string;
  frontmatter: ParsedFrontmatter;
}

/** Stage an immutable snapshot of a skill folder under the snapshots root. */
export function stageSnapshot(input: LocalImportInput): LocalImportSnapshot {
  const walked = walkFiles(input.sourceDir);
  const snapshotDir = join(input.snapshotsRoot, input.namespace, input.slug, input.version);
  if (existsSync(snapshotDir)) {
    throw new SkillGateHttpError("CONFLICT", 409, "snapshot already exists for this version");
  }
  if (walked.length > MAX_FILES) {
    throw new SkillGateHttpError("LIMIT_EXCEEDED", 413, "skill exceeds the maximum file count");
  }
  mkdirSync(snapshotDir, { recursive: true });
  try {
    let totalBytes = 0;
    for (const file of walked) {
      const stats = statSync(file.absolutePath);
      if (stats.size > MAX_FILE_BYTES) {
        throw new SkillGateHttpError("LIMIT_EXCEEDED", 413, "skill file exceeds the per-file size limit");
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new SkillGateHttpError("LIMIT_EXCEEDED", 413, "skill exceeds the total size limit");
      }
      const data = readFileSync(file.absolutePath);
      const destination = safeJoin(snapshotDir, file.relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, data);
    }
    const { files } = snapshotFiles(snapshotDir);
    const entryText = readFileSync(safeJoin(snapshotDir, SKILL_ENTRY), "utf8");
    return {
      snapshotDir,
      files,
      contentSha256: contentHashOf(files),
      entryText,
      frontmatter: parseFrontmatter(entryText),
    };
  } catch (error) {
    rmSync(snapshotDir, { recursive: true, force: true });
    throw error;
  }
}
