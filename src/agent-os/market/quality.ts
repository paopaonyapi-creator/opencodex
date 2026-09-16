/**
 * Pao Market Signal Control Plane — signal quality classification (§79).
 *
 * Measures DATA COMPLETENESS AND TRUST only. There is deliberately no
 * profitability score anywhere in this file.
 */

import type { MarketSignal, SignalQuality } from "./types";

export class SignalQualityGrader {
  grade(signal: MarketSignal, nowMs: number): SignalQuality {
    const reasons: string[] = [];
    let points = 0;

    // 1. Verified provider ingress.
    if (signal.verified) {
      points += 2;
    } else {
      reasons.push("signal is not provider-verified");
    }

    // 2. Symbol sanity.
    if (signal.symbol.trim() !== "") {
      points += 1;
    } else {
      reasons.push("symbol missing");
    }

    // 3. Entry/stop/target completeness.
    const hasEntry = signal.entryPrice !== undefined && signal.entryPrice > 0;
    const hasStop = signal.stopPrice !== undefined && signal.stopPrice > 0;
    const hasTarget = signal.targetPrice !== undefined && signal.targetPrice > 0;
    if (hasEntry && hasStop) points += 2;
    else reasons.push("entry or stop price missing");
    if (hasTarget) points += 1;
    else reasons.push("target price missing");

    // 4. Timestamp freshness (stale signals degrade the grade, never block).
    const signalTimeMs = Date.parse(signal.signalTime);
    if (Number.isFinite(signalTimeMs)) {
      const ageMinutes = (nowMs - signalTimeMs) / 60_000;
      if (ageMinutes <= 60) points += 2;
      else if (ageMinutes <= 24 * 60) points += 1;
      else reasons.push("signal older than 24h");
    } else {
      reasons.push("signal time unparseable");
    }

    // 5. Provider confidence present.
    if (signal.providerConfidence !== undefined) {
      points += 1;
    } else {
      reasons.push("provider confidence absent");
    }

    // Max 8 points. An unverified or symbol-less signal is insufficient
    // regardless of arithmetic.
    if (!signal.verified || signal.symbol.trim() === "") {
      return { grade: "insufficient", reasons };
    }
    const grade = points >= 8 ? "A" : points >= 6 ? "B" : points >= 4 ? "C" : "D";
    return { grade, reasons };
  }
}
