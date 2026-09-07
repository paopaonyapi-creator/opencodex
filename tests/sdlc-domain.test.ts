// Phase 20.2 — SDLC Domain Engine Unit Tests
// Tests state machine transitions, constitution hashing, requirements/ACs, tasks DAG, and locking.

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import {
  isValidTransition,
  transitionCycleState,
  assertValidTransition,
} from "../src/agent-os/sdlc/state-machine";
import {
  getProjectConstitution,
  verifyConstitutionHash,
  evaluateConstitutionCompliance,
  mergePolicyPacks,
} from "../src/agent-os/sdlc/constitution";
import {
  validateTaskGraph,
  topologicalSortTasks,
  buildTasksFromPlan,
} from "../src/agent-os/sdlc/tasks";
import {
  acquireTaskLock,
  releaseTaskLock,
  renewTaskLock,
} from "../src/agent-os/sdlc/runner";
import {
  resetSdlcOrchestratorForTests,
  getSdlcOrchestrator,
} from "../src/agent-os/sdlc/orchestrator";
import type { SdlcTask } from "../src/agent-os/sdlc/types";

function cleanSdlcTables() {
  const db = openAgentOsDb();
  db.run("DELETE FROM sdlc_cycles");
  db.run("DELETE FROM sdlc_requirements");
  db.run("DELETE FROM sdlc_acceptance_criteria");
  db.run("DELETE FROM sdlc_clarifications");
  db.run("DELETE FROM sdlc_adrs");
  db.run("DELETE FROM sdlc_tasks");
  db.run("DELETE FROM sdlc_gates");
  db.run("DELETE FROM sdlc_reviews");
  db.run("DELETE FROM sdlc_evidence");
  db.run("DELETE FROM sdlc_approvals");
  db.run("DELETE FROM sdlc_artifacts");
  db.run("DELETE FROM sdlc_locks");
}

describe("SDLC Domain — State Machine", () => {
  beforeEach(() => {
    cleanSdlcTables();
    resetSdlcOrchestratorForTests();
  });

  it("permits canonical sequential transitions", () => {
    expect(isValidTransition("IDEA", "SPECIFYING")).toBe(true);
    expect(isValidTransition("SPECIFYING", "SPECIFIED")).toBe(true);
    expect(isValidTransition("SPECIFIED", "CLARIFYING")).toBe(true);
    expect(isValidTransition("CLARIFYING", "CLARIFIED")).toBe(true);
    expect(isValidTransition("CLARIFIED", "PLANNING")).toBe(true);
    expect(isValidTransition("PLANNING", "PLANNED")).toBe(true);
    expect(isValidTransition("PLANNED", "TASKING")).toBe(true);
    expect(isValidTransition("TASKING", "TASKED")).toBe(true);
    expect(isValidTransition("TASKED", "ANALYZING")).toBe(true);
    expect(isValidTransition("ANALYZING", "READY_FOR_DEV")).toBe(true);
    expect(isValidTransition("READY_FOR_DEV", "IMPLEMENTING")).toBe(true);
    expect(isValidTransition("IMPLEMENTING", "IMPLEMENTED")).toBe(true);
    expect(isValidTransition("IMPLEMENTED", "VERIFYING")).toBe(true);
    expect(isValidTransition("VERIFYING", "VERIFIED")).toBe(true);
    expect(isValidTransition("VERIFIED", "REVIEWING")).toBe(true);
    expect(isValidTransition("REVIEWING", "REVIEWED")).toBe(true);
    expect(isValidTransition("REVIEWED", "CONVERGING")).toBe(true);
    expect(isValidTransition("CONVERGING", "CONVERGED")).toBe(true);
  });

  it("allows control state transitions from active states", () => {
    expect(isValidTransition("SPECIFYING", "BLOCKED")).toBe(true);
    expect(isValidTransition("PLANNING", "PAUSED")).toBe(true);
    expect(isValidTransition("IMPLEMENTING", "APPROVAL_REQUIRED")).toBe(true);
    expect(isValidTransition("VERIFYING", "CANCELLED")).toBe(true);
  });

  it("rejects illegal transitions that skip stages", () => {
    expect(isValidTransition("IDEA", "IMPLEMENTING")).toBe(false);
    expect(isValidTransition("SPECIFYING", "CONVERGED")).toBe(false);
    expect(isValidTransition("PLANNING", "REVIEWING")).toBe(false);
    expect(() => assertValidTransition("IDEA", "CONVERGED")).toThrow();
  });

  it("updates cycle state in database via transitionCycleState", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      rawIdea: "Build universal webhook processor with verification",
    });

    const transitioned = transitionCycleState(cycle.id, "SPECIFYING", "SPECIFY");
    expect(transitioned).toBe(true);

    const updated = orchestrator.getCycle(cycle.id);
    expect(updated.status).toBe("SPECIFYING");
    expect(updated.currentStage).toBe("SPECIFY");
  });
});

describe("SDLC Domain — Constitution & Rules", () => {
  it("loads 10 supreme immutable project rules with valid SHA-256", () => {
    const constitution = getProjectConstitution();
    expect(constitution.version).toBe("1.0.0");
    expect(constitution.rules.length).toBe(10);
    expect(constitution.sha256Hash).toBeDefined();
    expect(constitution.sha256Hash.length).toBe(64);
    expect(verifyConstitutionHash(constitution)).toBe(true);
  });

  it("merges additional policy packs without mutating core rules", () => {
    const merged = mergePolicyPacks({
      name: "payment-pci",
      rules: ["PCI-01: Credit card numbers must never be logged in plain text."],
    });
    expect(merged.rules.length).toBe(11);
    expect(merged.rules[10]).toContain("PCI-01");
    expect(verifyConstitutionHash(merged)).toBe(true);
  });

  it("evaluates rule compliance and catches violations", () => {
    const pass = evaluateConstitutionCompliance({
      hasCleanGitTree: true,
      hasDeterministicTests: true,
      hasCouncilApproval: true,
      hasNoSecretLeak: true,
    });
    expect(pass.compliant).toBe(true);
    expect(pass.violations.length).toBe(0);

    const fail = evaluateConstitutionCompliance({
      hasCleanGitTree: false,
      hasDeterministicTests: false,
      hasCouncilApproval: true,
      hasNoSecretLeak: true,
    });
    expect(fail.compliant).toBe(false);
    expect(fail.violations.length).toBe(2);
  });
});

describe("SDLC Domain — Tasks DAG & Topological Sorting", () => {
  it("sorts acyclic dependencies in topological order", () => {
    const tasks: SdlcTask[] = [
      {
        id: "t3",
        cycleId: "c1",
        taskKey: "TASK-003",
        title: "Integration tests",
        description: "",
        taskType: "TEST",
        status: "TODO",
        dependencies: ["TASK-002"],
        acceptanceCriteriaKeys: ["AC-001"],
        assignedWorker: null,
        lockExpiresAt: null,
        estimatedMinutes: 30,
        actualMinutes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "t1",
        cycleId: "c1",
        taskKey: "TASK-001",
        title: "Database schema migration",
        description: "",
        taskType: "SCHEMA",
        status: "TODO",
        dependencies: [],
        acceptanceCriteriaKeys: ["AC-001"],
        assignedWorker: null,
        lockExpiresAt: null,
        estimatedMinutes: 20,
        actualMinutes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "t2",
        cycleId: "c1",
        taskKey: "TASK-002",
        title: "API endpoint handler",
        description: "",
        taskType: "BACKEND",
        status: "TODO",
        dependencies: ["TASK-001"],
        acceptanceCriteriaKeys: ["AC-001"],
        assignedWorker: null,
        lockExpiresAt: null,
        estimatedMinutes: 40,
        actualMinutes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const sorted = topologicalSortTasks(tasks);
    expect(sorted.map((t) => t.taskKey)).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
    expect(validateTaskGraph(tasks).isValid).toBe(true);
  });

  it("detects and rejects cyclical dependencies", () => {
    const cyclicTasks: SdlcTask[] = [
      {
        id: "t1",
        cycleId: "c1",
        taskKey: "TASK-001",
        title: "Module A",
        description: "",
        taskType: "BACKEND",
        status: "TODO",
        dependencies: ["TASK-002"],
        acceptanceCriteriaKeys: [],
        assignedWorker: null,
        lockExpiresAt: null,
        estimatedMinutes: 10,
        actualMinutes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "t2",
        cycleId: "c1",
        taskKey: "TASK-002",
        title: "Module B",
        description: "",
        taskType: "BACKEND",
        status: "TODO",
        dependencies: ["TASK-001"],
        acceptanceCriteriaKeys: [],
        assignedWorker: null,
        lockExpiresAt: null,
        estimatedMinutes: 10,
        actualMinutes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const res = validateTaskGraph(cyclicTasks);
    expect(res.isValid).toBe(false);
    expect(res.cycleError).toBeDefined();
    expect(() => topologicalSortTasks(cyclicTasks)).toThrow();
  });
});

describe("SDLC Domain — Task Locking Leases", () => {
  beforeEach(() => {
    cleanSdlcTables();
  });

  it("acquires lease and blocks concurrent worker until expired or released", () => {
    const taskId = "task-lock-test-1";
    const worker1 = "worker-alpha";
    const worker2 = "worker-beta";

    const acquired1 = acquireTaskLock(taskId, worker1, 1000);
    expect(acquired1.acquired).toBe(true);
    expect(acquired1.lockId).toBeDefined();

    // worker2 attempts to acquire lock immediately -> rejected
    const acquired2 = acquireTaskLock(taskId, worker2, 1000);
    expect(acquired2.acquired).toBe(false);

    // worker1 renews lock
    const renewed = renewTaskLock(taskId, worker1, 2000);
    expect(renewed).toBe(true);

    // worker1 releases lock
    const released = releaseTaskLock(taskId, worker1);
    expect(released).toBe(true);

    // Now worker2 can acquire lock
    const acquired3 = acquireTaskLock(taskId, worker2, 1000);
    expect(acquired3.acquired).toBe(true);
  });
});
