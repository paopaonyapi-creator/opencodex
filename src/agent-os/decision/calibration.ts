/**
 * Phase 20.84 — Confidence & Calibration Engine
 * Computes Brier scores, Expected Calibration Error (ECE), and manages threshold profiles.
 */

export interface ThresholdProfile {
  name: string;
  minConfidenceAllow: number;
  minConfidenceReview: number;
  humanApprovalAlways: boolean;
  maxAllowedECE: number;
}

export interface CalibrationSample {
  predictedProbability: number;
  actualOutcome: 0 | 1; // 1 = accurate/verified, 0 = erroneous
}

export interface CalibrationReport {
  sampleCount: number;
  brierScore: number;
  ece: number;
  accuracy: number;
  isTrusted: boolean;
}

export class CalibrationEngine {
  private profiles = new Map<string, ThresholdProfile>();

  constructor() {
    this.seedProfiles();
  }

  public getProfile(name: string): ThresholdProfile {
    return (
      this.profiles.get(name) ?? {
        name: "default",
        minConfidenceAllow: 0.90,
        minConfidenceReview: 0.70,
        humanApprovalAlways: false,
        maxAllowedECE: 0.05,
      }
    );
  }

  /**
   * Brier score: (1 / N) * sum((p - o)^2).
   * Range 0.0 (perfect) to 1.0 (completely inaccurate).
   */
  public calculateBrierScore(samples: CalibrationSample[]): number {
    if (samples.length === 0) return 0.0;
    const sum = samples.reduce(
      (acc, s) => acc + Math.pow(s.predictedProbability - s.actualOutcome, 2),
      0,
    );
    return Number((sum / samples.length).toFixed(4));
  }

  /**
   * Expected Calibration Error (ECE) across M bins (default 10).
   */
  public calculateECE(samples: CalibrationSample[], numBins = 10): number {
    if (samples.length === 0) return 0.0;

    const binSize = 1.0 / numBins;
    let totalEce = 0;

    for (let i = 0; i < numBins; i++) {
      const binLower = i * binSize;
      const binUpper = (i + 1) * binSize;

      const inBin = samples.filter(
        (s) =>
          s.predictedProbability >= binLower &&
          (i === numBins - 1
            ? s.predictedProbability <= binUpper
            : s.predictedProbability < binUpper),
      );

      if (inBin.length === 0) continue;

      const avgConfidence =
        inBin.reduce((acc, s) => acc + s.predictedProbability, 0) / inBin.length;
      const avgAccuracy =
        inBin.reduce((acc, s) => acc + s.actualOutcome, 0) / inBin.length;

      const weight = inBin.length / samples.length;
      totalEce += weight * Math.abs(avgAccuracy - avgConfidence);
    }

    return Number(totalEce.toFixed(4));
  }

  public evaluateCalibration(
    samples: CalibrationSample[],
    profileName: string,
  ): CalibrationReport {
    const profile = this.getProfile(profileName);
    const brier = this.calculateBrierScore(samples);
    const ece = this.calculateECE(samples);

    const accurateCount = samples.filter((s) => s.actualOutcome === 1).length;
    const accuracy = samples.length > 0 ? accurateCount / samples.length : 1.0;

    const isTrusted = samples.length >= 10 ? ece <= profile.maxAllowedECE : true;

    return {
      sampleCount: samples.length,
      brierScore: brier,
      ece,
      accuracy: Number(accuracy.toFixed(4)),
      isTrusted,
    };
  }

  private seedProfiles(): void {
    this.profiles.set("low_risk_router", {
      name: "low_risk_router",
      minConfidenceAllow: 0.8,
      minConfidenceReview: 0.55,
      humanApprovalAlways: false,
      maxAllowedECE: 0.08,
    });

    this.profiles.set("normal_tool_use", {
      name: "normal_tool_use",
      minConfidenceAllow: 0.93,
      minConfidenceReview: 0.7,
      humanApprovalAlways: false,
      maxAllowedECE: 0.05,
    });

    this.profiles.set("privileged_tool_use", {
      name: "privileged_tool_use",
      minConfidenceAllow: 0.99,
      minConfidenceReview: 0.85,
      humanApprovalAlways: true,
      maxAllowedECE: 0.03,
    });

    this.profiles.set("destructive_action", {
      name: "destructive_action",
      minConfidenceAllow: 1.0,
      minConfidenceReview: 1.0,
      humanApprovalAlways: true,
      maxAllowedECE: 0.01,
    });
  }
}
