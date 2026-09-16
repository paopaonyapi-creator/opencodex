// Phase 20.60 — Delivery retry math and publication aggregate status.
//
// Backoff schedule from spec §17.1 (15s / 60s / 5m / 20m / 60m) with ±20%
// jitter, capped at max attempts. Aggregate status logic implements §7.1: a
// publication is only `published` when every rendition reached a published
// terminal state.

import { randomInt } from "node:crypto";
import type { DeliveryStatus, PublicationStatus, Rendition } from "./types";

const BASE_BACKOFF_SECONDS = [15, 60, 300, 1200, 3600];

/** Backoff for the *next* attempt (attemptCount already includes the failure). */
export function nextBackoffSeconds(attemptCount: number, maxAttempts: number): { delaySeconds: number; exhausted: boolean } {
  if (attemptCount >= maxAttempts) return { delaySeconds: 0, exhausted: true };
  const index = Math.min(attemptCount - 1, BASE_BACKOFF_SECONDS.length - 1);
  const base = BASE_BACKOFF_SECONDS[Math.max(0, index)];
  // ±20% jitter from the CSPRNG; not security-sensitive but cheap to do right.
  const jitterSpan = Math.max(1, Math.round(base * 0.2));
  const jitter = randomInt(-jitterSpan, jitterSpan + 1);
  return { delaySeconds: Math.max(1, base + jitter), exhausted: false };
}

const TERMINAL_OK: ReadonlySet<DeliveryStatus> = new Set(["published"]);
const TERMINAL_BAD: ReadonlySet<DeliveryStatus> = new Set(["failed_final", "cancelled"]);

/**
 * Aggregate publication status from its renditions (spec §7.1 — never mark
 * the whole publication PUBLISHED until required destinations succeed;
 * partial success surfaces as partial_success).
 */
export function aggregatePublicationStatus(renditions: Array<Pick<Rendition, "deliveryStatus">>, fallback: PublicationStatus): PublicationStatus {
  if (renditions.length === 0) return fallback;
  if (renditions.every((r) => TERMINAL_OK.has(r.deliveryStatus))) return "published";
  const anyGood = renditions.some((r) => TERMINAL_OK.has(r.deliveryStatus));
  const anyBad = renditions.some((r) => TERMINAL_BAD.has(r.deliveryStatus));
  const anyActive = renditions.some((r) => !TERMINAL_OK.has(r.deliveryStatus) && !TERMINAL_BAD.has(r.deliveryStatus) && r.deliveryStatus !== "failed_retryable");
  if (anyGood && (anyBad || renditions.some((r) => r.deliveryStatus === "failed_retryable"))) return "partial_success";
  if (anyBad && !anyGood && !anyActive) return "failed";
  if (renditions.every((r) => r.deliveryStatus === "draft")) return fallback;
  if (renditions.some((r) => r.deliveryStatus === "scheduled" || r.deliveryStatus === "queued")) return "scheduled";
  if (renditions.some((r) => r.deliveryStatus === "publishing")) return "dispatching";
  return fallback;
}

/**
 * True when a local job may resubmit: OpenPost already owns the durable
 * queue, so once a dispatch was accepted (remote ref recorded) Pao must not
 * resubmit blindly (spec §15, §17.3) — reconciliation owns the outcome then.
 */
export function mayResubmit(job: { attemptCount: number; maxAttempts: number; remoteOperationRef: string | null; status: string }): boolean {
  if (job.remoteOperationRef) return false;
  if (job.status !== "failed_retryable" && job.status !== "pending") return false;
  return job.attemptCount < job.maxAttempts;
}
