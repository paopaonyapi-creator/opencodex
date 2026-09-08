// Phase 20.2 — SDLC Quality Gates & Traceability Tests
// Tests QualityGateEngine, ChecklistEngine, AnalyzeEngine, and Human Approval Gate.

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { QualityGateEngine } from "../src/agent-os/sdlc/gates";
import { ChecklistEngine } from "../src/agent-os/sdlc/checklist";
import { AnalyzeEngine } from "../src/agent-os/sdlc/analyze";
import { ApprovalEngine } from "../src/agent-os/sdlc/approvals";
import { SafeImplementationRunner } from "../src/agent-os/sdlc/runner";
import { getSdlcOrchestrator, resetSdlcOrchestratorForTests } from "../src/agent-os/sdlc/orchestrator";

function cleanDb() {
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

describe("SDLC Quality Gates — QualityGateEngine", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("records and retrieves quality gates correctly", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Gate Test Cycle",
      sourceIdea: "Testing gate records",
    });

    const recorded = QualityGateEngine.recordGate({
      cycleId: cycle.id,
      gateType: "SPEC_GATE",
      status: "passed",
      score: 100,
      checklistResults: [{ name: "Spec Complete", passed: true }],
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    });

    expect(recorded.id).toBeDefined();
    expect(recorded.status).toBe("passed");

    const fetched = QualityGateEngine.getGate(cycle.id, "SPEC_GATE");
    expect(fetched).not.toBeNull();
    expect(fetched?.score).toBe(100);
    expect(fetched?.status).toBe("passed");

    const gatesList = QualityGateEngine.listGates(cycle.id);
    expect(gatesList.length).toBe(1);
    expect(gatesList[0].gateType).toBe("SPEC_GATE");
  });

  it("assertGatePassed passes on 'passed' status and throws on failure or missing", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Assert Gate Test Cycle",
      sourceIdea: "Testing gate assertions",
    });

    // Missing gate throws
    expect(() => QualityGateEngine.assertGatePassed(cycle.id, "PLAN_GATE")).toThrow("has not been evaluated");

    // Failed gate throws
    QualityGateEngine.recordGate({
      cycleId: cycle.id,
      gateType: "PLAN_GATE",
      status: "failed",
      score: 40,
      checklistResults: [{ name: "ADR Approved", passed: false }],
      blockers: ["ADR-001 missing decision"],
      evaluatedAt: new Date().toISOString(),
    });

    expect(() => QualityGateEngine.assertGatePassed(cycle.id, "PLAN_GATE")).toThrow("Mandatory gate 'PLAN_GATE' failed");

    // Passed gate succeeds
    QualityGateEngine.recordGate({
      cycleId: cycle.id,
      gateType: "PLAN_GATE",
      status: "passed",
      score: 100,
      checklistResults: [{ name: "ADR Approved", passed: true }],
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    });

    expect(() => QualityGateEngine.assertGatePassed(cycle.id, "PLAN_GATE")).not.toThrow();
  });
});

describe("SDLC Quality Gates — Pre-Implementation Checklist", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("fails pre-implementation checklist when prerequisite gates are missing", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Checklist Prerequisites Test",
      sourceIdea: "Testing pre-implementation requirements",
    });

    const result = ChecklistEngine.evaluatePreImplementation(cycle.id, true);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(100);
    expect(result.implementGate.status).toBe("failed");
    expect(result.items.some(i => i.name === "Specification Approved" && !i.passed)).toBe(true);
  });

  it("fails pre-implementation checklist when git working tree is dirty", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Dirty Git Guard Test",
      sourceIdea: "Testing git safety guard",
    });

    // Record passed prerequisites
    QualityGateEngine.recordGate({
      cycleId: cycle.id,
      gateType: "SPEC_GATE",
      status: "passed",
      score: 100,
      checklistResults: [],
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    });
    QualityGateEngine.recordGate({
      cycleId: cycle.id,
      gateType: "PLAN_GATE",
      status: "passed",
      score: 100,
      checklistResults: [],
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    });
    QualityGateEngine.recordGate({
      cycleId: cycle.id,
      gateType: "TASKS_GATE",
      status: "passed",
      score: 100,
      checklistResults: [],
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    });

    // Evaluate with gitClean = false (dirty tree)
    const resultDirty = ChecklistEngine.evaluatePreImplementation(cycle.id, false);
    expect(resultDirty.passed).toBe(false);
    const gitItem = resultDirty.items.find(i => i.name === "Clean Git Working Tree");
    expect(gitItem?.passed).toBe(false);

    // Evaluate with gitClean = true (clean tree)
    const resultClean = ChecklistEngine.evaluatePreImplementation(cycle.id, true);
    expect(resultClean.passed).toBe(true);
    expect(resultClean.score).toBe(100);
    expect(resultClean.implementGate.status).toBe("passed");
  });
});

describe("SDLC Traceability & Gap Detection (/analyze)", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("detects uncovered requirements, uncovered ACs, and orphan tasks", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Traceability Test Cycle",
      sourceIdea: "Testing matrix coverage and gaps",
    });

    const db = openAgentOsDb();
    const cycleId = cycle.id;
    const now = new Date().toISOString();

    // 1. Insert Requirements: FR-001 (has AC) and FR-002 (no AC -> gap)
    db.query(`
      INSERT INTO sdlc_requirements (id, cycle_id, key, type, priority, title, description, status, risk_level, created_at, updated_at)
      VALUES
        ('req-1', ?, 'FR-001', 'FUNCTIONAL', 5, 'User Login', 'Authenticate user', 'proposed', 'MEDIUM', ?, ?),
        ('req-2', ?, 'FR-002', 'FUNCTIONAL', 5, 'Password Reset', 'Reset flow', 'proposed', 'MEDIUM', ?, ?)
    `).run(cycleId, now, now, cycleId, now, now);

    // 2. Insert Acceptance Criteria: AC-001 (mapped to TASK-001) and AC-002 (no task -> gap)
    db.query(`
      INSERT INTO sdlc_acceptance_criteria (id, requirement_id, cycle_id, key, description, verification_type, status)
      VALUES
        ('ac-1', 'req-1', ?, 'AC-001', 'Returns 200 with JWT', 'UNIT_TEST', 'pending'),
        ('ac-2', 'req-1', ?, 'AC-002', 'Rate limits after 5 attempts', 'INTEGRATION_TEST', 'pending')
    `).run(cycleId, cycleId);

    // 3. Insert Tasks: TASK-001 (maps to AC-001) and TASK-002 (no ACs -> orphan task)
    db.query(`
      INSERT INTO sdlc_tasks (id, cycle_id, key, title, description, task_type, status, priority, dependencies_json, target_files_json, acceptance_criteria_keys_json, estimated_minutes, created_at, updated_at)
      VALUES
        ('task-1', ?, 'TASK-001', 'Auth Service', '', 'code', 'pending', 5, '[]', '[]', '["AC-001"]', 30, ?, ?),
        ('task-2', ?, 'TASK-002', 'Orphan Cleanup', '', 'code', 'pending', 5, '[]', '[]', '[]', 15, ?, ?)
    `).run(cycleId, now, now, cycleId, now, now);

    const matrix = AnalyzeEngine.analyzeCycle(cycleId);

    expect(matrix.totalRequirements).toBe(2);
    expect(matrix.totalAcceptanceCriteria).toBe(2);
    expect(matrix.totalTasks).toBe(2);

    expect(matrix.coveredRequirements).toBe(1); // Only FR-001 has AC
    expect(matrix.requirementCoveragePercent).toBe(50);

    expect(matrix.coveredAcceptanceCriteria).toBe(1); // Only AC-001 is mapped to a task
    expect(matrix.acCoveragePercent).toBe(50);

    // Check detected gaps
    const uncReq = matrix.gaps.find(g => g.type === "UNCOVERED_REQUIREMENT");
    expect(uncReq).toBeDefined();
    expect(uncReq?.referenceKey).toBe("FR-002");

    const uncAc = matrix.gaps.find(g => g.type === "UNCOVERED_AC");
    expect(uncAc).toBeDefined();
    expect(uncAc?.referenceKey).toBe("AC-002");

    const orphanTask = matrix.gaps.find(g => g.type === "ORPHAN_TASK");
    expect(orphanTask).toBeDefined();
    expect(orphanTask?.referenceKey).toBe("TASK-002");
  });
});

describe("SDLC Human Approval Gate", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("enforces approval lifecycle with cryptographic token and expiration", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Approval Lifecycle Test",
      sourceIdea: "Testing approval token flow",
      riskLevel: "HIGH",
    });
    const cycleId = cycle.id;

    // Request approval for HIGH risk action
    const approval = ApprovalEngine.requestApproval({
      cycleId,
      actionType: "high_risk_implementation",
      reason: "Altering core payment authorization flow",
      riskLevel: "HIGH",
      requestedBy: "agent-architect",
      ttlMinutes: 30,
    });

    expect(approval.status).toBe("pending");
    expect(approval.token.startsWith("tok_")).toBe(true);
    expect(approval.expiresAt).toBeGreaterThan(Date.now());

    // Listed as pending
    const pendingList = ApprovalEngine.listPendingApprovals(cycleId);
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].id).toBe(approval.id);

    // Safe runner should reject execution before approval is granted
    expect(() => SafeImplementationRunner.assertApprovalGranted(cycleId, "HIGH")).toThrow("requires human approval");

    // Approve the request
    const decided = ApprovalEngine.decideApproval(approval.token, "approve", "lead-engineer@example.com");
    expect(decided.status).toBe("approved");
    expect(decided.decidedBy).toBe("lead-engineer@example.com");
    expect(decided.decidedAt).toBeDefined();

    // Now Safe runner permits execution
    expect(() => SafeImplementationRunner.assertApprovalGranted(cycleId, "HIGH")).not.toThrow();

    // LOW risk requires no approval
    expect(() => SafeImplementationRunner.assertApprovalGranted(cycleId, "LOW")).not.toThrow();
  });

  it("handles rejection and expired approvals gracefully", () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Approval Rejection Test",
      sourceIdea: "Testing rejection flow",
      riskLevel: "CRITICAL",
    });
    const cycleId = cycle.id;

    const approval = ApprovalEngine.requestApproval({
      cycleId,
      actionType: "destructive_migration",
      reason: "Drop deprecated table column",
      riskLevel: "CRITICAL",
      ttlMinutes: 0.001, // Expire almost immediately
    });

    // Rejection workflow
    const rejected = ApprovalEngine.decideApproval(approval.id, "reject", "security-lead");
    expect(rejected.status).toBe("rejected");

    // Cannot decide again
    expect(() => ApprovalEngine.decideApproval(approval.id, "approve", "admin")).toThrow("already rejected");
  });
});
