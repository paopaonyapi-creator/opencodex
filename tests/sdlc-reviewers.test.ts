// Phase 20.2 — Software Reviewer Council Unit Tests
// Tests multi-role evaluation, reviewer independence, critical finding veto, consensus calculation, and provider degradation.

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { SoftwareReviewerCouncil, runReviewCouncil } from "../src/agent-os/sdlc/reviewers";
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

describe("SDLC Reviewer Council — SoftwareReviewerCouncil", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("evaluates all 5 council roles with PASS verdict and records reviews", async () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Council Review Test",
      sourceIdea: "Testing multi-role council evaluation",
    });

    const result = await SoftwareReviewerCouncil.evaluateCycle(cycle.id);

    expect(result.cycleId).toBe(cycle.id);
    expect(result.reviews.length).toBe(5);
    expect(result.hasBlockingFindings).toBe(false);
    expect(result.overallVerdict).toBe("PASS");
    expect(result.consensusScore).toBeGreaterThanOrEqual(90);
    expect(result.reviewGate.status).toBe("passed");

    // Verify persisted rows in database
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM sdlc_reviews WHERE cycle_id = ?").all(cycle.id) as any[];
    expect(rows.length).toBe(5);

    const roles = rows.map(r => r.reviewer_role);
    expect(roles).toContain("Architect");
    expect(roles).toContain("Security");
    expect(roles).toContain("QA");
    expect(roles).toContain("CodeQuality");
    expect(roles).toContain("SRE");
  });

  it("enforces reviewer independence by excluding the implementer", async () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Reviewer Independence Test",
      sourceIdea: "Testing exclusion of implementer from reviewing",
    });

    // Author is council_agent_architect
    const result = await SoftwareReviewerCouncil.evaluateCycle(cycle.id, {
      implementerId: "council_agent_architect",
    });

    expect(result.reviews.length).toBe(4);
    expect(result.reviews.some(r => r.reviewerRole === "Architect")).toBe(false);
    expect(result.reviews.some(r => r.reviewerRole === "Security")).toBe(true);
  });

  it("vetoes cycle when a single CRITICAL finding is detected (Critical Finding Veto)", async () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Critical Veto Test",
      sourceIdea: "Testing critical security veto",
    });

    const result = await SoftwareReviewerCouncil.evaluateCycle(cycle.id, {
      simulatedFailure: true, // triggers Security critical injection vulnerability
    });

    expect(result.hasBlockingFindings).toBe(true);
    expect(result.overallVerdict).toBe("FAIL");
    expect(result.reviewGate.status).toBe("failed");
    expect(result.reviewGate.blockers.length).toBeGreaterThan(0);

    const secReview = result.reviews.find(r => r.reviewerRole === "Security");
    expect(secReview).toBeDefined();
    expect(secReview?.verdict).toBe("FAIL");
    expect(secReview?.findings.some(f => f.severity === "CRITICAL")).toBe(true);
  });

  it("gracefully degrades to ABSTAIN without crashing when a provider fails", async () => {
    const orchestrator = getSdlcOrchestrator();
    const cycle = orchestrator.createCycle({
      title: "Provider Degradation Test",
      sourceIdea: "Testing graceful provider degradation",
    });

    // Simulate provider failure on QA reviewer
    const result = await runReviewCouncil(cycle.id, {
      simulatedProviderOutage: "QA",
    });

    expect(result.reviews.length).toBe(5);

    const qaReview = result.reviews.find(r => r.reviewerRole === "QA");
    expect(qaReview).toBeDefined();
    expect(qaReview?.verdict).toBe("ABSTAIN");
    expect(qaReview?.summary).toContain("Gracefully degraded to ABSTAIN");

    // Other roles still completed
    const secReview = result.reviews.find(r => r.reviewerRole === "Security");
    expect(secReview?.verdict).toBe("PASS");
  });
});
