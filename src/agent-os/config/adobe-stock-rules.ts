// Adobe Stock Centralized & Versioned Rules Configuration
//
// Phase 16 Rule: Marketplace requirements can change over time.
// Rules are maintained in this centralized configuration module and versioned
// instead of being hard-coded across disparate files.

export interface AdobeStockRules {
  rulesVersion: string;
  lastUpdated: string;
  policyNote: string;
  image: {
    minMegapixels: number;
    maxMegapixels: number;
    maxFileSizeBytes: number;
    acceptedFormats: readonly string[];
    acceptedMimeTypes: readonly string[];
    requiredColorProfile: string;
  };
  png: {
    minMegapixels: number;
    maxMegapixels: number;
    maxFileSizeBytes: number;
    acceptedFormat: string;
    acceptedMimeType: string;
    requiredColorProfile: string;
    requireTrueAlpha: boolean;
    minTransparentRatio: number;
    maxTransparentRatio: number;
    minSubjectBoundingBoxRatio: number;
    maxHaloTolerance: number;
  };
  video: {
    minDurationSeconds: number;
    maxDurationSeconds: number;
    acceptedContainers: readonly string[];
    acceptedCodecs: readonly string[];
    acceptedFrameRates: readonly number[];
    maxFileSizeBytes: number;
  };
  metadata: {
    minTitleLength: number;
    maxTitleLength: number;
    minKeywords: number;
    maxKeywords: number;
    recommendedKeywordsTarget: number;
    prohibitedPatterns: readonly RegExp[];
  };
  compliance: {
    requireGenerativeAiTag: boolean;
    requireHumanReviewBeforeSubmission: boolean;
  };
}

export const ADOBE_STOCK_RULES: AdobeStockRules = {
  rulesVersion: "adobe-stock-2026-06-11",
  lastUpdated: "2026-08-30",
  policyNote: "Adobe Stock requirements are subject to contributor policy updates. Human verification is required prior to real marketplace submission.",
  image: {
    minMegapixels: 4.0,
    maxMegapixels: 100.0,
    maxFileSizeBytes: 45 * 1024 * 1024, // 45 MB
    acceptedFormats: ["jpg", "jpeg"],
    acceptedMimeTypes: ["image/jpeg", "image/jpg"],
    requiredColorProfile: "sRGB",
  },
  png: {
    minMegapixels: 4.0,
    maxMegapixels: 100.0,
    maxFileSizeBytes: 45 * 1024 * 1024, // 45 MB
    acceptedFormat: "png",
    acceptedMimeType: "image/png",
    requiredColorProfile: "sRGB",
    requireTrueAlpha: true,
    minTransparentRatio: 0.05, // at least 5% transparent background
    maxTransparentRatio: 0.95, // at least 5% subject (not empty)
    minSubjectBoundingBoxRatio: 0.15, // subject must fill at least 15% of canvas area
    maxHaloTolerance: 0.08, // threshold for color fringe / edge contamination
  },
  video: {
    minDurationSeconds: 5.0,
    maxDurationSeconds: 60.0,
    acceptedContainers: ["mov", "mp4", "mpg", "mpeg"],
    acceptedCodecs: ["prores", "h264", "h265", "hevc", "av1", "apple prores"],
    acceptedFrameRates: [23.976, 23.98, 24, 25, 29.97, 30, 50, 59.94, 60],
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024, // 4 GB standard cap
  },
  metadata: {
    minTitleLength: 5,
    maxTitleLength: 200,
    minKeywords: 5,
    maxKeywords: 49,
    recommendedKeywordsTarget: 25,
    prohibitedPatterns: [
      /\b(disney|marvel|nike|apple|coca-cola|pepsi|gucci|louis vuitton|lego|pokemon|playstation|xbox|nintendo|tesla|ferrari|porsche)\b/i,
      /\b(mickey mouse|superman|batman|spiderman|iron man|darth vader|yoda|pikachu|harry potter)\b/i,
      /\b(steve jobs|elon musk|bill gates|taylor swift|donald trump|joe biden)\b/i,
      /\b(breaking news|terrorist attack|war casualty|live footage)\b/i,
    ],
  },
  compliance: {
    requireGenerativeAiTag: true,
    requireHumanReviewBeforeSubmission: true,
  },
};
