// Phase 20.64 — Visual Compute configuration (spec §8, §19, §55-§56).
//
// Safe defaults: subsystem off, agent execution off, public execution off,
// native experimental off, local docs preferred. Hard limits are configurable
// but never overrideable by agent parameters.

import { VGPU_PINNED_VERSION } from "./types";

export interface VisualComputeConfig {
  enabled: boolean;
  runtimeBrowser: boolean;
  runtimeNode: boolean;
  runtimeMock: boolean;
  runtimeNativeExperimental: boolean;
  agentShaderCreateEnabled: boolean;
  agentShaderExecuteEnabled: boolean;
  publicExecutionEnabled: boolean;
  docsProvider: "local" | "hosted";
  remoteDocsEnabled: boolean;
  docsExampleDownload: boolean;
  vgpuVersionPolicy: "pinned";
  vgpuPinnedVersion: string;
  maxShaderSourceBytes: number;
  maxTextureWidth: number;
  maxTextureHeight: number;
  maxSingleBufferBytes: number;
  maxTotalEstimatedGpuBytes: number;
  maxReadbackBytes: number;
  maxExecutionMs: number;
  maxConcurrentJobsPerWorker: number;
  maxQueuedJobsPerActor: number;
  maxArtifactsPerJob: number;
  workerHeartbeatTimeoutSec: number;
  thresholdHighMemoryBytes: number;
  thresholdHighDimensions: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getVisualComputeConfig(): VisualComputeConfig {
  return {
    enabled: process.env.VISUAL_COMPUTE_ENABLED === "true",
    runtimeBrowser: process.env.VGPU_BROWSER_ENABLED !== "false",
    runtimeNode: process.env.VGPU_NODE_ENABLED !== "false",
    runtimeMock: process.env.VGPU_MOCK_ENABLED !== "false",
    runtimeNativeExperimental: process.env.VGPU_NATIVE_EXPERIMENTAL === "true",
    agentShaderCreateEnabled: process.env.VGPU_AGENT_SHADER_CREATE_ENABLED !== "false",
    agentShaderExecuteEnabled: process.env.VGPU_AGENT_SHADER_EXECUTE_ENABLED === "true",
    publicExecutionEnabled: process.env.VGPU_PUBLIC_EXECUTION_ENABLED === "true",
    docsProvider: process.env.VGPU_DOCS_PROVIDER?.trim() === "hosted" ? "hosted" : "local",
    remoteDocsEnabled: process.env.VGPU_REMOTE_DOCS_MCP_ENABLED === "true",
    docsExampleDownload: false,
    vgpuVersionPolicy: "pinned",
    vgpuPinnedVersion: process.env.VGPU_PINNED_VERSION?.trim() || VGPU_PINNED_VERSION,
    maxShaderSourceBytes: intEnv("VGPU_MAX_SHADER_BYTES", 262_144, 1_024, 4 * 1024 * 1024),
    maxTextureWidth: intEnv("VGPU_MAX_TEXTURE_WIDTH", 4_096, 16, 16_384),
    maxTextureHeight: intEnv("VGPU_MAX_TEXTURE_HEIGHT", 4_096, 16, 16_384),
    maxSingleBufferBytes: intEnv("VGPU_MAX_BUFFER_BYTES", 134_217_728, 1_024, 2 * 1024 * 1024 * 1024),
    maxTotalEstimatedGpuBytes: intEnv("VGPU_MAX_GPU_BYTES", 536_870_912, 4_096, 4 * 1024 * 1024 * 1024),
    maxReadbackBytes: intEnv("VGPU_MAX_READBACK_BYTES", 268_435_456, 1_024, 1024 * 1024 * 1024),
    maxExecutionMs: intEnv("VGPU_MAX_EXECUTION_MS", 30_000, 100, 600_000),
    maxConcurrentJobsPerWorker: intEnv("VGPU_MAX_CONCURRENT_JOBS", 2, 1, 16),
    maxQueuedJobsPerActor: intEnv("VGPU_MAX_QUEUED_JOBS_PER_ACTOR", 20, 1, 200),
    maxArtifactsPerJob: intEnv("VGPU_MAX_ARTIFACTS_PER_JOB", 20, 1, 100),
    workerHeartbeatTimeoutSec: intEnv("VGPU_WORKER_HEARTBEAT_TIMEOUT_SEC", 90, 10, 3_600),
    thresholdHighMemoryBytes: intEnv("VGPU_HIGH_MEMORY_THRESHOLD", 134_217_728, 1_024, 1024 * 1024 * 1024),
    thresholdHighDimensions: intEnv("VGPU_HIGH_DIMENSION_THRESHOLD", 2_048, 16, 16_384),
  };
}

/** Fail-fast limit validation (spec §55). */
export function assertConfigValid(config: VisualComputeConfig): void {
  const checks: Array<[boolean, string]> = [
    [config.maxShaderSourceBytes > 0, "maxShaderSourceBytes must be positive"],
    [config.maxTextureWidth >= 16, "maxTextureWidth too small"],
    [config.maxTextureHeight >= 16, "maxTextureHeight too small"],
    [config.maxExecutionMs >= 100, "maxExecutionMs too small"],
    [config.maxTotalEstimatedGpuBytes >= config.maxSingleBufferBytes, "total GPU budget smaller than single-buffer cap"],
    [config.maxReadbackBytes <= config.maxTotalEstimatedGpuBytes, "readback cap exceeds GPU budget"],
  ];
  for (const [ok, message] of checks) {
    if (!ok) throw new Error("invalid visual compute config: " + message);
  }
}
