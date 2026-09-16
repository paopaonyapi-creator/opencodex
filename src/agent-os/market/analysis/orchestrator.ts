/**
 * Pao Market Signal Control Plane — AI analysis orchestrator + reviewer
 * council (Phase 20.52 §12-16, §76).
 *
 * AI is ADVISORY. The default "model" is a deterministic summarizer that can
 * only restate facts already present in the trusted context — the strongest
 * possible hallucination posture. A real model can be plugged in via
 * AnalysisModelFn; its output still passes the hallucination guard before it
 * reaches a proposal, and the reviewer council remains deterministic.
 *
 * Council consensus can never override a hard risk failure: the pipeline runs
 * risk AFTER analysis and gates proposal creation on risk.passed alone.
 */

import { nextId } from "../events";
import { detectFabricationPhrases, validateAnalysisNumbers } from "./hallucination-guard";
import type { MarketAIAnalysisDraft, TrustedNumericContext } from "./analysis-types";
import type {
  CouncilConsensus,
  MarketSignal,
  MarketAIAnalysis,
  ModelRunRef,
  ReviewerVote,
  RiskAssessment,
  SignalQuality,
} from "../types";

/** Prompt version registry (§76). Bump deliberately, persist per model run. */
export const PROMPT_VERSIONS = {
  summary: "market-summary:v1",
  context: "market-context:v1",
  technicalReview: "market-technical-review:v1",
  riskCommentary: "market-risk-commentary:v1",
  devilsAdvocate: "market-devils-advocate:v1",
  council: "market-reviewer-council:v1",
} as const;

export type AnalysisStage =
  | "signal_summary"
  | "data_sufficiency"
  | "market_context"
  | "technical_context"
  | "news_context"
  | "risk_commentary"
  | "counter_thesis"
  | "reviewer_council"
  | "final_summary";

export interface AnalysisModelRequest {
  readonly stage: AnalysisStage;
  readonly signal: MarketSignal;
  readonly trustedContextSummary: string;
  readonly promptVersion: string;
}

export interface AnalysisModelResponse {
  readonly draft: Partial<MarketAIAnalysisDraft>;
  readonly modelName: string;
  readonly modelProvider: string;
}

/**
 * Pluggable model function. The default implementation never fabricates: it
 * composes its summary from the trusted context verbatim.
 */
export type AnalysisModelFn = (request: AnalysisModelRequest) => Promise<AnalysisModelResponse>;

export function deterministicAnalysisModel(): AnalysisModelFn {
  return async request => {
    const s = request.signal;
    const parts: string[] = [
      `Provider ${s.provider} issued a ${s.eventType} signal for ${s.symbol}`,
      s.direction ? `with a ${s.direction} direction` : null,
      s.entryPrice !== undefined ? `at entry ${s.entryPrice}` : null,
      s.stopPrice !== undefined ? `stop ${s.stopPrice}` : null,
      s.targetPrice !== undefined ? `target ${s.targetPrice}` : null,
      s.timeframe ? `on the ${s.timeframe} timeframe` : null,
      s.strategy ? `strategy ${s.strategy}` : null,
    ].filter((p): p is string => p !== null);
    return {
      modelName: "deterministic-restatement",
      modelProvider: "pao-market-local",
      draft: {
        summary: `${parts.join(", ")}.`,
        bullishFactors: s.direction === "long" ? ["Provider direction is long"] : [],
        bearishFactors: s.direction === "short" ? ["Provider direction is short"] : [],
        invalidationFactors: s.stopPrice !== undefined ? [`Thesis invalidates at the provider stop ${s.stopPrice}`] : [],
        riskNotes: ["Analysis is decision support; the provider score is provider opinion, not verified market data."],
        confidence: s.providerConfidence ?? 0,
        confidenceBasis: s.providerConfidence !== undefined ? ["provider-reported confidence"] : ["no provider confidence supplied"],
        dataSufficient: s.entryPrice !== undefined && s.stopPrice !== undefined,
        missingData: [s.entryPrice === undefined ? "entry price" : null, s.stopPrice === undefined ? "stop price" : null, s.targetPrice === undefined ? "target price" : null].filter(
          (m): m is string => m !== null,
        ),
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Reviewer council (deterministic; consensus cannot override hard risk)
// ---------------------------------------------------------------------------

export interface CouncilInput {
  readonly signal: MarketSignal;
  readonly draft: MarketAIAnalysisDraft;
  readonly validation: { readonly valid: boolean; readonly unsupportedClaims: readonly string[] };
  readonly riskAssessment?: RiskAssessment;
  readonly quality: SignalQuality | null;
}

export function runReviewerCouncil(input: CouncilInput): CouncilConsensus {
  const votes: ReviewerVote[] = [];

  // MarketContextReviewer — is the trusted context coherent?
  const contextReasons: string[] = [`Signal from ${input.signal.provider} verified: ${input.signal.verified}`];
  votes.push({
    reviewer: "MarketContextReviewer",
    verdict: input.signal.verified ? "support" : "oppose",
    confidence: input.signal.verified ? 0.6 : 0.9,
    reasons: contextReasons,
    warnings: input.signal.verified ? [] : ["Signal failed provider verification"],
  });

  // TechnicalReviewer — do levels cohere (entry/stop/target geometry)?
  const geometryOk =
    input.signal.entryPrice !== undefined &&
    input.signal.stopPrice !== undefined &&
    ((input.signal.direction === "long" && input.signal.stopPrice < input.signal.entryPrice) ||
      (input.signal.direction === "short" && input.signal.stopPrice > input.signal.entryPrice) ||
      input.signal.direction === undefined);
  votes.push({
    reviewer: "TechnicalReviewer",
    verdict: geometryOk ? "support" : "oppose",
    confidence: 0.5,
    reasons: geometryOk ? ["Entry/stop geometry is coherent with the stated direction"] : ["Stop is on the wrong side of entry for the stated direction"],
    warnings: geometryOk ? [] : ["Risk per unit would be negative; proposal blocked downstream regardless"],
  });

  // RiskReviewer — deterministic risk result is authoritative.
  if (input.riskAssessment) {
    votes.push({
      reviewer: "RiskReviewer",
      verdict: input.riskAssessment.passed ? "support" : "oppose",
      confidence: 1,
      reasons: input.riskAssessment.passed
        ? ["Deterministic risk assessment passed"]
        : input.riskAssessment.hardFailures.map(f => f.message),
      warnings: input.riskAssessment.warnings.map(w => w.message),
    });
  } else {
    votes.push({
      reviewer: "RiskReviewer",
      verdict: "abstain",
      confidence: 0,
      reasons: ["No risk assessment supplied yet"],
      warnings: [],
    });
  }

  // DevilsAdvocateReviewer — challenges high conviction on weak data.
  const weakData = !input.draft.dataSufficient || (input.quality !== null && (input.quality.grade === "C" || input.quality.grade === "D" || input.quality.grade === "insufficient"));
  const highConviction = input.draft.confidence >= 0.8;
  votes.push({
    reviewer: "DevilsAdvocateReviewer",
    verdict: weakData && highConviction ? "oppose" : "abstain",
    confidence: weakData && highConviction ? 0.8 : 0.3,
    reasons:
      weakData && highConviction
        ? ["Model confidence is high while signal data is incomplete; conviction is not supported by the data"]
        : ["No unsupported conviction detected"],
    warnings: weakData ? ["Data completeness is limited"] : [],
  });

  // PolicyReviewer — hallucination validation and council scope.
  const policyWarnings: string[] = [];
  if (!input.validation.valid) {
    policyWarnings.push(`${input.validation.unsupportedClaims.length} unsupported numeric claim(s) flagged by the hallucination guard`);
  }
  votes.push({
    reviewer: "PolicyReviewer",
    verdict: policyWarnings.length === 0 ? "support" : "abstain",
    confidence: policyWarnings.length === 0 ? 0.7 : 0.4,
    reasons: policyWarnings.length === 0 ? ["Analysis passed the hallucination guard"] : ["Analysis requires operator attention before approval"],
    warnings: policyWarnings,
  });

  const oppose = votes.filter(v => v.verdict === "oppose").length;
  const support = votes.filter(v => v.verdict === "support").length;
  // Abstentions do not dilute a unanimous casting vote, but they also do not
  // manufacture one: oppose dominates, unanimous-casting support supports,
  // and an all-abstain council reports insufficient data.
  const casting = votes.length - votes.filter(v => v.verdict === "abstain").length;
  const result: CouncilConsensus["result"] =
    oppose > 0 ? "oppose" : casting > 0 && support === casting ? "support" : casting === 0 ? "insufficient_data" : "mixed";
  return { result, votes };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface AnalysisOrchestratorDeps {
  readonly model: AnalysisModelFn;
  readonly councilEnabled: boolean;
  readonly now?: () => Date;
}

export interface AnalysisRunInput {
  readonly signal: MarketSignal;
  readonly quality: SignalQuality | null;
  readonly riskAssessment?: RiskAssessment;
}

export class AnalysisOrchestrator {
  private readonly model: AnalysisModelFn;
  private readonly councilEnabled: boolean;
  private readonly now: () => Date;

  constructor(deps: AnalysisOrchestratorDeps) {
    this.model = deps.model;
    this.councilEnabled = deps.councilEnabled;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Run the analysis stages. Every stage lands in structured output; numbers
   * are guarded against the trusted context before the result is returned.
   */
  async analyze(input: AnalysisRunInput): Promise<MarketAIAnalysis> {
    const started = this.now().getTime();
    const modelRuns: ModelRunRef[] = [];

    // Trusted numeric context: only deterministic values may appear in text.
    const trusted: TrustedNumericContext = {
      currencyValues: [input.signal.entryPrice, input.signal.stopPrice, input.signal.targetPrice].filter(
        (v): v is number => v !== undefined,
      ),
      percentValues: [input.riskAssessment?.plannedRiskAmount, input.signal.providerConfidence].filter(
        (v): v is number => v !== undefined,
      ),
      plainValues: [input.signal.providerScore, input.riskAssessment?.positionSize].filter((v): v is number => v !== undefined),
    };

    const stages: AnalysisStage[] = ["signal_summary", "data_sufficiency", "market_context", "risk_commentary", "counter_thesis", "final_summary"];
    let draft: MarketAIAnalysisDraft = {
      summary: "",
      bullishFactors: [],
      bearishFactors: [],
      invalidationFactors: [],
      riskNotes: [],
      confidence: 0,
      confidenceBasis: [],
      dataSufficient: false,
      missingData: [],
    };

    for (const stage of stages) {
      const stageStart = this.now().getTime();
      try {
        const response = await this.model({
          stage,
          signal: input.signal,
          trustedContextSummary: JSON.stringify(trusted),
          promptVersion: PROMPT_VERSIONS.summary,
        });
        draft = { ...draft, ...response.draft };
        modelRuns.push({
          agentId: `market-${stage}-agent`,
          modelProvider: response.modelProvider,
          modelName: response.modelName,
          promptVersion: PROMPT_VERSIONS.summary,
          latencyMs: this.now().getTime() - stageStart,
          success: true,
        });
      } catch (err) {
        modelRuns.push({
          agentId: `market-${stage}-agent`,
          modelProvider: "unknown",
          modelName: "unknown",
          promptVersion: PROMPT_VERSIONS.summary,
          latencyMs: this.now().getTime() - stageStart,
          success: false,
          errorCode: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        });
        // A failed stage degrades the analysis; it never invents content.
      }
    }

    const validation = validateAnalysisNumbers(draft, trusted);
    const fabricationHits = detectFabricationPhrases(draft);
    const finalValidation = {
      valid: validation.valid && fabricationHits.length === 0,
      unsupportedClaims: [...validation.unsupportedClaims, ...fabricationHits],
      warnings: [...validation.warnings, ...fabricationHits.map(h => `Fabrication pattern in ${h}`)],
    };

    const consensus = this.councilEnabled
      ? runReviewerCouncil({ signal: input.signal, draft, validation, riskAssessment: input.riskAssessment, quality: input.quality })
      : undefined;

    const analysis: MarketAIAnalysis = {
      id: nextId("mana"),
      signalId: input.signal.id,
      dataSufficient: draft.dataSufficient,
      missingData: draft.missingData,
      summary: draft.summary,
      bullishFactors: draft.bullishFactors,
      bearishFactors: draft.bearishFactors,
      invalidationFactors: draft.invalidationFactors,
      riskNotes: [
        ...draft.riskNotes,
        "AI output is decision support only. Confidence is the model's self-assessment, not a probability of profit.",
      ],
      confidence: draft.confidence,
      confidenceBasis: draft.confidenceBasis,
      reviewerConsensus: consensus,
      validation: finalValidation,
      modelRuns,
      generatedAt: new Date(this.now().getTime() + (this.now().getTime() - started)).toISOString(),
    };
    return analysis;
  }
}
