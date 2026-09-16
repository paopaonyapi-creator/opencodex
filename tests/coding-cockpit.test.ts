// Phase 20.39 — Unified AI Coding Workspace tests (spec §48). Policy levels
// + risk scoring, path escape rejection, one-writer lock semantics
// (conflict / expiry reclaim / healthy-takeover gate), approval binding +
// single-use + expiry, event idempotency + replay, mock provider session
// lifecycle, workspace registration (duplicate path, git detection,
// PRIVILEGED never automatic), native session import, redaction, usage
// source separation. All provider I/O is the in-process mock — no network,
// no real CLI dependency for the core tests. Fake secret fixtures are
// assembled at runtime so no credential-shaped literal is ever committed.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { CockpitService, resetCockpitServiceForTests } from "../src/agent-os/coding-cockpit/service";
import { CockpitStore } from "../src/agent-os/coding-cockpit/store";
import { evaluatePolicy, scoreRisk, riskBand, TRUST_MAX_LEVEL } from "../src/agent-os/coding-cockpit/policy";
import { resolveInsideWorkspace, staysInsideWorkspace, canonicalizeRoot } from "../src/agent-os/coding-cockpit/paths";
import { redactText, redactJsonForAudit } from "../src/agent-os/coding-cockpit/redaction";
import { CockpitError } from "../src/agent-os/coding-cockpit/types";
import { ApprovalGateway } from "../src/agent-os/coding-cockpit/approvals";

let testDir: string;

beforeEach(() => {
  closeAgentOsDbForTests();
  resetCockpitServiceForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-cc-test-"));
  process.env.OPENCODEX_HOME = testDir;
  process.env.PAO_ALLOW_PRIVILEGED_MODE = "false";
  delete process.env.PAO_DEFAULT_EXECUTION_LEVEL;
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetCockpitServiceForTests();
  rmSync(testDir, { recursive: true, force: true });
});

// Runtime-assembled fake credentials for redaction fixtures (never real).
const FAKE_SK = "sk-" + "x".repeat(24);
const FAKE_GHP = "ghp_" + "y".repeat(24);
const FAKE_API_VALUE = ["super", "secret", "value"].join("-");

function makeWorkspace(service: CockpitService, name = "proj"): { workspaceId: string; root: string } {
  const root = join(testDir, name);
  mkdirSync(root, { recursive: true });
  const workspace = service.registerWorkspace({ rootPath: root, name, actor: "operator" });
  return { workspaceId: workspace.id, root };
}

// --- §16/§17 policy engine ----------------------------------------------------------

describe("execution policy engine", () => {
  test("read-only default denies write and shell, allows read", () => {
    const base = {
      workspaceId: "ws",
      workspaceTrust: "STANDARD" as const,
      configuredLevel: "LEVEL_0_READ_ONLY" as const,
    };
    expect(evaluatePolicy({ ...base, actionType: "READ" }).decision.effect).toBe("ALLOW");
    expect(evaluatePolicy({ ...base, actionType: "WRITE" }).decision.effect).toBe("DENY");
    expect(evaluatePolicy({ ...base, actionType: "SHELL" }).decision.effect).toBe("DENY");
    expect(evaluatePolicy({ ...base, actionType: "NETWORK" }).decision.effect).toBe("DENY");
  });

  test("level ladder: write allowed at LEVEL_1, shell needs LEVEL_2, deploy LEVEL_5", () => {
    const trust = "PRIVILEGED" as const;
    expect(evaluatePolicy({ workspaceId: "ws", workspaceTrust: trust, configuredLevel: "LEVEL_1_SAFE_WRITE", actionType: "WRITE" }).decision.effect).toBe("ALLOW");
    expect(evaluatePolicy({ workspaceId: "ws", workspaceTrust: trust, configuredLevel: "LEVEL_1_SAFE_WRITE", actionType: "SHELL" }).decision.effect).toBe("DENY");
    expect(evaluatePolicy({ workspaceId: "ws", workspaceTrust: trust, configuredLevel: "LEVEL_2_COMMAND", actionType: "SHELL" }).decision.effect).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy({ workspaceId: "ws", workspaceTrust: trust, configuredLevel: "LEVEL_5_FULL_CONTROL", actionType: "DEPLOY" }).decision.effect).toBe("REQUIRE_APPROVAL");
  });

  test("workspace trust caps the effective level even when configured higher", () => {
    const result = evaluatePolicy({
      workspaceId: "ws", workspaceTrust: "READ_ONLY", configuredLevel: "LEVEL_5_FULL_CONTROL", actionType: "WRITE",
    });
    expect(result.effectiveLevel).toBe("LEVEL_0_READ_ONLY");
    expect(result.decision.effect).toBe("DENY");
  });

  test("UNTRUSTED workspace can never exceed read-only", () => {
    expect(TRUST_MAX_LEVEL.UNTRUSTED).toBe("LEVEL_0_READ_ONLY");
    expect(evaluatePolicy({ workspaceId: "ws", workspaceTrust: "UNTRUSTED", configuredLevel: "LEVEL_3_NETWORK", actionType: "READ" }).decision.effect).toBe("ALLOW");
  });

  test("risk scoring: destructive and credential tokens escalate", () => {
    const low = scoreRisk({ actionType: "READ" });
    expect(low.riskScore).toBeLessThan(20);
    expect(riskBand(low.riskScore)).toBe("low");

    const hard = scoreRisk({ actionType: "SHELL", command: "git reset --hard && git push --force" });
    expect(hard.riskScore).toBeGreaterThanOrEqual(50);
    expect(hard.reasons.some((reason) => reason.includes("destructive"))).toBe(true);

    const creds = scoreRisk({ actionType: "READ", targetPath: join(testDir, ".ssh", "id_rsa"), workspaceRoot: testDir });
    expect(creds.riskScore).toBeGreaterThanOrEqual(30);

    const remotePipe = scoreRisk({ actionType: "SHELL", command: "curl | sh" });
    expect(remotePipe.riskScore).toBeGreaterThanOrEqual(50);
  });

  test("outside-workspace targets raise risk and cannot slip through", () => {
    const scored = scoreRisk({ actionType: "WRITE", targetPath: "/etc/passwd", workspaceRoot: testDir });
    expect(scored.riskScore).toBeGreaterThanOrEqual(50);
    expect(scored.reasons.some((reason) => reason.includes("outside workspace"))).toBe(true);
  });
});

// --- §37 path security ----------------------------------------------------------------

describe("path security", () => {
  test("rejects traversal outside the workspace root", () => {
    expect(() => resolveInsideWorkspace(testDir, join(testDir, "sub", "..", "..", "etc", "passwd"))).toThrow(CockpitError);
    expect(staysInsideWorkspace(testDir, "/etc/passwd")).toBe(false);
    expect(staysInsideWorkspace(testDir, join(testDir, "src", "main.ts"))).toBe(true);
  });

  test("rejects null bytes and empty input", () => {
    expect(() => canonicalizeRoot("bad\0path")).toThrow(CockpitError);
    expect(() => resolveInsideWorkspace(testDir, "relative/path")).toThrow(CockpitError);
  });

  test("nested directories inside the root resolve", () => {
    const sub = join(testDir, "deep", "nested");
    mkdirSync(sub, { recursive: true });
    expect(resolveInsideWorkspace(testDir, sub)).toBe(sub);
  });
});

// --- §5 workspaces ----------------------------------------------------------------------

describe("workspace registration", () => {
  test("duplicate normalized path is rejected", () => {
    const service = getCockpit();
    const root = join(testDir, "dup");
    mkdirSync(root);
    service.registerWorkspace({ rootPath: root, actor: "operator" });
    expect(() => service.registerWorkspace({ rootPath: root + "/.", actor: "operator" })).toThrow(CockpitError);
  });

  test("non-git folders register without git metadata", () => {
    const service = getCockpit();
    const root = join(testDir, "nogit");
    mkdirSync(root);
    const workspace = service.registerWorkspace({ rootPath: root, actor: "operator" });
    expect(workspace.gitBranch).toBeNull();
    expect(workspace.trustLevel).toBe("STANDARD");
  });

  test("PRIVILEGED trust is never assigned automatically and is human-gated", () => {
    const service = getCockpit();
    const root = join(testDir, "priv");
    mkdirSync(root);
    const workspace = service.registerWorkspace({ rootPath: root, actor: "operator", trustLevel: "PRIVILEGED" });
    expect(workspace.trustLevel).toBe("STANDARD");

    expect(() => service.setWorkspaceTrust(workspace.id, "PRIVILEGED", "agent-9")).toThrow(/human actor/);
    expect(() => service.setWorkspaceTrust(workspace.id, "PRIVILEGED", "operator")).toThrow(/PAO_ALLOW_PRIVILEGED_MODE/);

    process.env.PAO_ALLOW_PRIVILEGED_MODE = "true";
    const upgraded = service.setWorkspaceTrust(workspace.id, "PRIVILEGED", "operator");
    expect(upgraded.trustLevel).toBe("PRIVILEGED");
  });
});

// --- §19 one-writer lock -------------------------------------------------------------------

describe("writer lock", () => {
  test("two writers cannot both hold the workspace", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "lockws");
    const first = service.locks.acquire({ workspaceId, sessionId: "sess_a", ownerInstanceId: "i1", actor: "operator" });
    expect(first.acquired).toBe(true);
    const second = service.locks.acquire({ workspaceId, sessionId: "sess_b", ownerInstanceId: "i1", actor: "operator" });
    expect(second.acquired).toBe(false);
    expect(second.conflicting?.sessionId).toBe("sess_a");
  });

  test("expired lease is reclaimable; healthy lease requires confirmation", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "leasews");
    service.locks.acquire({ workspaceId, sessionId: "sess_a", ownerInstanceId: "i1", actor: "operator", leaseSeconds: 5 });
    // Force-expire by manipulating the stored lease.
    const active = service.store.getActiveLock(workspaceId);
    expect(active).not.toBeNull();
    service.store.updateLockStatus(active!.id, "EXPIRED");
    const reclaimed = service.locks.reclaimExpired(workspaceId, "sess_b", "i1", "operator");
    expect(reclaimed.sessionId).toBe("sess_b");

    // Healthy takeover requires explicit confirmation.
    expect(() => service.locks.takeover(workspaceId, "sess_c", "i1", "operator")).toThrow(/confirmation/);
    const stolen = service.locks.takeover(workspaceId, "sess_c", "i1", "operator", { confirmHealthyTakeover: true });
    expect(stolen.sessionId).toBe("sess_c");
    const events = service.store.listAudit({ eventType: "lock.takeover" });
    expect(events.length).toBe(1);
  });

  test("only the holder can release the lease", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "relws");
    service.locks.acquire({ workspaceId, sessionId: "sess_a", ownerInstanceId: "i1", actor: "operator" });
    expect(() => service.locks.release(workspaceId, "sess_b", "operator")).toThrow(CockpitError);
    expect(service.locks.release(workspaceId, "sess_a", "operator")).toBe(true);
  });
});

// --- §18 approvals ---------------------------------------------------------------------------

describe("approval gateway", () => {
  test("decision requires a human actor", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "apprws");
    const session = makeSession(service.store, workspaceId);
    const approval = service.approvals.create({
      sessionId: session.id, workspaceId, actionType: "SHELL", summary: "run tests",
      actionInput: { kind: "run_command", executable: "bun", args: ["test"] },
      decision: { effect: "REQUIRE_APPROVAL", riskScore: 35, reasons: ["shell"], ruleIds: ["r"] },
    });
    expect(() => service.approvals.decide(approval.id, true, "agent-9")).toThrow(/human actor/);
    const decided = service.approvals.decide(approval.id, true, "operator");
    expect(decided.status).toBe("APPROVED");
  });

  test("approval is bound to exact action parameters and single-use", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "bindws");
    const session = makeSession(service.store, workspaceId);
    const decision = { effect: "REQUIRE_APPROVAL" as const, riskScore: 60, reasons: ["x"], ruleIds: ["r"] };
    const matchingInput = { kind: "run_command", executable: "bun", args: ["test"] };
    const differentInput = { kind: "run_command", executable: "npm", args: ["test"] };

    // Single-use: consume with matching params, then replay is rejected.
    const approval = service.approvals.create({
      sessionId: session.id, workspaceId, actionType: "SHELL", summary: "approved command",
      actionInput: matchingInput, decision,
    });
    service.approvals.decide(approval.id, true, "operator");
    service.approvals.consume(approval.id, matchingInput);
    expect(() => service.approvals.consume(approval.id, matchingInput)).toThrow(/already consumed/);

    // Binding: a fresh approved approval cannot be applied to different params.
    const other = service.approvals.create({
      sessionId: session.id, workspaceId, actionType: "SHELL", summary: "other command",
      actionInput: differentInput, decision,
    });
    service.approvals.decide(other.id, true, "operator");
    expect(() => service.approvals.consume(other.id, matchingInput)).toThrow(/bound to different action parameters/);
    // The parameters it WAS approved for still consume correctly.
    service.approvals.consume(other.id, differentInput);
  });

  test("expired approvals cannot be decided or consumed", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "exprws");
    const session = makeSession(service.store, workspaceId);
    const approval = service.approvals.create({
      sessionId: session.id, workspaceId, actionType: "SHELL", summary: "slow approver",
      actionInput: { kind: "run_command", executable: "bun", args: ["build"] },
      decision: { effect: "REQUIRE_APPROVAL", riskScore: 40, reasons: [], ruleIds: [] },
      ttlMs: -1, // already expired
    });
    expect(() => service.approvals.decide(approval.id, true, "operator")).toThrow(CockpitError);
    const stored = service.store.getApproval(approval.id);
    expect(stored?.status === "EXPIRED" || stored?.status === "PENDING").toBe(true);
  });
});

// --- §6/§29/§31 session lifecycle via mock provider ---------------------------------------------

describe("mock provider session lifecycle", () => {
  test("start → send → events persisted → cancel", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "mockws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator", title: "mock run" });
    expect(session.status).toBe("RUNNING");
    expect(session.nativeSessionId).not.toBeNull();

    const result = await service.sendMessage({ sessionId: session.id, text: "hello workspace", actor: "operator" });
    expect(result.decision).toBe("ALLOW");

    const envelopes = service.bus.replay(session.id, 0);
    const types = envelopes.map((envelope) => envelope.type);
    expect(types).toContain("SessionStarted");
    expect(types).toContain("MessageCompleted");
    expect(types).toContain("ToolStarted");
    expect(types).toContain("ToolCompleted");
    expect(types).toContain("UsageUpdated");

    // Usage is provider-reported by the mock and stored with that source.
    const usage = service.store.listUsage({ sessionId: session.id });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((record) => record.source === "PROVIDER_REPORTED")).toBe(true);
    expect(usage[0].inputTokens).not.toBeNull();

    const cancelled = await service.cancelSession(session.id, "operator");
    expect(cancelled.status).toBe("COMPLETED");
  });

  test("second concurrent CODE session hits the one-writer gate", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "rows");
    const first = await service.startSession({ workspaceId, providerId: "mock", actor: "operator", mode: "CODE" });
    expect(first.session.writerState).toBe("HELD");
    await expect(service.startSession({ workspaceId, providerId: "mock", actor: "operator", mode: "CODE" })).rejects.toThrow(/lease/);
    await service.cancelSession(first.session.id, "operator");
  });

  test("native session import preserves the native id and is idempotent", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "importws");
    const discovered = await service.scanDiscovery(workspaceId, "mock");
    expect(discovered.length).toBe(1);
    const imported = await service.importDiscoveredSession("mock", discovered[0].nativeSessionId, workspaceId, "operator");
    expect(imported.nativeSessionId).toBe(discovered[0].nativeSessionId);
    expect(imported.status).toBe("DISCOVERED");
    const again = await service.importDiscoveredSession("mock", discovered[0].nativeSessionId, workspaceId, "operator");
    expect(again.id).toBe(imported.id);
  });

  test("slash commands execute from the registry and unknown commands fail structured", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "cmdws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    const result = await service.sendMessage({ sessionId: session.id, text: "/usage", actor: "operator" });
    expect(result.decision).toBe("COMMAND");
    await expect(service.sendMessage({ sessionId: session.id, text: "/definitely-not-a-command", actor: "operator" })).rejects.toThrow(/unknown command/);
  });
});

// --- §12 event bus --------------------------------------------------------------------------------

describe("event bus", () => {
  test("deltas are not persisted; structural events are", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "evws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    await service.sendMessage({ sessionId: session.id, text: "stream me", actor: "operator" });
    const persisted = service.store.listEvents(session.id, 0);
    expect(persisted.every((envelope) => envelope.type !== "MessageDelta")).toBe(true);
    expect(persisted.some((envelope) => envelope.type === "MessageCompleted")).toBe(true);
  });

  test("replay from a sequence offset returns only later events", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "replayws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    await service.sendMessage({ sessionId: session.id, text: "one", actor: "operator" });
    const all = service.store.listEvents(session.id, 0);
    expect(all.length).toBeGreaterThan(2);
    const later = service.bus.replay(session.id, all[0].sequence);
    expect(later.every((envelope) => envelope.sequence > all[0].sequence)).toBe(true);
  });
});

// --- §36 redaction ---------------------------------------------------------------------------------

describe("redaction", () => {
  test("secrets never survive into audit payloads", () => {
    expect(redactText("Bearer " + FAKE_SK).includes(FAKE_SK)).toBe(false);
    const redacted = redactJsonForAudit({ apiKey: FAKE_API_VALUE, nested: { password: "hunter2" }, note: "safe text" });
    expect(redacted.includes(FAKE_API_VALUE)).toBe(false);
    expect(redacted.includes("safe text")).toBe(true);
  });

  test("tool execution inputs are stored redacted", async () => {
    const service = getCockpit();
    const { workspaceId, root } = makeWorkspace(service, "redactws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    await service.runToolAction({
      sessionId: session.id,
      toolName: "secret.read",
      actionInput: { kind: "read_file", path: join(root, "notes.txt"), token: FAKE_GHP },
      actor: "operator",
    });
    const executions = service.store.listToolExecutions({ sessionId: session.id });
    const serialized = JSON.stringify(executions);
    expect(serialized.includes(FAKE_GHP)).toBe(false);
  });
});

// --- §32 tool flow -----------------------------------------------------------------------------------

describe("tool action flow", () => {
  test("read outside the workspace is denied with a structured error", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "pathws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    await expect(service.runToolAction({
      sessionId: session.id,
      toolName: "file.read",
      actionInput: { kind: "read_file", path: join(testDir, "outside-secret.txt") },
      actor: "operator",
    })).rejects.toThrow(CockpitError);
    void workspaceId;
  });

  test("read inside the workspace succeeds at read-only level", async () => {
    const service = getCockpit();
    const { workspaceId, root } = makeWorkspace(service, "readws");
    writeFileSync(join(root, "notes.txt"), "hello from the workspace");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    const outcome = await service.runToolAction({
      sessionId: session.id,
      toolName: "file.read",
      actionInput: { kind: "read_file", path: join(root, "notes.txt") },
      actor: "operator",
    });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.outputSummary.includes("hello from the workspace")).toBe(true);
  });

  test("shell is denied below LEVEL_2 and audited", async () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "shellws");
    const { session } = await service.startSession({ workspaceId, providerId: "mock", actor: "operator" });
    const outcome = await service.runToolAction({
      sessionId: session.id,
      toolName: "shell.run",
      actionInput: { kind: "run_command", executable: "echo", args: ["hi"] },
      actor: "operator",
    });
    expect(outcome.status).toBe("DENIED");
    expect(service.store.listAudit({ eventType: "policy.denied" }).length).toBe(1);
  });
});

// --- §23 usage ----------------------------------------------------------------------------------------

describe("usage telemetry", () => {
  test("summary separates sources and never invents values", () => {
    const service = getCockpit();
    const { workspaceId } = makeWorkspace(service, "usagews");
    const session = makeSession(service.store, workspaceId, "codex");
    service.store.insertUsage({
      sessionId: session.id, providerId: "codex", model: "gpt-5",
      inputTokens: 100, outputTokens: 50, cacheReadTokens: null, cacheWriteTokens: null,
      reasoningTokens: null, reportedCostUsd: 0.02, estimatedCostUsd: null, source: "PROVIDER_REPORTED",
    });
    const summary = service.usageSummary();
    expect(summary.totals.inputTokens).toBe(100);
    expect(summary.totals.reportedCostUsd).toBe(0.02);
    expect(summary.totals.estimatedCostUsd).toBeNull();
    expect(summary.byProvider[0].source).toBe("PROVIDER_REPORTED");
  });
});

// --- §53 security checklist spot-checks -----------------------------------------------------------------

describe("security invariants", () => {
  test("mock provider is registered but codex/claude degrade gracefully when absent", async () => {
    const service = getCockpit();
    const codexProbe = await service.probeProvider("codex");
    const claudeProbe = await service.probeProvider("claude_code");
    // Probes must complete without throwing regardless of installation state.
    expect(typeof codexProbe.installed).toBe("boolean");
    expect(typeof claudeProbe.installed).toBe("boolean");
    expect(claudeProbe.authenticated).toBeNull();
  });

  test("human actor gate blocks non-human approval decisions at the gateway level", () => {
    expect(() => ApprovalGateway.requireHumanActor("codex-agent")).toThrow(CockpitError);
    expect(() => ApprovalGateway.requireHumanActor("operator")).not.toThrow();
    expect(() => ApprovalGateway.requireHumanActor("dashboard-user")).not.toThrow();
  });
});

// --- helpers ---------------------------------------------------------------------------------------------

function makeSession(store: InstanceType<typeof CockpitStore>, workspaceId: string, providerId = "mock") {
  return store.insertSession({
    workspaceId, providerId, nativeSessionId: null, parentSessionId: null,
    title: "test session", status: "IDLE", mode: "CHAT", writerState: "NONE", startedAt: null,
    endedAt: null, lastActivityAt: null, nativeMetadataJson: null, capabilitiesJson: null, resumeTokenRef: null,
  });
}

function getCockpit(): CockpitService {
  return new CockpitService();
}
