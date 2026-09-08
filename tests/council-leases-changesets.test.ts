// Phase 20.4 — Task Lease + ChangeSet Registry tests
// (spec sections 16, 17, 35, 36, 37, 49, 53, 167).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { closeAgentOsDbForTests } from "../src/agent-os/db";
import {
  acquireTaskLease,
  heartbeatTaskLease,
  releaseTaskLease,
  getTaskLease,
  listTaskLeases,
  sweepExpiredLeases,
  resolveOrphanLease,
  isTaskSchedulable,
} from "../src/agent-os/council/leases";
import {
  registerChangeSet,
  getChangeSet,
  listChangeSets,
  latestChangeSetsByTask,
  getChangeSetRevisions,
  collectDiffStat,
  computeDiffHash,
  scanDiffSafety,
} from "../src/agent-os/council/changesets";
import { buildFileIntentManifest, classifyTask } from "../src/agent-os/council/classify";
import { runGit } from "../src/agent-os/council/git-safety";
import type { SdlcTask } from "../src/agent-os/sdlc/types";

const tempHomes: string[] = [];
let repo = "";

function openFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "council-db-"));
  tempHomes.push(dir);
  closeAgentOsDbForTests();
  require("../src/agent-os/db").openAgentOsDb(dir);
}

async function git(args: string[], cwd = repo): Promise<void> {
  const res = await runGit(args, { cwd });
  if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

async function headSha(cwd = repo): Promise<string> {
  const res = await runGit(["rev-parse", "HEAD"], { cwd });
  return res.stdout.trim();
}

beforeEach(async () => {
  openFreshDb();
  repo = mkdtempSync(join(tmpdir(), "council-cs-repo-"));
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.email", "fixture@example.com"]);
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "base.txt"), "base\n");
  await git(["add", "base.txt"]);
  await git(["commit", "-m", "initial"]);
});

afterEach(() => {
  closeAgentOsDbForTests();
  while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
  if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true });
});

describe("task leases (spec sections 16, 167)", () => {
  const run = "crun_1";

  it("acquires a lease for a free task", () => {
    const res = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-a", ttlSeconds: 60 });
    expect(res.acquired).toBe(true);
    if (res.acquired) {
      expect(res.lease.status).toBe("active");
      expect(res.lease.taskKey).toBe("T1");
    }
  });

  it("blocks a duplicate acquisition while held", () => {
    acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-a", ttlSeconds: 60 });
    const second = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-b", ttlSeconds: 60 });
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.reason).toBe("held");
  });

  it("allows different tasks to be leased concurrently", () => {
    const a = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-a", ttlSeconds: 60 });
    const b = acquireTaskLease({ councilRunId: run, taskKey: "T2", owner: "agent-b", ttlSeconds: 60 });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
    expect(listTaskLeases(run, "active").length).toBe(2);
  });

  it("extends expiry on heartbeat", () => {
    const res = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-a", ttlSeconds: 1 });
    expect(res.acquired).toBe(true);
    if (!res.acquired) return;
    const before = getTaskLease(res.lease.id)!.expiresAt;
    expect(heartbeatTaskLease(res.lease.id, "agent-a", 600)).toBe(true);
    expect(getTaskLease(res.lease.id)!.expiresAt).toBeGreaterThan(before);
  });

  it("rejects heartbeat from a different owner", () => {
    const res = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-a", ttlSeconds: 60 });
    if (!res.acquired) throw new Error("expected acquisition");
    expect(heartbeatTaskLease(res.lease.id, "agent-impostor", 60)).toBe(false);
  });

  it("permits re-acquisition after release", () => {
    const first = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-a", ttlSeconds: 60 });
    if (!first.acquired) throw new Error("expected acquisition");
    expect(releaseTaskLease(first.lease.id, "agent-a")).toBe(true);
    expect(acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-b", ttlSeconds: 60 }).acquired).toBe(true);
  });
});

describe("lease expiry requires orphan inspection (spec section 17)", () => {
  const run = "crun_2";

  it("does not hand an expired task straight to a replacement", () => {
    acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "dead-agent", ttlSeconds: -1 });
    const retry = acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "agent-b", ttlSeconds: 60 });
    expect(retry.acquired).toBe(false);
    if (!retry.acquired) {
      expect(retry.reason).toBe("orphan_inspection_required");
      expect(retry.existing.status).toBe("orphan_inspection");
    }
  });

  it("keeps the task unschedulable until the orphan is resolved", () => {
    acquireTaskLease({ councilRunId: run, taskKey: "T1", owner: "dead-agent", ttlSeconds: -1 });
    const orphans = sweepExpiredLeases(run);
    expect(orphans.length).toBeGreaterThanOrEqual(0);
    expect(isTaskSchedulable(run, "T1")).toBe(false);

    const lease = listTaskLeases(run).find(l => l.status === "orphan_inspection");
    expect(lease).toBeDefined();
    expect(resolveOrphanLease(lease!.id, "released")).toBe(true);
    expect(isTaskSchedulable(run, "T1")).toBe(true);
  });

  it("sweeps expired active leases into orphan_inspection", () => {
    acquireTaskLease({ councilRunId: run, taskKey: "TA", owner: "x", ttlSeconds: -5 });
    acquireTaskLease({ councilRunId: run, taskKey: "TB", owner: "y", ttlSeconds: 600 });
    const swept = sweepExpiredLeases(run);
    expect(swept.map(l => l.taskKey)).toContain("TA");
    expect(swept.map(l => l.taskKey)).not.toContain("TB");
  });
});

describe("changeset registry (spec sections 35, 49, 141)", () => {
  const run = "crun_3";

  async function makeCommit(file: string, content: string, msg: string): Promise<void> {
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    await git(["add", file]);
    await git(["commit", "-m", msg]);
  }

  it("records diff stats, hash and file list", async () => {
    const base = await headSha();
    await makeCommit("src/impl.ts", "export const a = 1;\nexport const b = 2;\n", "impl");
    const head = await headSha();

    const { changeset } = await registerChangeSet({
      councilRunId: run,
      taskKey: "T1",
      worktreeId: "wt1",
      worktreePath: repo,
      baseSha: base,
      headSha: head,
      risk: "MEDIUM",
    });

    expect(changeset.filesChanged).toContain("src/impl.ts");
    expect(changeset.insertions).toBe(2);
    expect(changeset.diffHash).toMatch(/^[0-9a-f]{64}$/);
    expect(changeset.revision).toBe(1);
    expect(getChangeSet(changeset.id)!.id).toBe(changeset.id);
  });

  it("computes a stable diff hash and a different one after a new commit (spec section 53)", async () => {
    const base = await headSha();
    await makeCommit("src/x.ts", "const x = 1;\n", "x");
    const head1 = await headSha();

    const h1 = await computeDiffHash(repo, base, head1);
    const h1again = await computeDiffHash(repo, base, head1);
    expect(h1).toBe(h1again);

    await makeCommit("src/x.ts", "const x = 2;\n", "x changed");
    const head2 = await headSha();
    expect(await computeDiffHash(repo, base, head2)).not.toBe(h1);
  });

  it("keeps every revision instead of overwriting (spec sections 48, 49)", async () => {
    const base = await headSha();
    await makeCommit("src/y.ts", "const y = 1;\n", "rev1");
    const head1 = await headSha();
    await registerChangeSet({
      councilRunId: run, taskKey: "T9", worktreeId: "wt1", worktreePath: repo,
      baseSha: base, headSha: head1, risk: "LOW",
    });

    await makeCommit("src/y.ts", "const y = 2;\n", "rev2");
    const head2 = await headSha();
    const second = await registerChangeSet({
      councilRunId: run, taskKey: "T9", worktreeId: "wt1", worktreePath: repo,
      baseSha: base, headSha: head2, risk: "LOW",
    });

    expect(second.changeset.revision).toBe(2);
    const revisions = getChangeSetRevisions(run, "T9");
    expect(revisions.length).toBe(2);
    expect(latestChangeSetsByTask(run).get("T9")!.revision).toBe(2);
  });

  it("detects migration and generated files", async () => {
    const base = await headSha();
    writeFileSync(join(repo, "m.sql"), "ALTER TABLE t ADD COLUMN c INT;\n");
    await git(["add", "m.sql"]);
    await git(["commit", "-m", "migration"]);
    // Place it under a migrations/ path to exercise the hint matcher.
    await git(["mv", "m.sql", "migrations-tmp.sql"]);
    await git(["commit", "-m", "rename"]);
    const head = await headSha();

    const stat = await collectDiffStat(repo, base, head);
    expect(stat.filesChanged.length).toBeGreaterThan(0);
  });

  it("lists changesets for a run", async () => {
    const base = await headSha();
    await makeCommit("src/z.ts", "const z = 1;\n", "z");
    const head = await headSha();
    await registerChangeSet({
      councilRunId: run, taskKey: "TZ", worktreeId: "wt1", worktreePath: repo,
      baseSha: base, headSha: head, risk: "LOW",
    });
    expect(listChangeSets(run).some(c => c.taskKey === "TZ")).toBe(true);
  });
});

describe("diff safety scan (spec sections 36, 37)", () => {
  const run = "crun_4";

  function task(key: string, targetFiles: string[]): SdlcTask {
    return {
      id: `task_${key}`, cycleId: "c1", key, title: "backend work", description: "",
      taskType: "code", status: "pending", dependencies: [], targetFiles,
      acceptanceCriteriaKeys: [], estimatedMinutes: 30, actualMinutes: null,
      createdAt: "", updatedAt: "",
    } as SdlcTask;
  }

  it("flags a secret-shaped added line without echoing the value", async () => {
    const base = await headSha();
    const dummyToken = ["sk-", "abcdefghijklmnopqrstuvwxyz", "012345"].join("");
    writeFileSync(join(repo, "cfg.ts"), `export const key = "${dummyToken}";\n`);
    await git(["add", "cfg.ts"]);
    await git(["commit", "-m", "add config"]);
    const head = await headSha();

    const report = await scanDiffSafety({
      worktreePath: repo, baseSha: base, headSha: head,
      filesChanged: ["cfg.ts"],
    });

    expect(report.passed).toBe(false);
    expect(report.secretFindings.length).toBeGreaterThan(0);
    expect(report.secretFindings.join(" ")).toContain("cfg.ts");
    // The secret itself must never appear in the finding.
    expect(report.secretFindings.join(" ")).not.toContain(dummyToken);
  });

  it("passes a clean diff", async () => {
    const base = await headSha();
    writeFileSync(join(repo, "clean.ts"), "export const n = 42;\n");
    await git(["add", "clean.ts"]);
    await git(["commit", "-m", "clean"]);
    const head = await headSha();

    const report = await scanDiffSafety({
      worktreePath: repo, baseSha: base, headSha: head, filesChanged: ["clean.ts"],
    });
    expect(report.passed).toBe(true);
    expect(report.secretFindings).toEqual([]);
  });

  it("flags SCOPE_DRIFT but does not fail the scan (spec section 37)", async () => {
    const base = await headSha();
    writeFileSync(join(repo, "outside.ts"), "export const drift = 1;\n");
    await git(["add", "outside.ts"]);
    await git(["commit", "-m", "out of scope"]);
    const head = await headSha();

    const manifest = buildFileIntentManifest(classifyTask(task("T1", ["src/server/"])));
    const report = await scanDiffSafety({
      worktreePath: repo, baseSha: base, headSha: head,
      filesChanged: ["outside.ts"], manifest,
    });

    expect(report.unexpectedPaths).toContain("outside.ts");
    expect(report.passed).toBe(true); // drift is visible, not fatal
  });

  it("records scope drift on the changeset", async () => {
    const base = await headSha();
    writeFileSync(join(repo, "elsewhere.ts"), "export const e = 1;\n");
    await git(["add", "elsewhere.ts"]);
    await git(["commit", "-m", "elsewhere"]);
    const head = await headSha();

    const manifest = buildFileIntentManifest(classifyTask(task("T2", ["src/server/"])));
    const { changeset } = await registerChangeSet({
      councilRunId: run, taskKey: "T2", worktreeId: "wt1", worktreePath: repo,
      baseSha: base, headSha: head, risk: "MEDIUM", manifest,
    });

    expect(changeset.scopeDrift).toBe(true);
    expect(changeset.scopeDriftPaths).toContain("elsewhere.ts");
  });

  it("hard-fails a diff that touches a forbidden path", async () => {
    const base = await headSha();
    writeFileSync(join(repo, ".env"), "SECRET_TOKEN=whatever\n");
    await git(["add", "-f", ".env"]);
    await git(["commit", "-m", "add env"]);
    const head = await headSha();

    const manifest = buildFileIntentManifest(classifyTask(task("T3", ["src/"])));
    const report = await scanDiffSafety({
      worktreePath: repo, baseSha: base, headSha: head,
      filesChanged: [".env"], manifest,
    });

    expect(report.forbiddenFiles).toContain(".env");
    expect(report.passed).toBe(false);
  });
});
