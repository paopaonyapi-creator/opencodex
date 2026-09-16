// Phase 20.23 — environment-backed notification policy. Secrets stay in env refs.

export interface NotificationConfig {
  enabled: boolean;
  workerEnabled: boolean;
  workerConcurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryJitterMs: number;
  discordEnabled: boolean;
  discordRequestTimeoutMs: number;
  discordBootstrapMinIntervalMs: number;
  dedupeWindowMs: number;
  aggregationWindowMs: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  maxPayloadBytes: number;
  eventRetentionDays: number;
  deliveryRetentionDays: number;
}

export const DEFAULT_NOTIFICATION_CONFIG: Readonly<NotificationConfig> = {
  enabled: false,
  workerEnabled: false,
  workerConcurrency: 2,
  pollIntervalMs: 250,
  leaseMs: 30_000,
  maxAttempts: 5,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
  retryJitterMs: 500,
  discordEnabled: true,
  discordRequestTimeoutMs: 10_000,
  discordBootstrapMinIntervalMs: 250,
  dedupeWindowMs: 30_000,
  aggregationWindowMs: 10_000,
  circuitFailureThreshold: 5,
  circuitOpenMs: 60_000,
  maxPayloadBytes: 65_536,
  eventRetentionDays: 30,
  deliveryRetentionDays: 30,
};

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(value.trim());
}

function integerEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function loadNotificationConfig(env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  const hasDefaultWebhook = Boolean(env.DISCORD_WEBHOOK_URL?.trim());
  const enabled = booleanEnv(env.NOTIFICATIONS_ENABLED, hasDefaultWebhook);
  return {
    enabled,
    workerEnabled: booleanEnv(env.NOTIFY_WORKER_ENABLED, enabled),
    workerConcurrency: integerEnv(env.NOTIFY_WORKER_CONCURRENCY, 2, 1, 16),
    pollIntervalMs: integerEnv(env.NOTIFY_WORKER_POLL_INTERVAL_MS, 250, 50, 60_000),
    leaseMs: integerEnv(env.NOTIFY_WORKER_LEASE_MS, 30_000, 1_000, 600_000),
    maxAttempts: integerEnv(env.NOTIFY_RETRY_MAX_ATTEMPTS, 5, 1, 20),
    retryBaseMs: integerEnv(env.NOTIFY_RETRY_BASE_MS, 1_000, 50, 600_000),
    retryMaxMs: integerEnv(env.NOTIFY_RETRY_MAX_MS, 30_000, 50, 3_600_000),
    retryJitterMs: integerEnv(env.NOTIFY_RETRY_JITTER_MS, 500, 0, 60_000),
    discordEnabled: booleanEnv(env.NOTIFY_DISCORD_ENABLED, true),
    discordRequestTimeoutMs: integerEnv(env.NOTIFY_DISCORD_REQUEST_TIMEOUT_MS, 10_000, 100, 120_000),
    discordBootstrapMinIntervalMs: integerEnv(env.NOTIFY_DISCORD_BOOTSTRAP_MIN_INTERVAL_MS, 250, 0, 60_000),
    dedupeWindowMs: integerEnv(env.NOTIFY_DEDUPE_DEFAULT_WINDOW_MS, 30_000, 0, 86_400_000),
    aggregationWindowMs: integerEnv(env.NOTIFY_AGGREGATION_DEFAULT_WINDOW_MS, 10_000, 0, 86_400_000),
    circuitFailureThreshold: integerEnv(env.NOTIFY_CIRCUIT_FAILURE_THRESHOLD, 5, 1, 100),
    circuitOpenMs: integerEnv(env.NOTIFY_CIRCUIT_OPEN_MS, 60_000, 1_000, 86_400_000),
    maxPayloadBytes: integerEnv(env.NOTIFY_QUEUE_MAX_PAYLOAD_BYTES, 65_536, 1_024, 1_048_576),
    eventRetentionDays: integerEnv(env.NOTIFY_EVENT_RETENTION_DAYS, 30, 1, 3650),
    deliveryRetentionDays: integerEnv(env.NOTIFY_DELIVERY_RETENTION_DAYS, 30, 1, 3650),
  };
}

export function notificationActivationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = loadNotificationConfig(env);
  return config.enabled && config.workerEnabled && config.discordEnabled;
}
