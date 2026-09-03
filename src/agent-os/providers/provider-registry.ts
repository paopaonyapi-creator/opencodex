// Pao AI Media Factory — Provider Registry & Budget Governor (Phase 16)
//
// Central registry for multi-modal providers with routing strategies and
// generation budget controls to prevent infinite retry loops and cost overruns.

import type {
  ImageProviderAdapter,
  VideoProviderAdapter,
  TextProviderAdapter,
  RoutingStrategy,
  BudgetGuardConfig,
} from "./provider-types";
import { DEFAULT_BUDGET_GUARD } from "./provider-types";
import { ComfyUiProviderAdapter } from "./comfyui-adapter";
import { MiniMaxH3ProviderAdapter } from "./minimax-h3-adapter";

export interface ProviderRegistration {
  name: string;
  kind: "image" | "video" | "text";
  isLocal: boolean;
  costPerGenerationUsd: number;
  adapter: ImageProviderAdapter | VideoProviderAdapter | TextProviderAdapter;
}

export class BudgetGovernor {
  private config: BudgetGuardConfig;
  private conceptGenerations = new Map<string, number>();
  private batchTotalCostUsd = new Map<string, number>();

  constructor(config: BudgetGuardConfig = DEFAULT_BUDGET_GUARD) {
    this.config = config;
  }

  public checkAndRecordGeneration(conceptId: string, batchId = "default", estimatedCostUsd = 0.05): { allowed: boolean; reason?: string } {
    const currentCount = this.conceptGenerations.get(conceptId) ?? 0;
    if (currentCount >= this.config.maxGenerationsPerConcept) {
      return {
        allowed: false,
        reason: `Budget Guard: Concept ${conceptId} exceeded maximum generation limit (${currentCount}/${this.config.maxGenerationsPerConcept}).`,
      };
    }

    const currentBatchCost = this.batchTotalCostUsd.get(batchId) ?? 0;
    if (this.config.maxCostPerBatchUsd && currentBatchCost + estimatedCostUsd > this.config.maxCostPerBatchUsd) {
      return {
        allowed: false,
        reason: `Budget Guard: Batch ${batchId} exceeded cost ceiling ($${currentBatchCost.toFixed(2)} + $${estimatedCostUsd} > $${this.config.maxCostPerBatchUsd}).`,
      };
    }

    this.conceptGenerations.set(conceptId, currentCount + 1);
    this.batchTotalCostUsd.set(batchId, currentBatchCost + estimatedCostUsd);
    return { allowed: true };
  }

  public getConceptCount(conceptId: string): number {
    return this.conceptGenerations.get(conceptId) ?? 0;
  }

  public reset(): void {
    this.conceptGenerations.clear;
    this.batchTotalCostUsd.clear();
  }
}

export class ProviderRegistry {
  private imageAdapters = new Map<string, ProviderRegistration>();
  private videoAdapters = new Map<string, ProviderRegistration>();
  private textAdapters = new Map<string, ProviderRegistration>();
  public readonly budgetGovernor: BudgetGovernor;

  constructor(budgetConfig?: BudgetGuardConfig) {
    this.budgetGovernor = new BudgetGovernor(budgetConfig);

    // Register built-in default adapters
    this.registerImageProvider({
      name: "comfyui",
      kind: "image",
      isLocal: true,
      costPerGenerationUsd: 0.0,
      adapter: new ComfyUiProviderAdapter(),
    });

    this.registerVideoProvider({
      name: "minimax_h3",
      kind: "video",
      isLocal: true,
      costPerGenerationUsd: 0.05,
      adapter: new MiniMaxH3ProviderAdapter(),
    });
  }

  public registerImageProvider(reg: ProviderRegistration): void {
    this.imageAdapters.set(reg.name, reg);
  }

  public registerVideoProvider(reg: ProviderRegistration): void {
    this.videoAdapters.set(reg.name, reg);
  }

  public registerTextProvider(reg: ProviderRegistration): void {
    this.textAdapters.set(reg.name, reg);
  }

  public getImageAdapter(name = "comfyui"): ImageProviderAdapter | null {
    return (this.imageAdapters.get(name)?.adapter as ImageProviderAdapter) ?? null;
  }

  public getVideoAdapter(name = "minimax_h3"): VideoProviderAdapter | null {
    return (this.videoAdapters.get(name)?.adapter as VideoProviderAdapter) ?? null;
  }

  /** Selects the optimal provider adapter based on routing strategy */
  public selectImageProvider(strategy: RoutingStrategy = "LOCAL_FIRST"): ImageProviderAdapter {
    const list = Array.from(this.imageAdapters.values());
    if (list.length === 0) throw new Error("No image providers registered.");

    if (strategy === "LOCAL_FIRST") {
      const local = list.find((p) => p.isLocal);
      if (local) return local.adapter as ImageProviderAdapter;
    }

    if (strategy === "CHEAP") {
      list.sort((a, b) => a.costPerGenerationUsd - b.costPerGenerationUsd);
      return list[0].adapter as ImageProviderAdapter;
    }

    return list[0].adapter as ImageProviderAdapter;
  }

  public selectVideoProvider(strategy: RoutingStrategy = "LOCAL_FIRST"): VideoProviderAdapter {
    const list = Array.from(this.videoAdapters.values());
    if (list.length === 0) throw new Error("No video providers registered.");

    if (strategy === "LOCAL_FIRST") {
      const local = list.find((p) => p.isLocal);
      if (local) return local.adapter as VideoProviderAdapter;
    }

    return list[0].adapter as VideoProviderAdapter;
  }
}

/** Global singleton instance for application use */
export const providerRegistry = new ProviderRegistry();
