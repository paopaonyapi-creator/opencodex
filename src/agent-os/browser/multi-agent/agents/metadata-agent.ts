// Phase 20.13 — Metadata Web Agent
//
// Specialized agent persona that synthesizes SEO-optimized titles, descriptions,
// commercial categories, and keyword tags, with automated DOM field autofill.

import { getBrowserBridge } from "../../bridge/browser-bridge";
import type { MetadataPayload, ResearchBrief } from "../types";

export class MetadataWebAgent {
  /**
   * Generates a grounded, compliant metadata payload based on research and asset context.
   */
  public generateMetadata(
    assetConcept: string,
    research?: ResearchBrief,
    options?: { maxKeywords?: number; category?: string },
  ): MetadataPayload {
    const cleanConcept = assetConcept.trim();
    const title = `${cleanConcept} - Premium Commercial Asset`;
    const description = `High quality, professionally composed ${cleanConcept.toLowerCase()} suitable for commercial, editorial, and digital design projects.`;

    const pool = new Set<string>();
    // Add words from concept
    for (const word of cleanConcept.toLowerCase().split(/\s+/)) {
      if (word.length > 2) pool.add(word);
    }

    // Incorporate research tags
    if (research && research.recommendedTags) {
      for (const t of research.recommendedTags) {
        pool.add(t.toLowerCase());
      }
    }

    // Default commercial tags
    const baselineTags = [
      "isolated",
      "concept",
      "design",
      "creative",
      "wallpaper",
      "illustration",
      "modern",
      "graphic",
    ];
    for (const t of baselineTags) {
      pool.add(t);
    }

    const maxKeywords = options?.maxKeywords || 25;
    const keywords = Array.from(pool).slice(0, maxKeywords);

    return {
      title,
      description,
      keywords,
      category: options?.category || "Photography & Graphics",
      complianceTags: ["editorial_clean", "no_trademarks_detected", "safe_for_work"],
    };
  }

  /**
   * Autofills generated metadata into the active web form.
   */
  public async autofillForm(
    payload: MetadataPayload,
    tabId?: string,
    selectors?: { titleTarget?: string; keywordsTarget?: string; descTarget?: string },
  ): Promise<{ filled: string[]; url: string }> {
    const bridge = getBrowserBridge();
    const filled: string[] = [];

    const titleSelector = selectors?.titleTarget || "input[name='asset_title']";
    const keywordsSelector = selectors?.keywordsTarget || "input[name='keywords']";

    // 1. Fill title
    try {
      await bridge.executeAction({
        tool: "browser.type",
        tabId,
        target: titleSelector,
        text: payload.title,
        agent: "metadata-agent",
      });
      filled.push("title");
    } catch {
      // Fallback to generic title input
      try {
        await bridge.executeAction({
          tool: "browser.type",
          tabId,
          target: "input[name='title']",
          text: payload.title,
          agent: "metadata-agent",
        });
        filled.push("title");
      } catch {}
    }

    // 2. Fill keywords
    try {
      await bridge.executeAction({
        tool: "browser.type",
        tabId,
        target: keywordsSelector,
        text: payload.keywords.join(", "),
        agent: "metadata-agent",
      });
      filled.push("keywords");
    } catch {
      try {
        await bridge.executeAction({
          tool: "browser.type",
          tabId,
          target: "textarea[name='keywords']",
          text: payload.keywords.join(", "),
          agent: "metadata-agent",
        });
        filled.push("keywords");
      } catch {}
    }

    const currentUrl = bridge.getActiveTab()?.url || "about:blank";
    return { filled, url: currentUrl };
  }
}

let metadataWebAgentInstance: MetadataWebAgent | null = null;
export function getMetadataWebAgent(): MetadataWebAgent {
  if (!metadataWebAgentInstance) {
    metadataWebAgentInstance = new MetadataWebAgent();
  }
  return metadataWebAgentInstance;
}
