// Pao AI Media Factory — Similarity & Near-Duplicate Engine (Phase 16)
//
// Layered similarity checking:
// Layer 1: Prompt & concept text token similarity (Jaccard + Levenshtein distance)
// Layer 2: Visual perceptual hash (dHash / block difference) comparison
// Layer 3: Batch clustering & distinction classification

export type SimilarityCategory = "UNIQUE" | "RELATED_BUT_DISTINCT" | "TOO_SIMILAR" | "DUPLICATE";

export interface SimilarityResult {
  category: SimilarityCategory;
  score: number; // 0.0 (totally unique) to 1.0 (exact duplicate)
  textSimilarity: number;
  visualSimilarity?: number;
  reason: string;
  matchedSiblingId?: string;
}

export interface AssetSignature {
  id: string;
  title?: string;
  promptText?: string;
  conceptDescription?: string;
  perceptualHash?: string; // Hex string e.g. 64-bit dHash
}

/** Compute Jaccard token similarity between two text strings */
export function calculateTextSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;
  const normalize = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const tokensA = new Set(normalize(textA));
  const tokensB = new Set(normalize(textB));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return Number((intersection / union).toFixed(3));
}

/** Compute Hamming distance between two hex hash strings */
export function calculateHammingDistance(hexA: string, hexB: string): number {
  if (!hexA || !hexB) return 64;
  const cleanA = hexA.trim().toLowerCase();
  const cleanB = hexB.trim().toLowerCase();
  if (cleanA.length !== cleanB.length) return 64;

  let distance = 0;
  for (let i = 0; i < cleanA.length; i++) {
    const valA = parseInt(cleanA[i], 16);
    const valB = parseInt(cleanB[i], 16);
    if (isNaN(valA) || isNaN(valB)) continue;
    let xor = valA ^ valB;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/** Normalize perceptual hash distance to 0.0 (completely different) -> 1.0 (identical) */
export function calculateVisualSimilarity(hashA?: string, hashB?: string): number | undefined {
  if (!hashA || !hashB) return undefined;
  const distance = calculateHammingDistance(hashA, hashB);
  // 64-bit hash: distance <= 4 is near-identical, > 16 is distinct
  const maxDistance = 64;
  const similarity = Math.max(0, (maxDistance - distance) / maxDistance);
  return Number(similarity.toFixed(3));
}

/**
 * Evaluates candidate asset against existing sibling assets in the same batch or project.
 * Enforces Adobe Stock distinctness rules: flags near-duplicates where variations are only superficial.
 */
export function evaluateSimilarity(
  candidate: AssetSignature,
  siblings: AssetSignature[],
): SimilarityResult {
  if (siblings.length === 0) {
    return {
      category: "UNIQUE",
      score: 0.0,
      textSimilarity: 0.0,
      reason: "First asset in batch; no siblings to compare.",
    };
  }

  let highestScore = 0.0;
  let highestTextSim = 0.0;
  let highestVisualSim: number | undefined = undefined;
  let closestSibling: AssetSignature | null = null;

  for (const sibling of siblings) {
    if (sibling.id === candidate.id) continue;

    const candText = `${candidate.title ?? ""} ${candidate.promptText ?? ""} ${candidate.conceptDescription ?? ""}`.trim();
    const sibText = `${sibling.title ?? ""} ${sibling.promptText ?? ""} ${sibling.conceptDescription ?? ""}`.trim();
    const textSim = calculateTextSimilarity(candText, sibText);

    let visualSim: number | undefined = undefined;
    if (candidate.perceptualHash && sibling.perceptualHash) {
      visualSim = calculateVisualSimilarity(candidate.perceptualHash, sibling.perceptualHash);
    }

    // Combined similarity score (weighted visual + text if visual available)
    const combinedScore = visualSim !== undefined ? visualSim * 0.65 + textSim * 0.35 : textSim;

    if (combinedScore > highestScore) {
      highestScore = combinedScore;
      highestTextSim = textSim;
      highestVisualSim = visualSim;
      closestSibling = sibling;
    }
  }

  highestScore = Number(highestScore.toFixed(3));

  let category: SimilarityCategory = "UNIQUE";
  let reason = "Asset is distinct from all siblings in the batch.";

  if (highestScore >= 0.90) {
    category = "DUPLICATE";
    reason = `Exact or near-identical duplicate of asset ${closestSibling?.id ?? "unknown"} (similarity: ${(highestScore * 100).toFixed(0)}%).`;
  } else if (highestScore >= 0.72) {
    category = "TOO_SIMILAR";
    reason = `Excessive similarity with asset ${closestSibling?.id ?? "unknown"} (similarity: ${(highestScore * 100).toFixed(0)}%). Commercial use case lacks meaningful differentiation.`;
  } else if (highestScore >= 0.40) {
    category = "RELATED_BUT_DISTINCT";
    reason = `Complementary concept sharing family theme with asset ${closestSibling?.id ?? "unknown"} (similarity: ${(highestScore * 100).toFixed(0)}%).`;
  }

  return {
    category,
    score: highestScore,
    textSimilarity: highestTextSim,
    visualSimilarity: highestVisualSim,
    reason,
    matchedSiblingId: closestSibling?.id,
  };
}
