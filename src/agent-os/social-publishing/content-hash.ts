// Phase 20.60 — Deterministic content hash and idempotency keys.
//
// The approval gate binds every human decision to `contentHash` (spec §8.7,
// §11.4, §14). Any material mutation — text, media bytes (by SHA-256), media
// order, destination account, provider settings, schedule outside tolerance,
// or the policy version — produces a different hash and invalidates the
// approval. Canonical JSON (sorted keys, no whitespace) keeps the hash stable
// across processes.

import { createHash } from "node:crypto";
import { SOCIAL_PUBLISHING_POLICY_VERSION, type Rendition } from "./types";

/** Canonical JSON: object keys sorted recursively, stable separators. */
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

/** Schedule drift below this tolerance does not invalidate an approval. */
export const SCHEDULE_TOLERANCE_MS = 60_000;

export interface MaterialRenditionState {
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  accountRef: string;
  platform: string;
  format: string;
  mediaSha256s: string[];
  providerSettings: Record<string, unknown>;
  scheduledAt: string | null;
  policyVersion: string;
}

/**
 * Extract the material state of a rendition. Fields excluded on purpose:
 * validation status, approval status, delivery status, remote refs — those
 * change as a *result* of processing and must not invalidate approvals.
 */
export function materialState(rendition: Rendition, accountOpenpostRef: string, policyVersion: string = SOCIAL_PUBLISHING_POLICY_VERSION): MaterialRenditionState {
  return {
    title: rendition.title ?? null,
    caption: rendition.caption ?? null,
    description: rendition.description ?? null,
    hashtags: [...rendition.hashtags],
    accountRef: accountOpenpostRef,
    platform: rendition.platform,
    format: rendition.format,
    mediaSha256s: [...rendition.assetRefs],
    providerSettings: rendition.providerSettings,
    scheduledAt: rendition.scheduledAt ?? null,
    policyVersion,
  };
}

/** Deterministic hash over the material state (spec §11.4 inputs). */
export function computeContentHash(state: MaterialRenditionState): string {
  return sha256Hex(canonicalJson(state));
}

/**
 * Whether a schedule change is inside the approval tolerance (spec §14.3
 * "Schedule changes outside an allowed tolerance").
 */
export function scheduleWithinTolerance(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= SCHEDULE_TOLERANCE_MS;
}

/**
 * Idempotency key for a remote mutation (spec §16). Same workspace scope,
 * publication, rendition, content, operation, and target schedule ⇒ same key
 * ⇒ the delivery executor returns the existing result instead of mutating
 * again.
 */
export function deliveryIdempotencyKey(input: {
  workspaceScope: string;
  publicationId: string;
  renditionId: string;
  contentHash: string;
  operationType: "schedule" | "publish_now" | "reconcile";
  targetSchedule: string | null;
}): string {
  return sha256Hex(
    canonicalJson({
      workspace_id: input.workspaceScope,
      publication_id: input.publicationId,
      rendition_id: input.renditionId,
      content_hash: input.contentHash,
      operation_type: input.operationType,
      target_schedule: input.targetSchedule,
    }),
  );
}
