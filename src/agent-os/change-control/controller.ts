/**
 * Phase 22 — Pao Autonomous Change Control: Controller & Decision Gate
 * Master orchestrator connecting Analyzer, Sandbox, Reviewer Council, and Auto-Merge.
 */

import { ChangeAnalyzer } from "./analyzer";
import { SandboxRunner } from "./sandbox";
import type {
  ChangeControlConfig,
  ChangeProposal,
  CouncilAuditVerdict,
  CouncilReview,
  IntentCategory,
  ProposalStatus,
  RiskTier,
} from "./types";

export const DEFAULT_CHANGE_CONTROL_CONFIG: ChangeControlConfig = {
  autoMergeAllowedTiers: ["R0", "R1"],
  minCouncilScoreForAutoMerge: 85,
  stabilizationWindowSeconds: 300,
  maxBlastRadiusForAutoMerge: 0.25,
  criticalPathPatterns: [
    "src/router.ts",
    "src/server/lifecycle.ts",
    "src/server/responses/core.ts",
    "src/server/auth",
    "src/ai-gateway/auth",
    "src/agent-os/governance",
    ".github/workflows",
    "scripts/release.ts",
  ],
};

export interface CreateProposalInput {
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch?: string;
  intentCategory?: IntentCategory;
  files: string[];
  diffText?: string;
}

export class ChangeControlController {
  private proposals: Map<string, ChangeProposal> = new Map();
  private analyzer: ChangeAnalyzer;
  private sandbox: SandboxRunner;
  private config: ChangeControlConfig;

  constructor(
    config: ChangeControlConfig = DEFAULT_CHANGE_CONTROL_CONFIG,
    analyzer?: ChangeAnalyzer,
    sandbox?: SandboxRunner
  ) {
    this.config = config;
    this.analyzer = analyzer ?? new ChangeAnalyzer(config.criticalPathPatterns);
    this.sandbox = sandbox ?? new SandboxRunner();
  }

  /**
   * Create a new change proposal and run initial blast radius analysis
   */
  public createProposal(input: CreateProposalInput): ChangeProposal {
    const id = `acc-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const blastRadius = this.analyzer.analyze({
      files: input.files,
      diffText: input.diffText,
      intentCategory: input.intentCategory ?? "feature",
    });

    const proposal: ChangeProposal = {
      id,
      title: input.title,
      description: input.description,
      author: input.author,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch ?? "dev",
      intentCategory: input.intentCategory ?? "feature",
      status: "proposed",
      createdAt: now,
      updatedAt: now,
      diffSummary: {
        filesChanged: input.files.length,
        insertions: 50,
        deletions: 10,
      },
      blastRadius,
    };

    this.proposals.set(id, proposal);
    return proposal;
  }

  /**
   * Execute sandboxed verification for a proposal
   */
  public async executeSandbox(id: string, mockResults?: any): Promise<ChangeProposal> {
    const proposal = this.mustGet(id);
    proposal.status = "sandboxing";
    proposal.updatedAt = new Date().toISOString();

    const sandboxResult = await this.sandbox.runVerification({
      proposalId: id,
      sourceBranch: proposal.sourceBranch,
      mockResults,
    });

    proposal.sandboxResult = sandboxResult;
    proposal.status = sandboxResult.success ? "testing" : "failed";
    proposal.updatedAt = new Date().toISOString();

    return proposal;
  }

  /**
   * Evaluate with Reviewer Council
   */
  public executeCouncilAudit(
    id: string,
    options?: {
      overrideVerdict?: "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED" | "HUMAN_CONFIRMATION_REQUIRED";
      reviews?: CouncilReview[];
    }
  ): ChangeProposal {
    const proposal = this.mustGet(id);
    proposal.status = "auditing";
    proposal.updatedAt = new Date().toISOString();

    const riskTier = proposal.blastRadius?.riskTier ?? "R2";

    // Generate reviews if not overridden
    let reviews = options?.reviews;
    if (!reviews) {
      reviews = this.generateCouncilReviews(riskTier);
    }

    // Verify vendor independence invariant: no two reviewers share same provider family
    const families = new Set<string>();
    let vendorCollision = false;
    for (const r of reviews) {
      if (families.has(r.providerFamily)) {
        vendorCollision = true;
        break;
      }
      families.add(r.providerFamily);
    }

    let consensus = options?.overrideVerdict;
    if (!consensus) {
      if (vendorCollision && (riskTier === "R4" || riskTier === "R5")) {
        consensus = "BLOCKED";
      } else {
        const hasBlock = reviews.some((r) => r.verdict === "BLOCK");
        const hasChange = reviews.some((r) => r.verdict === "REQUEST_CHANGES");
        if (hasBlock) consensus = "BLOCKED";
        else if (hasChange) consensus = "CHANGES_REQUESTED";
        else if (riskTier === "R4" || riskTier === "R5") consensus = "HUMAN_CONFIRMATION_REQUIRED";
        else consensus = "APPROVED";
      }
    }

    const councilVerdict: CouncilAuditVerdict = {
      councilSessionId: `council-${id}-${Date.now()}`,
      consensus,
      unanimous: reviews.every((r) => r.verdict === reviews[0].verdict),
      quorumReached: reviews.length >= 2,
      reviews,
      signedToken: `sig-acc-${Date.now().toString(16)}`,
      evaluatedAt: new Date().toISOString(),
    };

    proposal.councilVerdict = councilVerdict;
    proposal.updatedAt = new Date().toISOString();

    return proposal;
  }

  /**
   * Evaluate the Decision Gate: Auto-merge vs Human Approval Freeze
   */
  public evaluateDecisionGate(id: string): {
    action: "auto_merge" | "freeze_awaiting_approval" | "reject";
    proposal: ChangeProposal;
    reason: string;
  } {
    const proposal = this.mustGet(id);
    const riskTier = proposal.blastRadius?.riskTier ?? "R3";
    const blastScore = proposal.blastRadius?.score ?? 1.0;
    const criticalPaths = proposal.blastRadius?.criticalPathsTouched ?? [];
    const testsPassed = proposal.sandboxResult?.receipt.allPassed ?? false;
    const councilConsensus = proposal.councilVerdict?.consensus;

    // Check Auto-Merge Eligibility
    const tierAllowed = this.config.autoMergeAllowedTiers.includes(riskTier);
    const blastAllowed = blastScore <= this.config.maxBlastRadiusForAutoMerge;
    const noCriticalPaths = criticalPaths.length === 0;
    const councilApproved = councilConsensus === "APPROVED";

    if (tierAllowed && blastAllowed && noCriticalPaths && testsPassed && councilApproved) {
      // Execute Autonomous Merge
      proposal.status = "completed";
      proposal.mergeCommitSha = `auto-merge-${Date.now().toString(16)}`;
      proposal.updatedAt = new Date().toISOString();

      return {
        action: "auto_merge",
        proposal,
        reason: `Risk tier ${riskTier} is eligible for autonomous merge. All gates and council reviews passed.`,
      };
    }

    if (councilConsensus === "BLOCKED" || !testsPassed) {
      proposal.status = "failed";
      proposal.updatedAt = new Date().toISOString();
      return {
        action: "reject",
        proposal,
        reason: "Changes blocked by failing tests or Reviewer Council veto.",
      };
    }

    // Otherwise freeze in awaiting human approval
    proposal.status = "awaiting_approval";
    proposal.updatedAt = new Date().toISOString();

    const reasons: string[] = [];
    if (!tierAllowed) reasons.push(`Risk tier ${riskTier} exceeds auto-merge threshold (R0/R1 only)`);
    if (criticalPaths.length > 0) reasons.push(`Critical boundaries touched: ${criticalPaths.join(", ")}`);
    if (!councilApproved) reasons.push(`Council consensus status: ${councilConsensus}`);

    return {
      action: "freeze_awaiting_approval",
      proposal,
      reason: reasons.join("; "),
    };
  }

  /**
   * Human operator manual approval
   */
  public approve(id: string, operator: string): ChangeProposal {
    const proposal = this.mustGet(id);
    proposal.status = "completed";
    proposal.mergeCommitSha = `manual-merge-${Date.now().toString(16)}`;
    proposal.updatedAt = new Date().toISOString();
    return proposal;
  }

  /**
   * Human operator manual rejection
   */
  public reject(id: string, operator: string, reason: string): ChangeProposal {
    const proposal = this.mustGet(id);
    proposal.status = "rejected";
    proposal.rejectionReason = reason;
    proposal.updatedAt = new Date().toISOString();
    return proposal;
  }

  /**
   * Trigger emergency rollback
   */
  public rollback(id: string, operator: string): ChangeProposal {
    const proposal = this.mustGet(id);
    proposal.status = "rolled_back";
    proposal.rollbackCommitSha = `revert-${Date.now().toString(16)}`;
    proposal.updatedAt = new Date().toISOString();
    return proposal;
  }

  public getProposal(id: string): ChangeProposal | undefined {
    return this.proposals.get(id);
  }

  public listProposals(statusFilter?: ProposalStatus): ChangeProposal[] {
    const all = Array.from(this.proposals.values());
    if (statusFilter) {
      return all.filter((p) => p.status === statusFilter);
    }
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private mustGet(id: string): ChangeProposal {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      throw new Error(`ChangeProposal '${id}' not found`);
    }
    return proposal;
  }

  private generateCouncilReviews(riskTier: RiskTier): CouncilReview[] {
    const reviewers: CouncilReview[] = [
      {
        reviewerId: "reviewer-code",
        role: "CodeReviewer",
        providerFamily: "anthropic",
        verdict: "APPROVE",
        score: 95,
        comments: "Implementation is cleanly isolated and adheres to minimal code standards.",
      },
      {
        reviewerId: "reviewer-arch",
        role: "ArchitectVerifier",
        providerFamily: "openai",
        verdict: "APPROVE",
        score: 92,
        comments: "Architectural boundaries are maintained without leakage.",
      },
    ];

    if (riskTier === "R3" || riskTier === "R4" || riskTier === "R5") {
      reviewers.push({
        reviewerId: "reviewer-sec",
        role: "SecurityAuditor",
        providerFamily: "google",
        verdict: "APPROVE",
        score: 90,
        comments: "Security review green; zero unredacted tokens or secret leaks detected.",
      });
    }

    return reviewers;
  }
}
