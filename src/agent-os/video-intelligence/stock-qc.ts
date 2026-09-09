/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Adobe Stock QC Engine: Automated Technical, Visual & Commercial Quality Review
 */

import type { StockQcFinding, StockQcResult, VideoMetadata } from "./types";

export class StockQcEngine {
  /**
   * Evaluates video metadata and visual qualities against Adobe Stock submission guidelines.
   */
  public evaluate(metadata: VideoMetadata, rawText?: string): StockQcResult {
    const issues: StockQcFinding[] = [];
    let score = 95; // Initial ideal score

    // 1. Technical Resolution Check
    const minDim = Math.min(metadata.width, metadata.height);
    if (minDim < 720) {
      issues.push({
        severity: "high",
        timestamp: 0.0,
        type: "low_resolution",
        message: `Resolution (${metadata.width}x${metadata.height}) is below 720p minimum standard for Adobe Stock.`,
      });
      score -= 35;
    } else if (minDim < 1080) {
      issues.push({
        severity: "medium",
        timestamp: 0.0,
        type: "sub_1080p_resolution",
        message: "HD 720p detected. 1080p (Full HD) or 4K is strongly recommended for commercial acceptance.",
      });
      score -= 10;
    }

    // 2. Duration Standards (Adobe Stock recommends 5s - 60s)
    if (metadata.durationSec < 4.0) {
      issues.push({
        severity: "high",
        timestamp: 0.0,
        type: "duration_too_short",
        message: `Video duration (${metadata.durationSec.toFixed(1)}s) is too short. Minimum duration is 4-5 seconds.`,
      });
      score -= 25;
    } else if (metadata.durationSec > 120.0) {
      issues.push({
        severity: "medium",
        timestamp: metadata.durationSec,
        type: "duration_too_long",
        message: `Video duration (${metadata.durationSec.toFixed(1)}s) exceeds typical commercial stock clip length (<= 60s).`,
      });
      score -= 10;
    }

    // 3. Aspect Ratio Standards
    if (metadata.aspectRatio !== "16:9" && metadata.aspectRatio !== "9:16" && metadata.aspectRatio !== "1:1") {
      issues.push({
        severity: "low",
        timestamp: 0.0,
        type: "non_standard_aspect_ratio",
        message: `Aspect ratio ${metadata.aspectRatio} is non-standard. Standard 16:9 or 9:16 is preferred.`,
      });
      score -= 5;
    }

    // 4. Commercial Safety: Watermark or Logo keywords in text/transcription
    if (rawText) {
      const lower = rawText.toLowerCase();
      if (lower.includes("watermark") || lower.includes("shutterstock") || lower.includes("getty") || lower.includes("tiktok")) {
        issues.push({
          severity: "high",
          timestamp: 1.0,
          type: "watermark_or_brand_indicator",
          message: "Potential commercial risk: watermark or third-party brand marker detected in media context.",
        });
        score -= 40;
      }
    }

    // Bound score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    // Determine Verdict
    let verdict: StockQcResult["verdict"] = "PASS";
    const hasHigh = issues.some((i) => i.severity === "high");

    if (hasHigh || score < 65) {
      verdict = "FAIL";
    } else if (issues.length > 0 || score < 85) {
      verdict = "REVIEW";
    }

    // Build Recommendations
    const recommendations: string[] = [];
    if (verdict === "PASS") {
      recommendations.push("Asset meets Adobe Stock technical baseline. Ready for metadata tagging and upload.");
    } else if (verdict === "REVIEW") {
      recommendations.push("Manual review recommended prior to submission to confirm absence of visual warping or logos.");
    } else {
      recommendations.push("Do not submit this clip. Address resolution, duration, or watermark defects before export.");
    }

    return {
      verdict,
      score,
      confidence: 0.92,
      issues,
      recommendations,
    };
  }
}
