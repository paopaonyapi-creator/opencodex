// Phase 20.60 — Remote→normalized mapping.
//
// OpenPost status vocabulary is upstream-owned and may grow; every mapper
// falls back to "unknown" rather than guessing. Missing analytics metrics map
// to null — never zero (spec §20.1).

import type {
  AccountCapabilities,
  DeliveryStatus,
  ReadinessState,
  ValidationIssue,
} from "../types";
import type { RemoteCapability, RemoteDelivery, RemoteLifecycleEvent, RemoteReadinessItem, RemoteValidationIssue } from "./client";

const DELIVERY_STATES: Record<string, DeliveryStatus> = {
  draft: "draft",
  validating: "validating",
  approval_required: "approval_required",
  approved: "approved",
  scheduled: "scheduled",
  queued: "queued",
  publishing: "publishing",
  published: "published",
  failed: "failed_final",
  failed_retryable: "failed_retryable",
  cancelled: "cancelled",
  canceled: "cancelled",
  retry_scheduled: "failed_retryable",
  manual_resolution: "reconciliation_required",
  reconcile: "reconciliation_required",
};

/** Map an OpenPost publication/rendition/delivery state string to our normalized set. */
export function mapDeliveryState(remoteState: string | null | undefined, recoveryAction?: string | null): DeliveryStatus {
  if (!remoteState) return "unknown";
  const mapped = DELIVERY_STATES[String(remoteState).toLowerCase()];
  if (mapped) return mapped;
  if (recoveryAction === "reconcile" || recoveryAction === "manual_resolution") return "reconciliation_required";
  return "unknown";
}

const READINESS_STATES: Record<string, ReadinessState> = {
  ready: "ready",
  healthy: "ready",
  degraded: "degraded",
  requires_reauth: "requires_reauth",
  reauth_required: "requires_reauth",
  requires_scope: "requires_scope",
  scope_missing: "requires_scope",
  requires_review: "requires_review",
  app_review_required: "requires_review",
  unsupported_format: "unsupported_format",
  rate_limited: "rate_limited",
  disabled: "disabled",
  inactive: "disabled",
  disconnected: "requires_reauth",
};

export function mapReadinessState(remoteState: string | null | undefined): ReadinessState {
  if (!remoteState) return "unknown";
  return READINESS_STATES[String(remoteState).toLowerCase()] ?? "unknown";
}

/**
 * Merge per-provider capability data + provider readiness into the normalized
 * account capability shape. `known` stays false unless OpenPost actually
 * reported a capability row for this provider — unknown capabilities must not
 * be treated as supported (spec §11.3, §19).
 */
export function mapAccountCapabilities(input: {
  platform: string;
  isActive?: boolean | null;
  capabilities: RemoteCapability[];
  readiness: RemoteReadinessItem[];
}): { capabilities: AccountCapabilities; readinessState: ReadinessState; readinessReason: string | null } {
  const providerKey = input.platform.toLowerCase();
  const cap = input.capabilities.find((c) => String(c.provider ?? "").toLowerCase() === providerKey) ?? null;
  const readinessRow = input.readiness.find((r) => String(r.provider ?? "").toLowerCase() === providerKey) ?? null;

  let readinessState: ReadinessState = input.isActive === false ? "disabled" : "unknown";
  let readinessReason: string | null = input.isActive === false ? "account is inactive in OpenPost" : null;
  if (readinessRow) {
    const rowState = mapReadinessState(readinessRow.state);
    if (rowState !== "unknown") {
      readinessState = rowState;
      readinessReason = Array.isArray(readinessRow.blocking_issues) && readinessRow.blocking_issues.length
        ? JSON.stringify(readinessRow.blocking_issues).slice(0, 300)
        : readinessRow.state ?? null;
    }
    const accountRow = (readinessRow.accounts ?? []).find((a) => a.state);
    if (accountRow?.state) {
      const perAccount = mapReadinessState(accountRow.state);
      if (perAccount !== "unknown") {
        readinessState = perAccount;
        readinessReason = accountRow.state;
      }
    }
  }
  if (cap?.unavailable_reason) {
    readinessState = "unsupported_format";
    readinessReason = cap.unavailable_reason;
  }
  if (cap?.requires_app_review) {
    readinessState = readinessState === "unknown" ? "requires_review" : readinessState;
  }

  const capabilities: AccountCapabilities = {
    textLimit: typeof cap?.text_limit === "number" ? cap.text_limit : null,
    titleRequired: typeof cap?.title_required === "boolean" ? cap.title_required : null,
    descriptionRequired: typeof cap?.description_required === "boolean" ? cap.description_required : null,
    intents: Array.isArray(cap?.intents) ? cap.intents.map(String) : [],
    mediaShapes: cap?.media_shapes ?? {},
    nativeScheduling: typeof cap?.native_scheduling === "boolean" ? cap.native_scheduling : null,
    openpostQueued: typeof cap?.openpost_queued === "boolean" ? cap.openpost_queued : null,
    requiresAppReview: typeof cap?.requires_app_review === "boolean" ? cap.requires_app_review : null,
    requiresPublicMedia: typeof cap?.requires_public_media === "boolean" ? cap.requires_public_media : null,
    unavailableReason: cap?.unavailable_reason ?? null,
    caveats: Array.isArray(cap?.caveats) ? cap.caveats.map(String) : [],
    known: cap !== null,
    raw: cap ?? {},
  };

  return { capabilities, readinessState, readinessReason };
}

/** Map upstream validation issues into the local shape (remote=true). */
export function mapValidationIssues(remote: RemoteValidationIssue[] | null | undefined): ValidationIssue[] {
  if (!Array.isArray(remote)) return [];
  return remote.map((issue) => ({
    code: issue.code ?? "remote_validation_issue",
    severity: issue.severity === "error" ? "error" : issue.severity === "info" ? "info" : "warning",
    message: issue.message ?? issue.fallback_message ?? "OpenPost reported a validation issue.",
    field: issue.field,
    remote: true,
  }));
}

/** Extract per-rendition external identity + delivery detail from a lifecycle event stream. */
export function summarizeLifecycleEvents(events: RemoteLifecycleEvent[]): {
  latest: RemoteLifecycleEvent | null;
  publishedCount: number;
  failedCount: number;
  pendingCount: number;
} {
  let publishedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  for (const event of events) {
    const status = String(event.status ?? "").toLowerCase();
    if (status === "published" || event.type === "publication.published" || event.type === "rendition.published") publishedCount += 1;
    else if (status === "failed" || status === "error" || event.type === "rendition.failed" || event.type === "publication.failed") failedCount += 1;
    else pendingCount += 1;
  }
  return { latest: events[0] ?? null, publishedCount, failedCount, pendingCount };
}

function metricTotal(block: { total?: number | null } | undefined): number | null {
  return typeof block?.total === "number" ? block.total : null;
}

/** Normalize the analytics Overview into metric columns; missing stays null. */
export function mapAnalyticsSummary(overview: {
  summary?: Record<string, unknown>;
}): {
  views: number | null;
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  followersDelta: number | null;
} {
  const summary = overview.summary ?? {};
  return {
    views: metricTotal(summary.views as { total?: number | null } | undefined),
    impressions: metricTotal(summary.impressions as { total?: number | null } | undefined),
    reach: metricTotal(summary.reach as { total?: number | null } | undefined),
    engagements: metricTotal(summary.engagement as { total?: number | null } | undefined),
    followersDelta: metricTotal(summary.followers as { total?: number | null } | undefined),
  };
}
