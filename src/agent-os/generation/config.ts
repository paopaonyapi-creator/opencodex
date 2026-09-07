// Phase 19 — Generation Studio configuration.
//
// Reads PAO_* environment variables with spec section 59 defaults. Every value is
// validated with a meaningful message at startup (spec section 89). The ComfyUI
// base URL is configurable — the 127.0.0.1:8188 default is a DEFAULT, not a
// hardcode: business logic only ever reads it from here or the provider row.

export interface GenerationConfig {
  enabled: boolean;
  comfyuiBaseUrl: string;
  comfyuiWsUrl: string;
  comfyuiTimeoutSeconds: number;
  comfyuiMaxConcurrency: number;
  defaultPriority: number;
  maxRetries: number;
  maxAutoRework: number;
  maxImageUploadMb: number;
  maxVideoUploadMb: number;
  maxAudioUploadMb: number;
  storagePath: string;
  tempPath: string;
  tempRetentionHours: number;
  jobLogRetentionDays: number;
  stockReadyScore: number;
  stockManualReviewScore: number;
  // Phase 20: RunPod & Multi-GPU
  runpodEnabled: boolean;
  runpodApiBaseUrl: string;
  runpodApiKey: string;
  runpodDefaultTemplateId: string;
  runpodNetworkVolumeId: string;
  runpodAutoProvision: boolean;
  runpodAutoStop: boolean;
  runpodAutoTerminate: boolean;
  runpodIdleStopMinutes: number;
  runpodIdleTerminateMinutes: number;
  runpodMaxActivePods: number;
  runpodMaxGpuPricePerHour: number;
  runpodMaxEstimatedCostPerJob: number;
  runpodDailyBudget: number;
  runpodMonthlyBudget: number;
  runpodRequireApproval: boolean;
  gpuPreferLocal: boolean;
  gpuVramSafetyMarginGb: number;
  cloudBurstQueueThreshold: number;
  // Phase 20.1: Smart Queue & Auto Cloud Burst
  smartQueueEnabled: boolean;
  queueObserverIntervalSeconds: number;
  queueBurstMode: "off" | "manual" | "assisted" | "auto";
  queueBurstSoftDepth: number;
  queueBurstHardDepth: number;
  queueTargetDrainMinutes: number;
  queueMaxLocalWaitMinutes: number;
  queueMinBurstTimeSavingPercent: number;
  queueScaleUpCooldownSeconds: number;
  queueScaleUpStableWindowSeconds: number;
  queueScaleDownCooldownSeconds: number;
  queueScaleDownStableWindowSeconds: number;
  queueProviderMaxPending: number;
  queueMaxPrefetchJobsPerProvider: number;
  queueBatchChunkSize: number;
  queueMaxConcurrentPerProject: number;
  queueAffinityWarmMinutes: number;
  queueAggressiveScaleUp: boolean;
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value: number, name: string): number {
  if (value < 0 || !Number.isFinite(value)) {
    throw new Error(`PAO generation config: ${name} must be a non-negative finite number (got ${value})`);
  }
  return value;
}

export function generationConfigError(config: GenerationConfig): string | null {
  try {
    // URL validation
    for (const [label, raw] of [
      ["PAO_COMFYUI_BASE_URL", config.comfyuiBaseUrl],
      ["PAO_COMFYUI_WS_URL", config.comfyuiWsUrl],
    ] as const) {
      const parsed = new URL(raw);
      if (label === "PAO_COMFYUI_BASE_URL" && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `${label} must use http:// or https://`;
      }
      if (label === "PAO_COMFYUI_WS_URL" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
        return `${label} must use ws:// or wss://`;
      }
    }
    nonNegative(config.comfyuiTimeoutSeconds, "PAO_COMFYUI_TIMEOUT_SECONDS");
    if (config.comfyuiMaxConcurrency < 1) return "PAO_COMFYUI_MAX_CONCURRENCY must be at least 1";
    nonNegative(config.defaultPriority, "PAO_GENERATION_DEFAULT_PRIORITY");
    nonNegative(config.maxRetries, "PAO_GENERATION_MAX_RETRIES");
    nonNegative(config.maxAutoRework, "PAO_GENERATION_MAX_AUTO_REWORK");
    for (const [name, value] of [
      ["PAO_MAX_IMAGE_UPLOAD_MB", config.maxImageUploadMb],
      ["PAO_MAX_VIDEO_UPLOAD_MB", config.maxVideoUploadMb],
      ["PAO_MAX_AUDIO_UPLOAD_MB", config.maxAudioUploadMb],
    ] as const) nonNegative(value, name);
    nonNegative(config.tempRetentionHours, "PAO_GENERATION_TEMP_RETENTION_HOURS");
    nonNegative(config.jobLogRetentionDays, "PAO_GENERATION_JOB_LOG_RETENTION_DAYS");
    if (config.stockManualReviewScore > config.stockReadyScore) {
      return "PAO_STOCK_MANUAL_REVIEW_SCORE must not exceed PAO_STOCK_READY_SCORE";
    }
    return null;
  } catch {
    return "PAO_COMFYUI_BASE_URL / PAO_COMFYUI_WS_URL must be valid URLs";
  }
}

export function loadGenerationConfig(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): GenerationConfig {
  const config: GenerationConfig = {
    enabled: boolEnv(env.PAO_GENERATION_ENABLED, true),
    comfyuiBaseUrl: (env.PAO_COMFYUI_BASE_URL ?? "http://127.0.0.1:8188").replace(/\/+$/, ""),
    comfyuiWsUrl: env.PAO_COMFYUI_WS_URL ?? "ws://127.0.0.1:8188/ws",
    comfyuiTimeoutSeconds: numberEnv(env.PAO_COMFYUI_TIMEOUT_SECONDS, 600),
    comfyuiMaxConcurrency: numberEnv(env.PAO_COMFYUI_MAX_CONCURRENCY, 1),
    defaultPriority: numberEnv(env.PAO_GENERATION_DEFAULT_PRIORITY, 5),
    maxRetries: numberEnv(env.PAO_GENERATION_MAX_RETRIES, 2),
    maxAutoRework: numberEnv(env.PAO_GENERATION_MAX_AUTO_REWORK, 2),
    maxImageUploadMb: numberEnv(env.PAO_MAX_IMAGE_UPLOAD_MB, 50),
    maxVideoUploadMb: numberEnv(env.PAO_MAX_VIDEO_UPLOAD_MB, 2048),
    maxAudioUploadMb: numberEnv(env.PAO_MAX_AUDIO_UPLOAD_MB, 200),
    storagePath: env.PAO_GENERATION_STORAGE_PATH ?? "./data/generation",
    tempPath: env.PAO_GENERATION_TEMP_PATH ?? "./data/tmp/generation",
    tempRetentionHours: numberEnv(env.PAO_GENERATION_TEMP_RETENTION_HOURS, 24),
    jobLogRetentionDays: numberEnv(env.PAO_GENERATION_JOB_LOG_RETENTION_DAYS, 30),
    stockReadyScore: numberEnv(env.PAO_STOCK_READY_SCORE, 85),
    stockManualReviewScore: numberEnv(env.PAO_STOCK_MANUAL_REVIEW_SCORE, 75),
    // Phase 20
    runpodEnabled: boolEnv(env.PAO_RUNPOD_ENABLED, false),
    runpodApiBaseUrl: env.PAO_RUNPOD_API_BASE_URL ?? "https://rest.runpod.io/v1",
    runpodApiKey: env.PAO_RUNPOD_API_KEY ?? "",
    runpodDefaultTemplateId: env.PAO_RUNPOD_DEFAULT_TEMPLATE_ID ?? "hs44di56w7",
    runpodNetworkVolumeId: env.PAO_RUNPOD_NETWORK_VOLUME_ID ?? "",
    runpodAutoProvision: boolEnv(env.PAO_RUNPOD_AUTO_PROVISION, true),
    runpodAutoStop: boolEnv(env.PAO_RUNPOD_AUTO_STOP, true),
    runpodAutoTerminate: boolEnv(env.PAO_RUNPOD_AUTO_TERMINATE, false),
    runpodIdleStopMinutes: numberEnv(env.PAO_RUNPOD_IDLE_STOP_MINUTES, 10),
    runpodIdleTerminateMinutes: numberEnv(env.PAO_RUNPOD_IDLE_TERMINATE_MINUTES, 60),
    runpodMaxActivePods: numberEnv(env.PAO_RUNPOD_MAX_ACTIVE_PODS, 2),
    runpodMaxGpuPricePerHour: numberEnv(env.PAO_RUNPOD_MAX_GPU_PRICE_PER_HOUR, 1.50),
    runpodMaxEstimatedCostPerJob: numberEnv(env.PAO_RUNPOD_MAX_ESTIMATED_COST_PER_JOB, 2.00),
    runpodDailyBudget: numberEnv(env.PAO_RUNPOD_DAILY_BUDGET, 10.00),
    runpodMonthlyBudget: numberEnv(env.PAO_RUNPOD_MONTHLY_BUDGET, 100.00),
    runpodRequireApproval: boolEnv(env.PAO_RUNPOD_REQUIRE_APPROVAL, false),
    gpuPreferLocal: boolEnv(env.PAO_GPU_PREFER_LOCAL, true),
    gpuVramSafetyMarginGb: numberEnv(env.PAO_GPU_VRAM_SAFETY_MARGIN_GB, 2),
    cloudBurstQueueThreshold: numberEnv(env.PAO_CLOUD_BURST_QUEUE_THRESHOLD, 3),
    // Phase 20.1: Smart Queue & Auto Cloud Burst
    smartQueueEnabled: boolEnv(env.PAO_SMART_QUEUE_ENABLED, true),
    queueObserverIntervalSeconds: numberEnv(env.PAO_QUEUE_OBSERVER_INTERVAL_SECONDS, 3),
    queueBurstMode: (env.PAO_QUEUE_BURST_MODE?.toLowerCase() as "off" | "manual" | "assisted" | "auto") ?? "assisted",
    queueBurstSoftDepth: numberEnv(env.PAO_QUEUE_BURST_SOFT_DEPTH, 4),
    queueBurstHardDepth: numberEnv(env.PAO_QUEUE_BURST_HARD_DEPTH, 12),
    queueTargetDrainMinutes: numberEnv(env.PAO_QUEUE_TARGET_DRAIN_MINUTES, 20),
    queueMaxLocalWaitMinutes: numberEnv(env.PAO_QUEUE_MAX_LOCAL_WAIT_MINUTES, 30),
    queueMinBurstTimeSavingPercent: numberEnv(env.PAO_QUEUE_MIN_BURST_TIME_SAVING_PERCENT, 20),
    queueScaleUpCooldownSeconds: numberEnv(env.PAO_QUEUE_SCALE_UP_COOLDOWN_SECONDS, 60),
    queueScaleUpStableWindowSeconds: numberEnv(env.PAO_QUEUE_SCALE_UP_STABLE_WINDOW_SECONDS, 30),
    queueScaleDownCooldownSeconds: numberEnv(env.PAO_QUEUE_SCALE_DOWN_COOLDOWN_SECONDS, 300),
    queueScaleDownStableWindowSeconds: numberEnv(env.PAO_QUEUE_SCALE_DOWN_STABLE_WINDOW_SECONDS, 120),
    queueProviderMaxPending: numberEnv(env.PAO_QUEUE_PROVIDER_MAX_PENDING, 2),
    queueMaxPrefetchJobsPerProvider: numberEnv(env.PAO_QUEUE_MAX_PREFETCH_JOBS_PER_PROVIDER, 2),
    queueBatchChunkSize: numberEnv(env.PAO_QUEUE_BATCH_CHUNK_SIZE, 5),
    queueMaxConcurrentPerProject: numberEnv(env.PAO_QUEUE_MAX_CONCURRENT_PER_PROJECT, 4),
    queueAffinityWarmMinutes: numberEnv(env.PAO_QUEUE_AFFINITY_WARM_MINUTES, 20),
    queueAggressiveScaleUp: boolEnv(env.PAO_QUEUE_AGGRESSIVE_SCALE_UP, false),
  };
  const error = generationConfigError(config);
  if (error) throw new Error(error);
  return config;
}
