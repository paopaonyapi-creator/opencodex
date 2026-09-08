// Phase 20.4 — ChangeSet Registry & Diff Safety Scan
// (spec sections 34-37, 53, 141).
//
// A ChangeSet is the traceable unit that links a task to an agent run, a
// worktree, a commit range, and a diff hash. Reviews bind to the diff hash, so
// any new commit automatically invalidates prior reviews (spec section 53).

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { runGit } from "./git-safety";
import { isOutOfScope } from "./classify";
import type { RiskLevel } from "../sdlc/types";
import type { ChangeSet, DiffSafetyReport, FileIntentManifest } from "./types";

interface ChangeSetRow {
  id: string;
  council_run_id: string;
  task_key: string;
  worktree_id: string;
  agent_run_id: string | null;
  base_sha: string;
  head_sha: string;
  diff_hash: string;
  files_changed_json: string;
  insertions: number;
  deletions: number;
  generated_files_json: string;
  migration_files_json: string;
  risk: string;
  scope_drift: number;
  scope_drift_paths_json: string;
  revision: number;
  created_at: string;
}

function rowToChangeSet(row: ChangeSetRow): ChangeSet {
  return {
    id: row.id,
    councilRunId: row.council_run_id,
    taskKey: row.task_key,
    worktreeId: row.worktree_id,
    agentRunId: row.agent_run_id,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    diffHash: row.diff_hash,
    filesChanged: JSON.parse(row.files_changed_json) as string[],
    insertions: row.insertions,
    deletions: row.deletions,
    generatedFiles: JSON.parse(row.generated_files_json) as string[],
    migrationFiles: JSON.parse(row.migration_files_json) as string[],
    risk: row.risk as RiskLevel,
    scopeDrift: row.scope_drift === 1,
    scopeDriftPaths: JSON.parse(row.scope_drift_paths_json) as string[],
    revision: row.revision,
    createdAt: row.created_at,
  };
}

export interface DiffStat {
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

/** Collect --numstat for a commit range inside a worktree. */
export async function collectDiffStat(
  worktreePath: string,
  baseSha: string,
  headSha: string,
): Promise<DiffStat> {
  const res = await runGit(["diff", "--numstat", `${baseSha}..${headSha}`], {
    cwd: worktreePath,
  });

  const filesChanged: string[] = [];
  let insertions = 0;
  let deletions = 0;

  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addRaw, delRaw, file] = parts;
    // Binary files report "-" for both counts.
    if (addRaw !== "-") insertions += Number(addRaw) || 0;
    if (delRaw !== "-") deletions += Number(delRaw) || 0;
    filesChanged.push(file!.trim().replace(/\\/g, "/"));
  }

  return { filesChanged, insertions, deletions };
}

/**
 * diff_hash binds a review to exact content (spec section 53). Uses the raw
 * patch so a reordered-but-identical commit still yields the same hash.
 */
export async function computeDiffHash(
  worktreePath: string,
  baseSha: string,
  headSha: string,
): Promise<string> {
  const res = await runGit(
    ["diff", "--no-color", "--no-ext-diff", `${baseSha}..${headSha}`],
    { cwd: worktreePath, timeoutMs: 120_000 },
  );
  return createHash("sha256").update(res.stdout).digest("hex");
}

// --- Diff safety scan (spec section 36) -----------------------------------

/**
 * Secret-shaped patterns. Deliberately conservative: these are reported for a
 * reviewer to judge, and the raw value is never echoed back (spec section 28/89).
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "openai-style key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "aws access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "google api key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "generic assigned secret", re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
  { name: "bearer literal", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
];

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "pdf", "zip", "gz", "tar",
  "7z", "rar", "exe", "dll", "so", "dylib", "node", "wasm", "mp4", "mp3", "wav",
  "woff", "woff2", "ttf", "eot", "bin", "sqlite3", "db",
]);

export const DEFAULT_LARGE_FILE_BYTES = 512 * 1024;

export interface DiffSafetyInput {
  worktreePath: string;
  baseSha: string;
  headSha: string;
  filesChanged: string[];
  manifest?: FileIntentManifest;
  largeFileBytes?: number;
}

export async function scanDiffSafety(input: DiffSafetyInput): Promise<DiffSafetyReport> {
  const secretFindings: string[] = [];
  const unexpectedPaths: string[] = [];
  const binaryFiles: string[] = [];
  const largeFiles: string[] = [];
  const forbiddenFiles: string[] = [];
  const limit = input.largeFileBytes ?? DEFAULT_LARGE_FILE_BYTES;

  // Scan added lines only: pre-existing secrets in context lines are not this
  // changeset's fault, and flagging them would train reviewers to ignore us.
  const patch = await runGit(
    ["diff", "--no-color", "--no-ext-diff", "--unified=0", `${input.baseSha}..${input.headSha}`],
    { cwd: input.worktreePath, timeoutMs: 120_000 },
  );

  let currentFile = "unknown";
  for (const line of patch.stdout.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length).trim();
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const added = line.slice(1);
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(added)) {
        // Record location + rule only. Never the matched secret itself.
        secretFindings.push(`${currentFile}: possible ${name}`);
      }
    }
  }

  for (const file of input.filesChanged) {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    if (BINARY_EXTENSIONS.has(ext)) binaryFiles.push(file);

    if (input.manifest) {
      if (
        input.manifest.forbiddenPaths.some(f =>
          f.endsWith("/") ? file.startsWith(f) : file === f || file.endsWith(`/${f}`),
        )
      ) {
        forbiddenFiles.push(file);
      } else if (isOutOfScope(file, input.manifest)) {
        unexpectedPaths.push(file);
      }
    }

    const sizeRes = await runGit(["cat-file", "-s", `${input.headSha}:${file}`], {
      cwd: input.worktreePath,
    });
    if (sizeRes.ok) {
      const bytes = Number(sizeRes.stdout.trim());
      if (Number.isFinite(bytes) && bytes > limit) {
        largeFiles.push(`${file} (${bytes} bytes)`);
      }
    }
  }

  return {
    // Secrets and forbidden paths are hard failures; scope drift is not
    // (spec section 37: flag it, let the reviewer see it).
    passed: secretFindings.length === 0 && forbiddenFiles.length === 0,
    secretFindings: [...new Set(secretFindings)],
    unexpectedPaths,
    binaryFiles,
    largeFiles,
    forbiddenFiles,
  };
}

// --- Registry -------------------------------------------------------------

export interface RegisterChangeSetInput {
  councilRunId: string;
  taskKey: string;
  worktreeId: string;
  worktreePath: string;
  agentRunId?: string | null;
  baseSha: string;
  headSha: string;
  risk: RiskLevel;
  manifest?: FileIntentManifest;
}

const GENERATED_HINTS = ["/generated/", "/gen/", ".generated.", "__generated__"];
const MIGRATION_HINTS = ["migrations/", "migration/", "schema.sql"];

/**
 * Spec sections 34/35/48/49 — record a ChangeSet. Revisions accumulate: a retry
 * produces revision N+1 and never overwrites the prior audit row.
 */
export async function registerChangeSet(
  input: RegisterChangeSetInput,
): Promise<{ changeset: ChangeSet; safety: DiffSafetyReport }> {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  const stat = await collectDiffStat(input.worktreePath, input.baseSha, input.headSha);
  const diffHash = await computeDiffHash(input.worktreePath, input.baseSha, input.headSha);

  const safety = await scanDiffSafety({
    worktreePath: input.worktreePath,
    baseSha: input.baseSha,
    headSha: input.headSha,
    filesChanged: stat.filesChanged,
    manifest: input.manifest,
  });

  const generatedFiles = stat.filesChanged.filter(f =>
    GENERATED_HINTS.some(h => f.toLowerCase().includes(h)),
  );
  const migrationFiles = stat.filesChanged.filter(f =>
    MIGRATION_HINTS.some(h => f.toLowerCase().includes(h)),
  );

  const prior = db
    .query(
      `SELECT MAX(revision) AS r FROM council_changesets
       WHERE council_run_id = ? AND task_key = ?`,
    )
    .get(input.councilRunId, input.taskKey) as { r: number | null };
  const revision = (prior?.r ?? 0) + 1;

  const changeset: ChangeSet = {
    id: `cchg_${randomUUID().slice(0, 12)}`,
    councilRunId: input.councilRunId,
    taskKey: input.taskKey,
    worktreeId: input.worktreeId,
    agentRunId: input.agentRunId ?? null,
    baseSha: input.baseSha,
    headSha: input.headSha,
    diffHash,
    filesChanged: stat.filesChanged,
    insertions: stat.insertions,
    deletions: stat.deletions,
    generatedFiles,
    migrationFiles,
    risk: input.risk,
    scopeDrift: safety.unexpectedPaths.length > 0,
    scopeDriftPaths: safety.unexpectedPaths,
    revision,
    createdAt: now,
  };

  db.query(
    `INSERT INTO council_changesets
       (id, council_run_id, task_key, worktree_id, agent_run_id, base_sha, head_sha,
        diff_hash, files_changed_json, insertions, deletions, generated_files_json,
        migration_files_json, risk, scope_drift, scope_drift_paths_json, revision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    changeset.id,
    changeset.councilRunId,
    changeset.taskKey,
    changeset.worktreeId,
    changeset.agentRunId,
    changeset.baseSha,
    changeset.headSha,
    changeset.diffHash,
    JSON.stringify(changeset.filesChanged),
    changeset.insertions,
    changeset.deletions,
    JSON.stringify(changeset.generatedFiles),
    JSON.stringify(changeset.migrationFiles),
    changeset.risk,
    changeset.scopeDrift ? 1 : 0,
    JSON.stringify(changeset.scopeDriftPaths),
    changeset.revision,
    changeset.createdAt,
  );

  return { changeset, safety };
}

export function getChangeSet(id: string): ChangeSet | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM council_changesets WHERE id = ?").get(id) as
    | ChangeSetRow
    | undefined;
  return row ? rowToChangeSet(row) : null;
}

export function listChangeSets(councilRunId: string): ChangeSet[] {
  const db = openAgentOsDb();
  const rows = db
    .query(
      "SELECT * FROM council_changesets WHERE council_run_id = ? ORDER BY task_key, revision",
    )
    .all(councilRunId) as ChangeSetRow[];
  return rows.map(rowToChangeSet);
}

/** Latest revision per task (spec section 49 keeps every revision on record). */
export function latestChangeSetsByTask(councilRunId: string): Map<string, ChangeSet> {
  const out = new Map<string, ChangeSet>();
  for (const cs of listChangeSets(councilRunId)) {
    const existing = out.get(cs.taskKey);
    if (!existing || cs.revision > existing.revision) out.set(cs.taskKey, cs);
  }
  return out;
}

export function getChangeSetRevisions(councilRunId: string, taskKey: string): ChangeSet[] {
  const db = openAgentOsDb();
  const rows = db
    .query(
      `SELECT * FROM council_changesets
       WHERE council_run_id = ? AND task_key = ? ORDER BY revision`,
    )
    .all(councilRunId, taskKey) as ChangeSetRow[];
  return rows.map(rowToChangeSet);
}
