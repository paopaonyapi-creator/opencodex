import { SENSITIVE_KEY_PATTERN } from "../../lib/redact";
import { redactNotificationSecrets } from "./redaction";
import {
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SOURCES,
  type NormalizedNotificationEventInput,
  type NotificationEventInput,
} from "./types";

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;
const EXTRA_SENSITIVE_KEY_PATTERN = /(?:^|[_-])(?:auth|authorization|cookie|password|passwd|secret|session|token)(?:$|[_-])/i;

function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${key} exceeds ${maxLength} characters`);
  return trimmed;
}

function optionalString(value: unknown, key: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${key} exceeds ${maxLength} characters`);
  return trimmed.length > 0 ? trimmed : null;
}

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return EXTRA_SENSITIVE_KEY_PATTERN.test(normalized);
}

function sanitizeValue(value: unknown, key: string | null, depth: number): unknown {
  if (key && isSensitiveKey(key)) return "[REDACTED]";
  if (depth > 8) throw new Error("data nesting exceeds 8 levels");
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("data contains a non-finite number");
    return value;
  }
  if (typeof value === "string") return redactNotificationSecrets(value.slice(0, 4_000));
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error("data arrays are limited to 100 items");
    return value.map((entry) => sanitizeValue(entry, null, depth + 1));
  }
  if (objectRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 100) throw new Error("data objects are limited to 100 fields");
    return Object.fromEntries(entries.map(([childKey, child]) => [
      childKey.slice(0, 128),
      sanitizeValue(child, childKey, depth + 1),
    ]));
  }
  throw new Error("data contains an unsupported value");
}

function boundedWindow(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 86_400_000) {
    throw new Error(`${key} must be an integer from 0 to 86400000`);
  }
  return Number(value);
}

export function validateAndNormalizeNotificationInput(
  input: NotificationEventInput | unknown,
  options: { maxPayloadBytes?: number } = {},
): NormalizedNotificationEventInput {
  if (!objectRecord(input)) throw new Error("notification event must be an object");

  const source = requiredString(input, "source", 64);
  if (!(NOTIFICATION_SOURCES as readonly string[]).includes(source)) throw new Error(`source is not supported: ${source}`);
  const eventType = requiredString(input, "eventType", 160);
  if (!EVENT_TYPE_PATTERN.test(eventType)) throw new Error("eventType must use dot-separated lowercase identifiers");
  const severity = requiredString(input, "severity", 16);
  if (!(NOTIFICATION_SEVERITIES as readonly string[]).includes(severity)) throw new Error(`severity is not supported: ${severity}`);
  const priority = requiredString(input, "priority", 2);
  if (!(NOTIFICATION_PRIORITIES as readonly string[]).includes(priority)) throw new Error(`priority is not supported: ${priority}`);

  const title = redactNotificationSecrets(requiredString(input, "title", 256));
  const rawMessage = optionalString(input.message, "message", 4_000);
  const progress = input.progress === undefined || input.progress === null ? null : Number(input.progress);
  if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
    throw new Error("progress must be between 0 and 100");
  }

  const rawTags = input.tags ?? [];
  if (!Array.isArray(rawTags)) throw new Error("tags must be an array");
  const tags = [...new Set(rawTags.map((tag) => {
    if (typeof tag !== "string") throw new Error("tags must contain only strings");
    const trimmed = tag.trim();
    if (!trimmed || trimmed.length > 64) throw new Error("tags must be 1 to 64 characters");
    return trimmed;
  }))];
  if (tags.length > 20) throw new Error("tags are limited to 20 values");

  const rawData = input.data ?? {};
  if (!objectRecord(rawData)) throw new Error("data must be an object");
  const data = sanitizeValue(rawData, null, 0) as Record<string, unknown>;

  const occurred = input.occurredAt === undefined ? new Date() : new Date(input.occurredAt as string | Date);
  if (!Number.isFinite(occurred.getTime())) throw new Error("occurredAt must be a valid date");

  const requested = input.requestedDestinations ?? [];
  if (!Array.isArray(requested) || requested.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("requestedDestinations must contain non-empty strings");
  }
  const requestedDestinations = [...new Set(requested.map((value) => String(value).trim()))];
  if (requestedDestinations.length > 20) throw new Error("requestedDestinations is limited to 20 values");

  const normalized: NormalizedNotificationEventInput = {
    source: source as NormalizedNotificationEventInput["source"],
    eventType,
    title,
    message: rawMessage === null ? null : redactNotificationSecrets(rawMessage),
    severity: severity as NormalizedNotificationEventInput["severity"],
    priority: priority as NormalizedNotificationEventInput["priority"],
    status: optionalString(input.status, "status", 64),
    progress,
    entityType: optionalString(input.entityType, "entityType", 64),
    entityId: optionalString(input.entityId, "entityId", 256),
    dedupeKey: optionalString(input.dedupeKey, "dedupeKey", 256),
    aggregationKey: optionalString(input.aggregationKey, "aggregationKey", 256),
    dedupeWindowMs: boundedWindow(input.dedupeWindowMs, "dedupeWindowMs"),
    aggregationWindowMs: boundedWindow(input.aggregationWindowMs, "aggregationWindowMs"),
    tags,
    data,
    occurredAt: occurred.toISOString(),
    requestedDestinations,
  };

  const bytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
  const maxPayloadBytes = options.maxPayloadBytes ?? 65_536;
  if (bytes > maxPayloadBytes) throw new Error(`notification payload exceeds ${maxPayloadBytes} bytes`);
  return normalized;
}
