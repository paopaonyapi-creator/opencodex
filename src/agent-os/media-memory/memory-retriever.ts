// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Agent Retrieval & RAG Synthesis Engine

import type { VideoAnalysisReport } from "../video-intelligence/types";
import { VideoMemoryAdapter } from "./video-adapter";
import { MediaMemoryIndex } from "./memory-index";
import type {
  MemorySearchQuery,
  MemorySearchResult,
  RagContextPack,
  MediaMemoryItem,
} from "./types";

export class MediaMemoryRetriever {
  private index: MediaMemoryIndex;

  constructor(index?: MediaMemoryIndex) {
    this.index = index ?? new MediaMemoryIndex();
  }

  getIndex(): MediaMemoryIndex {
    return this.index;
  }

  /**
   * Index a Phase 20.13 VideoAnalysisReport directly into Media Memory.
   */
  indexVideoReport(report: VideoAnalysisReport) {
    const item = VideoMemoryAdapter.fromVideoAnalysisReport(report);
    return this.index.indexItem(item);
  }

  /**
   * Perform semantic similarity search across media memory.
   */
  search(query: MemorySearchQuery): MemorySearchResult[] {
    return this.index.search(query);
  }

  /**
   * Find nearest neighbor media items to a given reference item.
   */
  findSimilar(itemId: string, limit: number = 5, minScore: number = 0.2): MemorySearchResult[] {
    return this.index.findSimilar(itemId, limit, minScore);
  }

  /**
   * Synthesize an agentic RAG prompt context pack formatted in clean Markdown.
   * Tailored for autonomous agents (YouTube God OS scriptwriters, Adobe Stock campaign planners, Reviewer Council).
   */
  buildRagContext(queryText: string, maxItems: number = 3, minScore: number = 0.2): RagContextPack {
    const results = this.index.search({
      queryText,
      limit: maxItems,
      minScore,
    });

    const items = results.map((r) => r.item);
    const now = new Date().toISOString();

    if (items.length === 0) {
      return {
        query: queryText,
        totalMatches: 0,
        items: [],
        contextMarkdown: `## Media Memory Knowledge Context\n*No visual media matches found in local memory for query: "${queryText}".*`,
        tokensEstimated: 20,
        generatedAt: now,
      };
    }

    let md = `## Media Memory Knowledge Context (Query: "${queryText}")\n\n`;
    md += `*Retrieved ${items.length} relevant multimodal media record(s) from local storage:*\n\n`;

    for (let i = 0; i < results.length; i++) {
      const match = results[i];
      const item = match.item;
      const simPercent = Math.round(match.similarityScore * 100);

      md += `### [${i + 1}] ${item.title} (Relevance: ${simPercent}%)\n`;
      md += `- **ID:** \`${item.id}\` | **Type:** ${item.mediaType.toUpperCase()}\n`;
      md += `- **Summary:** ${item.summary}\n`;
      md += `- **Specs:** ${item.technicalSpecs.width}x${item.technicalSpecs.height} (${item.technicalSpecs.orientation || "landscape"}), ${item.technicalSpecs.durationSec?.toFixed(1) || 0}s duration\n`;

      if (item.pacing) {
        md += `- **Pacing:** Rhythm: \`${item.pacing.rhythmProfile?.toUpperCase() || "BALANCED"}\`, ${item.pacing.cutsPerMinute || 0} cuts/min, Mean shot: ${item.pacing.meanShotLengthSec || 0}s\n`;
      }

      if (item.hook) {
        md += `- **0–10s Hook:** Style: \`${item.hook.openingType || "Dynamic"}\`, Score: ${item.hook.visualHookScore || 0}/100, First cut: ${item.hook.firstCutTimestamp || 0}s\n`;
      }

      if (item.transcriptText && item.transcriptText.length > 5) {
        const snippet = item.transcriptText.length > 180 ? item.transcriptText.slice(0, 180) + "..." : item.transcriptText;
        md += `- **Transcript Excerpt:** "${snippet}"\n`;
      }

      if (item.heroFrames && item.heroFrames.length > 0) {
        const frameReasons = item.heroFrames.map((f) => `Frame @${f.timestamp}s (${f.reason || "Hero shot"})`).join("; ");
        md += `- **Key Visuals:** ${frameReasons}\n`;
      }

      if (item.concepts && item.concepts.length > 0) {
        md += `- **Key Concepts:** ${item.concepts.map((c) => `\`${c}\``).join(", ")}\n`;
      }

      md += "\n";
    }

    // Estimate tokens (roughly 1 token per 4 characters)
    const tokensEstimated = Math.ceil(md.length / 4);

    return {
      query: queryText,
      totalMatches: items.length,
      items,
      contextMarkdown: md,
      tokensEstimated,
      generatedAt: now,
    };
  }
}
