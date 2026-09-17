// Unit and contract tests for the `ocx review` CLI command
// (Phase 20.81 blueprint §48-50; GOLD slice #3).
//
// Tests CLI parsing, local-transport execution, usage errors, and
// preview output without requiring a running proxy.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { handleReview, USAGE } from "../src/cli/review";
import { findCommand } from "../src/cli/registry";

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repo].concat(args), {
    encoding: "utf-8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr || "git failed");
  return result.stdout;
}

function makeTestRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ocx-review-cli-test-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "tester@example.test"]);
  git(repo, ["config", "user.name", "tester"]);
  writeFileSync(join(repo, "README.md"), "initial content\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "init"]);
  return repo;
}

describe("ocx review CLI surface", () => {
  test("registered in CLI command registry with summary and details", () => {
    const entry = findCommand("review");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("review");
    expect(entry!.summary).toContain("Phase 20.81");
    expect(entry!.details && entry!.details.length > 0).toBe(true);
  });

  test("status subcommand returns code review engine metadata", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const code = await handleReview(["status", "--json"], {});
      expect(code).toBe(0);
      const parsed = JSON.parse(logs.join("\n")) as { engine?: string };
      expect(parsed.engine).toBe("pao-deterministic-review");
    } finally {
      console.log = origLog;
    }
  });

  test("preview subcommand reports changed files without invoking a model", async () => {
    const repo = makeTestRepo();
    try {
      writeFileSync(join(repo, "new-file.ts"), "export const x = 1;\n");
      git(repo, ["add", "."]);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      try {
        const code = await handleReview(["--repo", repo, "--preview", "--json"], {});
        expect(code).toBe(0);
        const parsed = JSON.parse(logs.join("\n")) as { filesChanged?: number; mode?: string };
        expect(parsed.mode).toBe("workspace");
        expect(parsed.filesChanged).toBe(1);
      } finally {
        console.log = origLog;
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("range review without both --from and --to rejects with usage error", async () => {
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    try {
      const code = await handleReview(["--from", "main"], {});
      expect(code).toBe(2);
      expect(errors.join("\n")).toContain("range review requires both --from and --to");
    } finally {
      console.error = origError;
    }
  });

  test("nonexistent repository path rejects with usage error", async () => {
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    try {
      const code = await handleReview(["--repo", join(tmpdir(), "nonexistent-" + randomUUID().slice(0, 8))], {});
      expect(code).toBe(2);
      expect(errors.join("\n")).toContain("repository path does not exist");
    } finally {
      console.error = origError;
    }
  });

  test("sessions list reports recorded sessions as JSON", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const code = await handleReview(["sessions", "--json"], {});
      expect(code).toBe(0);
      const parsed = JSON.parse(logs.join("\n"));
      expect(Array.isArray(parsed)).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});
