// Phase 20 — GPU Capability Catalog & Pricing.
//
// Manages GPU capability profiles, VRAM specifications, benchmark scores,
// and observed pricing with explicit timestamps.

import { openAgentOsDb } from "../../db";
import type { GpuCapabilityProfile, WorkloadClass } from "../types";

function rowToProfile(row: Record<string, unknown>): GpuCapabilityProfile {
  return {
    id: row.id as string,
    gpuTypeId: row.gpu_type_id as string,
    displayName: row.display_name as string,
    vramGb: row.vram_gb as number,
    architecture: row.architecture as string,
    provider: row.provider as string,
    supportsCuda: row.supports_cuda === 1,
    allowedWorkloadClasses: JSON.parse((row.allowed_workload_classes_json as string) ?? "[]") as WorkloadClass[],
    observedPricePerHour: (row.observed_price_per_hour as number | null) ?? null,
    priceObservedAt: (row.price_observed_at as string | null) ?? null,
    benchmarkScore: row.benchmark_score as number,
    enabled: row.enabled === 1,
    notes: row.notes as string,
  };
}

const DEFAULT_GPU_PROFILES: Array<Omit<GpuCapabilityProfile, "id">> = [
  {
    gpuTypeId: "NVIDIA GeForce RTX 4090",
    displayName: "RTX 4090 (24GB)",
    vramGb: 24,
    architecture: "Ada Lovelace",
    provider: "runpod",
    supportsCuda: true,
    allowedWorkloadClasses: [
      "LIGHT_IMAGE", "STANDARD_IMAGE", "HEAVY_IMAGE", "IMAGE_EDIT", "UPSCALE_IMAGE", "LIGHT_VIDEO", "BATCH",
    ],
    observedPricePerHour: 0.74,
    priceObservedAt: new Date().toISOString(),
    benchmarkScore: 100,
    enabled: true,
    notes: "Default high-efficiency workstation card",
  },
  {
    gpuTypeId: "NVIDIA GeForce RTX 5090",
    displayName: "RTX 5090 (32GB)",
    vramGb: 32,
    architecture: "Blackwell",
    provider: "runpod",
    supportsCuda: true,
    allowedWorkloadClasses: [
      "LIGHT_IMAGE", "STANDARD_IMAGE", "HEAVY_IMAGE", "IMAGE_EDIT", "UPSCALE_IMAGE", "LIGHT_VIDEO", "HEAVY_VIDEO", "VIDEO_UPSCALE", "BATCH",
    ],
    observedPricePerHour: 1.20,
    priceObservedAt: new Date().toISOString(),
    benchmarkScore: 160,
    enabled: true,
    notes: "Ultra-fast generation & video workloads",
  },
  {
    gpuTypeId: "NVIDIA RTX A6000",
    displayName: "RTX A6000 (48GB)",
    vramGb: 48,
    architecture: "Ampere",
    provider: "runpod",
    supportsCuda: true,
    allowedWorkloadClasses: [
      "LIGHT_IMAGE", "STANDARD_IMAGE", "HEAVY_IMAGE", "IMAGE_EDIT", "UPSCALE_IMAGE", "LIGHT_VIDEO", "HEAVY_VIDEO", "VIDEO_UPSCALE", "BATCH",
    ],
    observedPricePerHour: 0.79,
    priceObservedAt: new Date().toISOString(),
    benchmarkScore: 95,
    enabled: true,
    notes: "Large VRAM for video and heavy batches",
  },
  {
    gpuTypeId: "NVIDIA A40",
    displayName: "NVIDIA A40 (48GB)",
    vramGb: 48,
    architecture: "Ampere",
    provider: "runpod",
    supportsCuda: true,
    allowedWorkloadClasses: [
      "STANDARD_IMAGE", "HEAVY_IMAGE", "LIGHT_VIDEO", "HEAVY_VIDEO", "BATCH",
    ],
    observedPricePerHour: 0.45,
    priceObservedAt: new Date().toISOString(),
    benchmarkScore: 85,
    enabled: true,
    notes: "Cost-effective 48GB enterprise compute",
  },
  {
    gpuTypeId: "NVIDIA A100-SXM4-80GB",
    displayName: "A100 SXM4 (80GB)",
    vramGb: 80,
    architecture: "Ampere",
    provider: "runpod",
    supportsCuda: true,
    allowedWorkloadClasses: [
      "HEAVY_VIDEO", "VIDEO_UPSCALE", "BATCH",
    ],
    observedPricePerHour: 1.89,
    priceObservedAt: new Date().toISOString(),
    benchmarkScore: 140,
    enabled: true,
    notes: "Maximum memory for massive video models",
  },
  {
    gpuTypeId: "NVIDIA GeForce RTX 3090",
    displayName: "RTX 3090 (24GB)",
    vramGb: 24,
    architecture: "Ampere",
    provider: "runpod",
    supportsCuda: true,
    allowedWorkloadClasses: [
      "LIGHT_IMAGE", "STANDARD_IMAGE", "IMAGE_EDIT", "LIGHT_VIDEO", "BATCH",
    ],
    observedPricePerHour: 0.40,
    priceObservedAt: new Date().toISOString(),
    benchmarkScore: 75,
    enabled: true,
    notes: "Budget 24GB community card",
  },
];

export function seedGpuCatalog(force = false): void {
  const db = openAgentOsDb();
  if (!force) {
    const existing = db.query("SELECT COUNT(*) as count FROM gen_gpu_profiles").get() as { count: number };
    if (existing && existing.count >= DEFAULT_GPU_PROFILES.length) return;
  }
  for (const item of DEFAULT_GPU_PROFILES) {
    const id = `gpu_${item.gpuTypeId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    db.query(`
      INSERT INTO gen_gpu_profiles
        (id, gpu_type_id, display_name, vram_gb, architecture, provider,
         supports_cuda, allowed_workload_classes_json, observed_price_per_hour,
         price_observed_at, benchmark_score, enabled, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gpu_type_id) DO UPDATE SET
        vram_gb = excluded.vram_gb,
        display_name = excluded.display_name,
        architecture = excluded.architecture,
        benchmark_score = excluded.benchmark_score
    `).run(
      id,
      item.gpuTypeId,
      item.displayName,
      item.vramGb,
      item.architecture,
      item.provider,
      item.supportsCuda ? 1 : 0,
      JSON.stringify(item.allowedWorkloadClasses),
      item.observedPricePerHour,
      item.priceObservedAt,
      item.benchmarkScore,
      item.enabled ? 1 : 0,
      item.notes,
    );
  }
}

export function listGpuProfiles(options?: { enabledOnly?: boolean }): GpuCapabilityProfile[] {
  seedGpuCatalog();
  const db = openAgentOsDb();
  const sql = options?.enabledOnly
    ? "SELECT * FROM gen_gpu_profiles WHERE enabled = 1 ORDER BY benchmark_score DESC"
    : "SELECT * FROM gen_gpu_profiles ORDER BY benchmark_score DESC";
  const rows = db.query(sql).all() as Record<string, unknown>[];
  return rows.map(rowToProfile);
}

export function getGpuProfile(gpuTypeId: string): GpuCapabilityProfile | null {
  seedGpuCatalog();
  const row = openAgentOsDb()
    .query("SELECT * FROM gen_gpu_profiles WHERE gpu_type_id = ? OR id = ?")
    .get(gpuTypeId, gpuTypeId) as Record<string, unknown> | undefined;
  return row ? rowToProfile(row) : null;
}

export function recordPriceObservation(gpuType: string, pricePerHour: number, provider = "runpod"): void {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_price_observations (provider, gpu_type, price_per_hour, observed_at)
    VALUES (?, ?, ?, ?)
  `).run(provider, gpuType, pricePerHour, now);

  db.query(`
    UPDATE gen_gpu_profiles
    SET observed_price_per_hour = ?, price_observed_at = ?
    WHERE gpu_type_id = ?
  `).run(pricePerHour, now, gpuType);
}

export function findCompatibleGpuCandidates(
  minVramGb: number,
  maxPricePerHour?: number,
  workloadClass?: WorkloadClass,
): GpuCapabilityProfile[] {
  seedGpuCatalog();
  const all = listGpuProfiles({ enabledOnly: true });
  return all.filter(gpu => {
    if (gpu.vramGb < minVramGb) return false;
    if (maxPricePerHour !== undefined && gpu.observedPricePerHour !== null && gpu.observedPricePerHour > maxPricePerHour) {
      return false;
    }
    if (workloadClass && gpu.allowedWorkloadClasses.length > 0 && !gpu.allowedWorkloadClasses.includes(workloadClass)) {
      return false;
    }
    return true;
  });
}
