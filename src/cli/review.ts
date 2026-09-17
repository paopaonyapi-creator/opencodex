// ocx review / pao review — Deterministic Code Review CLI surface
// (Phase 20.81 blueprint §48-50; GOLD slice #3).
//
// Bridges the CLI to the code-review management routes. If the proxy is
// running, it talks HTTP through the runtimeRequest helper; if stopped,
// it executes against the local in-process CodeReviewService directly
// (local-transport precedent: storage, capabilities).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CliUsageError,
  printData,
  rejectArgs,
  runCliAction,
  runtimeRequest,
  takeFlag,
  takeOption,
  type RuntimeApiDeps,
} from "./runtime-api";
import { getCodeReviewService } from "../agent-os/code-review/service";
import type { ReviewFinding, ReviewMode, ReviewPreview, ReviewSessionRecord } from "../agent-os/code-review/types";

export const USAGE = `Usage:
  ocx review [--repo <path>] [--preview] [--json]
  ocx review --commit <sha> [--repo <path>] [--preview] [--json]
  ocx review --from <base> --to <head> [--repo <path>] [--preview] [--json]
  ocx review sessions [--limit <n>] [--json]
  ocx review session <id> [--json]
  ocx review status [--json]`;

interface ReviewCliOptions {
  repo: string;
  mode: ReviewMode;
  from?: string;
  to?: string;
  commit?: string;
  preview: boolean;
  json: boolean;
}

function parseReviewOptions(argv: string[]): { options: ReviewCliOptions; remaining: string[] } {
  const args = [...argv];
  const json = takeFlag(args, "--json");
  const preview = takeFlag(args, "--preview");
  const repoOpt = takeOption(args, "--repo");
  const commit = takeOption(args, "--commit");
  const from = takeOption(args, "--from");
  const to = takeOption(args, "--to");

  let mode: ReviewMode = "workspace";
  if (commit) mode = "commit";
  else if (from || to) {
    if (!from || !to) {
      throw new CliUsageError("range review requires both --from and --to\n\n" + USAGE);
    }
    mode = "range";
  }

  const repo = resolve(repoOpt ?? ".");
  if (!existsSync(repo)) {
    throw new CliUsageError("repository path does not exist: " + repo);
  }

  return {
    options: { repo, mode, from, to, commit, preview, json },
    remaining: args,
  };
}

async function runOrPreview(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const { options, remaining } = parseReviewOptions(argv);
  rejectArgs(remaining, USAGE);

  // Local-transport fallback: if proxy is not reachable, run in-process.
  const service = getCodeReviewService();

  if (options.preview) {
    let preview: ReviewPreview & { units?: unknown[] };
    try {
      const res = await runtimeRequest(
        "/api/agent-os/code-review/preview",
        {
          method: "POST",
          body: JSON.stringify({
            repositoryPath: options.repo,
            mode: options.mode,
            from: options.from,
            to: options.to,
            commit: options.commit,
          }),
        },
        deps,
      ) as { preview: ReviewPreview };
      preview = res.preview;
    } catch {
      preview = await service.preview({
        repositoryPath: options.repo,
        mode: options.mode,
        from: options.from,
        to: options.to,
        commit: options.commit,
        requestedBy: "cli",
      });
    }

    if (options.json) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    console.log("Review Preview (" + preview.mode + ")");
    console.log("  Files changed:  " + String(preview.filesChanged));
    console.log("  Files selected: " + String(preview.filesSelected));
    console.log("  Files excluded: " + String(preview.filesExcluded));
    console.log("  Review units:   " + String(preview.reviewUnits));
    console.log("  Risk level:     " + preview.risk.toUpperCase());
    console.log("  Protected path: " + (preview.protectedPathChanged ? "YES (human approval required)" : "no"));
    console.log("  Est. tokens:    ~" + String(preview.estimatedTokenBudget));
    return;
  }

  let result: {
    session: ReviewSessionRecord;
    gate: { gate: string; reasons: string[] };
    findings: ReviewFinding[];
    reused: boolean;
  };
  try {
    result = (await runtimeRequest(
      "/api/agent-os/code-review/run",
      {
        method: "POST",
        body: JSON.stringify({
          repositoryPath: options.repo,
          mode: options.mode,
          from: options.from,
          to: options.to,
          commit: options.commit,
        }),
      },
      deps,
    )) as typeof result;
  } catch {
    result = await service.runReview({
      repositoryPath: options.repo,
      mode: options.mode,
      from: options.from,
      to: options.to,
      commit: options.commit,
      requestedBy: "cli",
    });
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Pao Code Review — Session " + result.session.sessionId + (result.reused ? " (cached)" : ""));
    console.log("  Gate:      " + result.gate.gate);
    console.log("  Reasons:   " + result.gate.reasons.join("; "));
    console.log("  Findings:  " + String(result.findings.length) + " total");
    for (const f of result.findings) {
      console.log("    [" + f.severity + "] " + f.location.path + ":" + String(f.location.startLine) + " — " + f.title);
    }
  }

  if (result.gate.gate === "BLOCK" || result.gate.gate === "REQUIRE_FIX") {
    process.exitCode = 2;
  }
}

async function handleStatus(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const args = [...argv];
  const wantsJson = takeFlag(args, "--json");
  rejectArgs(args, USAGE);
  const service = getCodeReviewService();
  let statusData: Record<string, unknown>;
  try {
    statusData = (await runtimeRequest("/api/agent-os/code-review/status", {}, deps)) as Record<string, unknown>;
  } catch {
    const sessions = service.listSessions(50);
    statusData = {
      ok: true,
      phase: "20.81-slice1",
      engine: "pao-deterministic-review",
      sessions: sessions.length,
      completed: sessions.filter((s) => s.status === "completed").length,
      failed: sessions.filter((s) => s.status === "failed").length,
    };
  }
  printData(statusData, wantsJson, [
    "Code Review Engine: " + String(statusData.engine ?? "pao-deterministic-review"),
    "Recorded Sessions:  " + String(statusData.sessions ?? 0),
  ]);
}

async function handleSessions(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const args = [...argv];
  const wantsJson = takeFlag(args, "--json");
  const limitOpt = takeOption(args, "--limit");
  rejectArgs(args, USAGE);
  const limit = limitOpt ? Math.max(1, Number(limitOpt) || 20) : 20;
  const service = getCodeReviewService();
  let sessions: ReviewSessionRecord[];
  try {
    const res = (await runtimeRequest(
      "/api/agent-os/code-review/sessions?limit=" + String(limit),
      {},
      deps,
    )) as { sessions: ReviewSessionRecord[] };
    sessions = res.sessions ?? [];
  } catch {
    sessions = service.listSessions(limit);
  }
  if (wantsJson) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log("No review sessions recorded.");
    return;
  }
  for (const s of sessions) {
    console.log("  " + s.sessionId + " [" + (s.gate ?? "FAIL") + "] " + s.mode + " (rev " + String(s.revision) + ") — " + s.createdAt);
  }
}

async function handleSingleSession(id: string, argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const args = [...argv];
  const wantsJson = takeFlag(args, "--json");
  rejectArgs(args, USAGE);
  const service = getCodeReviewService();
  let data: { session: ReviewSessionRecord; gate: unknown; findings: ReviewFinding[] } | null = null;
  try {
    data = (await runtimeRequest("/api/agent-os/code-review/sessions/" + id, {}, deps)) as typeof data;
  } catch {
    const session = service.getSession(id);
    if (session) {
      data = {
        session,
        gate: service.loadGate(id),
        findings: service.listFindings(id),
      };
    }
  }
  if (!data || !data.session) {
    throw new CliUsageError("no such review session: " + id);
  }
  if (wantsJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log("Review Session " + data.session.sessionId);
  console.log("  Repository: " + data.session.repositoryPath);
  console.log("  Mode:       " + data.session.mode);
  console.log("  Gate:       " + (data.session.gate ?? "NONE"));
  console.log("  Revision:   " + String(data.session.revision));
  console.log("  Findings:   " + String(data.findings.length));
  for (const f of data.findings) {
    console.log("    [" + f.severity + "] " + f.location.path + ":" + String(f.location.startLine) + " " + f.title);
  }
}

export async function runReviewCommand(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const head = argv[0];
  if (head === "status") {
    await handleStatus(argv.slice(1), deps);
    return;
  }
  if (head === "sessions") {
    await handleSessions(argv.slice(1), deps);
    return;
  }
  if (head === "session") {
    const id = argv[1];
    if (!id || id.startsWith("-")) {
      throw new CliUsageError("session requires a session ID\n\n" + USAGE);
    }
    await handleSingleSession(id, argv.slice(2), deps);
    return;
  }
  await runOrPreview(argv, deps);
}

export async function handleReview(argv: string[], deps: RuntimeApiDeps = {}): Promise<number> {
  return runCliAction(() => runReviewCommand(argv, deps));
}
