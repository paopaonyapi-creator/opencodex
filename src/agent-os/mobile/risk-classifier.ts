// Risk Classifier for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import type { RiskLevel } from "./types";

export interface ClassificationResult {
  riskLevel: RiskLevel;
  reasons: string[];
  matchedKeywords: string[];
}

export class MobileRiskClassifier {
  private forbiddenPatterns: RegExp[] = [
    /\b(bank|banking|transfer\s+money|wire\s+transfer)\b/i,
    /\b(crypto|bitcoin|ethereum|wallet\s+transfer|seed\s+phrase|private\s+key)\b/i,
    /\b(otp|2fa|verification\s+code|authenticator\s+code|sms\s+code)\b/i,
    /\b(password\s+harvest|credential\s+steal|keylogger)\b/i,
    /\b(bypass\s+screen\s+lock|bypass\s+pin|bypass\s+biometric)\b/i,
    /\b(factory\s+reset|wipe\s+device|format\s+storage|rm\s+-rf)\b/i,
    /\b(surveillance|hidden\s+mic|secret\s+recording)\b/i,
  ];

  private highRiskPatterns: RegExp[] = [
    /\b(uninstall|remove\s+app)\b/i,
    /\b(permission\s+change|grant\s+permission|revoke\s+permission)\b/i,
    /\b(system\s+setting|developer\s+options|change\s+dns|change\s+proxy)\b/i,
    /\b(adb\s+shell|run\s+shell|destructive\s+diagnostics)\b/i,
    /\b(modify\s+system|root\s+access)\b/i,
  ];

  private mediumRiskPatterns: RegExp[] = [
    /\b(input|type|enter\s+text|fill\s+form)\b/i,
    /\b(install\s+apk|update\s+app)\b/i,
    /\b(clear\s+data|clear\s+cache|app\s+relaunch)\b/i,
    /\b(diagnostics|benchmark)\b/i,
  ];

  private lowRiskPatterns: RegExp[] = [
    /\b(tap|click|press|swipe|scroll|drag|open\s+app|navigate)\b/i,
  ];

  private observeOnlyPatterns: RegExp[] = [
    /\b(screenshot|capture\s+screen|hierarchy|dump\s+ui|inspect|read|view|battery\s+status)\b/i,
  ];

  public classify(goal: string, actionPayload?: Record<string, unknown>): ClassificationResult {
    const textToScan = `${goal} ${JSON.stringify(actionPayload || {})}`.toLowerCase();

    // Check R4 Forbidden First (Immediate rejection trigger)
    const forbiddenMatches: string[] = [];
    for (const pattern of this.forbiddenPatterns) {
      const match = textToScan.match(pattern);
      if (match) {
        forbiddenMatches.push(match[0]);
      }
    }

    if (forbiddenMatches.length > 0) {
      return {
        riskLevel: "R4",
        reasons: [`Goal matches forbidden policy categories: ${forbiddenMatches.join(", ")}`],
        matchedKeywords: forbiddenMatches,
      };
    }

    // Check R3 High Risk
    const highMatches: string[] = [];
    for (const pattern of this.highRiskPatterns) {
      const match = textToScan.match(pattern);
      if (match) highMatches.push(match[0]);
    }
    if (highMatches.length > 0) {
      return {
        riskLevel: "R3",
        reasons: [`Goal performs high-risk device or system modifications: ${highMatches.join(", ")}`],
        matchedKeywords: highMatches,
      };
    }

    // Check R2 Medium Risk
    const medMatches: string[] = [];
    for (const pattern of this.mediumRiskPatterns) {
      const match = textToScan.match(pattern);
      if (match) medMatches.push(match[0]);
    }
    if (medMatches.length > 0) {
      return {
        riskLevel: "R2",
        reasons: [`Goal modifies test app state or inputs data: ${medMatches.join(", ")}`],
        matchedKeywords: medMatches,
      };
    }

    // Check R1 Low Risk
    const lowMatches: string[] = [];
    for (const pattern of this.lowRiskPatterns) {
      const match = textToScan.match(pattern);
      if (match) lowMatches.push(match[0]);
    }
    if (lowMatches.length > 0) {
      return {
        riskLevel: "R1",
        reasons: [`Goal performs standard UI navigation or interaction: ${lowMatches.join(", ")}`],
        matchedKeywords: lowMatches,
      };
    }

    // Check R0 Observe Only
    const obsMatches: string[] = [];
    for (const pattern of this.observeOnlyPatterns) {
      const match = textToScan.match(pattern);
      if (match) obsMatches.push(match[0]);
    }
    if (obsMatches.length > 0) {
      return {
        riskLevel: "R0",
        reasons: [`Goal performs passive observation or reading only: ${obsMatches.join(", ")}`],
        matchedKeywords: obsMatches,
      };
    }

    // Default safe classification
    return {
      riskLevel: "R1",
      reasons: ["Default low-risk UI navigation classification"],
      matchedKeywords: [],
    };
  }
}

let riskClassifierInstance: MobileRiskClassifier | null = null;
export function getMobileRiskClassifier(): MobileRiskClassifier {
  if (!riskClassifierInstance) {
    riskClassifierInstance = new MobileRiskClassifier();
  }
  return riskClassifierInstance;
}
