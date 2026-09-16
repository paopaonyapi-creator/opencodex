/**
 * Phase 20.55 — deterministic Flash/Pro auto-router.
 *
 * The score is inspectable and side-effect free. Forced profiles win.
 * The reason string is stored on the mobile task audit record.
 */

export type MobileProfile = "flash" | "pro";

export interface ProfileSignals {
  readonly instruction: string;
  readonly forcedProfile?: MobileProfile | "auto";
  readonly expectedSteps?: number;
  readonly verificationLevel?: "off" | "final" | "checkpoints" | "strict";
  readonly riskLevel?: "R0" | "R1" | "R2" | "R3" | "R4";
  readonly requiresPro?: boolean;
}

export interface ProfileDecision {
  readonly profile: MobileProfile;
  readonly proScore: number;
  readonly reason: string;
}

const PRO_HINTS = /\b(investigate|debug|reproduce|explore|verify every step|logcat|anr|crash|checkpoint|recover|poll|loop)\b/i;
const CROSS_APP = /\b(then open|switch (to )?app|another app|multiple apps)\b/i;

export function selectMobileProfile(signals: ProfileSignals): ProfileDecision {
  if (signals.forcedProfile === "pro") {
    return { profile: "pro", proScore: 99, reason: "forced:pro" };
  }
  if (signals.requiresPro || signals.riskLevel === "R3" || signals.riskLevel === "R4") {
    return { profile: "pro", proScore: 99, reason: `policy-requires-pro:risk=${signals.riskLevel ?? "flag"}` };
  }
  if (signals.forcedProfile === "flash") {
    return { profile: "flash", proScore: 0, reason: "forced:flash" };
  }

  let proScore = 0;
  const reasons: string[] = [];
  const steps = signals.expectedSteps ?? estimateSteps(signals.instruction);
  if (steps > 5) { proScore += 1; reasons.push("steps>5"); }
  if (PRO_HINTS.test(signals.instruction)) { proScore += 3; reasons.push("exploratory-language"); }
  if (CROSS_APP.test(signals.instruction)) { proScore += 1; reasons.push("cross-app"); }
  if (signals.verificationLevel === "checkpoints" || signals.verificationLevel === "strict") {
    proScore += 2;
    reasons.push(`verification=${signals.verificationLevel}`);
  }
  if (/\b(logcat|bugreport|anr|tombstone)\b/i.test(signals.instruction)) { proScore += 3; reasons.push("diagnostics"); }
  if (/\b(until|keep trying|retry|poll|wait for)\b/i.test(signals.instruction)) { proScore += 3; reasons.push("loop"); }

  const profile: MobileProfile = proScore >= 3 ? "pro" : "flash";
  return { profile, proScore, reason: reasons.length ? reasons.join(",") : "default-flash:low-complexity" };
}

function estimateSteps(instruction: string): number {
  const clauses = instruction.split(/\b(?:then|after that|next|and then)\b/i).filter((s) => s.trim().length > 0);
  return Math.max(1, clauses.length);
}
