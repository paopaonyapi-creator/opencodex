// Adobe Stock Metadata Validator & Sanitizer
//
// Phase 16: Enforces title and keyword quality, deduplication, and prohibited
// brand/artist/celebrity/IP checks for stock submissions.

import { ADOBE_STOCK_RULES, type AdobeStockRules } from "../config/adobe-stock-rules";

export interface MetadataValidationInput {
  title: string;
  keywords: string[];
  generatedAi?: boolean;
  fictionalPeopleProperty?: boolean;
  category?: string;
}

export interface MetadataValidationResult {
  valid: boolean;
  cleanedTitle: string;
  cleanedKeywords: string[];
  flaggedProhibitedTerms: string[];
  errors: string[];
  warnings: string[];
  details: {
    titlePass: boolean;
    keywordsCountPass: boolean;
    prohibitedTermsPass: boolean;
    generatedAiPass: boolean;
  };
}

export function validateStockMetadata(
  input: MetadataValidationInput,
  rules: AdobeStockRules = ADOBE_STOCK_RULES,
): MetadataValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const flaggedProhibitedTerms: string[] = [];

  // 1. Title validation & sanitization
  const cleanedTitle = (input.title ?? "").trim().replace(/\s+/g, " ");
  let titlePass = true;

  if (cleanedTitle.length < rules.metadata.minTitleLength) {
    titlePass = false;
    errors.push(
      `Title is too short (${cleanedTitle.length} chars). Minimum is ${rules.metadata.minTitleLength} characters.`,
    );
  } else if (cleanedTitle.length > rules.metadata.maxTitleLength) {
    titlePass = false;
    errors.push(
      `Title is too long (${cleanedTitle.length} chars). Maximum is ${rules.metadata.maxTitleLength} characters.`,
    );
  }

  // 2. Prohibited terms check in Title
  for (const pattern of rules.metadata.prohibitedPatterns) {
    const match = cleanedTitle.match(pattern);
    if (match) {
      flaggedProhibitedTerms.push(match[0]);
      errors.push(
        `Prohibited term "${match[0]}" found in title. Brand names, artist names, celebrities, and copyrighted characters are strictly prohibited.`,
      );
    }
  }

  // 3. Keyword deduplication & cleaning
  const seen = new Set<string>();
  const cleanedKeywords: string[] = [];

  for (const rawKw of input.keywords ?? []) {
    const kw = rawKw
      .trim()
      .toLowerCase()
      .replace(/^[,\s.;]+|[,\s.;]+$/g, "") // strip leading/trailing punctuation
      .replace(/\s+/g, " ");

    if (kw.length > 0 && !seen.has(kw)) {
      seen.add(kw);
      cleanedKeywords.push(kw);

      // Check prohibited terms in keywords
      for (const pattern of rules.metadata.prohibitedPatterns) {
        const match = kw.match(pattern);
        if (match) {
          flaggedProhibitedTerms.push(match[0]);
          errors.push(
            `Prohibited term "${match[0]}" found in keyword "${kw}". Remove all trademarked and celebrity references.`,
          );
        }
      }
    }
  }

  // 4. Keyword count check
  let keywordsCountPass = true;
  if (cleanedKeywords.length < rules.metadata.minKeywords) {
    keywordsCountPass = false;
    errors.push(
      `Insufficient keywords (${cleanedKeywords.length}). Adobe Stock requires at least ${rules.metadata.minKeywords} keywords.`,
    );
  } else if (cleanedKeywords.length > rules.metadata.maxKeywords) {
    keywordsCountPass = false;
    errors.push(
      `Too many keywords (${cleanedKeywords.length}). Adobe Stock maximum is ${rules.metadata.maxKeywords} keywords.`,
    );
  } else if (cleanedKeywords.length < rules.metadata.recommendedKeywordsTarget) {
    warnings.push(
      `Keyword count (${cleanedKeywords.length}) is below recommended target of ${rules.metadata.recommendedKeywordsTarget}. Consider adding more descriptive context terms.`,
    );
  }

  // 5. Generative AI flag
  let generatedAiPass = true;
  if (input.generatedAi !== true && rules.compliance.requireGenerativeAiTag) {
    generatedAiPass = false;
    errors.push("Missing required Generative AI declaration (generatedAi must be true).");
  }

  const prohibitedTermsPass = flaggedProhibitedTerms.length === 0;
  const valid = titlePass && keywordsCountPass && prohibitedTermsPass && generatedAiPass;

  return {
    valid,
    cleanedTitle,
    cleanedKeywords,
    flaggedProhibitedTerms,
    errors,
    warnings,
    details: {
      titlePass,
      keywordsCountPass,
      prohibitedTermsPass,
      generatedAiPass,
    },
  };
}
