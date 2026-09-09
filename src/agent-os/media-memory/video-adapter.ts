// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Video Intelligence Adapter

import type { VideoAnalysisReport } from "../video-intelligence/types";
import type { MediaMemoryItem, MediaTechnicalSpecs } from "./types";

export class VideoMemoryAdapter {
  /**
   * Convert a Phase 20.13 VideoAnalysisReport into a unified MediaMemoryItem.
   */
  static fromVideoAnalysisReport(report: VideoAnalysisReport): MediaMemoryItem {
    const isUrl = report.source.startsWith("http://") || report.source.startsWith("https://");

    const tags: string[] = [
      report.intent,
      report.metadata.orientation,
      report.metadata.aspectRatio,
    ];

    if (report.pacing?.rhythmProfile) {
      tags.push(report.pacing.rhythmProfile.toLowerCase());
    }

    if (report.stockQc?.verdict) {
      tags.push(`qc:${report.stockQc.verdict.toLowerCase()}`);
    }

    if (report.hook?.openingType) {
      tags.push(`hook:${report.hook.openingType.toLowerCase().replace(/\s+/g, "-")}`);
    }

    const concepts: string[] = report.knowledgeRecord?.concepts
      ? [...report.knowledgeRecord.concepts]
      : [report.intent, report.metadata.orientation];

    const entities: string[] = report.knowledgeRecord?.entities
      ? [...report.knowledgeRecord.entities]
      : ([report.metadata.videoCodec, report.metadata.audioCodec].filter(
          (c): c is string => Boolean(c),
        ));

    const title =
      report.knowledgeRecord?.title ??
      `Video: ${report.source.split("/").pop() ?? report.jobId} (${report.metadata.orientation} ${report.metadata.aspectRatio})`;

    const summary =
      report.knowledgeRecord?.summary ??
      `Analysis for ${report.intent} (${report.metadata.durationSec.toFixed(1)}s runtime). Pacing: ${report.pacing?.rhythmProfile ?? "normal"}. Hook Score: ${report.hook?.visualHookScore ?? "N/A"}/100.`;

    const technicalSpecs: MediaTechnicalSpecs = {
      width: report.metadata.width,
      height: report.metadata.height,
      durationSec: report.metadata.durationSec,
      fps: report.metadata.fps,
      orientation: report.metadata.orientation,
      aspectRatio: report.metadata.aspectRatio,
      codec: report.metadata.videoCodec,
      bitrateKbps: report.metadata.bitrateKbps,
      fileSizeBytes: report.metadata.fileSizeBytes,
    };

    return {
      id: `mitem_${report.jobId}`,
      mediaType: "video",
      sourceUrl: isUrl ? report.source : undefined,
      localPath: isUrl ? undefined : report.source,
      title,
      summary,
      tags: Array.from(new Set(tags)),
      concepts: Array.from(new Set(concepts)),
      entities: Array.from(new Set(entities)),
      technicalSpecs,
      pacing: report.pacing
        ? {
            shotCount: report.pacing.shotCount,
            cutsPerMinute: report.pacing.cutsPerMinute,
            meanShotLengthSec: report.pacing.meanShotLengthSec,
            rhythmProfile: report.pacing.rhythmProfile,
          }
        : undefined,
      hook: report.hook
        ? {
            openingType: report.hook.openingType,
            visualHookScore: report.hook.visualHookScore,
            firstCutTimestamp: report.hook.firstCutTimestamp,
            pacingSummary: report.hook.pacingSummary,
          }
        : undefined,
      transcriptText: report.transcript?.fullText,
      transcriptSegments: (report.transcript?.segments || []).map((s) => ({
        startSec: s.start,
        endSec: s.end,
        text: s.text,
      })),
      heroFrames: (report.heroFrames || []).map((f) => ({
        frameIndex: f.frameIndex,
        timestamp: f.timestamp,
        framePath: f.framePath,
        score: f.score,
        reason: f.reason,
      })),
      metadata: {
        stockQc: report.stockQc,
        councilReview: report.councilReview,
        feedback: report.feedback,
        provenance: report.provenance,
        originalJobId: report.jobId,
      },
      createdAt: report.createdAt ?? new Date().toISOString(),
      updatedAt: report.completedAt ?? new Date().toISOString(),
    };
  }
}
