// GOLD slice #1 — deterministic code review runtime tests.
//
// Exercises the real path end-to-end: a temporary git repository is created,
// changes with known defects are staged, and the service must select,
// anchor, normalize, and gate them without any LLM involvement.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { addedLinesWithAnchors, parseUnifiedDiff } from "../src/agent-os/code-review/diff-parser";
import { evaluateGate } from "../src/agent-os/code-review/engine";
import { assertSafeRef } from "../src/agent-os/code-review/capture";
import { getCodeReviewService } from "../src/agent-os/code-review/service";
import type { ReviewFinding, ReviewSessionRecord } from "../src/agent-os/code-review/types";
import type { DelegatedReviewInput, ReviewProvider } from "../src/agent-os/code-review/reviewer";

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repo].concat(args), {
    encoding: "utf-8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git command failed");
  }
  return result.stdout;
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "code-review-test-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "tester@example.test"]);
  git(repo, ["config", "user.name", "tester"]);
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "base"]);
  return repo;
}

function stageChanges(repo: string): void {
  // A credential-shaped token built at runtime (never a real-looking literal).
  const fakeToken = "sk-" + "a".repeat(24);
  mkdirSync(join(repo, "src", "auth"), { recursive: true });
  writeFileSync(join(repo, "src", "auth", "token.ts"), [
    "export const CLIENT_TOKEN = " + JSON.stringify(fakeToken) + ";",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "src", "notes.txt"), [
    "notes",
    "<<<<<<< HEAD",
    "conflicted",
    ">>>>>>> branch",
    "",
  ].join("\n"));
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "on: push\n");
  git(repo, ["add", "."]);
}

describe("deterministic review parser", () => {
  test("anchors added lines to their true new-file line numbers", () => {
    const diffText = [
      "diff --git a/src/a.ts b/src/a.ts",
      "new file mode 100644",
      "+++ b/src/a.ts",
      "@@ -0,0 +1,3 @@",
      "+first",
      "+second",
      "+third",
    ].join("\n");
    const files = parseUnifiedDiff(diffText);
    expect(files).toHaveLength(1);
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.addedLines).toBe(3);
    const anchored = addedLinesWithAnchors(files[0]!);
    expect(anchored.map((a) => a.line)).toEqual([1, 2, 3]);
    expect(anchored[1]!.text).toBe("second");
  });

  test("context lines advance the counter and deletions do not", () => {
    const diffText = [
      "diff --git a/src/b.ts b/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-removed",
      "+added-after-delete",
      "+second-added",
    ].join("\n");
    const files = parseUnifiedDiff(diffText);
    const anchored = addedLinesWithAnchors(files[0]!);
    expect(anchored.map((a) => a.line)).toEqual([2, 3]);
  });
});

describe("deterministic quality gate", () => {
  test("fail-closed order: block beats require_fix beats human_approval beats warn", () => {
    const finding = (severity: ReviewFinding["severity"]): ReviewFinding => ({
      findingId: "f",
      sessionId: "s",
      unitId: "u",
      source: "deterministic",
      location: { path: "x", startLine: 1, endLine: 1 },
      category: "security",
      severity,
      confidence: 0.9,
      title: "t",
      description: "d",
      evidence: "e",
      status: "verified",
    });
    expect(evaluateGate([], false).gate).toBe("PASS");
    expect(evaluateGate([finding("MEDIUM")], false).gate).toBe("WARN");
    expect(evaluateGate([], true).gate).toBe("HUMAN_APPROVAL");
    expect(evaluateGate([finding("HIGH")], true).gate).toBe("REQUIRE_FIX");
    expect(evaluateGate([finding("CRITICAL")], false).gate).toBe("BLOCK");
    expect(evaluateGate([finding("CRITICAL")], true).gate).toBe("BLOCK");
  });
});

describe("safe ref validation", () => {
  test("rejects option injection and separators", () => {
    expect(() => assertSafeRef("-upload-pack", "from")).toThrow();
    expect(() => assertSafeRef("main..evil", "from")).toThrow();
    expect(() => assertSafeRef("a b", "from")).toThrow();
    expect(assertSafeRef("feature/agent-router", "to")).toBe("feature/agent-router");
  });
});

describe("end-to-end review over a real git repository", () => {
  const repo = makeRepo();
  stageChanges(repo);
  const service = getCodeReviewService();

  test("preview selects files and reports protected paths without any model call", async () => {
    const preview = await service.preview({ repositoryPath: repo, mode: "workspace", requestedBy: "test" });
    expect(preview.filesChanged).toBe(3);
    expect(preview.filesSelected).toBe(3);
    expect(preview.protectedPathChanged).toBe(true);
    expect(preview.risk).toBe("high");
    expect(preview.requiredReviewers).toContain("security");
    expect(preview.reviewUnits).toBeGreaterThanOrEqual(2);
  });

  test("review finds the credential and conflict marker and gates REQUIRE_FIX", async () => {
    const result = await service.runReview({ repositoryPath: repo, mode: "workspace", requestedBy: "test" });
    expect(result.reused).toBe(false);
    expect(result.session.status).toBe("completed");
    expect(result.session.policyVersion).toBe("20.81-slice1");
    expect(result.session.ruleHash).not.toBe("");
    const severities = result.findings.map((f) => f.severity);
    expect(severities).toContain("HIGH");
    const credential = result.findings.find((f) => f.subcategory === "credential");
    expect(credential).toBeDefined();
    expect(credential!.location.path).toBe("src/auth/token.ts");
    expect(credential!.location.startLine).toBe(1);
    expect(credential!.evidence).toContain("CLIENT_TOKEN");
    expect(result.findings.some((f) => f.subcategory === "merge-conflict")).toBe(true);
    expect(result.gate.gate).toBe("REQUIRE_FIX");
    expect(result.gate.counts.high).toBeGreaterThanOrEqual(1);
  });

  test("re-reviewing an identical diff reuses the session (idempotency)", async () => {
    const result = await service.runReview({ repositoryPath: repo, mode: "workspace", requestedBy: "test" });
    expect(result.reused).toBe(true);
    const sessions = service.listSessions(5);
    const matching = sessions.filter((s) => s.repositoryPath === result.session.repositoryPath && s.status === "completed");
    expect(matching).toHaveLength(1);
  });

  test("invalid refs are rejected before git runs", async () => {
    await expect(service.runReview({
      repositoryPath: repo,
      mode: "range",
      from: "-upload-pack",
      to: "main",
      requestedBy: "test",
    })).rejects.toThrow("safe-ref shape");
  });

  test("E2E-3: finding → fix → re-review → PASS with revision lineage", async () => {
    const loopRepo = makeRepo();
    try {
      const fakeToken = "sk-" + "b".repeat(24);
      writeFileSync(join(loopRepo, "leak.ts"), "export const K = " + JSON.stringify(fakeToken) + ";\n");
      git(loopRepo, ["add", "."]);

      const r1 = await service.runReview({ repositoryPath: loopRepo, mode: "workspace", requestedBy: "test" });
      expect(r1.reused).toBe(false);
      expect(r1.session.revision).toBe(1);
      expect(r1.session.parentSessionId).toBeNull();
      expect(r1.gate.gate).toBe("REQUIRE_FIX");

      // The fix: remove the leaked credential entirely.
      writeFileSync(join(loopRepo, "leak.ts"), "export const K = readFromSecretBroker();\n");
      git(loopRepo, ["add", "."]);

      const r2 = await service.runReview({ repositoryPath: loopRepo, mode: "workspace", requestedBy: "test" });
      expect(r2.reused).toBe(false);
      expect(r2.session.revision).toBe(2);
      expect(r2.session.parentSessionId).toBe(r1.session.sessionId);
      expect(r2.gate.gate).toBe("PASS");
      expect(r2.findings).toHaveLength(0);
    } finally {
      rmSync(loopRepo, { recursive: true, force: true });
    }
  });

  test("delegation merges provider findings; weak CRITICAL claims stay needs_context", async () => {
    const fakeToken = "sk-" + "c".repeat(24);
    writeFileSync(join(repo, "src", "extra.ts"), "export const T = " + JSON.stringify(fakeToken) + ";\n");
    git(repo, ["add", "."]);
    const seen: DelegatedReviewInput[] = [];
    const provider: ReviewProvider = {
      id: "stub",
      available: async () => true,
      review: async (input) => {
        seen.push(input);
        return {
          reviewer: "stub-model",
          findings: [
            {
              path: "src/extra.ts",
              startLine: 1,
              endLine: 1,
              severity: "HIGH",
              confidence: 0.9,
              title: "Hardcoded client token",
              description: "Token literal assigned to an export.",
              evidence: "const T = ...",
              category: "security",
            },
            {
              path: "src/extra.ts",
              startLine: 1,
              endLine: 1,
              severity: "CRITICAL",
              confidence: 0.5,
              title: "Uncorroborated critical claim",
              description: "Low-confidence claim must not harden the gate.",
              category: "security",
            },
          ],
          notes: "stub",
        };
      },
    };
    service.registerReviewProvider(provider);

    const result = await service.runReview({ repositoryPath: repo, mode: "workspace", requestedBy: "test", delegate: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.units.length).toBeGreaterThan(0);
    expect(seen[0]!.excerpts.every((e) => e.diff.length <= 8_000)).toBe(true);
    expect(result.session.delegatedFindings).toBe(2);
    const delegated = result.findings.filter((f) => f.source === "delegated");
    expect(delegated).toHaveLength(2);
    expect(delegated.find((f) => f.severity === "HIGH")!.status).toBe("verified");
    expect(delegated.find((f) => f.severity === "CRITICAL")!.status).toBe("needs_context");
    // The corroborated HIGH already forces REQUIRE_FIX; the weak CRITICAL
    // claim must not harden the gate to BLOCK on its own.
    expect(result.gate.gate).toBe("REQUIRE_FIX");
    expect(result.gate.counts.critical).toBe(0);

    // Delegation without an available provider degrades to deterministic-only.
    // Changing the diff bypasses the idempotency cache so a fresh review runs.
    const fakeToken2 = "sk-" + "d".repeat(24);
    writeFileSync(join(repo, "src", "extra2.ts"), "export const T2 = " + JSON.stringify(fakeToken2) + ";\n");
    git(repo, ["add", "."]);
    service.registerReviewProvider({ id: "off", available: async () => false, review: async () => ({ reviewer: "off", findings: [] }) });
    const deterministicOnly = await service.runReview({ repositoryPath: repo, mode: "workspace", requestedBy: "test", delegate: true });
    expect(deterministicOnly.session.delegatedFindings).toBe(0);
  });

  afterAll(() => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {
      // Windows temp cleanup races are tolerated; the OS cleans tmp.
    }
  });
});
