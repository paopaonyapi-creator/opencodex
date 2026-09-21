/**
 * Phase 20.88 — Remotion Timeline Compiler & Caption Alignment Engine
 * Assembles dynamic scene graphs into frame-accurate, brand-styled Remotion compositions.
 */

import type {
  BrandProfile,
  CaptionSegment,
  CaptionWord,
  SceneNode,
  SceneType,
  TimelineComposition,
  VideoTemplate,
} from "./types";

export interface SceneDraft {
  type: SceneType;
  title: string;
  narrationText: string;
  audioDurationSec: number;
  visualAssetRef?: string;
}

export const DEFAULT_BRAND_PROFILE: BrandProfile = {
  id: "brand_pao_default",
  name: "Pao-hubPro Kinetic",
  primaryColor: "#0f172a", // Slate 900
  secondaryColor: "#38bdf8", // Sky 400
  accentColor: "#f43f5e", // Rose 500
  fontHeading: "Inter, -apple-system, sans-serif",
  fontBody: "Inter, -apple-system, sans-serif",
  safeZonePaddingPx: 64, // Mobile UI safe area padding
};

export const MOBILE_9_16_TEMPLATE: VideoTemplate = {
  id: "template_reels_shorts_9_16",
  name: "Mobile Short-form 9:16 (Reels/Shorts/TikTok)",
  category: "mobile_explainer",
  width: 1080,
  height: 1920,
  fps: 30,
  defaultSceneTypes: ["hook", "problem", "solution", "workflow", "benefit", "cta"],
};

export class TimelineCompiler {
  /**
   * Generates frame-accurate word-level timestamps and segments for kinetic captions.
   */
  public static alignCaptions(
    narrationText: string,
    sceneStartSec: number,
    sceneDurationSec: number,
    fps: number,
  ): CaptionSegment[] {
    const rawWords = narrationText.trim().split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) return [];

    const durationPerWord = sceneDurationSec / rawWords.length;
    const words: CaptionWord[] = [];

    for (let i = 0; i < rawWords.length; i++) {
      const startSec = sceneStartSec + i * durationPerWord;
      const endSec = startSec + durationPerWord;
      const startFrame = Math.round(startSec * fps);
      const endFrame = Math.round(endSec * fps);

      words.push({
        word: rawWords[i],
        startSec,
        endSec,
        startFrame,
        endFrame,
      });
    }

    // Group into short, punchy 3-5 word subtitle chunks for mobile readability
    const segments: CaptionSegment[] = [];
    const chunkSize = 4;

    for (let i = 0; i < words.length; i += chunkSize) {
      const chunkWords = words.slice(i, i + chunkSize);
      const segStartSec = chunkWords[0].startSec;
      const segEndSec = chunkWords[chunkWords.length - 1].endSec;
      const segStartFrame = chunkWords[0].startFrame;
      const segEndFrame = chunkWords[chunkWords.length - 1].endFrame;

      segments.push({
        id: `seg_${Math.round(segStartSec * 100)}`,
        text: chunkWords.map((w) => w.word).join(" "),
        startSec: segStartSec,
        endSec: segEndSec,
        startFrame: segStartFrame,
        endFrame: segEndFrame,
        words: chunkWords,
      });
    }

    return segments;
  }

  /**
   * Compiles scene drafts into a full Remotion TimelineComposition.
   */
  public static compile(
    scenesDraft: SceneDraft[],
    template: VideoTemplate = MOBILE_9_16_TEMPLATE,
    brand: BrandProfile = DEFAULT_BRAND_PROFILE,
  ): TimelineComposition {
    const fps = template.fps;
    let currentFrame = 0;
    let totalSeconds = 0;

    const compiledScenes: SceneNode[] = [];

    for (let idx = 0; idx < scenesDraft.length; idx++) {
      const draft = scenesDraft[idx];
      const durationSec = Math.max(draft.audioDurationSec, 1.5); // Minimum 1.5s per scene
      const durationFrames = Math.round(durationSec * fps);
      const startSec = currentFrame / fps;

      const captions = this.alignCaptions(draft.narrationText, startSec, durationSec, fps);

      compiledScenes.push({
        id: `scene_${idx + 1}_${draft.type}`,
        type: draft.type,
        title: draft.title,
        narrationText: draft.narrationText,
        audioDurationSec: durationSec,
        startFrame: currentFrame,
        durationFrames,
        visualAssetRef: draft.visualAssetRef,
        captions,
      });

      currentFrame += durationFrames;
      totalSeconds += durationSec;
    }

    return {
      compositionId: `comp_${Date.now().toString(36)}`,
      templateId: template.id,
      fps,
      width: template.width,
      height: template.height,
      durationSeconds: Math.round(totalSeconds * 100) / 100,
      totalFrames: currentFrame,
      scenes: compiledScenes,
      brand,
    };
  }
}
