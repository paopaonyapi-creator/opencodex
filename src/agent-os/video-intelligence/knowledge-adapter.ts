/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Knowledge Adapter & Ingestion (Section 45 & 46)
 * Provider-agnostic knowledge bridge for video intelligence artifacts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeIngestRecord, VideoAnalysisReport } from "./types";

export class KnowledgeAdapter {
  private baseDir: string;

  constructor(customDir?: string) {
    this.baseDir = customDir ?? join(process.cwd(), "data", "knowledge", "video");
  }

  /**
   * Synthesizes a structured Knowledge Ingest Record from a completed Video Analysis Report
   */
  public createIngestRecord(report: VideoAnalysisReport): KnowledgeIngestRecord {
    const title = this.deriveTitle(report);
    const summary = this.deriveSummary(report);
    const concepts = this.extractConcepts(report);
    const entities = this.extractEntities(report);

    return {
      type: "video_analysis",
      source: report.source,
      title,
      summary,
      concepts,
      entities,
      reportPath: undefined,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Ingests the record into persistent local filesystem storage
   */
  public ingest(report: VideoAnalysisReport): KnowledgeIngestRecord {
    const record = this.createIngestRecord(report);

    try {
      if (!existsSync(this.baseDir)) {
        mkdirSync(this.baseDir, { recursive: true });
      }

      const filename = `record_${report.jobId}.json`;
      const targetPath = join(this.baseDir, filename);
      record.reportPath = targetPath;

      writeFileSync(targetPath, JSON.stringify({ record, report }, null, 2), "utf8");
    } catch {
      // In non-writable environments or sandboxes, keep in-memory representation cleanly
      record.reportPath = `in-memory://${report.jobId}`;
    }

    return record;
  }

  private deriveTitle(report: VideoAnalysisReport): string {
    const urlParts = report.source.split("/").pop() ?? "";
    const cleanSource = urlParts.split("?")[0] || "Untitled Video Asset";
    return `Video Analysis: ${cleanSource} (${report.metadata.orientation} ${report.metadata.aspectRatio})`;
  }

  private deriveSummary(report: VideoAnalysisReport): string {
    const duration = report.metadata.durationSec.toFixed(1);
    const pacing = report.pacing.rhythmProfile;
    const hook = report.hook ? `Hook Score: ${report.hook.visualHookScore}/100.` : "";
    const stock = report.stockQc ? `Stock QC Verdict: ${report.stockQc.verdict} (${report.stockQc.score}/100).` : "";
    return `Analysis for ${report.intent} (${duration}s runtime). Editorial pacing: ${pacing}. ${hook} ${stock}`.trim();
  }

  private extractConcepts(report: VideoAnalysisReport): string[] {
    const concepts = new Set<string>();
    concepts.add(report.intent);
    concepts.add(report.metadata.orientation);
    concepts.add(report.pacing.rhythmProfile);

    if (report.hook) {
      concepts.add(`hook:${report.hook.openingType}`);
    }
    if (report.stockQc) {
      concepts.add(`qc:${report.stockQc.verdict.toLowerCase()}`);
    }

    return Array.from(concepts);
  }

  private extractEntities(report: VideoAnalysisReport): string[] {
    const entities = new Set<string>();
    entities.add(report.metadata.videoCodec);
    if (report.metadata.audioCodec) entities.add(report.metadata.audioCodec);

    // Simple keyword extraction from transcript words
    const words = report.transcript.fullText.split(/\s+/);
    for (const w of words) {
      const clean = w.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      if (clean.length > 5 && !["should", "because", "through", "people", "before"].includes(clean)) {
        entities.add(clean);
        if (entities.size >= 10) break;
      }
    }

    return Array.from(entities);
  }
}
