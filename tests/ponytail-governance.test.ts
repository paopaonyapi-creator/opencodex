// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Automated Unit & Integration Tests

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  PonytailGovernanceGate,
  getPonytailGovernanceGate,
  ModeRouter,
  TaskClassifier,
  ReuseScanner,
  DependencyGuard,
  DiffGuard,
  CouncilTrigger,
  GovernanceReporter,
  DebtLedger,
  getGovernanceConfig,
  updateGovernanceConfig,
  resetGovernanceConfigForTests,
} from "../src/agent-os/governance";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getReviewerCouncilBridge } from "../src/agent-os/desktop-runtime";

describe("Phase 20.9: Pao-hubPro × Ponytail Minimal-Code Governance Layer", () => {
  beforeEach(() => {
    resetGovernanceConfigForTests();
  });

  afterEach(() => {
    resetGovernanceConfigForTests();
  });

  // --------------------------------------------------------------------------
  // 1. Governance Configuration & Defaults
  // --------------------------------------------------------------------------
  describe("1. Configuration & Safe Defaults", () => {
    it("provides safe production defaults", () => {
      const config = getGovernanceConfig();
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe("full");
      expect(config.diffGuard).toBe(true);
      expect(config.dependencyGuard).toBe(true);
      expect(config.reuseScan).toBe(true);
      expect(config.reviewerCouncil).toBe(true);
    });

    it("allows runtime configuration overrides", () => {
      updateGovernanceConfig({ mode: "ultra", diffGuard: false });
      const updated = getGovernanceConfig();
      expect(updated.mode).toBe("ultra");
      expect(updated.diffGuard).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Mode Router & Subagent Scoping
  // --------------------------------------------------------------------------
  describe("2. Mode Router & Subagent Scoping", () => {
    const router = new ModeRouter();

    it("routes tasks to expected modes", () => {
      expect(router.resolveMode({ taskType: "planning" })).toBe("lite");
      expect(router.resolveMode({ taskType: "refactor" })).toBe("ultra");
      expect(router.resolveMode({ taskType: "research" })).toBe("off");
      expect(router.resolveMode({ taskType: "documentation" })).toBe("off");
      expect(router.resolveMode({ taskType: "bugfix" })).toBe("full");
      expect(router.resolveMode({ taskType: "feature" })).toBe("full");
    });

    it("strictly disables governance for reviewer agents (independent judgment)", () => {
      expect(router.shouldApplyGovernance("reviewer_agent")).toBe(false);
      expect(router.shouldApplyGovernance("reviewer_council_member")).toBe(false);
      expect(router.shouldApplyGovernance("security_reviewer")).toBe(false);
      expect(router.shouldApplyGovernance("research_agent")).toBe(false);

      expect(router.resolveMode({ agentType: "reviewer_agent" })).toBe("off");
    });

    it("enables governance for coding, bugfix, and refactor agents", () => {
      expect(router.shouldApplyGovernance("coding_agent")).toBe(true);
      expect(router.shouldApplyGovernance("bugfix_agent")).toBe(true);
      expect(router.shouldApplyGovernance("refactor_engineer")).toBe(true);
    });

    it("handles explicit mode overrides and invalid fallbacks safely", () => {
      expect(router.resolveMode({ explicitMode: "lite" })).toBe("lite");
      expect(router.resolveMode({ explicitMode: "ultra" })).toBe("ultra");
      expect(router.resolveMode({ explicitMode: "invalid" as any })).toBe("full");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Task Classifier & Risk Categorization
  // --------------------------------------------------------------------------
  describe("3. Task Classifier & Risk Categorization", () => {
    const classifier = new TaskClassifier();

    it("classifies bugfixes, features, and refactors accurately", () => {
      const bugfix = classifier.classify("Fix null pointer error in request body parser");
      expect(bugfix.taskType).toBe("bugfix");
      expect(bugfix.risk).toBe("low");

      const refactor = classifier.classify("Refactor and dedup agent mode handlers");
      expect(refactor.taskType).toBe("refactor");
      expect(refactor.risk).toBe("medium");

      const docs = classifier.classify("Update README.md guide and API tutorials");
      expect(docs.taskType).toBe("documentation");
      expect(docs.risk).toBe("low");
    });

    it("flags security and auth tasks with high risk and council triggers", () => {
      const auth = classifier.classify("Update JWT token validation and rotate secret keys");
      expect(auth.risk).toBe("high");
      expect(auth.triggersReviewerCouncil).toBe(true);
      expect(auth.sensitiveAreas).toContain("authentication_and_secrets");
    });

    it("flags destructive operations as critical risk", () => {
      const destructive = classifier.classify("rm -rf old build artifacts and drop table cache");
      expect(destructive.risk).toBe("critical");
      expect(destructive.triggersReviewerCouncil).toBe(true);
      expect(destructive.sensitiveAreas).toContain("destructive_file_ops");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Reuse Scanner
  // --------------------------------------------------------------------------
  describe("4. Reuse Scanner (Repository Inspection)", () => {
    const scanner = new ReuseScanner();

    it("detects existing repository modules for common keywords", () => {
      const result = scanner.scan(["desktop", "runtime"]);
      expect(result.hasExistingEquivalent).toBe(true);
      expect(result.suggestedRung).toBe("rung_2_reuse");
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates.some((c) => c.filePath.includes("desktop-runtime"))).toBe(true);
    });

    it("suggests local patch when no existing equivalent matches", () => {
      const result = scanner.scan(["quantum_teleportation_flux_capacitor_xyz"]);
      expect(result.hasExistingEquivalent).toBe(false);
      expect(result.suggestedRung).toBe("rung_6_local_patch");
    });
  });

  // --------------------------------------------------------------------------
  // 5. Dependency Guard
  // --------------------------------------------------------------------------
  describe("5. Dependency Guard", () => {
    const guard = new DependencyGuard();

    it("recognizes already installed packages", () => {
      expect(guard.isInstalled("typescript")).toBe(true);
      const decision = guard.evaluateProposal({
        packageName: "typescript",
        reason: "compile source code",
      });
      expect(decision.allowed).toBe(true);
      expect(decision.existingDependencyAvailable).toBe(true);
    });

    it("rejects packages where stdlib or Bun native APIs provide equivalents", () => {
      const uuidDecision = guard.evaluateProposal({
        packageName: "uuid",
        reason: "generate random IDs",
      });
      expect(uuidDecision.allowed).toBe(false);
      expect(uuidDecision.stdlibAvailable).toBe(true);
      expect(uuidDecision.reason).toContain("node:crypto");

      const axiosDecision = guard.evaluateProposal({
        packageName: "axios",
        reason: "HTTP requests",
      });
      expect(axiosDecision.allowed).toBe(false);
      expect(axiosDecision.stdlibAvailable).toBe(true);
      expect(axiosDecision.reason).toContain("fetch");

      const sqliteDecision = guard.evaluateProposal({
        packageName: "better-sqlite3",
        reason: "database connection",
      });
      expect(sqliteDecision.allowed).toBe(false);
      expect(sqliteDecision.nativeAvailable).toBe(true);
      expect(sqliteDecision.reason).toContain("bun:sqlite");
    });

    it("rejects dependencies with cosmetic-only justification", () => {
      const decision = guard.evaluateProposal({
        packageName: "super-fancy-sugar-syntax",
        reason: "I want less code and cleaner syntax",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("cosmetic");
    });

    it("allows dependencies with protocol/technical justification subject to review", () => {
      const decision = guard.evaluateProposal({
        packageName: "@grpc/grpc-js",
        reason: "required protocol implementation for remote gRPC streaming",
        isProtocolRequired: true,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.securityReviewNeeded).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Diff Guard
  // --------------------------------------------------------------------------
  describe("6. Diff Guard", () => {
    const diffGuard = new DiffGuard();

    it("successfully inspects git status and produces clean scope summary", () => {
      const summary = diffGuard.inspectDiff();
      expect(typeof summary.filesChanged).toBe("number");
      expect(typeof summary.insertions).toBe("number");
      expect(typeof summary.deletions).toBe("number");
      expect(Array.isArray(summary.warnings)).toBe(true);
    });

    it("warns when a small bugfix touches an unusually large number of files", () => {
      const evaluation = diffGuard.evaluateScope(
        {
          filesChanged: 12,
          insertions: 50,
          deletions: 10,
          newFiles: [],
          deletedFiles: [],
          modifiedFiles: [],
          publicContractChanged: false,
          securityGuardsAltered: false,
          passed: true,
          warnings: [],
        },
        "bugfix"
      );
      expect(evaluation.warnings.some((w) => w.includes("exceeds recommended"))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Reviewer Council Trigger
  // --------------------------------------------------------------------------
  describe("7. Reviewer Council Trigger", () => {
    const trigger = new CouncilTrigger();

    it("triggers on high and critical risks", () => {
      expect(trigger.shouldTriggerCouncil({ risk: "high", sensitiveAreas: [] })).toBe(true);
      expect(trigger.shouldTriggerCouncil({ risk: "critical", sensitiveAreas: [] })).toBe(true);
      expect(trigger.shouldTriggerCouncil({ risk: "low", sensitiveAreas: [] })).toBe(false);
    });

    it("triggers when security guards or public contracts are modified", () => {
      expect(
        trigger.shouldTriggerCouncil({
          risk: "low",
          sensitiveAreas: [],
          diffSummary: {
            filesChanged: 1,
            insertions: 5,
            deletions: 2,
            newFiles: [],
            deletedFiles: [],
            modifiedFiles: [],
            publicContractChanged: true,
            securityGuardsAltered: false,
            passed: true,
            warnings: [],
          },
        })
      ).toBe(true);
    });

    it("evaluates council reviews using the Reviewer Council bridge", async () => {
      const verdict = await trigger.evaluate({
        taskId: "task-gov-test",
        requirement: "Add token rotation endpoint",
        decision: {
          mode: "full",
          taskType: "security",
          risk: "high",
          selectedRung: "rung_6_local_patch",
          existingCandidates: [],
          newDependencyRequired: false,
          expectedChangeScope: { files: 2, kind: "incremental" },
          requiresReviewerCouncil: true,
          reasoningSummary: "Security task",
          evaluatedAt: new Date().toISOString(),
        },
        sensitiveAreas: ["authentication_and_secrets"],
      });

      expect(verdict.verdict).toBeDefined();
      expect(Array.isArray(verdict.recommendedMitigations)).toBe(true);
    });

    it("incorporates governance perspective into council evaluation", async () => {
      const bridge = getReviewerCouncilBridge();
      const councilRes = await bridge.evaluate({
        runId: "test-run",
        mission: "Create new color logger",
        risk: "high",
        toolCall: {
          id: "call-1",
          runId: "test-run",
          toolId: "builtin__write_to_file",
          namespace: "builtin",
          name: "write_to_file",
          risk: "high",
          arguments: { path: "src/logger.ts" },
        },
        governanceEvidence: {
          selectedRung: "rung_2_reuse",
          taskType: "feature",
          risk: "high",
          reasoningSummary: "Existing logger found in src/agent-os/desktop-runtime/audit/audit-logger.ts",
          existingCandidates: ["src/agent-os/desktop-runtime/audit/audit-logger.ts"],
        },
      });

      expect(councilRes.reasons.some((r) => r.includes("Reuse candidates exist"))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Governance Reporter
  // --------------------------------------------------------------------------
  describe("8. Governance Reporter", () => {
    const reporter = new GovernanceReporter();

    it("generates structured and non-confidential reports", () => {
      const report = reporter.generateReport({
        decision: {
          mode: "full",
          taskType: "bugfix",
          risk: "medium",
          selectedRung: "rung_2_reuse",
          existingCandidates: ["src/lib/retry.ts"],
          newDependencyRequired: false,
          expectedChangeScope: { files: 2, kind: "incremental" },
          requiresReviewerCouncil: false,
          reasoningSummary: "Reuse existing retry logic",
          evaluatedAt: new Date().toISOString(),
        },
        diffSummary: {
          filesChanged: 2,
          insertions: 18,
          deletions: 7,
          newFiles: [],
          deletedFiles: [],
          modifiedFiles: ["src/client.ts", "src/lib/retry.ts"],
          publicContractChanged: false,
          securityGuardsAltered: false,
          passed: true,
          warnings: [],
        },
      });

      expect(report.status).toBe("PASS");
      expect(report.summaryText).toContain("Governance mode: full");
      expect(report.summaryText).toContain("Task: bugfix");
      expect(report.summaryText).toContain("Selected rung: rung_2_reuse");
      expect(report.summaryText).toContain("Diff: +18 / -7");

      const markdown = reporter.formatMarkdown(report);
      expect(markdown).toContain("### 🛡️ Pao-hubPro × Ponytail Governance Report");
    });
  });

  // --------------------------------------------------------------------------
  // 9. Technical Debt Ledger
  // --------------------------------------------------------------------------
  describe("9. Technical Debt Ledger (Markdown)", () => {
    const testDebtPath = join(process.cwd(), "docs", "governance", "test-debt.md");

    afterEach(() => {
      if (existsSync(testDebtPath)) {
        try {
          unlinkSync(testDebtPath);
        } catch {
          // Best-effort
        }
      }
    });

    it("records and parses technical debt entries", () => {
      const ledger = new DebtLedger(testDebtPath);
      expect(ledger.listDebts().length).toBe(0);

      const recorded = ledger.recordDebt({
        area: "desktop-runtime",
        shortcut: "In-memory cache for pending approvals instead of external store",
        reason: "Single instance execution during Phase 20.9",
        risk: "low",
        triggerToRevisit: "Multi-instance clustering in Phase 22",
        relatedFiles: ["src/agent-os/desktop-runtime/approval/approval-gateway.ts"],
        owner: "pao-core",
        status: "open",
      });

      expect(recorded.id).toContain("DEBT-");
      expect(existsSync(testDebtPath)).toBe(true);

      const debts = ledger.listDebts();
      expect(debts.length).toBe(1);
      expect(debts[0].shortcut).toBe("In-memory cache for pending approvals instead of external store");
      expect(debts[0].status).toBe("open");
    });
  });

  // --------------------------------------------------------------------------
  // 10. End-to-End Ponytail Governance Gate
  // --------------------------------------------------------------------------
  describe("10. End-to-End Ponytail Governance Gate", () => {
    const gate = getPonytailGovernanceGate();

    it("evaluates a standard coding task through the full 7-rung ladder", () => {
      const decision = gate.evaluateTask("Add retry support for API client using existing utils");
      expect(decision.mode).toBe("full");
      expect(decision.selectedRung).toBeDefined();
      expect(decision.evaluatedAt).toBeDefined();

      const prompt = gate.buildGovernanceSystemPrompt(decision);
      expect(prompt).toContain("=== PAO-HUBPRO MINIMAL-CODE GOVERNANCE (PONYTAIL) ===");
      expect(prompt).toContain("Reuse before creation");
      expect(prompt).toContain("No dependencies for cosmetic LOC reduction");
    });

    it("disables governance cleanly when PAO_GOVERNANCE_ENABLED is false", () => {
      updateGovernanceConfig({ enabled: false });
      const decision = gate.evaluateTask("Refactor all endpoints");
      expect(decision.mode).toBe("off");
      expect(decision.requiresReviewerCouncil).toBe(false);
      const prompt = gate.buildGovernanceSystemPrompt(decision);
      expect(prompt).toBe("");
    });
  });
});
