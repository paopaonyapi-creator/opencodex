/**
 * Pao Market Signal Control Plane — analysis domain types.
 */

export interface TrustedNumericContext {
  /** Prices and dollar amounts the model is allowed to mention. */
  readonly currencyValues: readonly number[];
  /** Percentages (risk percents, confidence percents) allowed in text. */
  readonly percentValues: readonly number[];
  /** Plain numbers (quantity, scores, timeframes) allowed in text. */
  readonly plainValues: readonly number[];
}

export interface MarketAIAnalysisDraft {
  readonly summary: string;
  readonly bullishFactors: string[];
  readonly bearishFactors: string[];
  readonly invalidationFactors: string[];
  readonly riskNotes: string[];
  readonly confidence: number;
  readonly confidenceBasis: string[];
  readonly dataSufficient: boolean;
  readonly missingData: string[];
}
