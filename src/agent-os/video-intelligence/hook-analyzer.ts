/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Hook Microscope: 0–10s Retention & Engagement Analyzer
 */

import type { HookAnalysis, HookTimelineEvent, SceneCut, VideoTranscript } from "./types";

export class HookAnalyzer {
  /**
   * Analyzes the critical 0–10 second window to evaluate viewer retention and hook impact.
   */
  public analyzeHook(scenes: SceneCut[], transcript?: VideoTranscript): HookAnalysis {
    const timeline: HookTimelineEvent[] = [];

    // 1. Initial Visual Opening
    timeline.push({
      timestamp: 0.0,
      event: "Visual opening frame presented",
      type: "visual",
    });

    // 2. First cut / Scene transition within 0-10s
    const firstCut = scenes.find((s) => s.timestamp > 0.1 && s.timestamp <= 10.0);
    if (firstCut) {
      timeline.push({
        timestamp: firstCut.timestamp,
        event: `First scene transition cut (scene score ${firstCut.sceneScore.toFixed(2)})`,
        type: "cut",
      });
    }

    // 3. Spoken Hook Analysis
    let firstSpokenTs: number | undefined;
    if (transcript && transcript.segments.length > 0) {
      const earlySeg = transcript.segments.find((s) => s.start <= 10.0);
      if (earlySeg) {
        firstSpokenTs = earlySeg.start;
        timeline.push({
          timestamp: Number(earlySeg.start.toFixed(2)),
          event: `First spoken hook phrase: "${earlySeg.text.slice(0, 40)}..."`,
          type: "spoken",
        });
      }
    }

    // 4. Secondary pattern interrupt
    const secondaryCut = scenes.find((s) => firstCut && s.timestamp > firstCut.timestamp && s.timestamp <= 10.0);
    if (secondaryCut) {
      timeline.push({
        timestamp: secondaryCut.timestamp,
        event: "Secondary visual pattern interruption",
        type: "visual",
      });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate Hook Score (0-100)
    let score = 70; // Baseline
    if (firstCut && firstCut.timestamp <= 2.5) score += 15; // Quick pacing
    if (firstCut && firstCut.timestamp > 5.0) score -= 10; // Slow pacing
    if (firstSpokenTs !== undefined && firstSpokenTs <= 1.2) score += 15; // Immediate speech
    if (timeline.length >= 3) score += 10; // Multi-element dynamic opening

    score = Math.min(100, Math.max(10, score));

    const openingType = score >= 85 ? "High-Impact Kinetic Hook" : score >= 65 ? "Narrative Question Hook" : "Ambient Slow-Burn Opening";
    const pacingSummary = `${timeline.length} significant dynamic events detected within the first 10 seconds.`;

    return {
      openingType,
      firstSpokenTimestamp: firstSpokenTs,
      firstCutTimestamp: firstCut?.timestamp,
      visualHookScore: score,
      pacingSummary,
      timeline,
    };
  }
}
