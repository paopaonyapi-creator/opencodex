// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Types & Interfaces

export type MediaType = "video" | "image";

export type VectorType = "multimodal" | "text" | "visual" | "transcript";

export interface MediaTechnicalSpecs {
  width: number;
  height: number;
  durationSec?: number;
  fps?: number;
  orientation?: "landscape" | "portrait" | "square";
  aspectRatio?: string;
  codec?: string;
  bitrateKbps?: number;
  fileSizeBytes?: number;
}

export interface MediaHeroFrameInfo {
  frameIndex: number;
  timestamp: number;
  framePath: string;
  score: number;
  reason?: string;
}

export interface MediaPacingSummary {
  shotCount?: number;
  cutsPerMinute?: number;
  meanShotLengthSec?: number;
  rhythmProfile?: string;
}

export interface MediaHookSummary {
  openingType?: string;
  visualHookScore?: number;
  firstCutTimestamp?: number;
  pacingSummary?: string;
}

export interface MediaTranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
}

export interface MediaMemoryItem {
  id: string;
  mediaType: MediaType;
  sourceUrl?: string;
  localPath?: string;
  title: string;
  summary: string;
  tags: string[];
  concepts: string[];
  entities: string[];
  technicalSpecs: MediaTechnicalSpecs;
  pacing?: MediaPacingSummary;
  hook?: MediaHookSummary;
  transcriptText?: string;
  transcriptSegments?: MediaTranscriptSegment[];
  heroFrames?: MediaHeroFrameInfo[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MediaVector {
  id: string;
  itemId: string;
  vectorType: VectorType;
  dimension: number;
  vector: number[];
  model: string;
  createdAt: string;
}

export interface MemorySearchQuery {
  queryText?: string;
  queryVector?: number[];
  mediaType?: MediaType;
  tags?: string[];
  concepts?: string[];
  minScore?: number; // 0.0 to 1.0 (default 0.25)
  limit?: number;    // default 10
  filter?: Record<string, unknown>;
}

export interface MemorySearchResult {
  item: MediaMemoryItem;
  similarityScore: number;
  matchedVectorType: VectorType;
  highlights?: string[];
}

export interface RagContextPack {
  query: string;
  totalMatches: number;
  items: MediaMemoryItem[];
  contextMarkdown: string;
  tokensEstimated: number;
  generatedAt: string;
}

export interface MediaMemoryStats {
  totalItems: number;
  totalVectors: number;
  videoCount: number;
  imageCount: number;
  vectorDimensions: number;
  indexSizeBytes: number;
}
