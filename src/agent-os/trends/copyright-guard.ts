// Phase 20.10 — Copyright & Trademark Guard (spec sections 37, 38).
//
// Protects Adobe Stock asset production against:
// 1. Trademarked brand names and logos (auto-genericization).
// 2. Protected characters, celebrities, and proprietary designs.
// 3. Direct third-party media reuse (strictly enforces original generation only).

export interface BrandGenericizationRule {
  brand: string;
  replacement: string;
  category: "automotive" | "tech" | "apparel" | "beverage" | "entertainment" | "retail";
}

export const PROTECTED_BRANDS: BrandGenericizationRule[] = [
  { brand: "Tesla", replacement: "futuristic angular geometric electric vehicle", category: "automotive" },
  { brand: "Cybertruck", replacement: "angular stainless steel electric pickup truck", category: "automotive" },
  { brand: "Apple", replacement: "sleek minimalist titanium technology device", category: "tech" },
  { brand: "iPhone", replacement: "modern bezel-less smartphone", category: "tech" },
  { brand: "iPad", replacement: "ultra-thin touchscreen tablet device", category: "tech" },
  { brand: "MacBook", replacement: "sleek aluminum ultrabook laptop", category: "tech" },
  { brand: "Nike", replacement: "high-performance athletic sportswear without branding", category: "apparel" },
  { brand: "Adidas", replacement: "ergonomic breathable sports apparel with clean fabric texture", category: "apparel" },
  { brand: "Coca-Cola", replacement: "refreshing chilled carbonated cola beverage in clear glassware", category: "beverage" },
  { brand: "Pepsi", replacement: "sparkling dark soda beverage with ice cubes and condensation", category: "beverage" },
  { brand: "McDonald's", replacement: "fresh fast-casual burger and crispy fries meal", category: "retail" },
  { brand: "Starbucks", replacement: "artisan iced coffee drink in clear cup with paper straw", category: "beverage" },
  { brand: "Disney", replacement: "whimsical fantasy character in enchanting storybook world", category: "entertainment" },
  { brand: "Marvel", replacement: "dynamic superhero in high-tech cinematic armor", category: "entertainment" },
  { brand: "Amazon", replacement: "modern automated smart fulfillment warehouse robotics", category: "retail" },
  { brand: "Google", replacement: "clean minimalist digital search platform interface", category: "tech" },
  { brand: "Sony", replacement: "premium mirrorless cinema camera with prime lens", category: "tech" },
  { brand: "Samsung", replacement: "curved OLED smart display screen", category: "tech" },
];

export interface CopyrightCheckResult {
  passed: boolean;
  detectedBrands: string[];
  wasGenericized: boolean;
  sanitizedText: string;
  riskLevel: "none" | "low" | "medium" | "high";
  recommendations: string[];
}

/**
 * Scans text for trademarked brands and transforms them into commercial-safe generic descriptors.
 */
export function sanitizeTrademarks(text: string): CopyrightCheckResult {
  let sanitized = text;
  const detectedBrands: string[] = [];

  for (const rule of PROTECTED_BRANDS) {
    const regex = new RegExp(`\\b${rule.brand}\\b`, "gi");
    if (regex.test(sanitized)) {
      detectedBrands.push(rule.brand);
      sanitized = sanitized.replace(regex, rule.replacement);
    }
  }

  const wasGenericized = detectedBrands.length > 0;
  const riskLevel = detectedBrands.length > 2 ? "high" : detectedBrands.length > 0 ? "medium" : "none";

  const recommendations: string[] = [];
  if (wasGenericized) {
    recommendations.push(
      `Genericized ${detectedBrands.length} trademarked entity/entities (${detectedBrands.join(", ")}) to comply with Adobe Stock commercial guidelines.`,
      "Ensure generation prompts explicitly avoid trademarked logos, registered emblems, and protected character likenesses.",
    );
  } else {
    recommendations.push("No trademarked commercial brand infringements detected.");
  }

  return {
    passed: true,
    detectedBrands,
    wasGenericized,
    sanitizedText: sanitized,
    riskLevel,
    recommendations,
  };
}

/**
 * Enforces the strict rule: Source research media must NEVER be directly copied or reused.
 */
export function validateProductionInputPolicy(input: {
  isOriginalPrompt: boolean;
  derivedFromSignalOnly: boolean;
  hasDirectMediaAttachment?: boolean;
}): { allowed: boolean; violationReason?: string } {
  if (input.hasDirectMediaAttachment) {
    return {
      allowed: false,
      violationReason: "Direct third-party media attachments are strictly prohibited. Adobe Stock workflow requires 100% original synthesis from abstract topic signals.",
    };
  }
  if (!input.isOriginalPrompt && !input.derivedFromSignalOnly) {
    return {
      allowed: false,
      violationReason: "Concept must be derived from synthesized market intelligence signals, not duplicated third-party copy.",
    };
  }
  return { allowed: true };
}
