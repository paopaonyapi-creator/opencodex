/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Editorial Pacing Analyzer: Shot Metrics, Cuts Per Minute & Rhythm Profiles
 */

import type { PacingMetrics, SceneCut, VideoMetadata } from "./types";

export class PacingAnalyzer {
  /**
   * Analyzes video scene boundaries to compute editorial pacing and rhythm metrics.
   */
  public analyzePacing(scenes: SceneCut[], metadata: VideoMetadata): PacingMetrics {
    const duration = Math.max(1.0, metadata.durationSec);
    const shotCount = Math.max(1, scenes.length);

    // Calculate cuts per minute
    const minutes = duration / 60.0;
    const cutsPerMinute = Number(((shotCount - 1) / Math.max(0.1, minutes)).toFixed(1));

    // Calculate shot lengths
    const shotLengths: number[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const start = scenes[i].timestamp;
      const end = i + 1 < scenes.length ? scenes[i + 1].timestamp : duration;
      shotLengths.push(Math.max(0.1, Number((end - start).toFixed(2))));
    }

    if (shotLengths.length === 0) {
      shotLengths.push(duration);
    }

    const meanShotLengthSec = Number(
      (shotLengths.reduce((a, b) => a + b, 0) / shotLengths.length).toFixed(2)
    );

    const sortedLengths = [...shotLengths].sort((a, b) => a - b);
    const mid = Math.floor(sortedLengths.length / 2);
    const medianShotLengthSec =
      sortedLengths.length % 2 !== 0
        ? sortedLengths[mid]
        : Number(((sortedLengths[mid - 1] + sortedLengths[mid]) / 2).toFixed(2));

    const longestShotSec = Math.max(...shotLengths);
    const shortestShotSec = Math.min(...shotLengths);

    // Cuts in the first 10 seconds
    const openingCutRate = scenes.filter((s) => s.timestamp > 0 && s.timestamp <= 10.0).length;

    // Categorize rhythm profile
    let rhythmProfile: PacingMetrics["rhythmProfile"] = "balanced";
    if (cutsPerMinute >= 24 || openingCutRate >= 4) {
      rhythmProfile = "high-energy";
    } else if (cutsPerMinute <= 4 && meanShotLengthSec >= 8) {
      rhythmProfile = "static";
    } else if (cutsPerMinute < 12) {
      rhythmProfile = "contemplative";
    }

    return {
      shotCount,
      cutsPerMinute,
      meanShotLengthSec,
      medianShotLengthSec,
      longestShotSec,
      shortestShotSec,
      openingCutRate,
      rhythmProfile,
    };
  }
}
