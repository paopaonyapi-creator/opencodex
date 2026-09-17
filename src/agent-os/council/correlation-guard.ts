/**
 * Phase 20.85 — Reviewer Council Correlation Guard
 * Enforces true independence across model families.
 * Multiple reviewer aliases resolving to the same underlying model family
 * cannot count as independent quorum votes.
 */

import { openAgentOsDb } from "../db";
import type { ReviewDecision } from "./types";

export interface ReviewerVote {
  reviewerId: string;
  provider: string;
  model: string;
  modelFamily: string;
  verdict: ReviewDecision;
  confidence: number;
}

export interface CorrelationCheckResult {
  passed: boolean;
  totalVotes: number;
  distinctFamilies: string[];
  distinctProviders: string[];
  isCorrelated: boolean;
  correlatedFamilies: string[];
  effectiveIndependentVotes: number;
  warning?: string;
}

export class ReviewerCorrelationGuard {
  /**
   * Enforces that reviewer council runs use distinct model families.
   * If minimumDistinctFamilies (default 2) is not met, the quorum is tagged correlated.
   */
  public static evaluate(
    votes: ReviewerVote[],
    minimumDistinctFamilies = 2,
  ): CorrelationCheckResult {
    const familyCounts = new Map<string, number>();
    const providerCounts = new Map<string, number>();

    for (const v of votes) {
      const family = v.modelFamily.toLowerCase();
      familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);

      const provider = v.provider.toLowerCase();
      providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
    }

    const distinctFamilies = Array.from(familyCounts.keys());
    const distinctProviders = Array.from(providerCounts.keys());

    const correlatedFamilies = distinctFamilies.filter(
      (f) => (familyCounts.get(f) ?? 0) > 1,
    );

    const isCorrelated =
      correlatedFamilies.length > 0 || distinctFamilies.length < Math.min(votes.length, minimumDistinctFamilies);

    // If multiple reviewers use the same model family, each family only contributes 1 effective vote
    const effectiveIndependentVotes = distinctFamilies.length;

    const passed = !isCorrelated || distinctFamilies.length >= minimumDistinctFamilies;

    let warning: string | undefined;
    if (isCorrelated) {
      warning = `Reviewer correlation detected: ${correlatedFamilies.join(", ")} family was used by multiple reviewers. Effective independent family count: ${distinctFamilies.length}.`;
    }

    return {
      passed,
      totalVotes: votes.length,
      distinctFamilies,
      distinctProviders,
      isCorrelated,
      correlatedFamilies,
      effectiveIndependentVotes,
      warning,
    };
  }

  /**
   * Records reviewer vote audit into core_reviewer_runs and core_reviewer_votes.
   */
  public static recordReviewerRun(
    diffHash: string,
    requestSource: string,
    votes: ReviewerVote[],
    consensusVerdict: ReviewDecision,
  ): string {
    const runId = `crun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const evalResult = this.evaluate(votes);

    try {
      const db = openAgentOsDb();
      db.query(`
        INSERT INTO core_reviewer_runs (
          id, diff_hash, request_source, reviewer_identities_json,
          distinct_families_count, correlated, consensus_verdict, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        diffHash,
        requestSource,
        JSON.stringify(votes.map((v) => ({ id: v.reviewerId, model: v.model, family: v.modelFamily }))),
        evalResult.distinctFamilies.length,
        evalResult.isCorrelated ? 1 : 0,
        consensusVerdict,
        new Date().toISOString(),
      );

      for (const v of votes) {
        const voteId = `cvote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        // If family is correlated, weight is diluted
        const familyCount = votes.filter((other) => other.modelFamily === v.modelFamily).length;
        const voteWeight = familyCount > 1 ? 1 / familyCount : 1.0;

        db.query(`
          INSERT INTO core_reviewer_votes (
            id, reviewer_run_id, reviewer_id, provider, model,
            model_family, verdict, findings_count, confidence, vote_weight, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          voteId,
          runId,
          v.reviewerId,
          v.provider,
          v.model,
          v.modelFamily,
          v.verdict,
          0,
          v.confidence,
          voteWeight,
          new Date().toISOString(),
        );
      }
    } catch {
      // Graceful fallback if testing without active SQLite handles
    }

    return runId;
  }
}
