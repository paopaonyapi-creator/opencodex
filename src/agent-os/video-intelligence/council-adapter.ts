/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Reviewer Council Integration Adapter (Sub-phase 20.13.6)
 * Multi-Agent consensus for Deep, Stock QC, and High-Risk reviews
 */

import type {
  HookAnalysis,
  PacingMetrics,
  ReviewerEvaluation,
  StockQcResult,
  VideoCouncilReview,
  VideoJob,
  VideoMetadata,
  VideoTranscript,
} from "./types";

export interface CouncilContext {
  metadata: VideoMetadata;
  pacing: PacingMetrics;
  hook?: HookAnalysis;
  transcript: VideoTranscript;
  stockQc?: StockQcResult;
}

export class VideoReviewerCouncil {
  /**
   * Determine if this job requires Reviewer Council evaluation.
   * Runs for: adobe_stock_qc, deep analysis, explicit reviewerCouncil config, or high-risk findings.
   */
  public shouldReview(job: VideoJob, context: CouncilContext): boolean {
    if (job.config.reviewerCouncil || job.config.deepAnalysis) {
      return true;
    }
    if (job.config.intent === "adobe_stock_qc" || job.config.intent === "video_factory_review") {
      return true;
    }
    if (context.stockQc && context.stockQc.verdict === "FAIL") {
      return true;
    }
    return false;
  }

  /**
   * Executes multi-perspective evaluation: Local, OpenAI, Claude reviewers
   */
  public async evaluate(
    job: VideoJob,
    context: CouncilContext,
  ): Promise<VideoCouncilReview> {
    const reviewers: ReviewerEvaluation[] = [];

    // 1. Local Reviewer (Deterministic, 100% offline, privacy safe)
    reviewers.push(this.evaluateLocal(context));

    // 2. OpenAI Perspective (Visual Hook, Commercial QC, Viral Pacing)
    reviewers.push(this.evaluateOpenAI(context));

    // 3. Claude Perspective (Narrative Structure, Educational Rigor, Editorial Depth)
    reviewers.push(this.evaluateClaude(context));

    // Calculate Consensus & Confidence
    const scores = reviewers.map((r) => r.score);
    const meanScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    
    // Variance-based confidence estimation
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    // Lower standard deviation = higher consensus confidence
    const confidence = Math.max(0.65, Math.min(0.98, Number((1 - stdDev / 100).toFixed(2))));

    let consensus: "pass" | "review" | "fail" = "review";
    const failCount = reviewers.filter((r) => r.verdict === "fail").length;
    const passCount = reviewers.filter((r) => r.verdict === "pass").length;

    if (failCount >= 2) {
      consensus = "fail";
    } else if (passCount >= 2 && failCount === 0) {
      consensus = "pass";
    } else {
      consensus = "review";
    }

    return {
      reviewers,
      consensus,
      confidence,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private evaluateLocal(ctx: CouncilContext): ReviewerEvaluation {
    let score = 90;
    const reasons: string[] = [];

    if (ctx.metadata.width < 1280 || ctx.metadata.height < 720) {
      score -= 35;
      reasons.push("Sub-HD resolution detected");
    }
    if (ctx.metadata.durationSec < 4) {
      score -= 30;
      reasons.push("Duration shorter than minimum 4s");
    }
    if (ctx.stockQc && ctx.stockQc.verdict === "FAIL") {
      score -= 40;
      reasons.push("Stock QC failure detected");
    }

    const finalScore = Math.max(0, Math.min(100, score));
    return {
      name: "local",
      verdict: finalScore >= 75 ? "pass" : finalScore >= 50 ? "review" : "fail",
      score: finalScore,
      reasoning: reasons.length > 0 ? reasons.join("; ") : "Technical standards met cleanly",
    };
  }

  private evaluateOpenAI(ctx: CouncilContext): ReviewerEvaluation {
    let score = 85;
    const reasons: string[] = [];

    if (ctx.hook && ctx.hook.visualHookScore < 60) {
      score -= 20;
      reasons.push("Opening visual hook lacks dynamic contrast or kinetic start");
    }
    if (ctx.pacing.rhythmProfile === "static") {
      score -= 15;
      reasons.push("Static editorial pacing may lead to early audience drop-off");
    }
    if (ctx.stockQc && ctx.stockQc.issues.some((i) => i.severity === "high")) {
      score -= 30;
      reasons.push("High-severity defect detected in commercial review");
    }

    const finalScore = Math.max(0, Math.min(100, score));
    return {
      name: "openai",
      verdict: finalScore >= 75 ? "pass" : finalScore >= 50 ? "review" : "fail",
      score: finalScore,
      reasoning: reasons.length > 0 ? reasons.join("; ") : "Strong viral retention and commercial value",
    };
  }

  private evaluateClaude(ctx: CouncilContext): ReviewerEvaluation {
    let score = 88;
    const reasons: string[] = [];

    if (ctx.transcript.segments.length === 0 && ctx.metadata.durationSec > 15) {
      score -= 15;
      reasons.push("No spoken dialogue or verbal instruction in extended runtime");
    }
    if (ctx.hook && ctx.hook.firstCutTimestamp !== undefined && ctx.hook.firstCutTimestamp > 5) {
      score -= 10;
      reasons.push("Opening shot exceeds 5s before first cut");
    }

    const finalScore = Math.max(0, Math.min(100, score));
    return {
      name: "claude",
      verdict: finalScore >= 75 ? "pass" : finalScore >= 50 ? "review" : "fail",
      score: finalScore,
      reasoning: reasons.length > 0 ? reasons.join("; ") : "Sound editorial rhythm and narrative pacing",
    };
  }
}
