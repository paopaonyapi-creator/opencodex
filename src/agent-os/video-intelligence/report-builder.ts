/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Report Builder: Structured Markdown & JSON Synthesis
 */

import type {
  HookAnalysis,
  PacingMetrics,
  StockQcResult,
  VideoMetadata,
  VideoTranscript,
} from "./types";

export interface BuildReportParams {
  jobId: string;
  source: string;
  intent: string;
  metadata: VideoMetadata;
  pacing: PacingMetrics;
  hook?: HookAnalysis;
  transcript?: VideoTranscript;
  stockQc?: StockQcResult;
  createdAt: string;
}

export class ReportBuilder {
  /**
   * Assembles a structured Markdown analysis report.
   */
  public buildMarkdown(params: BuildReportParams): string {
    const { jobId, source, intent, metadata, pacing, hook, transcript, stockQc, createdAt } = params;

    const sections: string[] = [];

    // Header
    sections.push(`# Pao-hubPro Video Intelligence Report`);
    sections.push(`**Job ID:** \`${jobId}\` | **Intent:** \`${intent}\` | **Generated:** ${createdAt}\n`);
    sections.push(`**Source:** \`${source}\`\n`);

    // 1. Technical Metadata Table
    sections.push(`## 1. Technical Specifications`);
    sections.push(`| Metric | Value |`);
    sections.push(`|---|---|`);
    sections.push(`| Resolution | ${metadata.width}x${metadata.height} (${metadata.orientation}) |`);
    sections.push(`| Aspect Ratio | ${metadata.aspectRatio} |`);
    sections.push(`| Duration | ${metadata.durationSec.toFixed(2)} seconds |`);
    sections.push(`| Frame Rate | ${metadata.fps} fps |`);
    sections.push(`| Video Codec | ${metadata.videoCodec} |`);
    if (metadata.audioCodec) sections.push(`| Audio Codec | ${metadata.audioCodec} |`);
    if (metadata.bitrateKbps) sections.push(`| Bitrate | ${metadata.bitrateKbps} kbps |`);
    sections.push(``);

    // 2. Editorial Pacing & Rhythm
    sections.push(`## 2. Editorial Pacing & Rhythm`);
    sections.push(`- **Shot Count:** ${pacing.shotCount}`);
    sections.push(`- **Cuts Per Minute:** ${pacing.cutsPerMinute}`);
    sections.push(`- **Mean Shot Length:** ${pacing.meanShotLengthSec}s (Median: ${pacing.medianShotLengthSec}s)`);
    sections.push(`- **Opening Pace (First 10s):** ${pacing.openingCutRate} cuts`);
    sections.push(`- **Rhythm Profile:** \`${pacing.rhythmProfile.toUpperCase()}\`\n`);

    // 3. Hook Microscope (0–10s)
    if (hook) {
      sections.push(`## 3. Hook Microscope (00:00–00:10)`);
      sections.push(`**Opening Style:** ${hook.openingType} | **Visual Hook Score:** ${hook.visualHookScore}/100\n`);
      sections.push(`### Timeline Breakdown`);
      for (const ev of hook.timeline) {
        const mm = String(Math.floor(ev.timestamp / 60)).padStart(2, "0");
        const ss = (ev.timestamp % 60).toFixed(1).padStart(4, "0");
        sections.push(`- \`${mm}:${ss}\` — ${ev.event}`);
      }
      sections.push(``);
    }

    // 4. Adobe Stock QC
    if (stockQc) {
      sections.push(`## 4. Adobe Stock Quality Control Review`);
      sections.push(`**Verdict:** **\`${stockQc.verdict}\`** | **Quality Score:** ${stockQc.score}/100 (Confidence: ${(stockQc.confidence * 100).toFixed(0)}%)\n`);

      if (stockQc.issues.length > 0) {
        sections.push(`### Identified Findings`);
        sections.push(`| Time | Severity | Type | Description |`);
        sections.push(`|---|---|---|---|`);
        for (const issue of stockQc.issues) {
          const mm = String(Math.floor(issue.timestamp / 60)).padStart(2, "0");
          const ss = (issue.timestamp % 60).toFixed(1).padStart(4, "0");
          sections.push(`| \`${mm}:${ss}\` | **${issue.severity.toUpperCase()}** | \`${issue.type}\` | ${issue.message} |`);
        }
        sections.push(``);
      } else {
        sections.push(`No critical or moderate quality defects identified.\n`);
      }

      sections.push(`### Recommendations`);
      for (const rec of stockQc.recommendations) {
        sections.push(`- ${rec}`);
      }
      sections.push(``);
    }

    // 5. Transcript Summary
    if (transcript && transcript.segments.length > 0) {
      sections.push(`## 5. Spoken Dialogue Transcript`);
      sections.push(`**Provider:** \`${transcript.provider}\` | **Language:** \`${transcript.language.toUpperCase()}\`\n`);
      for (const seg of transcript.segments) {
        const mm = String(Math.floor(seg.start / 60)).padStart(2, "0");
        const ss = (seg.start % 60).toFixed(1).padStart(4, "0");
        sections.push(`- \`[${mm}:${ss}]\` ${seg.text}`);
      }
      sections.push(``);
    }

    return sections.join("\n");
  }
}
