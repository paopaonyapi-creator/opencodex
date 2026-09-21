import { describe, expect, it } from "bun:test";
import {
  ASPECT_RATIO_SPECS,
  evaluateSubmissionQc,
  generateMetadataForItem,
} from "../src/agent-os/campaign/metadata/stock-metadata-engine";

describe("Adobe Stock Creator GOD MODZa Knowledge & Submission QC", () => {
  it("provides complete aspect-ratio specs and commercial composition tags", () => {
    expect(ASPECT_RATIO_SPECS["16:9"].compositionTags).toContain("copy space");
    expect(ASPECT_RATIO_SPECS["9:16"].compositionTags).toContain("reels");
    expect(ASPECT_RATIO_SPECS["1:1"].minDimensions).toBe("3000x3000");
    expect(ASPECT_RATIO_SPECS["3:2"].minDimensions).toBe("6000x4000");
  });

  it("detects forbidden trademarks in titles or tags and flags advice", () => {
    const badItem = {
      title: "Woman holding new iPhone in modern office",
      keywords: ["woman", "office", "iphone", "apple", "technology", "communication"],
    };

    const qc = evaluateSubmissionQc(badItem);
    expect(qc.noVisibleTrademarks).toBe(false);
    expect(qc.readyForSubmission).toBe(false);
    expect(qc.advice.some((a) => a.includes("iphone"))).toBe(true);
  });

  it("validates high quality compliant submission asset", () => {
    const metadata = generateMetadataForItem({
      prompt: "Solar panels mounted on rooftop of modern eco-friendly house under bright blue sky",
      keyword: "solar panel",
      category: "clean_tech",
    });

    expect(metadata.title.length).toBeGreaterThan(10);
    expect(metadata.keywords.length).toBeGreaterThanOrEqual(25);

    const qc = evaluateSubmissionQc({
      title: metadata.title,
      keywords: metadata.keywords,
      width: 6000,
      height: 4000,
      aspectRatio: "3:2",
    });

    expect(qc.noVisibleTrademarks).toBe(true);
    expect(qc.resolution5kPlus).toBe(true);
    expect(qc.cleanListingMetadata).toBe(true);
    expect(qc.readyForSubmission).toBe(true);
  });
});
