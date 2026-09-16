import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { redactNotificationSecrets } from "./redaction";
import type {
  NormalizedNotificationEventInput,
  NotificationAggregation,
  NotificationAttemptInput,
  NotificationCircuit,
  NotificationCircuitState,
  NotificationDeadLetter,
  NotificationDelivery,
  NotificationDeliveryStatus,
  NotificationDestination,
  NotificationDestinationInput,
  NotificationEvent,
  NotificationPriority,
  NotificationProviderGate,
  NotificationProviderId,
  NotificationRateLimitState,
  NotificationSubscription,
  NotificationSubscriptionInput,
  PublicNotificationDestination,
} from "./types";

const SECRET_REF_PATTERN = /^env:[A-Z][A-Z0-9_]{1,126}$/;
const EVENT_PATTERN = /^(?:\*|[a-z][a-z0-9_-]*(?:\.(?:[a-z0-9][a-z0-9_-]*|\*))+?)$/;

function jsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function iso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function destinationFromRow(row: Record<string, unknown>): NotificationDestination {
  return {
    id: String(row.id),
    provider: String(row.provider) as NotificationDestination["provider"],
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    environment: String(row.environment) as NotificationDestination["environment"],
    channelClass: String(row.channel_class) as NotificationDestination["channelClass"],
    secretRef: String(row.secret_ref),
    health: String(row.health) as NotificationDestination["health"],
    invalidReason: row.invalid_reason === null ? null : String(row.invalid_reason),
    rateLimitStateKey: row.rate_limit_state_key === null ? null : String(row.rate_limit_state_key),
    lastSuccessAt: row.last_success_at === null ? null : String(row.last_success_at),
    lastFailureAt: row.last_failure_at === null ? null : String(row.last_failure_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function eventFromRow(row: Record<string, unknown>): NotificationEvent {
  return {
    id: String(row.id),
    source: String(row.source) as NotificationEvent["source"],
    eventType: String(row.event_type),
    title: String(row.title),
    message: row.message === null ? null : String(row.message),
    severity: String(row.severity) as NotificationEvent["severity"],
    priority: String(row.priority) as NotificationEvent["priority"],
    status: row.status === null ? null : String(row.status),
    progress: row.progress === null ? null : Number(row.progress),
    entityType: row.entity_type === null ? null : String(row.entity_type),
    entityId: row.entity_id === null ? null : String(row.entity_id),
    dedupeKey: row.dedupe_key === null ? null : String(row.dedupe_key),
    aggregationKey: row.aggregation_key === null ? null : String(row.aggregation_key),
    tags: jsonArray(row.tags_json),
    data: jsonObject(row.data_json),
    occurredAt: String(row.occurred_at),
    requestedDestinations: jsonArray(row.requested_destinations_json),
    createdAt: String(row.created_at),
    createdAtMs: Number(row.created_at_ms),
  };
}

function deliveryFromRow(row: Record<string, unknown>): NotificationDelivery {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    destinationId: String(row.destination_id),
    provider: String(row.provider) as NotificationDelivery["provider"],
    status: String(row.status) as NotificationDeliveryStatus,
    priority: String(row.priority) as NotificationPriority,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    availableAtMs: Number(row.available_at_ms),
    reservedBy: row.reserved_by === null ? null : String(row.reserved_by),
    reservedAtMs: row.reserved_at_ms === null ? null : Number(row.reserved_at_ms),
    leaseExpiresAtMs: row.lease_expires_at_ms === null ? null : Number(row.lease_expires_at_ms),
    sentAt: row.sent_at === null ? null : String(row.sent_at),
    deliveredAt: row.delivered_at === null ? null : String(row.delivered_at),
    providerMessageId: row.provider_message_id === null ? null : String(row.provider_message_id),
    lastStatusCode: row.last_status_code === null ? null : Number(row.last_status_code),
    lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code),
    lastErrorMessage: row.last_error_message === null ? null : String(row.last_error_message),
    idempotencyKey: String(row.idempotency_key),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function aggregationFromRow(row: Record<string, unknown>): NotificationAggregation {
  const summary = jsonObject(row.summary_json);
  return {
    id: String(row.id),
    aggregationKey: String(row.aggregation_key),
    destinationId: String(row.destination_id),
    rootEventId: String(row.root_event_id),
    status: String(row.status) as NotificationAggregation["status"],
    eventCount: Number(row.event_count),
    summary: {
      eventTypes: jsonObject(summary.eventTypes) as Record<string, number>,
      numericTotals: jsonObject(summary.numericTotals) as Record<string, number>,
    },
    flushAtMs: Number(row.flush_at_ms),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function publicDestination(destination: NotificationDestination): PublicNotificationDestination {
  const { secretRef: _secretRef, ...safe } = destination;
  return safe;
}

function attemptFromRow(row: Record<string, unknown>): NotificationAttemptInput {
  return {
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    attempt: Number(row.attempt),
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
    statusCode: row.status_code === null ? null : Number(row.status_code),
    errorCode: row.error_code === null ? null : String(row.error_code),
    retryAfterMs: row.retry_after_ms === null ? null : Number(row.retry_after_ms),
    bucketId: row.bucket_id === null ? null : String(row.bucket_id),
    rateLimitRemaining: row.rate_limit_remaining === null ? null : Number(row.rate_limit_remaining),
    rateLimitResetAfterMs: row.rate_limit_reset_after_ms === null ? null : Number(row.rate_limit_reset_after_ms),
    globalRateLimited: Number(row.global_rate_limited) === 1,
    durationMs: Number(row.duration_ms),
  };
}

function rateLimitStateFromRow(row: Record<string, unknown>): NotificationRateLimitState {
  return {
    stateKey: String(row.state_key),
    provider: String(row.provider) as NotificationProviderId,
    destinationId: row.destination_id === null ? null : String(row.destination_id),
    bucketId: row.bucket_id === null ? null : String(row.bucket_id),
    scope: row.scope === null ? null : String(row.scope),
    limit: row.limit_value === null ? null : Number(row.limit_value),
    remaining: row.remaining === null ? null : Number(row.remaining),
    resetAfterMs: row.reset_after_ms === null ? null : Number(row.reset_after_ms),
    blockedUntilMs: row.blocked_until_ms === null ? null : Number(row.blocked_until_ms),
    observedAt: row.observed_at === null ? null : String(row.observed_at),
    lastRequestAtMs: row.last_request_at_ms === null ? null : Number(row.last_request_at_ms),
    rateLimitedCount: Number(row.rate_limited_count ?? 0),
  };
}

function providerGateFromRow(row: Record<string, unknown>): NotificationProviderGate {
  return {
    provider: String(row.provider) as NotificationProviderId,
    blockedUntilMs: row.blocked_until_ms === null ? null : Number(row.blocked_until_ms),
    reason: row.reason === null ? null : String(row.reason),
    observedAt: row.observed_at === null ? null : String(row.observed_at),
  };
}

function circuitFromRow(row: Record<string, unknown>): NotificationCircuit {
  return {
    destinationId: String(row.destination_id),
    provider: String(row.provider) as NotificationProviderId,
    state: String(row.state) as NotificationCircuitState,
    failureCount: Number(row.failure_count),
    openedUntilMs: row.opened_until_ms === null ? null : Number(row.opened_until_ms),
    reason: row.reason === null ? null : String(row.reason),
    lastFailureAt: row.last_failure_at === null ? null : String(row.last_failure_at),
    lastSuccessAt: row.last_success_at === null ? null : String(row.last_success_at),
    updatedAt: String(row.updated_at),
  };
}

function deadLetterFromRow(row: Record<string, unknown>): NotificationDeadLetter {
  return {
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    eventId: String(row.event_id),
    destinationId: String(row.destination_id),
    reason: String(row.reason),
    lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code),
    attempts: Number(row.attempts),
    status: String(row.status) as NotificationDeadLetter["status"],
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
  };
}

export class NotificationStore {
  readonly db: Database;

  constructor(dir?: string) {
    this.db = openAgentOsDb(dir);
  }

  private immediate<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertDestination(input: NotificationDestinationInput, nowMs = Date.now()): NotificationDestination {
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(input.id)) throw new Error("destination id is invalid");
    if (input.provider !== "discord_webhook") throw new Error(`unsupported notification provider: ${input.provider}`);
    if (!input.name.trim() || input.name.trim().length > 128) throw new Error("destination name is invalid");
    if (!SECRET_REF_PATTERN.test(input.secretRef)) throw new Error("destination secretRef must use env:VARIABLE_NAME");
    const now = iso(nowMs);
    const enabled = input.enabled !== false;
    this.db.query(`
      INSERT INTO notification_destinations (
        id, provider, name, enabled, environment, channel_class, secret_ref,
        health, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        name = excluded.name,
        enabled = excluded.enabled,
        environment = excluded.environment,
        channel_class = excluded.channel_class,
        secret_ref = excluded.secret_ref,
        health = CASE WHEN excluded.enabled = 0 THEN 'disabled'
                      WHEN notification_destinations.health = 'disabled' THEN 'unknown'
                      ELSE notification_destinations.health END,
        invalid_reason = CASE WHEN excluded.enabled = 1 THEN NULL ELSE notification_destinations.invalid_reason END,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.provider,
      input.name.trim(),
      enabled ? 1 : 0,
      input.environment ?? "all",
      input.channelClass ?? "general",
      input.secretRef,
      enabled ? "unknown" : "disabled",
      now,
      now,
    );
    return this.getDestination(input.id)!;
  }

  getDestination(id: string): NotificationDestination | null {
    const row = this.db.query("SELECT * FROM notification_destinations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? destinationFromRow(row) : null;
  }

  listDestinations(): NotificationDestination[] {
    return (this.db.query("SELECT * FROM notification_destinations ORDER BY name, id").all() as Record<string, unknown>[])
      .map(destinationFromRow);
  }

  listDestinationsPublic(): PublicNotificationDestination[] {
    return this.listDestinations().map(publicDestination);
  }

  setDestinationEnabled(id: string, enabled: boolean, nowMs = Date.now()): PublicNotificationDestination | null {
    this.db.query(`UPDATE notification_destinations SET enabled = ?,
      health = CASE
        WHEN ? = 1 THEN (CASE WHEN health = 'disabled' THEN 'unknown' ELSE health END)
        ELSE (CASE WHEN health = 'invalid' THEN 'invalid' ELSE 'disabled' END)
      END,
      invalid_reason = CASE WHEN ? = 1 AND health <> 'invalid' THEN NULL ELSE invalid_reason END,
      updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, enabled ? 1 : 0, enabled ? 1 : 0, iso(nowMs), id);
    const destination = this.getDestination(id);
    return destination ? publicDestination(destination) : null;
  }

  updateDestinationHealth(
    id: string,
    health: NotificationDestination["health"],
    invalidReason?: string | null,
    nowMs = Date.now(),
  ): void {
    const now = iso(nowMs);
    const lastSuccessUpdate = health === "healthy" ? `, last_success_at = '${now}'` : "";
    const lastFailureUpdate = (health === "invalid" || health === "degraded") ? `, last_failure_at = '${now}'` : "";
    const enabledUpdate = health === "invalid" ? ", enabled = 0" : "";
    this.db.query(`UPDATE notification_destinations SET health = ?,
      invalid_reason = ?, updated_at = ? ${lastSuccessUpdate} ${lastFailureUpdate} ${enabledUpdate} WHERE id = ?`)
      .run(health, invalidReason ?? null, now, id);
  }

  upsertSubscription(input: NotificationSubscriptionInput, nowMs = Date.now()): NotificationSubscription {
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(input.id)) throw new Error("subscription id is invalid");
    if (!EVENT_PATTERN.test(input.eventPattern)) throw new Error("subscription eventPattern is invalid");
    if (!this.getDestination(input.destinationId)) throw new Error(`destination not found: ${input.destinationId}`);
    const now = iso(nowMs);
    this.db.query(`INSERT INTO notification_subscriptions (
      id, event_pattern, destination_id, source, min_severity, max_priority, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET event_pattern = excluded.event_pattern,
      destination_id = excluded.destination_id, source = excluded.source,
      min_severity = excluded.min_severity, max_priority = excluded.max_priority,
      enabled = excluded.enabled, updated_at = excluded.updated_at`)
      .run(
        input.id,
        input.eventPattern,
        input.destinationId,
        input.source ?? null,
        input.minSeverity ?? null,
        input.maxPriority ?? null,
        input.enabled === false ? 0 : 1,
        now,
        now,
      );
    return this.listSubscriptions().find((entry) => entry.id === input.id)!;
  }

  listSubscriptions(): NotificationSubscription[] {
    const rows = this.db.query("SELECT * FROM notification_subscriptions ORDER BY id").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      eventPattern: String(row.event_pattern),
      destinationId: String(row.destination_id),
      source: row.source === null ? null : String(row.source) as NotificationSubscription["source"],
      minSeverity: row.min_severity === null ? null : String(row.min_severity) as NotificationSubscription["minSeverity"],
      maxPriority: row.max_priority === null ? null : String(row.max_priority) as NotificationSubscription["maxPriority"],
      enabled: Number(row.enabled) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  getEvent(id: string): NotificationEvent | null {
    const row = this.db.query("SELECT * FROM notification_events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? eventFromRow(row) : null;
  }

  listEvents(options: { limit?: number; source?: string; eventType?: string } = {}): NotificationEvent[] {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (options.source) { clauses.push("source = ?"); args.push(options.source); }
    if (options.eventType) { clauses.push("event_type = ?"); args.push(options.eventType); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const rows = this.db.query(`SELECT * FROM notification_events ${where} ORDER BY created_at_ms DESC, rowid DESC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];
    return rows.map(eventFromRow);
  }

  insertEvent(input: NormalizedNotificationEventInput, options: { id?: string; nowMs?: number; status?: string } = {}): { event: NotificationEvent; created: boolean } {
    const id = options.id ?? `nev_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const nowMs = options.nowMs ?? Date.now();
    const createdAt = iso(nowMs);
    const result = this.db.query(`INSERT OR IGNORE INTO notification_events (
      id, source, event_type, title, message, severity, priority, status, progress,
      entity_type, entity_id, dedupe_key, aggregation_key, tags_json, data_json,
      requested_destinations_json, occurred_at, created_at, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        input.source,
        input.eventType,
        input.title,
        input.message ?? null,
        input.severity,
        input.priority,
        options.status ?? input.status ?? "ACCEPTED",
        input.progress ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        input.dedupeKey ?? null,
        input.aggregationKey ?? null,
        JSON.stringify(input.tags),
        JSON.stringify(input.data),
        JSON.stringify(input.requestedDestinations ?? []),
        input.occurredAt,
        createdAt,
        nowMs,
      );
    return { event: this.getEvent(id)!, created: result.changes > 0 };
  }

  findRecentEventByDedupeKey(dedupeKey: string, sinceMs: number): NotificationEvent | null {
    const row = this.db.query(`SELECT * FROM notification_events
      WHERE dedupe_key = ? AND created_at_ms >= ? AND status <> 'SUPPRESSED'
      ORDER BY created_at_ms DESC, rowid DESC LIMIT 1`).get(dedupeKey, sinceMs) as Record<string, unknown> | undefined;
    return row ? eventFromRow(row) : null;
  }

  setEventStatus(id: string, status: string): void {
    this.db.query("UPDATE notification_events SET status = ? WHERE id = ?").run(status, id);
  }

  createDelivery(input: {
    eventId: string;
    destination: NotificationDestination;
    priority: NotificationPriority;
    maxAttempts: number;
    availableAtMs: number;
    idempotencyKey: string;
    nowMs?: number;
  }): { delivery: NotificationDelivery; created: boolean } {
    const nowMs = input.nowMs ?? Date.now();
    const id = `ndel_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const now = iso(nowMs);
    const result = this.db.query(`INSERT OR IGNORE INTO notification_deliveries (
      id, event_id, destination_id, provider, status, priority, attempt, max_attempts,
      available_at_ms, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'QUEUED', ?, 0, ?, ?, ?, ?, ?)`)
      .run(
        id,
        input.eventId,
        input.destination.id,
        input.destination.provider,
        input.priority,
        input.maxAttempts,
        input.availableAtMs,
        input.idempotencyKey,
        now,
        now,
      );
    const row = result.changes > 0
      ? this.getDelivery(id)
      : this.getDeliveryByIdempotencyKey(input.idempotencyKey);
    if (!row) throw new Error("failed to create notification delivery");
    return { delivery: row, created: result.changes > 0 };
  }

  getDelivery(id: string): NotificationDelivery | null {
    const row = this.db.query("SELECT * FROM notification_deliveries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? deliveryFromRow(row) : null;
  }

  getDeliveryByIdempotencyKey(key: string): NotificationDelivery | null {
    const row = this.db.query("SELECT * FROM notification_deliveries WHERE idempotency_key = ?").get(key) as Record<string, unknown> | undefined;
    return row ? deliveryFromRow(row) : null;
  }

  listDeliveries(options: { limit?: number; status?: NotificationDeliveryStatus; destinationId?: string } = {}): NotificationDelivery[] {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (options.status) { clauses.push("status = ?"); args.push(options.status); }
    if (options.destinationId) { clauses.push("destination_id = ?"); args.push(options.destinationId); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const rows = this.db.query(`SELECT * FROM notification_deliveries ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];
    return rows.map(deliveryFromRow);
  }

  updateDelivery(id: string, updates: Partial<NotificationDelivery>, nowMs = Date.now()): NotificationDelivery | null {
    const sets: string[] = [];
    const args: Array<string | number | boolean | null> = [];
    if (updates.status !== undefined) { sets.push("status = ?"); args.push(updates.status); }
    if (updates.attempt !== undefined) { sets.push("attempt = ?"); args.push(updates.attempt); }
    if (updates.availableAtMs !== undefined) { sets.push("available_at_ms = ?"); args.push(updates.availableAtMs); }
    if (updates.reservedBy !== undefined) { sets.push("reserved_by = ?"); args.push(updates.reservedBy); }
    if (updates.reservedAtMs !== undefined) { sets.push("reserved_at_ms = ?"); args.push(updates.reservedAtMs); }
    if (updates.leaseExpiresAtMs !== undefined) { sets.push("lease_expires_at_ms = ?"); args.push(updates.leaseExpiresAtMs); }
    if (updates.sentAt !== undefined) { sets.push("sent_at = ?"); args.push(updates.sentAt); }
    if (updates.deliveredAt !== undefined) { sets.push("delivered_at = ?"); args.push(updates.deliveredAt); }
    if (updates.providerMessageId !== undefined) { sets.push("provider_message_id = ?"); args.push(updates.providerMessageId); }
    if (updates.lastStatusCode !== undefined) { sets.push("last_status_code = ?"); args.push(updates.lastStatusCode); }
    if (updates.lastErrorCode !== undefined) { sets.push("last_error_code = ?"); args.push(updates.lastErrorCode); }
    if (updates.lastErrorMessage !== undefined) {
      sets.push("last_error_message = ?");
      args.push(updates.lastErrorMessage ? redactNotificationSecrets(updates.lastErrorMessage) : null);
    }
    if (sets.length === 0) return this.getDelivery(id);
    sets.push("updated_at = ?");
    args.push(iso(nowMs));
    args.push(id);
    this.db.query(`UPDATE notification_deliveries SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    return this.getDelivery(id);
  }

  findOpenAggregation(aggregationKey: string, destinationId: string, nowMs: number): NotificationAggregation | null {
    const row = this.db.query(`SELECT * FROM notification_aggregations
      WHERE aggregation_key = ? AND destination_id = ? AND status = 'OPEN' AND flush_at_ms >= ?
      LIMIT 1`).get(aggregationKey, destinationId, nowMs) as Record<string, unknown> | undefined;
    return row ? aggregationFromRow(row) : null;
  }

  getAggregationForDelivery(delivery: NotificationDelivery): NotificationAggregation | null {
    const row = this.db.query(`SELECT * FROM notification_aggregations
      WHERE root_event_id = ? AND destination_id = ? AND status = 'OPEN' LIMIT 1`)
      .get(delivery.eventId, delivery.destinationId) as Record<string, unknown> | undefined;
    return row ? aggregationFromRow(row) : null;
  }

  createAggregation(input: {
    aggregationKey: string;
    destinationId: string;
    rootEventId: string;
    summary: NotificationAggregation["summary"];
    flushAtMs: number;
    nowMs?: number;
  }): NotificationAggregation {
    const id = `nagg_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const now = iso(input.nowMs);
    this.db.query(`INSERT INTO notification_aggregations (
      id, aggregation_key, destination_id, root_event_id, status, event_count,
      summary_json, flush_at_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'OPEN', 1, ?, ?, ?, ?)`)
      .run(id, input.aggregationKey, input.destinationId, input.rootEventId, JSON.stringify(input.summary), input.flushAtMs, now, now);
    return this.listAggregations().find((entry) => entry.id === id)!;
  }

  updateAggregation(id: string, summary: NotificationAggregation["summary"], nowMs = Date.now()): NotificationAggregation {
    this.db.query(`UPDATE notification_aggregations SET event_count = event_count + 1,
      summary_json = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'`)
      .run(JSON.stringify(summary), iso(nowMs), id);
    return this.listAggregations().find((entry) => entry.id === id)!;
  }

  markAggregationFlushed(id: string, nowMs = Date.now()): void {
    this.db.query("UPDATE notification_aggregations SET status = 'FLUSHED', updated_at = ? WHERE id = ?")
      .run(iso(nowMs), id);
  }

  listAggregations(): NotificationAggregation[] {
    return (this.db.query("SELECT * FROM notification_aggregations ORDER BY created_at, rowid").all() as Record<string, unknown>[])
      .map(aggregationFromRow);
  }

  reserveNextDelivery(input: { workerId: string; nowMs?: number; leaseMs?: number }): NotificationDelivery | null {
    const nowMs = input.nowMs ?? Date.now();
    const leaseMs = Math.max(100, input.leaseMs ?? 30_000);
    return this.immediate(() => {
      this.db.query(`UPDATE notification_deliveries SET status = 'QUEUED', reserved_by = NULL,
        reserved_at_ms = NULL, lease_expires_at_ms = NULL, updated_at = ?
        WHERE status IN ('RESERVED', 'SENDING') AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?`)
        .run(iso(nowMs), nowMs);
      const row = this.db.query(`SELECT d.* FROM notification_deliveries d
        JOIN notification_destinations dest ON dest.id = d.destination_id
        WHERE d.status IN ('QUEUED', 'RETRY_SCHEDULED', 'RATE_LIMITED')
          AND d.available_at_ms <= ? AND dest.enabled = 1
          AND NOT EXISTS (
            SELECT 1 FROM notification_deliveries active
            WHERE active.destination_id = d.destination_id
              AND active.status IN ('RESERVED', 'SENDING')
          )
        ORDER BY CASE d.priority
          WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
          d.available_at_ms, d.created_at, d.rowid LIMIT 1`)
        .get(nowMs) as Record<string, unknown> | undefined;
      if (!row) return null;
      const changed = this.db.query(`UPDATE notification_deliveries SET status = 'RESERVED', reserved_by = ?,
        reserved_at_ms = ?, lease_expires_at_ms = ?, updated_at = ?
        WHERE id = ? AND status IN ('QUEUED', 'RETRY_SCHEDULED', 'RATE_LIMITED')`)
        .run(input.workerId, nowMs, nowMs + leaseMs, iso(nowMs), String(row.id));
      return changed.changes > 0 ? this.getDelivery(String(row.id)) : null;
    });
  }

  // --- Attempts ---
  createAttempt(input: NotificationAttemptInput): void {
    this.db.query(`INSERT INTO notification_attempts (
      id, delivery_id, attempt, started_at, finished_at, status_code, error_code,
      retry_after_ms, bucket_id, rate_limit_remaining, rate_limit_reset_after_ms,
      global_rate_limited, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        input.id,
        input.deliveryId,
        input.attempt,
        input.startedAt,
        input.finishedAt,
        input.statusCode ?? null,
        input.errorCode ? redactNotificationSecrets(input.errorCode) : null,
        input.retryAfterMs ?? null,
        input.bucketId ?? null,
        input.rateLimitRemaining ?? null,
        input.rateLimitResetAfterMs ?? null,
        input.globalRateLimited ? 1 : 0,
        input.durationMs,
      );
  }

  listAttempts(deliveryId: string): NotificationAttemptInput[] {
    const rows = this.db.query("SELECT * FROM notification_attempts WHERE delivery_id = ? ORDER BY attempt ASC")
      .all(deliveryId) as Record<string, unknown>[];
    return rows.map(attemptFromRow);
  }

  // --- Rate Limit States ---
  listRateLimitStates(): NotificationRateLimitState[] {
    const rows = this.db.query("SELECT * FROM notification_rate_limit_states ORDER BY observed_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(rateLimitStateFromRow);
  }

  getRateLimitState(stateKey: string): NotificationRateLimitState | null {
    const row = this.db.query("SELECT * FROM notification_rate_limit_states WHERE state_key = ?")
      .get(stateKey) as Record<string, unknown> | undefined;
    return row ? rateLimitStateFromRow(row) : null;
  }

  findRateLimitState(provider: string, destinationId?: string | null, bucketId?: string | null): NotificationRateLimitState | null {
    if (bucketId) {
      const byBucket = this.db.query("SELECT * FROM notification_rate_limit_states WHERE provider = ? AND bucket_id = ? LIMIT 1")
        .get(provider, bucketId) as Record<string, unknown> | undefined;
      if (byBucket) return rateLimitStateFromRow(byBucket);
    }
    if (destinationId) {
      const byDest = this.db.query("SELECT * FROM notification_rate_limit_states WHERE provider = ? AND destination_id = ? LIMIT 1")
        .get(provider, destinationId) as Record<string, unknown> | undefined;
      if (byDest) return rateLimitStateFromRow(byDest);
    }
    return null;
  }

  upsertRateLimitState(input: NotificationRateLimitState): void {
    this.db.query(`INSERT INTO notification_rate_limit_states (
      state_key, provider, destination_id, bucket_id, scope, limit_value, remaining,
      reset_after_ms, blocked_until_ms, observed_at, last_request_at_ms, rate_limited_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      provider = excluded.provider,
      destination_id = COALESCE(excluded.destination_id, notification_rate_limit_states.destination_id),
      bucket_id = COALESCE(excluded.bucket_id, notification_rate_limit_states.bucket_id),
      scope = COALESCE(excluded.scope, notification_rate_limit_states.scope),
      limit_value = COALESCE(excluded.limit_value, notification_rate_limit_states.limit_value),
      remaining = excluded.remaining,
      reset_after_ms = excluded.reset_after_ms,
      blocked_until_ms = excluded.blocked_until_ms,
      observed_at = excluded.observed_at,
      last_request_at_ms = excluded.last_request_at_ms,
      rate_limited_count = excluded.rate_limited_count`)
      .run(
        input.stateKey,
        input.provider,
        input.destinationId ?? null,
        input.bucketId ?? null,
        input.scope ?? null,
        input.limit ?? null,
        input.remaining ?? null,
        input.resetAfterMs ?? null,
        input.blockedUntilMs ?? null,
        input.observedAt ?? iso(),
        input.lastRequestAtMs ?? Date.now(),
        input.rateLimitedCount,
      );
  }

  // --- Provider Gates ---
  getProviderGate(provider: string): NotificationProviderGate | null {
    const row = this.db.query("SELECT * FROM notification_provider_gates WHERE provider = ?")
      .get(provider) as Record<string, unknown> | undefined;
    return row ? providerGateFromRow(row) : null;
  }

  setProviderGate(provider: string, blockedUntilMs: number, reason?: string | null, nowMs = Date.now()): void {
    this.db.query(`INSERT INTO notification_provider_gates (provider, blocked_until_ms, reason, observed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        blocked_until_ms = excluded.blocked_until_ms,
        reason = excluded.reason,
        observed_at = excluded.observed_at`)
      .run(provider, blockedUntilMs, reason ?? null, iso(nowMs));
  }

  clearProviderGate(provider: string): void {
    this.db.query("DELETE FROM notification_provider_gates WHERE provider = ?").run(provider);
  }

  // --- Circuits ---
  getCircuit(destinationId: string): NotificationCircuit | null {
    const row = this.db.query("SELECT * FROM notification_circuits WHERE destination_id = ?")
      .get(destinationId) as Record<string, unknown> | undefined;
    return row ? circuitFromRow(row) : null;
  }

  upsertCircuit(input: {
    destinationId: string;
    provider: NotificationProviderId;
    state: NotificationCircuitState;
    failureCount?: number;
    openedUntilMs?: number | null;
    reason?: string | null;
    lastFailureAt?: string | null;
    lastSuccessAt?: string | null;
    nowMs?: number;
  }): NotificationCircuit {
    const now = iso(input.nowMs);
    this.db.query(`INSERT INTO notification_circuits (
      destination_id, provider, state, failure_count, opened_until_ms, reason,
      last_failure_at, last_success_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(destination_id) DO UPDATE SET
      provider = excluded.provider,
      state = excluded.state,
      failure_count = excluded.failure_count,
      opened_until_ms = excluded.opened_until_ms,
      reason = excluded.reason,
      last_failure_at = COALESCE(excluded.last_failure_at, notification_circuits.last_failure_at),
      last_success_at = COALESCE(excluded.last_success_at, notification_circuits.last_success_at),
      updated_at = excluded.updated_at`)
      .run(
        input.destinationId,
        input.provider,
        input.state,
        input.failureCount ?? 0,
        input.openedUntilMs ?? null,
        input.reason ?? null,
        input.lastFailureAt ?? null,
        input.lastSuccessAt ?? null,
        now,
      );
    return this.getCircuit(input.destinationId)!;
  }

  // --- Dead Letters ---
  createDeadLetter(input: {
    deliveryId: string;
    eventId: string;
    destinationId: string;
    reason: string;
    lastErrorCode?: string | null;
    attempts: number;
    nowMs?: number;
  }): NotificationDeadLetter {
    const id = `ndl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const now = iso(input.nowMs);
    this.db.query(`INSERT OR REPLACE INTO notification_dead_letters (
      id, delivery_id, event_id, destination_id, reason, last_error_code, attempts, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`)
      .run(
        id,
        input.deliveryId,
        input.eventId,
        input.destinationId,
        redactNotificationSecrets(input.reason),
        input.lastErrorCode ? redactNotificationSecrets(input.lastErrorCode) : null,
        input.attempts,
        now,
      );
    return this.getDeadLetter(id)!;
  }

  getDeadLetter(id: string): NotificationDeadLetter | null {
    const row = this.db.query("SELECT * FROM notification_dead_letters WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? deadLetterFromRow(row) : null;
  }

  getDeadLetterByDelivery(deliveryId: string): NotificationDeadLetter | null {
    const row = this.db.query("SELECT * FROM notification_dead_letters WHERE delivery_id = ?").get(deliveryId) as Record<string, unknown> | undefined;
    return row ? deadLetterFromRow(row) : null;
  }

  listDeadLetters(options: { status?: string; limit?: number } = {}): NotificationDeadLetter[] {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (options.status) { clauses.push("status = ?"); args.push(options.status); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const rows = this.db.query(`SELECT * FROM notification_dead_letters ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];
    return rows.map(deadLetterFromRow);
  }

  resolveDeadLetter(id: string, action: "RETRIED" | "DISMISSED", actor = "operator", nowMs = Date.now()): NotificationDeadLetter | null {
    const now = iso(nowMs);
    this.db.query("UPDATE notification_dead_letters SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?")
      .run(action, now, actor, id);
    return this.getDeadLetter(id);
  }

  // --- Invalid Request Velocity Tracking ---
  recordInvalidRequest(input: {
    provider: string;
    destinationId?: string | null;
    statusCode: number;
    errorCode: string;
    nowMs?: number;
  }): void {
    const nowMs = input.nowMs ?? Date.now();
    this.db.query(`INSERT INTO notification_invalid_requests (
      id, provider, destination_id, status_code, error_code, occurred_at_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        `nir_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        input.provider,
        input.destinationId ?? null,
        input.statusCode,
        redactNotificationSecrets(input.errorCode),
        nowMs,
        iso(nowMs),
      );
  }

  invalidRequestSummary(nowMs = Date.now()): {
    invalidRequests10m: number;
    rateLimitedRequests10m: number;
    authFailures10m: number;
    forbiddenRequests10m: number;
    notFoundRequests10m: number;
    badPayloadRequests10m: number;
  } {
    const windowMs = nowMs - (10 * 60 * 1_000);
    const rows = this.db.query(`SELECT status_code, COUNT(*) as count
      FROM notification_invalid_requests
      WHERE occurred_at_ms >= ?
      GROUP BY status_code`).all(windowMs) as Array<{ status_code: number; count: number }>;
    let authFailures10m = 0;
    let forbiddenRequests10m = 0;
    let notFoundRequests10m = 0;
    let rateLimitedRequests10m = 0;
    let badPayloadRequests10m = 0;
    let total = 0;
    for (const r of rows) {
      const code = Number(r.status_code);
      const cnt = Number(r.count);
      total += cnt;
      if (code === 401) authFailures10m += cnt;
      else if (code === 403) forbiddenRequests10m += cnt;
      else if (code === 404) notFoundRequests10m += cnt;
      else if (code === 429) rateLimitedRequests10m += cnt;
      else if (code === 400) badPayloadRequests10m += cnt;
    }
    return {
      invalidRequests10m: total,
      rateLimitedRequests10m,
      authFailures10m,
      forbiddenRequests10m,
      notFoundRequests10m,
      badPayloadRequests10m,
    };
  }

  // --- Audit ---
  recordAudit(input: {
    eventType: string;
    actor?: string;
    eventId?: string | null;
    deliveryId?: string | null;
    destinationId?: string | null;
    detail?: Record<string, unknown>;
    nowMs?: number;
  }): void {
    const safeDetail = JSON.parse(redactNotificationSecrets(JSON.stringify(input.detail ?? {}))) as Record<string, unknown>;
    this.db.query(`INSERT INTO notification_audit_events (
      id, event_type, actor, event_id, delivery_id, destination_id, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        `naudit_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        input.eventType,
        input.actor ?? "system",
        input.eventId ?? null,
        input.deliveryId ?? null,
        input.destinationId ?? null,
        JSON.stringify(safeDetail),
        iso(input.nowMs),
      );
  }

  listAuditEvents(options: { deliveryId?: string; eventId?: string; destinationId?: string; limit?: number } = {}): Array<{
    id: string;
    eventType: string;
    actor: string;
    eventId: string | null;
    deliveryId: string | null;
    destinationId: string | null;
    detail: Record<string, unknown>;
    createdAt: string;
  }> {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (options.deliveryId) { clauses.push("delivery_id = ?"); args.push(options.deliveryId); }
    if (options.eventId) { clauses.push("event_id = ?"); args.push(options.eventId); }
    if (options.destinationId) { clauses.push("destination_id = ?"); args.push(options.destinationId); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const rows = this.db.query(`SELECT * FROM notification_audit_events ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      actor: String(row.actor),
      eventId: row.event_id === null ? null : String(row.event_id),
      deliveryId: row.delivery_id === null ? null : String(row.delivery_id),
      destinationId: row.destination_id === null ? null : String(row.destination_id),
      detail: jsonObject(row.detail_json),
      createdAt: String(row.created_at),
    }));
  }
}

