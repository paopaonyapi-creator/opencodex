// Phase 20.40 — Source scanner & cache (spec §13.2–§13.4, §22, §42). Bounded
// I/O only: stat-first revision tokens, backward tail reads in fixed chunks,
// bounded head reads, complete newline-terminated JSONL records only (an
// unfinished suffix stays invisible), no full-file hashing during polls.
// Path safety: sources must resolve inside their configured root; directory
// symlinks are not followed; deleted files clean the cache.

import { closeSync, fstatSync, openSync, readSync, statSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { SessionObservationError } from "./types";

export interface SourceStat {
  sizeBytes: number;
  mtimeMs: number;
  ctimeMs: number;
  fileId: string;
  lastModifiedAt: string;
}

export interface TailRecord {
  line: string;
  endOffset: number;
  malformed: boolean;
  errors: SessionObservationError[];
}

export function revisionOf(stat: SourceStat): string {
  return [stat.mtimeMs, stat.ctimeMs, stat.sizeBytes, stat.fileId].join(":");
}

export function statSourceSafe(sourcePath: string): SourceStat | null {
  try {
    const st = statSync(sourcePath);
    if (!st.isFile()) return null;
    const fileId = (st as { ino?: number }).ino !== undefined && (st as { ino?: number }).ino !== 0
      ? String((st as { ino?: number }).ino)
      : "dev" + (st.dev ?? 0);
    return {
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
      ctimeMs: st.ctimeMs,
      fileId,
      lastModifiedAt: new Date(st.mtimeMs).toISOString(),
    };
  } catch {
    return null;
  }
}

/** True when targetPath resolves inside rootPath. Symlinks are resolved via
 *  realpath so a symlinked file escaping the root is caught; a not-yet-existing
 *  target falls back to lexical resolution (nothing to symlink yet). */
export function pathInsideRoot(rootPath: string, targetPath: string): boolean {
  try {
    const rootReal = realpathSync(rootPath);
    let targetReal: string;
    try {
      targetReal = realpathSync(targetPath);
    } catch {
      targetReal = targetPath;
    }
    const rootNorm = resolve(rootReal).toLowerCase();
    const targetNorm = resolve(targetReal).toLowerCase();
    return targetNorm === rootNorm || targetNorm.startsWith(rootNorm + sep.toLowerCase());
  } catch {
    return false;
  }
}

/** List candidate files under root (bounded, no directory-symlink following,
 *  tolerant of files vanishing mid-scan). Depth-limited breadth walk. */
export function listCandidateFiles(rootPath: string, extension: string, maxFiles: number, maxDepth = 4): Array<{ path: string; depth: number }> {
  const results: Array<{ path: string; depth: number }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || results.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Directory symlinks are never followed; file symlinks are accepted
        // only when their realpath stays inside the root.
        try {
          const linkStat = lstatSync(full);
          if (!linkStat.isFile()) continue;
          if (!pathInsideRoot(rootPath, full)) continue;
          results.push({ path: full, depth });
        } catch {
          continue;
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        results.push({ path: full, depth });
      }
    }
  };
  walk(rootPath, 0);
  return results;
}

/** Bounded tail read: returns the LAST COMPLETE newline-terminated line read
 *  from a single bounded window at the end of the file. An unfinished suffix
 *  (no trailing newline) is ignored, never repaired. If the last complete
 *  line is not valid JSON, malformed=true and the raw line is returned — an
 *  older record is NEVER substituted. If the window cannot contain the full
 *  record, TAIL_LIMIT_REACHED is reported rather than a truncated record. */
export function readLastCompleteLine(sourcePath: string, options: { chunkBytes: number; maxTailBytes: number }): TailRecord | null {
  let fd: number | null = null;
  const errors: SessionObservationError[] = [];
  try {
    fd = openSync(sourcePath, "r");
    const st = fstatSync(fd);
    const size = st.size;
    if (size === 0) return null;
    const windowBytes = Math.min(Math.max(options.maxTailBytes, options.chunkBytes), size);
    const startOffset = size - windowBytes;
    const buf = Buffer.alloc(windowBytes);
    let totalRead = 0;
    while (totalRead < windowBytes) {
      const bytesRead = readSync(fd, buf, totalRead, windowBytes - totalRead, startOffset + totalRead);
      if (bytesRead <= 0) break;
      totalRead += bytesRead;
    }
    const text = buf.subarray(0, totalRead).toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      if (totalRead >= size) return null; // whole file read; no complete record exists yet
      errors.push(makeError("TAIL_LIMIT_REACHED", "no complete record within the tail budget"));
      return { line: "", endOffset: startOffset, malformed: false, errors };
    }
    const beforeSlice = text.slice(0, lastNewline);
    const prevNewline = beforeSlice.lastIndexOf("\n");
    if (prevNewline === -1 && startOffset > 0) {
      // The last record extends beyond the tail window — report the budget
      // limit honestly instead of parsing a truncated record.
      errors.push(makeError("TAIL_LIMIT_REACHED", "latest record extends beyond the tail budget"));
      return { line: "", endOffset: startOffset + lastNewline + 1, malformed: false, errors };
    }
    const line = beforeSlice.slice(prevNewline + 1).replace(/\r$/, "");
    const endOffset = startOffset + lastNewline + 1;
    if (line.trim().length === 0) {
      // empty final record; treat as no observable latest event
      return { line: "", endOffset, malformed: false, errors };
    }
    try {
      JSON.parse(line);
      return { line, endOffset, malformed: false, errors };
    } catch (error) {
      errors.push(makeError("MALFORMED_RECORD", "last complete record is not valid JSON"));
      void error;
      return { line, endOffset, malformed: true, errors };
    }
  } catch (error) {
    errors.push(makeError("SOURCE_UNREADABLE", error instanceof Error ? error.message : String(error)));
    return { line: "", endOffset: 0, malformed: true, errors };
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** Bounded head read: returns the first maxBytes bytes as text for metadata
 *  discovery (working directory, session id). Never parses untrusted content
 *  as anything but data. */
export function readHeadText(sourcePath: string, maxBytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(sourcePath, "r");
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    return bytesRead > 0 ? buf.subarray(0, bytesRead).toString("utf8") : "";
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** Read complete newline-terminated records in a byte window [fromOffset,
 *  toOffset) — used by readEvents with pagination. Returns parsed-or-marked
 *  records with their end offsets. */
export function readCompleteRecordsWindow(sourcePath: string, fromOffset: number, maxBytes: number): Array<{ line: string; endOffset: number; malformed: boolean }> {
  let fd: number | null = null;
  const out: Array<{ line: string; endOffset: number; malformed: boolean }> = [];
  try {
    fd = openSync(sourcePath, "r");
    const st = fstatSync(fd);
    const size = st.size;
    if (fromOffset >= size) return out;
    const length = Math.min(maxBytes, size - fromOffset);
    const buf = Buffer.alloc(length);
    const bytesRead = readSync(fd, buf, 0, length, fromOffset);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    let cursor = 0;
    let newlineIndex = text.indexOf("\n", cursor);
    while (newlineIndex >= 0) {
      const line = text.slice(cursor, newlineIndex).replace(/\r$/, "");
      const endOffset = fromOffset + newlineIndex + 1;
      if (line.trim().length > 0) {
        let malformed = false;
        try {
          JSON.parse(line);
        } catch {
          malformed = true;
        }
        out.push({ line, endOffset, malformed });
      }
      cursor = newlineIndex + 1;
      newlineIndex = text.indexOf("\n", cursor);
    }
    return out;
  } catch {
    return out;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

export function makeError(code: SessionObservationError["code"], message: string, recoverable = true): SessionObservationError {
  return { code, message, recoverable, observedAt: new Date().toISOString() };
}

export function assertAbsoluteFile(path: string): void {
  if (!isAbsolute(path)) {
    throw new Error("SOURCE_OUTSIDE_ROOT: relative paths are not accepted");
  }
}
