// Phase 20.4 — Verification Bundles & Failure Attribution
// (spec sections 55-60, 115-119, 171, 172).
//
// Reuses Phase 20.2's DeterministicVerifier command semantics via the shared
// SafeImplementationRunner (spec section 183) but adds three things 20.2 lacks:
//   1. scope (TASK_LOCAL / CHANGESET / INTEGRATION),
//   2. baseline comparison so a pre-existing failure is not blamed on an agent,
//   3. a hashed evidence bundle that gates can point at.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { SafeImplementationRunner } from "../sdlc/runner";
import type {
  CheckOutcome,
  FailureOrigin,
  VerificationBundle,
  VerificationCheck,
  VerificationScope,
} from "./types";

export interface CheckSpec {
  name: string;
  command: string[];
  /** Skip when the repo has no such script/target. */
  optional?: boolean;
}

/** Spec section 56 — the standard ladder. Ordered cheapest-first. */
export const DEFAULT_CHECKS: CheckSpec[] = [
  { name: "typecheck", command: ["bun", "run", "typecheck"] },
  { name: "unit tests", command: ["bun", "test"] },
  { name: "gui lint", command: ["bun", "run", "lint:gui"], optional: true },
];

export interface RunChecksOptions {
  cwd: string;
  timeoutMs?: number;
  checks?: CheckSpec[];
  /** Outcomes observed on the untouched base, keyed by check name. */
  baseline?: Map<string, CheckOutcome>;
}

const FLAKY_HINTS = [
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "socket hang up",
  "timeout", "flaky", "port already in use", "EADDRINUSE",
];

function looksFlaky(output: string): boolean {
  const lower = output.toLowerCase();
  return FLAKY_HINTS.some(h => lower.includes(h.toLowerCase()));
}

function summarize(text: string, limit = 2000): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  // Keep the tail: test runners put failure summaries at the end.
  return `...(truncated)...\n${trimmed.slice(-limit)}`;
}

/**
 * Spec sections 57/115 — run the ladder and attribute each failure. A check that
 * already failed on the base is PRE_EXISTING and must not be charged to the
 * agent (spec section 116).
 */
export async function runChecks(options: RunChecksOptions): Promise<VerificationCheck[]> {
  const checks = options.checks ?? DEFAULT_CHECKS;
  const out: VerificationCheck[] = [];

  for (const spec of checks) {
    const started = Date.now();
    const res = await SafeImplementationRunner.runCommand(spec.command, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 300_000,
    });

    const combined = `${res.stdout}\n${res.stderr}`;
    let outcome: CheckOutcome;

    if (res.exitCode === 0) outcome = "PASS";
    else if (res.timedOut || looksFlaky(combined)) outcome = "FLAKY_SUSPECTED";
    else outcome = "FAIL";

    // A missing optional target is NOT_RUN, not a failure.
    if (
      spec.optional &&
      res.exitCode !== 0 &&
      /script not found|no such file|unknown command|Missing script/i.test(combined)
    ) {
      outcome = "NOT_RUN";
    }

    const baselineOutcome = options.baseline?.get(spec.name);
    let origin: FailureOrigin = "UNKNOWN";
    if (outcome === "PASS" || outcome === "NOT_RUN") {
      origin = "PRE_EXISTING"; // nothing to attribute
    } else if (baselineOutcome === undefined) {
      origin = "UNKNOWN";
    } else if (baselineOutcome === "FAIL" || baselineOutcome === "FLAKY_SUSPECTED") {
      origin = "PRE_EXISTING";
    } else if (baselineOutcome === "PASS") {
      origin = "INTRODUCED";
    }

    out.push({
      name: spec.name,
      command: res.command,
      outcome,
      exitCode: res.exitCode,
      outputSummary: summarize(combined),
      logRef: null,
      durationMs: Date.now() - started,
      origin,
      timestamp: new Date().toISOString(),
    });
  }

  return out;
}

/** Capture baseline outcomes on an untouched checkout (spec section 115). */
export async function captureBaseline(
  cwd: string,
  checks: CheckSpec[] = DEFAULT_CHECKS,
  timeoutMs?: number,
): Promise<Map<string, CheckOutcome>> {
  const results = await runChecks({ cwd, checks, timeoutMs });
  return new Map(results.map(r => [r.name, r.outcome]));
}

export interface CreateBundleInput {
  councilRunId: string;
  scope: VerificationScope;
  commitSha: string;
  checks: VerificationCheck[];
  changesetId?: string | null;
  integrationRunId?: string | null;
}

/**
 * Spec sections 58/59 — persist an immutable, hashed evidence bundle. A bundle
 * passes only when nothing was INTRODUCED and no hard FAIL remains.
 */
export function createVerificationBundle(
  input: CreateBundleInput,
): VerificationBundle {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  const passed = evaluateChecksPassed(input.checks);

  const bundleHash = createHash("sha256")
    .update(
      JSON.stringify({
        scope: input.scope,
        commitSha: input.commitSha,
        checks: input.checks.map(c => ({
          name: c.name,
          outcome: c.outcome,
          exitCode: c.exitCode,
          origin: c.origin,
        })),
      }),
    )
    .digest("hex");

  const bundle: VerificationBundle = {
    id: `cvb_${randomUUID().slice(0, 12)}`,
    councilRunId: input.councilRunId,
    scope: input.scope,
    changesetId: input.changesetId ?? null,
    integrationRunId: input.integrationRunId ?? null,
    commitSha: input.commitSha,
    checks: input.checks,
    passed,
    bundleHash,
    createdAt: now,
  };

  db.query(
    `INSERT INTO council_verification_bundles
       (id, council_run_id, scope, changeset_id, integration_run_id, commit_sha,
        checks_json, passed, bundle_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    bundle.id,
    bundle.councilRunId,
    bundle.scope,
    bundle.changesetId,
    bundle.integrationRunId,
    bundle.commitSha,
    JSON.stringify(bundle.checks),
    bundle.passed ? 1 : 0,
    bundle.bundleHash,
    bundle.createdAt,
  );

  return bundle;
}

/**
 * Spec sections 59/116/117 — a bundle passes when no check was INTRODUCED-failing.
 * FLAKY_SUSPECTED does not pass on its own; it must be retried and confirmed
 * (spec section 118), so it is treated as not-passing here.
 */
export function evaluateChecksPassed(checks: VerificationCheck[]): boolean {
  if (checks.length === 0) return false;
  for (const c of checks) {
    if (c.outcome === "PASS" || c.outcome === "NOT_RUN") continue;
    if (c.outcome === "BLOCKED") return false;
    if (c.origin === "PRE_EXISTING") continue; // not this changeset's fault
    return false;
  }
  return true;
}

/** Spec section 116 — split failures by who caused them. */
export function attributeFailures(checks: VerificationCheck[]): {
  introduced: VerificationCheck[];
  preExisting: VerificationCheck[];
  unknown: VerificationCheck[];
  flaky: VerificationCheck[];
} {
  const failing = checks.filter(c => c.outcome === "FAIL" || c.outcome === "FLAKY_SUSPECTED");
  return {
    introduced: failing.filter(c => c.origin === "INTRODUCED"),
    preExisting: failing.filter(c => c.origin === "PRE_EXISTING"),
    unknown: failing.filter(c => c.origin === "UNKNOWN"),
    flaky: checks.filter(c => c.outcome === "FLAKY_SUSPECTED"),
  };
}

/**
 * Spec section 118 — confirm a suspected flake by re-running just that check.
 * Two consecutive passes reclassify it; otherwise it stays a failure.
 */
export async function confirmFlaky(
  cwd: string,
  spec: CheckSpec,
  attempts = 2,
  timeoutMs?: number,
): Promise<{ confirmedFlaky: boolean; outcomes: CheckOutcome[] }> {
  const outcomes: CheckOutcome[] = [];
  for (let i = 0; i < attempts; i++) {
    const [check] = await runChecks({ cwd, checks: [spec], timeoutMs });
    outcomes.push(check!.outcome);
  }
  return { confirmedFlaky: outcomes.every(o => o === "PASS"), outcomes };
}

function rowToBundle(r: Record<string, unknown>): VerificationBundle {
  return {
    id: r.id as string,
    councilRunId: r.council_run_id as string,
    scope: r.scope as VerificationScope,
    changesetId: (r.changeset_id as string | null) ?? null,
    integrationRunId: (r.integration_run_id as string | null) ?? null,
    commitSha: r.commit_sha as string,
    checks: JSON.parse(r.checks_json as string) as VerificationCheck[],
    passed: r.passed === 1,
    bundleHash: r.bundle_hash as string,
    createdAt: r.created_at as string,
  };
}

export function getVerificationBundle(id: string): VerificationBundle | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM council_verification_bundles WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToBundle(row) : null;
}

export function listVerificationBundles(
  councilRunId: string,
  scope?: VerificationScope,
): VerificationBundle[] {
  const db = openAgentOsDb();
  const rows = scope
    ? (db
        .query(
          "SELECT * FROM council_verification_bundles WHERE council_run_id = ? AND scope = ? ORDER BY created_at",
        )
        .all(councilRunId, scope) as Array<Record<string, unknown>>)
    : (db
        .query(
          "SELECT * FROM council_verification_bundles WHERE council_run_id = ? ORDER BY created_at",
        )
        .all(councilRunId) as Array<Record<string, unknown>>);
  return rows.map(rowToBundle);
}

/** Latest bundle for a changeset, used by merge readiness (spec section 65). */
export function latestBundleForChangeset(changesetId: string): VerificationBundle | null {
  const db = openAgentOsDb();
  const row = db
    .query(
      `SELECT * FROM council_verification_bundles
       WHERE changeset_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(changesetId) as Record<string, unknown> | undefined;
  return row ? rowToBundle(row) : null;
}

/**
 * Spec section 60 — a bundle is only valid for the commit it ran against.
 * Prevents an old green run from vouching for new code.
 */
export function isBundleCurrent(
  bundle: VerificationBundle,
  currentCommitSha: string,
): boolean {
  return bundle.commitSha === currentCommitSha;
}
