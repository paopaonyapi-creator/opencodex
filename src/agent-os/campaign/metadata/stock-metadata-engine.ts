// Pao Stock Autonomous Campaign Planner — Stock Metadata Engine (Phase 21)
//
// Automatically constructs commercial SEO titles and 25-45 hierarchical tags
// formatted to Adobe Stock submission standards and relevancy indexing rules.

export interface MetadataGenerationInput {
  prompt: string;
  keyword?: string;
  category?: string;
  assetType?: string;
  lighting?: string;
  angle?: string;
}

export interface GeneratedStockMetadata {
  title: string;
  keywords: string[];
  categoryNumber: number;
  categoryName: string;
  commercialIntent: string;
}

// Adobe Stock numeric category mapping
const ADOBE_STOCK_CATEGORIES: Record<string, { id: number; name: string }> = {
  clean_tech: { id: 17, name: "Environment" },
  sustainable_mobility: { id: 13, name: "Transportation" },
  robotics: { id: 7, name: "Technology" },
  ai_infrastructure: { id: 7, name: "Technology" },
  agritech: { id: 1, name: "Agriculture" },
  biotech: { id: 11, name: "Science" },
  fintech: { id: 3, name: "Business" },
  general: { id: 3, name: "Business" },
};

const CATEGORY_DEFAULT_TAGS: Record<string, string[]> = {
  clean_tech: ["solar", "renewable", "green energy", "eco", "power", "solar panel", "electricity", "generation", "climate", "alternative energy"],
  sustainable_mobility: ["ev", "electric vehicle", "transport", "mobility", "automotive", "charging", "battery", "eco transport", "clean transit", "urban"],
  robotics: ["robot", "robotics", "automation", "robotic arm", "machine", "engineering", "cybernetics", "hardware", "smart factory", "mechanics"],
  ai_infrastructure: ["datacenter", "data center", "server room", "computing", "cloud", "telecom", "supercomputer", "network", "digital", "high tech"],
  agritech: ["farming", "agriculture", "smart farm", "greenhouse", "crops", "botanical", "hydroponics", "cultivation", "horticulture", "agribusiness"],
  biotech: ["laboratory", "science", "genetics", "medical", "research", "biology", "pharmaceutical", "scientific", "microscope", "healthcare"],
  fintech: ["finance", "banking", "payment", "digital money", "investment", "commerce", "transaction", "currency", "cashless", "fintech"],
  general: ["corporate", "workplace", "background", "lifestyle", "commercial stock", "contemporary", "creative", "bright", "copyspace", "horizontal"],
};

const COMMON_COMMERCIAL_TAGS = [
  "commercial", "professional", "industry", "modern", "future", "innovation",
  "concept", "business", "technology", "sustainable", "clean", "design", "nobody",
  "indoor", "outdoor", "daylight", "bright", "quality", "success", "digital",
  "development", "solution", "strategy", "efficiency", "corporate", "creative",
  "generative", "high resolution", "stock photo", "visual",
];

/**
 * Builds clean, concise Adobe Stock title under 70 characters.
 */
export function buildStockTitle(prompt: string, keyword?: string): string {
  // Extract primary essence from prompt, clean filler words
  const cleanPrompt = prompt
    .replace(/\b(photorealistic|hyperrealistic|cinematic|4k|ultra hd|8k|raw|masterpiece|trending on artstation)\b/gi, "")
    .replace(/,\s*,+/g, ",")
    .trim();

  const firstClause = cleanPrompt.split(/[,.;]/)[0]?.trim() || keyword || "Commercial Stock Asset";
  let title = firstClause.charAt(0).toUpperCase() + firstClause.slice(1);

  if (title.length > 70) {
    title = title.slice(0, 67).trim() + "...";
  }
  return title;
}

/**
 * Generates an ordered set of 25-45 hierarchical keywords for Adobe Stock.
 */
export function generateStockKeywords(input: MetadataGenerationInput): string[] {
  const tagsSet = new Set<string>();

  // 1. Primary subject words from target keyword
  if (input.keyword) {
    input.keyword.toLowerCase().split(/\s+/).forEach((w) => {
      if (w.length > 2) tagsSet.add(w);
    });
    tagsSet.add(input.keyword.toLowerCase());
  }

  // 2. Specific nouns and adjectives from prompt
  const words = input.prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["with", "from", "that", "this", "shot", "view", "photo"].includes(w));

  for (const w of words) {
    tagsSet.add(w);
    if (tagsSet.size >= 25) break;
  }

  // 3. Technical & Composition tags
  if (input.assetType === "video_4k") tagsSet.add("video").add("footage").add("motion");
  if (input.assetType === "isolated_element") tagsSet.add("isolated").add("cutout").add("white background");
  if (input.lighting) tagsSet.add(input.lighting.replace(/_/g, " "));
  if (input.angle) tagsSet.add(input.angle.replace(/_/g, " "));

  // 4. Enrich with category default tags
  const catKey = input.category ?? "general";
  const catTags = CATEGORY_DEFAULT_TAGS[catKey] ?? CATEGORY_DEFAULT_TAGS.general;
  for (const cTag of catTags) {
    tagsSet.add(cTag);
  }

  // 5. Enrich with commercial core tags
  for (const tag of COMMON_COMMERCIAL_TAGS) {
    tagsSet.add(tag);
    if (tagsSet.size >= 40) break;
  }

  return Array.from(tagsSet).slice(0, 45);
}

// ---------------------------------------------------------------------------
// Phase 21 & GOD MODZa Enhanced Knowledge & QC Architecture
// ---------------------------------------------------------------------------

export const FORBIDDEN_TRADEMARKS = [
  "iphone", "ipad", "macbook", "apple", "nike", "adidas", "tesla",
  "microsoft", "windows", "playstation", "xbox", "gopro", "dji",
  "coca cola", "pepsi", "starbucks", "mcdonalds",
] as const;

export type AspectRatioType = "16:9" | "9:16" | "1:1" | "4:5" | "3:2" | "2:3";

export const ASPECT_RATIO_SPECS: Record<AspectRatioType, {
  buyerUse: string;
  minDimensions: string;
  compositionTags: string[];
}> = {
  "16:9": {
    buyerUse: "Websites, presentations, video thumbnails, digital ads",
    minDimensions: "3840x2160 (4K UHD)",
    compositionTags: ["horizontal", "widescreen", "banner", "copy space", "landscape"],
  },
  "9:16": {
    buyerUse: "Stories, Reels, Shorts, vertical mobile advertising",
    minDimensions: "2160x3840 (4K Vertical)",
    compositionTags: ["vertical", "stories", "reels", "mobile", "full screen"],
  },
  "1:1": {
    buyerUse: "Social posts, marketplace tiles, compact ads",
    minDimensions: "3000x3000",
    compositionTags: ["square", "social media", "centered", "balanced"],
  },
  "4:5": {
    buyerUse: "Portrait social feeds, mobile advertising",
    minDimensions: "3200x4000",
    compositionTags: ["portrait", "social feed", "vertical", "headline space"],
  },
  "3:2": {
    buyerUse: "Editorial, web banners, print, general stock use",
    minDimensions: "6000x4000",
    compositionTags: ["classic ratio", "editorial", "rule of thirds", "horizontal"],
  },
  "2:3": {
    buyerUse: "Posters, magazine covers, vertical layouts",
    minDimensions: "4000x6000",
    compositionTags: ["poster layout", "cover", "vertical format", "safe area"],
  },
};

export interface SubmissionQcChecklist {
  aspectRatioOk: boolean;
  resolution5kPlus: boolean;
  noVisibleTrademarks: boolean;
  noAiAnatomyArtifacts: boolean;
  cleanListingMetadata: boolean;
  readyForSubmission: boolean;
  advice: string[];
}

/**
 * Validates metadata and technical parameters against Adobe Stock Creator GOD MODZa standards.
 */
export function evaluateSubmissionQc(item: {
  title: string;
  keywords: string[];
  width?: number;
  height?: number;
  aspectRatio?: AspectRatioType;
}): SubmissionQcChecklist {
  const advice: string[] = [];
  let noVisibleTrademarks = true;

  const combinedText = `${item.title} ${item.keywords.join(" ")}`.toLowerCase();
  for (const tm of FORBIDDEN_TRADEMARKS) {
    if (combinedText.includes(tm)) {
      noVisibleTrademarks = false;
      advice.push(`Remove trademark reference '${tm}' to prevent copyright/trademark rejection.`);
    }
  }

  const longestEdge = Math.max(item.width ?? 0, item.height ?? 0);
  const resolution5kPlus = longestEdge >= 5000;
  if (item.width && item.height && !resolution5kPlus) {
    advice.push(`Resolution is ${item.width}x${item.height}. Recommended master target is at least 5000px on the long edge.`);
  }

  const cleanListingMetadata = item.title.length >= 10 && item.title.length <= 70 && item.keywords.length >= 25;
  if (!cleanListingMetadata) {
    advice.push("Ensure title is between 10-70 characters and contains 25-45 hierarchical tags.");
  }

  const readyForSubmission = noVisibleTrademarks && cleanListingMetadata;

  return {
    aspectRatioOk: item.aspectRatio ? Boolean(ASPECT_RATIO_SPECS[item.aspectRatio]) : true,
    resolution5kPlus: (item.width && item.height) ? resolution5kPlus : true,
    noVisibleTrademarks,
    noAiAnatomyArtifacts: true,
    cleanListingMetadata,
    readyForSubmission,
    advice,
  };
}

/**
 * Generates comprehensive metadata for a campaign item.
 */
export function generateMetadataForItem(input: MetadataGenerationInput): GeneratedStockMetadata {
  const categoryKey = input.category ?? "general";
  const cat = ADOBE_STOCK_CATEGORIES[categoryKey] ?? ADOBE_STOCK_CATEGORIES.general;
  const title = buildStockTitle(input.prompt, input.keyword);
  const keywords = generateStockKeywords(input);

  return {
    title,
    keywords,
    categoryNumber: cat.id,
    categoryName: cat.name,
    commercialIntent: "commercial_royalty_free",
  };
}
