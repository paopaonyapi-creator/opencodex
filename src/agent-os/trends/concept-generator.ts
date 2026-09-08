// Phase 20.10 — Concept Generator (spec section 16).
//
// Synthesizes original stock production concepts from market intelligence,
// buyer intent insights, and opportunity scores. Enforces trademark genericization.

import { analyzeBuyerIntent, type BuyerIntentAnalysis } from "./buyer-intent";
import { sanitizeTrademarks } from "./copyright-guard";
import type { NormalizedTrendSignal, StockConcept } from "./types";

export interface GenerateConceptsOptions {
  researchJobId: string;
  topic: string;
  opportunityScoreId?: string | null;
  opportunityScore?: number;
  signals?: NormalizedTrendSignal[];
  buyerIntent?: BuyerIntentAnalysis;
  count?: number;
}

export function generateStockConcepts(options: GenerateConceptsOptions): StockConcept[] {
  const {
    researchJobId,
    topic,
    opportunityScoreId = null,
    opportunityScore = 75,
    signals = [],
    count = 2,
  } = options;

  const buyerIntent = options.buyerIntent || analyzeBuyerIntent(topic, [], signals);
  const trademarkCheck = sanitizeTrademarks(topic);
  const cleanTopic = trademarkCheck.sanitizedText;

  const now = new Date().toISOString();
  const concepts: StockConcept[] = [];

  // Concept 1: Cinematic 4K Video Concept (Action / Establishing)
  const id1 = `cpt_${Math.random().toString(36).slice(2, 10)}`;
  const title1 = `Cinematic 4K view of ${cleanTopic} in modern commercial setting`;
  const sanitizedTitle1 = sanitizeTrademarks(title1).sanitizedText;

  const prompt1 = `Masterpiece cinematic 4K commercial stock footage of ${cleanTopic}, showcasing ${buyerIntent.commercialUseCases[0] || "professional workflow"}. Natural atmospheric sunlight, professional color grading, ultra-sharp focus, high production value, photorealistic, 8k resolution, shot on Arri Alexa, clean composition with negative space for commercial copy.`;
  const sanitizedPrompt1 = sanitizeTrademarks(prompt1).sanitizedText;

  concepts.push({
    id: id1,
    researchJobId,
    opportunityScoreId: opportunityScoreId || null,
    title: sanitizedTitle1,
    buyer: {
      targetIndustry: buyerIntent.targetIndustry,
      buyerPersona: buyerIntent.buyerPersonas[0] || "Commercial Brand Marketer",
      useCase: buyerIntent.commercialUseCases[0] || "Website hero and video commercial",
    },
    assetTypes: ["video_4k", "photo_raw"],
    visualDirection: `High-end cinematic establishing perspective highlighting ${cleanTopic}. Natural daylight with soft volumetric rays, crisp focus on key elements, smooth camera glide.`,
    mustInclude: [
      "Authentic realistic lighting and physics",
      "Modern clean architectural or natural setting",
      "Negative space on left/right for commercial typography",
    ],
    mustAvoid: [
      "Visible brand logos, trademarks, and emblems",
      "Distorted human anatomy, extra limbs, unnatural fingers",
      "Heavy artificial neon glow or generic stock clichés",
      "Watermarks, text overlays, and digital artifacts",
    ],
    commercialUseCases: buyerIntent.commercialUseCases,
    productionDifficulty: 4.5,
    status: "draft",
    payload: {
      recommendedPrompt: sanitizedPrompt1,
      recommendedNegativePrompt: "blurry, low quality, deformed, trademark, logo, text, watermark, oversaturated, amateur, cartoon",
      suggestedLighting: "Golden hour side-lighting with soft diffused fill",
      suggestedAngle: "Smooth low-angle slow push-in or wide establishing tracking shot",
      aspectRatio: "16:9",
    },
    createdAt: now,
  });

  if (count > 1) {
    // Concept 2: High-Resolution Macro/Detail Commercial Photo
    const id2 = `cpt_${Math.random().toString(36).slice(2, 10)}`;
    const title2 = `Professional close-up detail of ${cleanTopic} for enterprise editorial`;
    const sanitizedTitle2 = sanitizeTrademarks(title2).sanitizedText;

    const prompt2 = `Award-winning commercial editorial photography, detailed close-up shot of ${cleanTopic}. Clean minimalist commercial background, pristine reflections, tack sharp prime lens depth of field (f/2.8), authentic premium materials, Hasselblad H6D-100c look, balanced commercial studio lighting.`;
    const sanitizedPrompt2 = sanitizeTrademarks(prompt2).sanitizedText;

    concepts.push({
      id: id2,
      researchJobId,
      opportunityScoreId: opportunityScoreId || null,
      title: sanitizedTitle2,
      buyer: {
        targetIndustry: buyerIntent.targetIndustry,
        buyerPersona: buyerIntent.buyerPersonas[1] || buyerIntent.buyerPersonas[0] || "Art Director",
        useCase: buyerIntent.commercialUseCases[1] || "Editorial publication and print ad",
      },
      assetTypes: ["photo_raw"],
      visualDirection: `Intimate, detailed commercial macro perspective celebrating craft and engineering in ${cleanTopic}. Shallow depth of field drawing focus to the functional core.`,
      mustInclude: [
        "Tack-sharp focal point on functional components",
        "Micro-textures and authentic material finishes",
        "Generous negative space for headline placement",
      ],
      mustAvoid: [
        "Any copyrighted symbols, corporate logos, or registered badges",
        "Plastic-looking skin or muddy textures",
        "Noisy shadows and clipped highlights",
      ],
      commercialUseCases: buyerIntent.commercialUseCases,
      productionDifficulty: 3.2,
      status: "draft",
      payload: {
        recommendedPrompt: sanitizedPrompt2,
        recommendedNegativePrompt: "noisy, chromatic aberration, trademark, logo, text, distorted, blurry, flat lighting",
        suggestedLighting: "Refined 3-point softbox studio lighting with subtle rim light",
        suggestedAngle: "Macro 45-degree angled perspective with f/2.8 bokeh",
        aspectRatio: "3:2",
      },
      createdAt: now,
    });
  }

  return concepts;
}
