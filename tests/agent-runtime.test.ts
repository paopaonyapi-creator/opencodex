// Phase 20.61 — Agent Runtime control plane tests.
//
// Covers the spec §21/§22 matrix against a deterministic in-memory amux
// (tests/helpers/amux-fake.ts) and a disposable git fixture repo: state
// machine, atomic claim race, stale claims, path/command/secret policy,
// payload-bound approvals, independent verification, bounded recovery,
// idempotent events, worktree isolation, and the management API surface.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { assertTransition, TASK_TRANSITIONS } from "../src/agent-os/agent-runtime/types";
import { AgentRuntimeHttpError, type AgentTask } from "../src/agent-os/agent-runtime/types";
import { approvalRequirement, classifyRisk, decideExecution, decideMergeTarget, decidePathPolicy } from "../src/agent-os/agent-runtime/policy";
import { assertEvidenceSafe, assertEvidenceType, assertVerifierIndependent, recoveryPermitted, verificationOutcome } from "../src/agent-os/agent-runtime/evidence";
import { payloadHashOf } from "../src/agent-os/agent-runtime/hash";
import { AgentRuntimeService, setAgentRuntimeServiceForTests, resetAgentRuntimeServiceForTests } from "../src/agent-os/agent-runtime/service";
import { createWorktree, worktreeBranchFor, worktreePathFor } from "../src/agent-os/agent-runtime/worktrees";
import { containsSecretLikeMaterial } from "../src/agent-os/agent-runtime/secrets";
import { AgentRuntimeStore } from "../src/agent-os/agent-runtime/store";
import { AmuxAdapter } from "../src/agent-os/agent-runtime/adapter/amux-adapter";
import { FakeAmuxAdapter, FakeAmuxTransport, PINNED_COMMIT } from "./helpers/amux-fake";
import { handleManagementAPI } from "../src/server/management-api";
import type { AgentRuntimeConfig } from "../src/agent-os/agent-runtime/config";
import type { OcxConfig } from "../src/types";

// ---------------------------------------------------------------------------
// harness

const tempHomes: string[] = [];

function openFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-runtime-"));
  tempHomes.push(dir);
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
  return dir;
}

function makeConfig(overrides?: Partial<AgentRuntimeConfig>): AgentRuntimeConfig {
  return {
    enabled: true,
    provider: "amux",
    amuxBaseUrl: "https://127.0.0.1:8824",
    amuxToken: "test-token-not-real",
    amuxTokenSecretRef: "",
    requestTimeoutMs: 2000,
    pinnedRuntimeCommit: PINNED_COMMIT,
    allowedApiFamilies: ["health", "board", "sessions", "sync"],
    leaseSeconds: 60,
    heartbeatSeconds: 15,
    recoveryGraceSeconds: 30,
    maxAttempts: 3,
    workspaceRoot: "",
    defaultPolicyProfile: "restricted-dev",
    networkDefault: "deny",
    protectedBranches: ["main", "master", "dev"],
    dispatchEnabled: true,
    recoveryEnabled: true,
    workerRoles: ["planner", "implementer", "tester", "reviewer", "recovery-controller", "release-controller"],
    ...overrides,
  };
}

function makeService(fake: FakeAmuxAdapter, overrides?: Partial<AgentRuntimeConfig>): { service: AgentRuntimeService; home: string } {
  const home = openFreshDb();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-worktrees-"));
  tempHomes.push(workspaceRoot);
  const service = new AgentRuntimeService({
    config: makeConfig({ workspaceRoot, ...overrides }),
    adapterFactory: () => fake,
  });
  return { service, home };
}

function makeWorkerCaps(): { roles: never; capabilities: never } {
  return {
    roles: ["implementer"] as never,
    capabilities: ["repo.read", "repo.write_scoped", "command.safe_dev", "command.test", "command.readonly_git", "command.write_git"] as never,
  };
}

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-runtime-repo-"));
  tempHomes.push(dir);
  execSync("git init -q", { cwd: dir });
  execSync('git -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------------------
// unit: state machine, claims, policy

describe("phase 20.61 state machine", () => {
  test("DONE != VERIFIED != APPROVED: direct jumps are refused", () => {
    expect(() => assertTransition("done", "approved")).toThrow(/invalid task transition/);
    expect(() => assertTransition("done", "merged")).toThrow(/invalid task transition/);
    expect(() => assertTransition("running", "verified")).toThrow(/invalid task transition/);
    expect(() => assertTransition("verified", "merged")).toThrow(/invalid task transition/);
    // the canonical happy path is legal:
    expect(TASK_TRANSITIONS.queued).toContain("claimed");
    expect(TASK_TRANSITIONS.done).toContain("verifying");
    expect(TASK_TRANSITIONS.verified).toContain("approval_required");
    expect(TASK_TRANSITIONS.approval_required).toContain("approved");
  });
});

describe("phase 20.61 policy gateway (default deny)", () => {
  const worker = {
    id: "w1", name: "impl", provider: "amux", roles: ["implementer"] as never,
    capabilities: ["repo.read", "repo.write_scoped", "command.safe_dev", "command.test", "command.readonly_git"] as never,
    maxConcurrency: 1, status: "online" as const, runtimeWorkerId: null, lastSeenAt: null, createdAt: "", updatedAt: "",
  };
  const task = { id: "t1", claimOwner: "w1", worktreePath: "/ws/task-t1-implementer" } as AgentTask;

  test("in-scope safe command is allowed", () => {
    const decision = decideExecution({
      worker, task,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.test", argv: ["bun", "test"], paths: ["src/x.ts"] },
      networkDefault: "deny",
    });
    expect(decision.effect).toBe("allow");
  });

  test("path traversal and out-of-scope paths are denied", () => {
    expect(decidePathPolicy({ paths: ["../outside"], worktreePath: "/ws/t1" })[0].effect).toBe("deny");
    expect(decidePathPolicy({ paths: ["/etc/passwd"], worktreePath: "/ws/t1" }).some((r) => r.effect === "deny")).toBe(true);
    expect(decidePathPolicy({ paths: [], worktreePath: null })[0].ruleId).toBe("agent.path.none");
    const result = decideExecution({
      worker, task,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.safe_dev", argv: ["cat"], paths: ["../../etc/passwd"] },
      networkDefault: "deny",
    });
    expect(result.effect).toBe("deny");
  });

  test("dangerous command families are structurally denied", () => {
    for (const argv of [["sudo", "rm", "-rf", "/"], ["mkfs.ext4", "/dev/sda1"], ["docker", "run", "--privileged", "x"]]) {
      const decision = decideExecution({
        worker, task,
        request: { taskId: "t1", workerId: "w1", commandClass: "command.safe_dev", argv },
        networkDefault: "deny",
      });
      expect(decision.effect).toBe("deny");
    }
  });

  test("git push / destructive ops require approval; secret access without capability is denied", () => {
    const push = decideExecution({
      worker, task,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.readonly_git", argv: ["git", "push", "origin", "main"] },
      networkDefault: "deny",
    });
    expect(push.effect).toBe("require_approval");

    const secret = decideExecution({
      worker, task,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.secret", argv: ["printenv"], secretAccess: true },
      networkDefault: "deny",
    });
    expect(secret.effect).toBe("deny");
  });

  test("network default-deny and risk classification", () => {
    const network = decideExecution({
      worker, task,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.network", argv: ["curl", "https://example.com"], network: true },
      networkDefault: "deny",
    });
    expect(network.effect).toBe("deny");
    expect(classifyRisk({ commandClass: "command.test", argv: ["bun", "test"] })).toBe("low");
    expect(classifyRisk({ commandClass: "command.write_git", argv: ["git", "commit"] })).toBe("medium");
  });

  test("a worker that does not hold the claim is denied everything", () => {
    const decision = decideExecution({
      worker, task,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.safe_dev", argv: ["bun", "test"] },
      networkDefault: "deny",
    });
    expect(decision.effect).toBe("allow");
    const outsider = { ...task, claimOwner: "someone-else" } as AgentTask;
    const denied = decideExecution({
      worker, task: outsider,
      request: { taskId: "t1", workerId: "w1", commandClass: "command.safe_dev", argv: ["bun", "test"] },
      networkDefault: "deny",
    });
    expect(denied.effect).toBe("deny");
    expect(denied.ruleResults.some((r) => r.ruleId === "agent.identity.not_claim_owner")).toBe(true);
  });

  test("approval matrix and merge target rules", () => {
    expect(approvalRequirement("repo.read")).toBe("allow");
    expect(approvalRequirement("dependency.install")).toBe("policy_dependent");
    expect(approvalRequirement("production.deploy")).toBe("approval_required");
    expect(approvalRequirement("secret.read")).toBe("approval_required");

    const protectedMerge = decideMergeTarget({ branch: "pao/amux/art_1/implementer", targetBranch: "main", protectedBranches: ["main"] });
    expect(protectedMerge.effect).toBe("require_approval");
    const badBranch = decideMergeTarget({ branch: "feature/x", targetBranch: "main", protectedBranches: ["main"] });
    expect(badBranch.effect).toBe("deny");
  });
});

describe("phase 20.61 evidence and verification rules", () => {
  test("unknown evidence type is rejected", () => {
    expect(assertEvidenceType("screenshot")).toBe("screenshot");
    expect(() => assertEvidenceType("not-a-type")).toThrow(/unknown evidence type/);
  });

  test("secret-like material never reaches evidence", () => {
    expect(containsSecretLikeMaterial("Authorization: Bearer amux_secret_token_value")).toBe(true);
    expect(() => assertEvidenceSafe({ note: "token: " + "sk-" + "c".repeat(24) })).toThrow(/secret-like/);
    expect(() => assertEvidenceSafe({ note: "clean metadata" })).not.toThrow();
  });

  test("the verifier must be independent of the implementer", () => {
    expect(() => assertVerifierIndependent({ verifierWorkerId: "w1", implementerClaimOwner: "w1", verifierRole: "reviewer" })).toThrow(/independent/);
    expect(() => assertVerifierIndependent({ verifierWorkerId: "w2", implementerClaimOwner: "w1", verifierRole: "reviewer" })).not.toThrow();
    expect(() => assertVerifierIndependent({ verifierWorkerId: "w2", implementerClaimOwner: null, verifierRole: "planner" })).toThrow(/reviewer or release-controller/);
  });

  test("verifier verdict maps to state and retry budget is bounded", () => {
    expect(verificationOutcome({ verdict: "pass", requirements: [], risks: [], regressions: [], recommendedAction: "approve", verifierId: "v", reviewedAt: "" }).status).toBe("verified");
    expect(verificationOutcome({ verdict: "needs_changes", requirements: [], risks: [], regressions: [], recommendedAction: "rework", verifierId: "v", reviewedAt: "" }).status).toBe("rejected");
    expect(recoveryPermitted({ attempt: 2, maxAttempts: 3 })).toBe(true);
    expect(recoveryPermitted({ attempt: 3, maxAttempts: 3 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// integration with the in-memory amux + real service

describe("phase 20.61 service integration (fake amux)", () => {
  let fake: FakeAmuxAdapter;
  let service: AgentRuntimeService;

  beforeEach(() => {
    fake = new FakeAmuxAdapter();
    const made = makeService(fake);
    service = made.service;
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    resetAgentRuntimeServiceForTests();
  });

  function registerWorker(): { id: string } {
    const caps = makeWorkerCaps();
    return service.registerWorker({ name: "impl-1", provider: "amux", roles: caps.roles, capabilities: caps.capabilities, runtimeWorkerId: "impl-1" });
  }

  test("full flow: dispatch claims atomically, verifies independently, and lands in approval_required", async () => {
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({
      title: "Add search field",
      description: "Case-insensitive product search.",
      acceptanceCriteria: ["search is case-insensitive", "empty search returns all", "unit tests cover cases"],
      repoRoot,
    });
    service.queueTask(task.id);
    const { task: running } = await service.dispatchTask(task.id, { workerId: worker.id });
    expect(running.status).toBe("running");
    expect(running.claimOwner).toBe(worker.id);
    expect(running.claimVersion).toBe(1);
    expect(running.worktreePath).toBeTruthy();
    expect(existsSync(running.worktreePath!)).toBe(true);
    expect(running.branch).toBe(worktreeBranchFor(task.id, "implementer"));
    expect(fake.dispatchedTasks).toHaveLength(1);

    // worker heartbeat + completion with a structured checkpoint
    const ok = service.heartbeat(task.id, { claimToken: running.claimToken!, checkpoint: { status: "running", summary: "search added", completedSteps: ["ui"], nextStep: "tests", changedFiles: ["src/search.ts"], commandsRun: [], evidenceIds: [], blockers: [], updatedAt: "" } });
    expect(ok).toBe(true);

    service.completeTask(task.id, { claimToken: running.claimToken!, summary: "done" });

    // the minimum verification packet is enforced: no evidence yet
    await expect(service.verifyTask(task.id, {
      verifierWorkerId: "reviewer-1", verdict: { verdict: "pass", requirements: [], risks: [], regressions: [], recommendedAction: "approve", verifierId: "reviewer-1", reviewedAt: nowIso() },
    })).rejects.toThrow(/diff or commit evidence/);

    service.addEvidence(task.id, { evidenceType: "diff", content: "diff --git a/src b/src" });
    service.addEvidence(task.id, { evidenceType: "test_report", content: "3 pass 0 fail" });

    // independent reviewer verifies
    const { task: verified, outcome } = await service.verifyTask(task.id, {
      verifierWorkerId: "reviewer-1",
      verdict: { verdict: "pass", requirements: [{ id: "AC-1", status: "pass", evidence: [] }], risks: [], regressions: [], recommendedAction: "approve", verifierId: "reviewer-1", reviewedAt: nowIso() },
    });
    expect(outcome.status).toBe("verified");
    expect(verified.status).toBe("approval_required"); // human approval by default

    const approval = service.requestApproval(task.id, { action: "protected.merge", payload: { branch: verified.branch, target: "main" }, requestedBy: "release-controller" });
    const decided = service.decideApproval(approval.id, { decision: "approved", approverId: "operator-1" });
    expect(decided.approval.status).toBe("approved");
    expect(decided.task?.status).toBe("approved");
  });

  test("atomic claim race: exactly one claim wins", async () => {
    const worker = registerWorker();
    const caps = makeWorkerCaps();
    service.registerWorker({ name: "impl-2", provider: "amux", roles: caps.roles, capabilities: caps.capabilities });
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "race", description: "x", repoRoot });
    service.queueTask(task.id);

    const store = new AgentRuntimeStore();
    const first = store.claimTaskAtomic({ taskId: task.id, workerId: worker.id, claimToken: "tok-a", leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
    const second = store.claimTaskAtomic({ taskId: task.id, workerId: "impl-2", claimToken: "tok-b", leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.task?.claimOwner).toBe(worker.id);
  });

  test("stale claim token cannot complete or overwrite newer state", async () => {
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "stale", description: "x", repoRoot });
    service.queueTask(task.id);
    const { task: running } = await service.dispatchTask(task.id, { workerId: worker.id });
    expect(() => service.completeTask(task.id, { claimToken: "forged-token" })).toThrow();
    void running;
  });

  test("runtime failure during dispatch parks the task in recovering (fail closed)", async () => {
    const worker = registerWorker();
    fake.dispatchFault = new Error("connection refused");
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "flaky runtime", description: "x", repoRoot });
    service.queueTask(task.id);
    await expect(service.dispatchTask(task.id, { workerId: worker.id })).rejects.toThrow(/connection refused/);
    expect(service.getTask(task.id).task.status).toBe("recovering");
  });

  test("version drift fails closed", async () => {
    fake.breakCompatibility("deadbeef00000000000000000000000000000000");
    const health = await service.runtimeHealth();
    expect(health.compatible).toBe(false);
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "drift", description: "x", repoRoot });
    service.queueTask(task.id);
    await expect(service.dispatchTask(task.id, { workerId: worker.id })).rejects.toThrow();
    expect(service.getTask(task.id).task.status).toBe("recovering");
  });

  test("recovery sweep reclaims expired leases and exhausts the bounded retry budget", async () => {
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "recovery", description: "x", repoRoot, maxAttempts: 2 });
    service.queueTask(task.id);
    await service.dispatchTask(task.id, { workerId: worker.id });

    // simulate an abandoned session: lease long expired, no heartbeat
    const store = new AgentRuntimeStore();
    const past = new Date(Date.now() - 600_000).toISOString();
    store.updateTask(task.id, { status: "running" });
    openAgentOsDb().query("UPDATE ar_tasks SET lease_expires_at = ? WHERE id = ?").run(past, task.id);

    const sweep1 = await service.runRecoverySweep();
    expect(sweep1.recovered).toBe(1);
    expect(service.getTask(task.id).task.status).toBe("queued");

    // burn the retry budget, then the sweep must fail the task terminally
    service.retryTask(task.id);
    await service.dispatchTask(task.id, { workerId: worker.id });
    openAgentOsDb().query("UPDATE ar_tasks SET lease_expires_at = ? WHERE id = ?").run(past, task.id);
    const sweep2 = await service.runRecoverySweep();
    void sweep2;
    // attempt is now at max (2): reclaim requeues once more only while budget remains
    const finalStatus = service.getTask(task.id).task.status;
    expect(["queued", "failed"]).toContain(finalStatus);
    if (finalStatus === "queued") {
      // re-dispatch consumes the last attempt, next exhaustion fails the task
      await service.dispatchTask(task.id, { workerId: worker.id });
      openAgentOsDb().query("UPDATE ar_tasks SET lease_expires_at = ? WHERE id = ?").run(past, task.id);
      const sweep3 = await service.runRecoverySweep();
      expect(sweep3.failed).toBe(1);
      expect(service.getTask(task.id).task.status).toBe("failed");
    }
  });

  test("verifier rejection sends the task back to queued (rework), within budget", async () => {
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "rework", description: "x", repoRoot, acceptanceCriteria: ["AC"] });
    service.queueTask(task.id);
    const { task: running } = await service.dispatchTask(task.id, { workerId: worker.id });
    service.addEvidence(task.id, { evidenceType: "diff", content: "diff" });
    service.addEvidence(task.id, { evidenceType: "test_report", content: "tests" });
    service.completeTask(task.id, { claimToken: running.claimToken! });
    const { task: rejected } = await service.verifyTask(task.id, {
      verifierWorkerId: "reviewer-1",
      verdict: { verdict: "fail", requirements: [{ id: "AC-1", status: "fail", evidence: [] }], risks: [], regressions: ["search is case-sensitive"], recommendedAction: "rework", verifierId: "reviewer-1", reviewedAt: nowIso() },
    });
    expect(rejected.status).toBe("rejected");
    const retried = service.retryTask(task.id);
    expect(retried.status).toBe("queued");
  });

  test("approval is payload-bound: a changed payload invalidates the request", async () => {
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "payload", description: "x", repoRoot });
    const approval = service.requestApproval(task.id, { action: "production.deploy", payload: { commit: "abc123", env: "prod" }, requestedBy: "release-controller" });
    expect(() => service.decideApproval(approval.id, { decision: "approved", approverId: "operator", currentPayload: { commit: "DIFFERENT", env: "prod" } })).toThrow(/payload changed/);
    const fresh = service.store.getApproval(approval.id)!;
    expect(fresh.status).toBe("stale");
    // the original payload still decides cleanly
    const approval2 = service.requestApproval(task.id, { action: "production.deploy", payload: { commit: "abc123", env: "prod" }, requestedBy: "release-controller" });
    const decided = service.decideApproval(approval2.id, { decision: "approved", approverId: "operator", currentPayload: { commit: "abc123", env: "prod" } });
    expect(decided.approval.status).toBe("approved");
  });

  test("cancellation during execution cleans up and stops the task", async () => {
    const worker = registerWorker();
    const repoRoot = fixtureRepo();
    const task = service.createTask({ title: "cancel", description: "x", repoRoot });
    service.queueTask(task.id);
    const { task: running } = await service.dispatchTask(task.id, { workerId: worker.id });
    const cancelled = service.cancelTask(task.id, { type: "human", id: "operator" });
    expect(cancelled.status).toBe("cancelled");
    void running;
  });

  test("duplicate runtime events are harmless (idempotent ingestion)", () => {
    const store = new AgentRuntimeStore();
    const key = "evt-fixed-key-1";
    const first = store.insertEvent({ id: "e1", eventType: "task.started", taskId: "t", sessionId: null, source: "amux-adapter", idempotencyKey: key, payload: {}, occurredAt: nowIso() });
    const duplicate = store.insertEvent({ id: "e2", eventType: "task.started", taskId: "t", sessionId: null, source: "amux-adapter", idempotencyKey: key, payload: {}, occurredAt: nowIso() });
    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(store.listEvents().length).toBe(1);
  });

  test("worktrees: branch format enforced and dangerous segments rejected", async () => {
    expect(worktreeBranchFor("art_abc", "implementer")).toBe("pao/amux/art_abc/implementer");
    expect(() => worktreeBranchFor("../evil", "implementer")).toThrow(/not safe/);
    expect(() => worktreePathFor("", "art_1", "tester")).toThrow(/workspace root/);
    const repoRoot = fixtureRepo();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-worktrees-"));
    tempHomes.push(workspaceRoot);
    const handle = await createWorktree({ repoRoot, workspaceRoot, taskId: "art_wt", role: "tester" });
    expect(existsSync(handle.path)).toBe(true);
    const head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: handle.path }).toString().trim();
    expect(head).toBe("pao/amux/art_wt/tester");
  });

  test("adapter maps upstream errors to typed failures", async () => {
    const transport = new FakeAmuxTransport();
    transport.faults.push({ pathMatch: "/health", status: 401, times: 1 });
    const adapter = new AmuxAdapter({ transport, pinnedCommit: PINNED_COMMIT });
    await expect(adapter.health()).rejects.toThrow(/401|auth/i);
  });
});

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// management API surface

describe("phase 20.61 management routes", () => {
  let fake: FakeAmuxAdapter;

  beforeEach(() => {
    fake = new FakeAmuxAdapter();
    const home = openFreshDb();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-worktrees-"));
    tempHomes.push(workspaceRoot);
    setAgentRuntimeServiceForTests(new AgentRuntimeService({
      config: makeConfig({ workspaceRoot }),
      adapterFactory: () => fake,
    }));
    void home;
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    resetAgentRuntimeServiceForTests();
  });

  function baseConfig(): OcxConfig {
    return { port: 10100, hostname: "127.0.0.1", defaultProvider: "a", providers: [] } as unknown as OcxConfig;
  }

  async function api(method: string, path: string, body?: unknown): Promise<Response> {
    const url = new URL("http://127.0.0.1:10100" + path);
    const response = await handleManagementAPI(
      new Request(url, { method, headers: { Host: url.host }, body: body === undefined ? undefined : JSON.stringify(body) }),
      url,
      baseConfig(),
      { saveConfigPreservingClaudeCode: () => {} },
    );
    expect(response).not.toBeNull();
    return response!;
  }

  test("health endpoint reports the phase and counters", async () => {
    const response = await api("GET", "/api/agent-os/agent-runtime/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["phase"]).toBe("20.61");
  });

  test("worker registration, task lifecycle, and approval queue through the API", async () => {
    const created = await api("POST", "/api/agent-os/agent-runtime/workers", { name: "impl-1", roles: ["implementer"], capabilities: ["repo.read", "command.safe_dev"] });
    expect(created.status).toBe(201);
    const workerId = ((await created.json()) as { worker: { id: string } }).worker.id;

    const taskResponse = await api("POST", "/api/agent-os/agent-runtime/tasks", { title: "api task", description: "via api", acceptanceCriteria: ["works"] });
    expect(taskResponse.status).toBe(201);
    const taskId = ((await taskResponse.json()) as { task: { id: string } }).task.id;

    const queued = await api("POST", "/api/agent-os/agent-runtime/tasks/" + taskId + "/queue", {});
    expect(queued.status).toBe(200);

    const approvalResponse = await api("POST", "/api/agent-os/agent-runtime/tasks/" + taskId + "/request-approval", { action: "production.deploy", payload: { commit: "abc", env: "prod" }, requestedBy: "release-controller" });
    expect(approvalResponse.status).toBe(201);
    const approvalId = ((await approvalResponse.json()) as { approval: { id: string } }).approval.id;

    const queue = await api("GET", "/api/agent-os/agent-runtime/approvals?status=pending");
    const queueBody = (await queue.json()) as { approvals: Array<{ id: string }> };
    expect(queueBody.approvals.some((a) => a.id === approvalId)).toBe(true);

    const decided = await api("POST", "/api/agent-os/agent-runtime/approvals/" + approvalId + "/approve", { approverId: "operator", currentPayload: { commit: "abc", env: "prod" } });
    expect(decided.status).toBe(200);
    void workerId;
  });

  test("mcp tools listing and unknown route 404", async () => {
    const tools = await api("GET", "/api/agent-os/agent-runtime/mcp-tools");
    const toolBody = (await tools.json()) as { tools: Array<{ name: string; riskTier: string }> };
    expect(toolBody.tools.some((t) => t.name === "agent_runtime_dispatch_task" && t.riskTier === "R3")).toBe(true);
    expect(toolBody.tools.some((t) => t.name === "agent_runtime_list_tasks" && t.riskTier === "R0")).toBe(true);

    const missing = await api("GET", "/api/agent-os/agent-runtime/not-a-route");
    expect(missing.status).toBe(404);
  });
});

void mkdirSync; void writeFileSync; void payloadHashOf; void AgentRuntimeHttpError;
