/**
 * Pao AI Gateway — Alias resolution.
 *
 * Agents request capability aliases (pao-fast, pao-code, etc.)
 * instead of vendor model IDs. This module resolves aliases to
 * concrete model IDs using config-driven mappings.
 */

import type { AliasConfig, GatewayModelConfig } from "./types";

export interface AliasResolution {
  readonly aliasId: string;
  readonly modelId: string;
  readonly priority: number;
  readonly constraints?: {
    readonly localOnly?: boolean;
    readonly reviewRequired?: boolean;
  };
}

/**
 * Resolve an alias to ordered model candidates.
 * Returns candidates sorted by priority (highest first).
 * Only returns models that exist in the catalog and are enabled.
 */
export function resolveAlias(
  aliasId: string,
  aliases: readonly AliasConfig[],
  models: readonly GatewayModelConfig[],
): AliasResolution[] {
  const alias = aliases.find(a => a.id === aliasId);
  if (!alias) return [];

  const modelIds = new Set(models.filter(m => m.enabled !== false).map(m => m.id));

  return alias.routes
    .filter(r => modelIds.has(r.modelId))
    .sort((a, b) => b.priority - a.priority)
    .map(r => ({
      aliasId,
      modelId: r.modelId,
      priority: r.priority,
      constraints: alias.constraints,
    }));
}

/**
 * Check whether an alias exists in the configuration.
 */
export function aliasExists(aliasId: string, aliases: readonly AliasConfig[]): boolean {
  return aliases.some(a => a.id === aliasId);
}

/**
 * List all configured alias IDs.
 */
export function listAliases(aliases: readonly AliasConfig[]): string[] {
  return aliases.map(a => a.id);
}

/**
 * Check if a requested model string is a Pao alias (starts with "pao-").
 * If not, it's treated as a direct model reference.
 */
export function isPaoAlias(model: string): boolean {
  return model.startsWith("pao-");
}
