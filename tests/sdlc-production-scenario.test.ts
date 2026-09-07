// Phase 20.2 — SDLC Production Scenario End-to-End Tests
// Comprehensive verification of all 10 acceptance scenarios from the Phase 20.2 specification.

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { getSdlcOrchestrator, resetSdlcOrchestratorForTests } from "../src/agent-os/sdlc/orchestrator";
import { RecoveryEngine } from "../src/agent-os/sdlc/recovery";

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

describe("SDLC Phase 20.2 — 10 Production Acceptance Scenarios", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("executes complete lifecycle through all 10 stages and converges cleanly", async () => {
    const orchestrator = getSdlcOrchestrator();

    // 0. Initialize Cycle from Idea
    const cycle = orchestrator.createCycle({
      title: "Universal Webhook Ingestion Engine",
      sourceIdea: "Build high-throughput webhook receiver with cryptographic signature verification and retry queue",
      riskLevel: "MEDIUM",
      priority: 8,
    });

    expect(cycle.id).toBeDefined();
    expect(cycle.status).toBe("DRAFT");
    expect(cycle.featureKey.startsWith("FEAT-")).toBe(true);

    // 1. Scenario 1: /specify & /clarify
    const specResult = await orchestrator.specify(cycle.id);
    expect(specResult.requirements.length).toBeGreaterThanOrEqual(3);
    expect(specResult.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
    expect(specResult.specGate.status).toBe("passed");

    const clarifyResult = await orchestrator.clarify(cycle.id);
    expect(clarifyResult.canProceed).toBe(true);
    expect(orchestrator.getCycle(cycle.id).status).toBe("CLARIFIED");

    // 2. Scenario 2: /plan
    const planResult = await orchestrator.plan(cycle.id);
    expect(planResult.adrs.length).toBeGreaterThanOrEqual(2);
    expect(planResult.planGate.status).toBe("passed");
    expect(orchestrator.getCycle(cycle.id).status).toBe("PLANNED");

    // 3. Scenario 3: /tasks
    const tasksResult = await orchestrator.generateTasks(cycle.id);
    expect(tasksResult.tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasksResult.tasksGate.status).toBe("passed");
    expect(orchestrator.getCycle(cycle.id).status).toBe("TASKED");

    // 4. Scenario 4: /analyze (Coverage & Traceability)
    const matrix = await orchestrator.analyze(cycle.id);
    expect(matrix.totalRequirements).toBeGreaterThan(0);
    expect(matrix.totalAcceptanceCriteria).toBeGreaterThan(0);
    expect(matrix.requirementCoveragePercent).toBe(100);
    expect(matrix.acCoveragePercent).toBe(100);
    expect(matrix.gaps.filter(g => g.severity === "BLOCKING").length).toBe(0);

    // 5. Scenario 5: /checklist (Pre-Implementation Guard)
    const checklistResult = await orchestrator.evaluateChecklist(cycle.id, true);
    expect(checklistResult.passed).toBe(true);
    expect(checklistResult.score).toBe(100);
    expect(checklistResult.implementGate.status).toBe("passed");

    // 6. Scenario 6: /implement (Safe Task Execution)
    const tasks = orchestrator.getTasks(cycle.id);
    expect(tasks.length).toBeGreaterThanOrEqual(3);

    for (const task of tasks) {
      const execResult = await orchestrator.implementTask(cycle.id, task.id, "worker-prod-1");
      expect(execResult.success).toBe(true);
    }

    // Verify all tasks are completed
    const updatedTasks = orchestrator.getTasks(cycle.id);
    expect(updatedTasks.every(t => t.status === "completed")).toBe(true);

    // 7. Scenario 7: /test (Deterministic Verification)
    const testResult = await orchestrator.runTests(cycle.id, { fastCheck: true });
    expect(testResult.passed).toBe(true);
    expect(testResult.evidence.length).toBeGreaterThanOrEqual(3);
    expect(testResult.allAcsVerified).toBe(true);

    // Verify all acceptance criteria have evidence and passed status
    const updatedAcs = orchestrator.getAcceptanceCriteria(cycle.id);
    expect(updatedAcs.every(a => a.status === "passed" && a.evidenceId !== null)).toBe(true);

    // 8. Scenario 8: /review (Software Reviewer Council)
    const reviewResult = await orchestrator.runReview(cycle.id);
    expect(reviewResult.overallVerdict).toBe("PASS");
    expect(reviewResult.reviews.length).toBe(5);
    expect(reviewResult.hasBlockingFindings).toBe(false);
    expect(reviewResult.reviewGate.status).toBe("passed");

    // 9. Scenario 9: /converge (Definition of Done)
    const convergence = await orchestrator.converge(cycle.id);
    expect(convergence.converged).toBe(true);
    expect(convergence.score).toBe(100);
    expect(convergence.convergeGate.status).toBe("passed");

    // Cycle is CLOSED and completedAt is stamped
    const finalCycle = orchestrator.getCycle(cycle.id);
    expect(finalCycle.status).toBe("CLOSED");
    expect(finalCycle.completedAt).toBeDefined();

    // 10. Scenario 10: Crash Recovery & Resumption
    // Create interrupted cycle
    const interrupted = orchestrator.createCycle({
      title: "Interrupted Worker Cycle",
      sourceIdea: "Testing recovery from mid-flight crash",
    });

    // Acquire lock and simulate in-progress crash
    const db = openAgentOsDb();
    const now = Date.now();
    db.query(`
      INSERT INTO sdlc_locks (id, resource_id, owner_id, cycle_id, acquired_at, expires_at)
      VALUES ('lock-crash-1', 'task-crash-1', 'dead-worker', ?, ?, ?)
    `).run(interrupted.id, now - 10000, now - 1000); // expired lock

    db.query("UPDATE sdlc_cycles SET status = 'IMPLEMENTING', current_stage = 'IMPLEMENTING' WHERE id = ?").run(interrupted.id);

    const recoveryReport = RecoveryEngine.performStartupRecovery();
    expect(recoveryReport.clearedLocksCount).toBeGreaterThanOrEqual(1);
    expect(recoveryReport.activeCycles).toContain(interrupted.id);

    // Test pause and resume
    const paused = RecoveryEngine.pauseCycle(interrupted.id);
    expect(paused.status).toBe("PAUSED");

    const resumed = RecoveryEngine.resumeCycle(interrupted.id);
    expect(resumed.status).toBe("IMPLEMENTING");
  });
});
