export const NOTIFICATION_SOURCES = [
  "codex",
  "comfyui",
  "runpod",
  "browser",
  "chrome_extension",
  "social_intelligence",
  "stock_pipeline",
  "reviewer_council",
  "system",
  "user",
  "other",
] as const;

export const NOTIFICATION_SEVERITIES = [
  "debug",
  "info",
  "success",
  "warning",
  "error",
  "critical",
] as const;

export const NOTIFICATION_PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export interface NotificationEventInput {
  source: NotificationSource;
  eventType: string;
  title: string;
  message?: string | null;
  severity: NotificationSeverity;
  priority: NotificationPriority;
  status?: string | null;
  progress?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
  aggregationKey?: string | null;
  dedupeWindowMs?: number;
  aggregationWindowMs?: number;
  tags?: string[];
  data?: Record<string, unknown>;
  occurredAt?: string | Date;
  requestedDestinations?: string[];
}

export interface NormalizedNotificationEventInput extends Omit<NotificationEventInput, "tags" | "data" | "occurredAt"> {
  tags: string[];
  data: Record<string, unknown>;
  occurredAt: string;
}

export interface DiscordRateLimitObservation {
  limit: number | null;
  remaining: number | null;
  resetAfterMs: number | null;
  resetAtMs: number | null;
  bucketId: string | null;
  scope: string | null;
  retryAfterMs: number | null;
  global: boolean;
}

export type NotificationProviderId = "discord_webhook";
export type NotificationDeliveryStatus =
  | "QUEUED"
  | "RESERVED"
  | "SENDING"
  | "RATE_LIMITED"
  | "RETRY_SCHEDULED"
  | "DELIVERED"
  | "FAILED"
  | "DEAD_LETTER"
  | "CANCELLED"
  | "SUPPRESSED";

export type NotificationCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface NotificationEvent extends NormalizedNotificationEventInput {
  id: string;
  createdAt: string;
  createdAtMs: number;
}

export interface NotificationDestinationInput {
  id: string;
  provider: NotificationProviderId;
  name: string;
  enabled?: boolean;
  environment?: "dev" | "staging" | "production" | "all";
  channelClass?: "critical" | "errors" | "jobs" | "stock" | "research" | "system" | "general";
  secretRef: string;
}

export interface NotificationDestination extends Required<Omit<NotificationDestinationInput, "enabled" | "environment" | "channelClass">> {
  enabled: boolean;
  environment: "dev" | "staging" | "production" | "all";
  channelClass: "critical" | "errors" | "jobs" | "stock" | "research" | "system" | "general";
  health: "unknown" | "healthy" | "degraded" | "invalid" | "disabled";
  invalidReason: string | null;
  rateLimitStateKey: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicNotificationDestination = Omit<NotificationDestination, "secretRef">;

export interface NotificationSubscriptionInput {
  id: string;
  eventPattern: string;
  destinationId: string;
  source?: NotificationSource | null;
  minSeverity?: NotificationSeverity | null;
  maxPriority?: NotificationPriority | null;
  enabled?: boolean;
}

export interface NotificationSubscription extends Required<Omit<NotificationSubscriptionInput, "source" | "minSeverity" | "maxPriority" | "enabled">> {
  source: NotificationSource | null;
  minSeverity: NotificationSeverity | null;
  maxPriority: NotificationPriority | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: string;
  eventId: string;
  destinationId: string;
  provider: NotificationProviderId;
  status: NotificationDeliveryStatus;
  priority: NotificationPriority;
  attempt: number;
  maxAttempts: number;
  availableAtMs: number;
  reservedBy: string | null;
  reservedAtMs: number | null;
  leaseExpiresAtMs: number | null;
  sentAt: string | null;
  deliveredAt: string | null;
  providerMessageId: string | null;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationAggregation {
  id: string;
  aggregationKey: string;
  destinationId: string;
  rootEventId: string;
  status: "OPEN" | "FLUSHED" | "CANCELLED";
  eventCount: number;
  summary: {
    eventTypes: Record<string, number>;
    numericTotals: Record<string, number>;
  };
  flushAtMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationEmitReceipt {
  eventId: string;
  status: "accepted" | "deduplicated" | "suppressed" | "disabled";
  deliveriesQueued: number;
  suppressed: number;
  aggregated: number;
}

export interface NotificationAttemptInput {
  id: string;
  deliveryId: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  statusCode: number | null;
  errorCode: string | null;
  retryAfterMs: number | null;
  bucketId: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAfterMs: number | null;
  globalRateLimited: boolean;
  durationMs: number;
}

export interface NotificationRateLimitState {
  stateKey: string;
  provider: NotificationProviderId;
  destinationId: string | null;
  bucketId: string | null;
  scope: string | null;
  limit: number | null;
  remaining: number | null;
  resetAfterMs: number | null;
  blockedUntilMs: number | null;
  observedAt: string | null;
  lastRequestAtMs: number | null;
  rateLimitedCount: number;
}

export interface NotificationProviderGate {
  provider: NotificationProviderId;
  blockedUntilMs: number | null;
  reason: string | null;
  observedAt: string | null;
}

export interface NotificationCircuit {
  destinationId: string;
  provider: NotificationProviderId;
  state: NotificationCircuitState;
  failureCount: number;
  openedUntilMs: number | null;
  reason: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  updatedAt: string;
}

export interface NotificationDeadLetter {
  id: string;
  deliveryId: string;
  eventId: string;
  destinationId: string;
  reason: string;
  lastErrorCode: string | null;
  attempts: number;
  status: "OPEN" | "RETRIED" | "DISMISSED";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}
