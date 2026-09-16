// Phase 20.61 — Canonical hashing for approval binding and idempotency keys.

import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic hash binding an approval to an exact payload (spec §11). */
export function payloadHashOf(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

/** Idempotency key over operation + request payload. */
export function idempotencyKey(operation: string, request: unknown): string {
  return sha256Hex(canonicalJson({ operation, request }));
}
