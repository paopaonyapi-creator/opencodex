// Phase 20.4 — Conflict Analyzer (spec sections 61-63, 73, 74, 108, 168).
//
// Real conflict detection via `git merge-tree --write-tree`, which performs a
// trial merge in the object database WITHOUT touching any working tree. That
// property matters: predicting conflicts must never mutate a checkout.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { runGit } from "./git-safety";
import type {
  ChangeSet,
  ConflictCase,
  ConflictCaseStatus,
  ConflictType,
} from "./types";

export interface TrialMergeResult {
  clean: boolean;
  conflictedFiles: string[];
  treeSha: string | null;
  /** True when this git build lacks `merge-tree --write-tree`. */
  unsupported: boolean;
  raw: string;
}

/**
 * Trial-merge two commits without a worktree. Requires git >= 2.38 for
 * `--write-tree`; falls back to reporting `unsupported` so callers can degrade
 * to sequential apply rather than guessing (spec section 62).
 */
export async function trialMerge(
  repoRoot: string,
  baseSha: string,
  oursSha: string,
  theirsSha: string,
): Promise<TrialMergeResult> {
  const res = await runGit(
    ["merge-tree", "--write-tree", "--merge-base", baseSha, oursSha, theirsSha],
    { cwd: repoRoot, timeoutMs: 120_000 },
  );

  const combined = `${res.stdout}\n${res.stderr}`;
  if (/unknown option|usage: git merge-tree|invalid option/i.test(combined)) {
    return { clean: false, conflictedFiles: [], treeSha: null, unsupported: true, raw: combined };
  }

  const lines = res.stdout.split(/\r?\n/);
  const treeSha = lines[0]?.trim() ?? null;

  // Exit 0 => clean merge; non-zero => conflicts described on stdout.
  if (res.exitCode === 0) {
    return {
      clean: true,
      conflictedFiles: [],
      treeSha: /^[0-9a-f]{40}$/.test(treeSha ?? "") ? treeSha : null,
      unsupported: false,
      raw: res.stdout,
    };
  }

  // Conflict output includes an "Auto-merging"/"CONFLICT (...)" informational
  // block plus a NUL/newline separated file list depending on git version.
  const conflicted = new Set<string>();
  for (const line of lines) {
    const m = /^CONFLICT\s*\([^)]*\):\s*(.+)$/.exec(line);
    if (m) {
      // Messages look like: "Merge conflict in path/to/file"
      const inMatch = /(?:Merge conflict in|conflict in)\s+(.+)$/i.exec(m[1]!);
      conflicted.add((inMatch?.[1] ?? m[1]!).trim());
      continue;
    }
    // Some versions emit "100644 <sha> 1\tpath" stage lines.
    const stage = /^\d{6} [0-9a-f]{40} [123]\t(.+)$/.exec(line);
    if (stage) conflicted.add(stage[1]!.trim());
  }

  return {
    clean: false,
    conflictedFiles: [...conflicted],
    treeSha: null,
    unsupported: false,
    raw: res.stdout || res.stderr,
  };
}

/** Spec section 73 — classify what kind of conflict we are looking at. */
export function classifyConflictType(files: string[]): ConflictType {
  const lower = files.map(f => f.toLowerCase());
  if (lower.some(f => /(^|\/)(bun\.lock|bun\.lockb|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(f))) {
    return "LOCKFILE";
  }
  if (lower.some(f => f.includes("migrations/") || f.endsWith("schema.sql") || f.endsWith("db.ts"))) {
    return "MIGRATION_ORDER";
  }
  return "TEXTUAL";
}

export interface AnalyzeConflictInput {
  repoRoot: string;
  councilRunId: string;
  baseSha: string;
  a: ChangeSet;
  b: ChangeSet;
}

export interface ConflictAnalysis {
  clean: boolean;
  unsupported: boolean;
  conflictedFiles: string[];
  conflictType: ConflictType | null;
  conflictCase: ConflictCase | null;
}

/**
 * Spec sections 61/62 — detect a real conflict between two changesets before
 * they enter the merge queue. Records a ConflictCase when they clash.
 */
export async function analyzeChangeSetPair(
  input: AnalyzeConflictInput,
): Promise<ConflictAnalysis> {
  const trial = await trialMerge(
    input.repoRoot,
    input.baseSha,
    input.a.headSha,
    input.b.headSha,
  );

  if (trial.unsupported) {
    return {
      clean: false,
      unsupported: true,
      conflictedFiles: [],
      conflictType: null,
      conflictCase: null,
    };
  }

  if (trial.clean) {
    return {
      clean: true,
      unsupported: false,
      conflictedFiles: [],
      conflictType: null,
      conflictCase: null,
    };
  }

  // Fall back to declared file overlap when git did not name the files.
  const files =
    trial.conflictedFiles.length > 0
      ? trial.conflictedFiles
      : input.a.filesChanged.filter(f => input.b.filesChanged.includes(f));

  const conflictType = classifyConflictType(files);
  const conflictCase = recordConflictCase({
    councilRunId: input.councilRunId,
    changesetIds: [input.a.id, input.b.id],
    candidateIds: [],
    files,
    baseSha: input.baseSha,
    conflictType,
    detail: `trial merge of ${input.a.taskKey} and ${input.b.taskKey} conflicts in ${files.length} file(s)`,
  });

  return {
    clean: false,
    unsupported: false,
    conflictedFiles: files,
    conflictType,
    conflictCase,
  };
}

export function recordConflictCase(input: {
  councilRunId: string;
  changesetIds: string[];
  candidateIds: string[];
  files: string[];
  baseSha: string;
  conflictType: ConflictType;
  detail: string;
}): ConflictCase {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  const conflictCase: ConflictCase = {
    id: `cconf_${randomUUID().slice(0, 12)}`,
    councilRunId: input.councilRunId,
    candidateIds: input.candidateIds,
    changesetIds: input.changesetIds,
    files: input.files,
    baseSha: input.baseSha,
    conflictType: input.conflictType,
    status: "open",
    resolver: null,
    resolutionChangesetId: null,
    detail: input.detail,
    createdAt: now,
  };

  db.query(
    `INSERT INTO council_conflict_cases
       (id, council_run_id, candidate_ids_json, changeset_ids_json, files_json, base_sha,
        conflict_type, status, resolver, resolution_changeset_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?)`,
  ).run(
    conflictCase.id,
    conflictCase.councilRunId,
    JSON.stringify(conflictCase.candidateIds),
    JSON.stringify(conflictCase.changesetIds),
    JSON.stringify(conflictCase.files),
    conflictCase.baseSha,
    conflictCase.conflictType,
    conflictCase.detail,
    conflictCase.createdAt,
  );

  return conflictCase;
}

function rowToConflictCase(r: Record<string, unknown>): ConflictCase {
  return {
    id: r.id as string,
    councilRunId: r.council_run_id as string,
    candidateIds: JSON.parse(r.candidate_ids_json as string) as string[],
    changesetIds: JSON.parse(r.changeset_ids_json as string) as string[],
    files: JSON.parse(r.files_json as string) as string[],
    baseSha: r.base_sha as string,
    conflictType: r.conflict_type as ConflictType,
    status: r.status as ConflictCaseStatus,
    resolver: (r.resolver as string | null) ?? null,
    resolutionChangesetId: (r.resolution_changeset_id as string | null) ?? null,
    detail: r.detail as string,
    createdAt: r.created_at as string,
  };
}

export function listConflictCases(
  councilRunId: string,
  status?: ConflictCaseStatus,
): ConflictCase[] {
  const db = openAgentOsDb();
  const rows = status
    ? (db
        .query(
          "SELECT * FROM council_conflict_cases WHERE council_run_id = ? AND status = ? ORDER BY created_at",
        )
        .all(councilRunId, status) as Array<Record<string, unknown>>)
    : (db
        .query("SELECT * FROM council_conflict_cases WHERE council_run_id = ? ORDER BY created_at")
        .all(councilRunId) as Array<Record<string, unknown>>);
  return rows.map(rowToConflictCase);
}

/**
 * Spec section 74 — a resolution must be a reviewable changeset, not a silent
 * overwrite. Marking resolved without one is refused.
 */
export function resolveConflictCase(
  conflictCaseId: string,
  input: { resolver: string; resolutionChangesetId: string | null; abandon?: boolean },
): { ok: boolean; reason?: string } {
  const db = openAgentOsDb();

  if (input.abandon) {
    db.run(
      "UPDATE council_conflict_cases SET status = 'abandoned', resolver = ? WHERE id = ?",
      [input.resolver, conflictCaseId],
    );
    return { ok: true };
  }

  if (!input.resolutionChangesetId) {
    return {
      ok: false,
      reason: "conflict resolution requires a reviewable resolution changeset (s74)",
    };
  }

  const res = db.run(
    `UPDATE council_conflict_cases
     SET status = 'resolved', resolver = ?, resolution_changeset_id = ?
     WHERE id = ? AND status IN ('open', 'resolving')`,
    [input.resolver, input.resolutionChangesetId, conflictCaseId],
  );

  return (res.changes ?? 0) > 0
    ? { ok: true }
    : { ok: false, reason: "conflict case not found or already closed" };
}

/**
 * Spec section 108 — migration ordering. Two changesets that both add
 * migrations must be applied in a deterministic order and never merged blindly.
 */
export function detectMigrationOrderRisk(changesets: ChangeSet[]): {
  atRisk: boolean;
  taskKeys: string[];
  files: string[];
} {
  const withMigrations = changesets.filter(c => c.migrationFiles.length > 0);
  return {
    atRisk: withMigrations.length > 1,
    taskKeys: withMigrations.map(c => c.taskKey),
    files: withMigrations.flatMap(c => c.migrationFiles),
  };
}
