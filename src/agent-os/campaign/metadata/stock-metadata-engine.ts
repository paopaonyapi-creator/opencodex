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
