import { describe, expect, test } from "bun:test";
import { ChangeControlController } from "../src/agent-os/change-control/controller";

describe("Phase 22 — ChangeControlController & Decision Gate", () => {
  test("creates proposal and initializes blast radius", () => {
    const controller = new ChangeControlController();
    const proposal = controller.createProposal({
      title: "docs: update guide",
      description: "minor docs patch",
      author: "pao-dev",
      sourceBranch: "pao/docs",
      files: ["docs/guide.md"],
      intentCategory: "docs",
    });

    expect(proposal.id).toBeDefined();
    expect(proposal.status).toBe("proposed");
    expect(proposal.blastRadius?.riskTier).toBe("R0");
    expect(controller.getProposal(proposal.id)).toBeDefined();
  });

  test("executes sandbox and records test receipt", async () => {
    const controller = new ChangeControlController();
    const proposal = controller.createProposal({
      title: "fix: leaf bugfix",
      description: "isolated fix",
      author: "pao-dev",
      sourceBranch: "pao/fix-leaf",
      files: ["src/utils/math.ts"],
      intentCategory: "fix",
    });

    const updated = await controller.executeSandbox(proposal.id);
    expect(updated.status).toBe("testing");
    expect(updated.sandboxResult?.success).toBe(true);
    expect(updated.sandboxResult?.receipt.allPassed).toBe(true);
  });

  test("executes council audit and asserts vendor independence", () => {
    const controller = new ChangeControlController();
    const proposal = controller.createProposal({
      title: "feat: add capability",
      description: "moderate feature",
      author: "pao-dev",
      sourceBranch: "pao/feature",
      files: ["src/agent-os/skills.ts"],
      intentCategory: "feature",
    });

    const audited = controller.executeCouncilAudit(proposal.id);
    expect(audited.councilVerdict?.quorumReached).toBe(true);
    expect(audited.councilVerdict?.reviews.length).toBeGreaterThanOrEqual(2);

    // Assert vendor independence invariant
    const families = audited.councilVerdict?.reviews.map((r) => r.providerFamily) ?? [];
    const uniqueFamilies = new Set(families);
    expect(uniqueFamilies.size).toBe(families.length);
  });

  test("auto-merges R0 / R1 change when all gates and reviews pass", async () => {
    const controller = new ChangeControlController();
    const proposal = controller.createProposal({
      title: "docs: release notes",
      description: "documentation only",
      author: "pao-dev",
      sourceBranch: "pao/docs-patch",
      files: ["docs/notes.md"],
      intentCategory: "docs",
    });

    await controller.executeSandbox(proposal.id);
    controller.executeCouncilAudit(proposal.id, { overrideVerdict: "APPROVED" });

    const decision = controller.evaluateDecisionGate(proposal.id);
    expect(decision.action).toBe("auto_merge");
    expect(decision.proposal.status).toBe("completed");
    expect(decision.proposal.mergeCommitSha).toBeDefined();
  });

  test("freezes R3 change in awaiting_approval despite green tests", async () => {
    const controller = new ChangeControlController();
    const proposal = controller.createProposal({
      title: "feat: heavy refactoring",
      description: "large subsystem rewrite",
      author: "pao-dev",
      sourceBranch: "pao/refactor",
      files: [
        "src/agent-os/workflow.ts",
        "src/agent-os/tasks.ts",
        "src/agent-os/registry.ts",
        "src/agent-os/policy.ts",
      ],
      intentCategory: "refactor",
    });

    await controller.executeSandbox(proposal.id);
    controller.executeCouncilAudit(proposal.id, { overrideVerdict: "APPROVED" });

    const decision = controller.evaluateDecisionGate(proposal.id);
    expect(decision.action).toBe("freeze_awaiting_approval");
    expect(decision.proposal.status).toBe("awaiting_approval");
  });

  test("freezes changes touching critical system paths regardless of risk score", async () => {
    const controller = new ChangeControlController();
    const proposal = controller.createProposal({
      title: "fix: touch router",
      description: "one line change in router",
      author: "pao-dev",
      sourceBranch: "pao/router-patch",
      files: ["src/router.ts"],
      intentCategory: "fix",
    });

    await controller.executeSandbox(proposal.id);
    controller.executeCouncilAudit(proposal.id, { overrideVerdict: "APPROVED" });

    const decision = controller.evaluateDecisionGate(proposal.id);
    expect(decision.action).toBe("freeze_awaiting_approval");
    expect(decision.reason).toContain("Critical boundaries touched");
  });

  test("supports manual operator approval, rejection, and rollback", () => {
    const controller = new ChangeControlController();
    const p1 = controller.createProposal({
      title: "proposal 1",
      description: "test",
      author: "pao",
      sourceBranch: "pao/1",
      files: ["file1.ts"],
    });

    const approved = controller.approve(p1.id, "senior-operator");
    expect(approved.status).toBe("completed");
    expect(approved.mergeCommitSha).toBeDefined();

    const p2 = controller.createProposal({
      title: "proposal 2",
      description: "test",
      author: "pao",
      sourceBranch: "pao/2",
      files: ["file2.ts"],
    });

    const rejected = controller.reject(p2.id, "senior-operator", "Needs rework on caching");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toContain("rework on caching");

    const rolledBack = controller.rollback(p1.id, "emergency-responder");
    expect(rolledBack.status).toBe("rolled_back");
    expect(rolledBack.rollbackCommitSha).toBeDefined();
  });
});
