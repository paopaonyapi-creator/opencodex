// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Reviewer Council Bridge: Multi-dimensional verification and critical security blocking

import type { CouncilDecisionResult, CouncilEvidencePacket, CouncilDecisionVerdict } from "./types";

export class ReviewerCouncilBridge {
  /**
   * Evaluates structured execution evidence against Reviewer Council standards.
   * Enforces: Verified critical security finding = BLOCK.
   */
  evaluateEvidence(packet: CouncilEvidencePacket): CouncilDecisionResult {
    const blockingFindings: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    let correctnessScore = 1.0;
    let securityScore = 1.0;
    let maintainabilityScore = 1.0;
    let testsScore = 1.0;

    // 1. Security Analysis
    if (packet.securityFindings && packet.securityFindings.length > 0) {
      for (const finding of packet.securityFindings) {
        if (finding.severity === "critical") {
          blockingFindings.push(`[CRITICAL SECURITY] ${finding.rule}: ${finding.description}`);
          securityScore = Math.min(securityScore, 0.2);
        } else if (finding.severity === "high") {
          blockingFindings.push(`[HIGH SECURITY] ${finding.rule}: ${finding.description}`);
          securityScore = Math.min(securityScore, 0.5);
        } else if (finding.severity === "medium") {
          warnings.push(`[SECURITY WARNING] ${finding.rule}: ${finding.description}`);
          securityScore = Math.min(securityScore, 0.75);
        } else {
          recommendations.push(`[SECURITY NOTE] ${finding.rule}: ${finding.description}`);
          securityScore = Math.min(securityScore, 0.9);
        }
      }
    }

    // 2. Test Verification
    if (packet.testResults) {
      const { passed, failed, total } = packet.testResults;
      if (total === 0 && (packet.filesModified && packet.filesModified.length > 0)) {
        warnings.push("No automated tests were executed for these code modifications.");
        testsScore = 0.5;
        maintainabilityScore = Math.min(maintainabilityScore, 0.7);
      } else if (failed > 0) {
        blockingFindings.push(`Automated tests failed: ${failed} failed out of ${total} tests.`);
        testsScore = Math.max(0.1, (passed / total) * 0.5);
        correctnessScore = Math.min(correctnessScore, 0.4);
      } else {
        testsScore = 1.0;
      }
    }

    // 3. Diff & Plan Consistency Check
    if (packet.plan.steps.length === 0) {
      warnings.push("Implementation proceeded without an explicit structured plan.");
      maintainabilityScore = Math.min(maintainabilityScore, 0.8);
    }

    // 4. Determine Verdict
    let decision: CouncilDecisionVerdict = "approve";

    if (blockingFindings.some(f => f.includes("[CRITICAL SECURITY]"))) {
      // Hard rule: verified critical security issue = BLOCK
      decision = "block";
    } else if (blockingFindings.length > 0) {
      decision = "revise";
    } else if (warnings.length > 0) {
      decision = "approve_with_warnings";
    }

    return {
      decision,
      scores: {
        correctness: Number(correctnessScore.toFixed(2)),
        security: Number(securityScore.toFixed(2)),
        maintainability: Number(maintainabilityScore.toFixed(2)),
        tests: Number(testsScore.toFixed(2)),
      },
      blockingFindings,
      warnings,
      recommendations,
      reviewedAt: new Date().toISOString(),
    };
  }
}
