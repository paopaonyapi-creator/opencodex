/**
 * Pao AI Gateway — Reviewer Role & Independence Selector.
 *
 * Enforces Section 16 independence requirements:
 * - Reviewers must come from distinct provider families where practical
 * - Developer model family is excluded from high-risk reviewer assignment
 * - Assigns appropriate specialized reviewer roles
 */

import type { GatewayModelConfig, GatewayProviderConfig } from "../types";
import type { ReviewerRole, ReviewRequirement } from "./types";

export interface ReviewerAssignment {
  readonly role: ReviewerRole;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerFamily: string;
  readonly isIndependent: boolean;
}

/**
 * Determine the canonical provider family from provider type or id.
 */
export function getProviderFamily(providerId: string, providerType?: string): string {
  const idNorm = providerId.toLowerCase();
  const typeNorm = (providerType ?? "").toLowerCase();
  const combined = `${idNorm} ${typeNorm}`;

  if (combined.includes("local") || combined.includes("ollama") || combined.includes("vllm")) return "local";
  if (combined.includes("runpod")) return "runpod";
  if (combined.includes("anthropic") || combined.includes("claude")) return "anthropic";
  if (combined.includes("gemini") || combined.includes("google")) return "gemini";
  if (combined.includes("openrouter")) return "openrouter";
  if (typeNorm === "openai" || idNorm.includes("openai")) return "openai";
  return typeNorm || idNorm;
}

/**
 * Select independent reviewers according to the review requirement.
 */
export function selectReviewers(
  requirement: ReviewRequirement,
  availableModels: readonly GatewayModelConfig[],
  providers: readonly GatewayProviderConfig[],
  developerProviderId?: string,
): ReviewerAssignment[] {
  if (requirement.minReviewers === 0 || requirement.requiredRoles.length === 0) {
    return [];
  }

  const devFamily = developerProviderId ? getProviderFamily(developerProviderId) : "";
  const providerTypeMap = new Map<string, string>();
  for (const p of providers) {
    providerTypeMap.set(p.id, p.type);
  }

  // Group models with chat capability by provider family
  const modelsByFamily = new Map<string, GatewayModelConfig[]>();
  for (const m of availableModels) {
    if (!m.capabilities.chat) continue;
    const provType = providerTypeMap.get(m.providerId);
    const family = getProviderFamily(m.providerId, provType);
    let list = modelsByFamily.get(family);
    if (!list) {
      list = [];
      modelsByFamily.set(family, list);
    }
    list.push(m);
  }

  const assignments: ReviewerAssignment[] = [];
  const usedFamilies = new Set<string>();
  if (requirement.requireDifferentProviders && devFamily) {
    usedFamilies.add(devFamily); // Avoid developer family first
  }

  for (const role of requirement.requiredRoles) {
    let chosenModel: GatewayModelConfig | null = null;
    let chosenFamily = "";
    let isIndependent = false;

    // First pass: try to find a model from an unused family
    for (const [family, models] of modelsByFamily.entries()) {
      if (!usedFamilies.has(family) && models.length > 0) {
        chosenModel = models[0]!;
        chosenFamily = family;
        usedFamilies.add(family);
        isIndependent = true;
        break;
      }
    }

    // Second pass: if no unused family, take any family except developer family (if possible)
    if (!chosenModel) {
      for (const [family, models] of modelsByFamily.entries()) {
        if (family !== devFamily && models.length > 0) {
          chosenModel = models[0]!;
          chosenFamily = family;
          isIndependent = true;
          break;
        }
      }
    }

    // Fallback: take any available model
    if (!chosenModel) {
      for (const [family, models] of modelsByFamily.entries()) {
        if (models.length > 0) {
          chosenModel = models[0]!;
          chosenFamily = family;
          isIndependent = (family !== devFamily);
          break;
        }
      }
    }

    if (chosenModel) {
      assignments.push({
        role,
        providerId: chosenModel.providerId,
        modelId: chosenModel.id,
        providerFamily: chosenFamily,
        isIndependent,
      });
    }
  }

  return assignments;
}
