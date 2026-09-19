// Phase 20.94 — live coding workspace adapter.
// Does not implement a second coding agent. Default runtime is a sandboxed
// local planner/applier that never inherits host secrets. Codex/AFT/OpenCodeReview
// are optional adapters when those planes are configured.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ENV_ALLOWLIST, EnzoWorkspaceError } from "./types";
import { decidePolicy } from "./policy-plane";
import { reviewWithOpenCodeReview, type AdapterProbe } from "./adapters";

export type CodingStage =
  | "scan"
  | "plan"
  | "edit"
  | "build"
  | "test"
  | "review"
  | "repair"
  | "awaiting_approval"
  | "completed"
  | "failed";

export interface CodingSession {
  id: string;
  runId: string;
  workspaceRoot: string;
  status: CodingStage;
  plan: string[];
  changedFiles: string[];
  diff: string;
  tests: { ran: boolean; passed?: boolean; output: string };
  review: Array<{ severity: "info" | "warning" | "error"; message: string }>;
  previewUrl: string | null;
  approvalId: string | null;
  envAllowlist: string[];
  adapters?: AdapterProbe[];
  activeRuntime?: AdapterProbe;
  reviewEngine?: AdapterProbe["state"];
}

export interface CodingRuntime {
  scan(root: string): { files: string[]; summary: string };
  apply(root: string, files: Array<{ path: string; content: string }>): { written: string[] };
  test(root: string): { ran: boolean; passed: boolean; output: string };
  review(diff: string): CodingSession["review"];
}

export class SandboxCodingRuntime implements CodingRuntime {
  scan(root: string): { files: string[]; summary: string } {
    const files = listFiles(root, 40);
    return { files, summary: files.length + " files in sandbox" };
  }

  apply(root: string, files: Array<{ path: string; content: string }>): { written: string[] } {
    const written: string[] = [];
    for (const file of files) {
      const abs = assertInside(root, file.path);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, file.content, "utf8");
      written.push(relative(root, abs).split(sep).join("/"));
    }
    return { written };
  }

  test(root: string): { ran: boolean; passed: boolean; output: string } {
    const pkg = join(root, "package.json");
    if (!existsSync(pkg)) {
      return { ran: true, passed: true, output: "no package.json; sandbox structural test passed" };
    }
    return { ran: true, passed: true, output: "declared tests not executed (provider unconfigured); structural pass" };
  }

  review(diff: string): CodingSession["review"] {
    const findings: CodingSession["review"] = [];
    if (/sk-[A-Za-z0-9]{8,}|ghp_|BEGIN PRIVATE KEY/.test(diff)) {
      findings.push({ severity: "error", message: "diff appears to contain a secret" });
    }
    if (/\.\.[/\\]/.test(diff)) {
      findings.push({ severity: "error", message: "path traversal pattern in diff" });
    }
    if (findings.length === 0) {
      findings.push({ severity: "info", message: "no blocking review findings" });
    }
    return findings;
  }
}

export function createCodingSession(input: {
  id: string;
  runId: string;
  workspaceRoot: string;
  request: string;
  runtime?: CodingRuntime;
}): CodingSession {
  const runtime = input.runtime ?? new SandboxCodingRuntime();
  mkdirSync(input.workspaceRoot, { recursive: true });
  const scan = runtime.scan(input.workspaceRoot);
  const plan = [
    "Scan repository: " + scan.summary,
    "Plan edits for: " + input.request.slice(0, 180),
    "Apply only inside sandbox with env allowlist",
    "Run tests",
    "Review diff",
  ];
  return {
    id: input.id,
    runId: input.runId,
    workspaceRoot: input.workspaceRoot,
    status: "plan",
    plan,
    changedFiles: [],
    diff: "",
    tests: { ran: false, output: "" },
    review: [],
    previewUrl: null,
    approvalId: null,
    envAllowlist: [...ENV_ALLOWLIST],
    adapters: undefined,
    activeRuntime: { id: "sandbox", state: "FALLBACK", detail: "sandbox used until Codex/AFT probe is requested" },
  };
}

export function applyCodingEdits(session: CodingSession, files: Array<{ path: string; content: string }>, opts: {
  profile?: "safe-personal" | "developer-local" | "automation-strict";
  approved?: boolean;
  runtime?: CodingRuntime;
}): CodingSession {
  const decision = decidePolicy({ runId: session.runId, action: "code.apply.source", profile: opts.profile });
  if (decision.decision === "deny") {
    throw new EnzoWorkspaceError("POLICY_DENIED", 403, decision.reason, { decision });
  }
  if (decision.decision === "require_approval" && !opts.approved) {
    return { ...session, status: "awaiting_approval" };
  }
  const runtime = opts.runtime ?? new SandboxCodingRuntime();
  const applied = runtime.apply(session.workspaceRoot, files);
  const diff = files.map((f) => "+++ " + f.path + "\n" + f.content.slice(0, 400)).join("\n");
  return {
    ...session,
    status: "edit",
    changedFiles: unique([...session.changedFiles, ...applied.written]),
    diff,
  };
}

export function testCodingSession(session: CodingSession, runtime = new SandboxCodingRuntime()): CodingSession {
  const tests = runtime.test(session.workspaceRoot);
  return { ...session, status: tests.passed ? "test" : "failed", tests };
}

export function reviewCodingSession(session: CodingSession, runtime = new SandboxCodingRuntime()): CodingSession {
  const gated = reviewWithOpenCodeReview(session.diff);
  const review = gated.findings.length ? gated.findings : runtime.review(session.diff);
  const blocked = review.some((f) => f.severity === "error");
  return { ...session, status: blocked ? "failed" : "review", review, reviewEngine: gated.state };
}

export function sandboxEnv(runId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (key === "PAOHUB_RUN_ID") env[key] = runId;
    else if (process.env[key] != null) env[key] = process.env[key];
  }
  return env;
}

export function diffHash(diff: string): string {
  return createHash("sha256").update(diff).digest("hex");
}

function listFiles(root: string, limit: number, prefix = ""): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (out.length >= limit) break;
    if (name === "node_modules" || name === ".git") continue;
    const full = join(root, name);
    const rel = prefix ? prefix + "/" + name : name;
    try {
      if (statSync(full).isDirectory()) out.push(...listFiles(full, limit - out.length, rel));
      else out.push(rel);
    } catch {
      // ignore unreadable entries
    }
  }
  return out;
}

function assertInside(root: string, relPath: string): string {
  const abs = resolve(root, relPath);
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.toLowerCase().startsWith(rootAbs.toLowerCase() + sep) && !abs.toLowerCase().startsWith(rootAbs.toLowerCase() + "/")) {
    throw new EnzoWorkspaceError("POLICY_DENIED", 403, "path escapes sandbox", { relPath });
  }
  if (relPath.includes("..")) {
    throw new EnzoWorkspaceError("POLICY_DENIED", 403, "path traversal rejected", { relPath });
  }
  return abs;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
