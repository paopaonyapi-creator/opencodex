// Phase 20.82 — Perception: symbol-aware workspace snapshot.
//
// Deterministic read-only perception over a workspace root. Reuses the
// repository's path-safety seam (mcp-gateway sandbox) — never resolves paths
// outside the declared root. Symbol counting is a lightweight structural scan
// (function/class/const declarations) sufficient for change observation; full
// LSP-grade symbol resolution is the pinned AFT toolchain's job at integration
// time and is deliberately NOT faked here.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { ToolExecutionSandbox } from "../mcp-gateway/sandbox";
import type { PerceptionFileEntry, PerceptionRequest, PerceptionResult } from "./types";

const DEFAULT_MAX_FILES = 500;
const SNAPSHOT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".md", ".yaml", ".yml",
]);
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".cache", "coverage", ".next", ".turbo",
]);

function listFiles(root: string, dir: string, out: PerceptionFileEntry[], maxFiles: number): void {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip, never throw out of perception
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      listFiles(root, full, out, maxFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SNAPSHOT_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue;
    try {
      const st = statSync(full);
      out.push({
        relativePath: relative(root, full).split("\\").join("/"),
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // file vanished between listing and stat — skip
    }
  }
}

function countSymbols(filePath: string): number {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return 0;
  }
  const matches = content.match(/\b(function|class|interface|type|const|export)\b/g);
  return matches ? matches.length : 0;
}

/** Deterministic content hash of the perceived file set (path + size + mtime). */
function hashFileSet(files: PerceptionFileEntry[]): string {
  const canonical = files
    .map((f) => `${f.relativePath}:${f.sizeBytes}:${Math.round(f.mtimeMs)}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function createPerception(req: PerceptionRequest): PerceptionResult {
  const root = req.workspaceRoot;
  const maxFiles = Math.min(Math.max(req.maxFiles ?? DEFAULT_MAX_FILES, 1), 2000);
  const kind = req.kind === "symbols" ? "symbols" : "tree";

  const files: PerceptionFileEntry[] = [];
  listFiles(root, root, files, maxFiles);

  let symbolCount = 0;
  if (kind === "symbols") {
    for (const f of files.slice(0, 200)) {
      const resolved = ToolExecutionSandbox.assertSafeWorkspacePath(f.relativePath, root);
      symbolCount += countSymbols(resolved);
    }
  }

  const perceptionId = `smp_${randomUUID().slice(0, 16)}`;
  const now = new Date().toISOString();
  const contentHash = hashFileSet(files);

  try {
    const db = openAgentOsDb();
    db.run(
      "INSERT INTO sm_perceptions (id, session_id, kind, workspace_root, files_json, symbol_count, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [perceptionId, req.sessionId, kind, root, JSON.stringify(files), symbolCount, contentHash, now],
    );
  } catch {
    // Perception remains usable in-memory even if persistence is unavailable.
  }

  return {
    perceptionId,
    sessionId: req.sessionId,
    kind,
    workspaceRoot: root,
    fileCount: files.length,
    symbolCount,
    contentHash,
    files,
    createdAt: now,
  };
}

export function getPerception(perceptionId: string): PerceptionResult | null {
  try {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT * FROM sm_perceptions WHERE id = ? LIMIT 1")
      .get(perceptionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      perceptionId: row.id as string,
      sessionId: row.session_id as string,
      kind: row.kind as string,
      workspaceRoot: row.workspace_root as string,
      fileCount: (JSON.parse(row.files_json as string) as PerceptionFileEntry[]).length,
      symbolCount: row.symbol_count as number,
      contentHash: row.content_hash as string,
      files: JSON.parse(row.files_json as string) as PerceptionFileEntry[],
      createdAt: row.created_at as string,
    };
  } catch {
    return null;
  }
}
