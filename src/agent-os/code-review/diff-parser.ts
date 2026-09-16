// Pure unified-diff parsing for the deterministic review runtime.
//
// This module has no I/O and no process access: it turns diff text into
// per-file records with hunk-accurate anchors. Keeping it pure makes the
// parser unit-testable without git and keeps the process boundary confined
// to capture.ts. Hunk headers are parsed with startsWith/indexOf rather
// than regular expressions so the header grammar stays explicit.

import type { DiffFile } from "./types";
import { isExcludablePath, isProtectedPath } from "./rules";

interface RawHunk {
  newStart: number;
  lines: string[];
}

interface RawFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  isBinary: boolean;
  hunks: RawHunk[];
}

/**
 * Extract the new-file start line from a hunk header.
 *
 * Header shape: two at-signs, ranges separated by spaces, then the hunk
 * function context. Only the new-file range is needed for anchoring.
 */
export function hunkNewStart(line: string): number | null {
  if (!line.startsWith("@@")) return null;
  const plusIndex = line.indexOf("+");
  if (plusIndex === -1) return null;
  const rest = line.substring(plusIndex + 1);
  let end = -1;
  const comma = rest.indexOf(",");
  const space = rest.indexOf(" ");
  if (comma !== -1 && space !== -1) end = Math.min(comma, space);
  else if (comma !== -1) end = comma;
  else if (space !== -1) end = space;
  else end = rest.length;
  const parsed = Number(rest.substring(0, end).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isDiffBodyLine(line: string): boolean {
  return line.startsWith(" ")
    || (line.startsWith("+") && !line.startsWith("+++"))
    || (line.startsWith("-") && !line.startsWith("---"))
    || line.startsWith("\\");
}

export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: RawFile | null = null;
  let currentHunk: RawHunk | null = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(materialize(current));
      current = { path: extractBPath(line), status: "modified", isBinary: false, hunks: [] };
      currentHunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename from ")) current.path = line.replace("rename from ", "").trim();
    else if (line.startsWith("rename to ")) current.path = line.replace("rename to ", "").trim();
    else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) current.isBinary = true;
    else if (hunkNewStart(line) !== null) {
      const newStart = hunkNewStart(line) ?? 1;
      currentHunk = { newStart, lines: [] };
      current.hunks.push(currentHunk);
    } else if (currentHunk && isDiffBodyLine(line)) {
      currentHunk.lines.push(line);
    }
  }
  if (current) files.push(materialize(current));
  return files;
}

function extractBPath(diffHeader: string): string {
  const parts = diffHeader.split(" b/");
  return (parts[parts.length - 1] ?? "").trim();
}

function materialize(raw: RawFile): DiffFile {
  let added = 0;
  let removed = 0;
  const body: string[] = [["--- a/", raw.path].join(""), ["+++ b/", raw.path].join("")];
  for (const hunk of raw.hunks) {
    body.push(["@@ -1,1 +", hunk.newStart, ",", hunk.lines.length, " @@"].join(""));
    for (const line of hunk.lines) {
      body.push(line);
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) removed += 1;
    }
  }
  return {
    path: raw.path,
    status: raw.status,
    diff: raw.isBinary ? "" : body.join("\n"),
    addedLines: added,
    removedLines: removed,
    isBinary: raw.isBinary,
    protectedPath: isProtectedPath(raw.path),
    excludable: isExcludablePath(raw.path),
  };
}

/**
 * Added lines with their true new-file line numbers.
 *
 * Walks hunks in order: the hunk header resets the counter to start-1;
 * context (" ") and added ("+") lines advance it; deletions and
 * "\ No newline" markers do not.
 */
export function addedLinesWithAnchors(file: DiffFile): Array<{ line: number; text: string }> {
  const anchored: Array<{ line: number; text: string }> = [];
  let newLine = 0;
  for (const line of file.diff.split("\n")) {
    const start = hunkNewStart(line);
    if (start !== null) {
      newLine = start - 1;
      continue;
    }
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      newLine += 1;
      anchored.push({ line: newLine, text: line.substring(1) });
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
    // "-" deletions and "\ No newline at end of file" do not advance the
    // new-file counter.
  }
  return anchored;
}
