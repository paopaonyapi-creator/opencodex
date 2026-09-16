/**
 * Pao AI Gateway — Quota window model (Phase 20.51).
 *
 * Normalizes provider quota telemetry into independent windows with explicit
 * confidence and freshness. The governing rule: missing telemetry is UNKNOWN,
 * never unlimited, and never rendered as full headroom.
 */

import type {
  QuotaConfidence,
  QuotaFreshness,
  QuotaPolicy,
  QuotaUnit,
  QuotaWindow,
  QuotaWindowType,
} from "../types";

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * Classify how fresh an observation is. A missing timestamp is "unknown" —
 * it must not be treated as either fresh or stale.
 */
export function classifyFreshness(
  observedAt: string | undefined,
  policy: Pick<QuotaPolicy, "agingAfterSec" | "staleAfterSec">,
  now: () => number = Date.now,
): QuotaFreshness {
  if (!observedAt) return "unknown";
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "unknown";
  const ageSec = (now() - observed) / 1000;
  if (ageSec < 0) return "fresh"; // clock skew on the observer side
  if (ageSec < policy.agingAfterSec) return "fresh";
  if (ageSec < policy.staleAfterSec) return "aging";
  return "stale";
}

// ---------------------------------------------------------------------------
// Headroom scoring
// ---------------------------------------------------------------------------

/**
 * Headroom score in [0, 1] for routing.
 *
 * - unknown confidence or missing ratio → 0 (the caller applies the unknown
 *   penalty separately; a route with no quota evidence must not outscore one
 *   with evidence of headroom).
 * - remaining ratio is used directly, clamped to [0, 1].
 */
export function quotaHeadroomScore(window: QuotaWindow | undefined): number {
  if (!window) return 0;
  if (window.confidence === "unknown") return 0;
  const ratio = window.remainingRatio;
  if (ratio === undefined || !Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Score modifier for telemetry that cannot be trusted. Applied when the best
 * window for a route is missing, unknown-confidence, or stale.
 */
export function quotaUncertaintyPenalty(
  window: QuotaWindow | undefined,
  policy: Pick<QuotaPolicy, "staleAfterSec" | "stalePenalty" | "unknownPenalty">,
  now: () => number = Date.now,
): number {
  if (!window) return policy.unknownPenalty;
  if (window.confidence === "unknown") return policy.unknownPenalty;
  if (isStale(window, policy, now)) return policy.stalePenalty;
  return 0;
}

/** Whether the window's observation is older than the stale threshold. */
export function isStale(
  window: QuotaWindow,
  policy: Pick<QuotaPolicy, "staleAfterSec">,
  now: () => number = Date.now,
): boolean {
  const observed = Date.parse(window.observedAt);
  if (!Number.isFinite(observed)) return true;
  return now() - observed > policy.staleAfterSec * 1000;
}

/**
 * Whether a quota-exhausted route may be retried yet. A known resetAt releases
 * the cooldown slightly after the reset; an unknown reset stays closed until
 * the caller's bounded probe cycle allows it.
 */
export function cooldownRemainingMs(
  resetAt: string | undefined,
  now: () => number = Date.now,
): number | null {
  if (!resetAt) return null;
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset)) return null;
  return Math.max(0, reset + 30_000 - now()); // 30s guard past the reported reset
}

// ---------------------------------------------------------------------------
// Defensive normalization from upstream telemetry
// ---------------------------------------------------------------------------

const WINDOW_TYPE_HINTS: readonly [QuotaWindowType, readonly string[]][] = [
  ["hourly", ["hour", "short", "5h", "short_window"]],
  ["daily", ["day", "daily"]],
  ["weekly", ["week", "weekly"]],
  ["monthly", ["month", "monthly"]],
  ["credit", ["credit", "balance", "fund"]],
  ["rolling", ["rolling", "session", "sliding"]],
];

function detectWindowType(raw: Record<string, unknown>): QuotaWindowType {
  const haystack = Object.keys(raw)
    .concat(typeof raw.label === "string" ? [raw.label] : [])
    .concat(typeof raw.window === "string" ? [raw.window] : [])
    .join(" ")
    .toLowerCase();
  for (const [type, hints] of WINDOW_TYPE_HINTS) {
    if (hints.some(h => haystack.includes(h))) return type;
  }
  return "unknown";
}

function detectUnit(raw: Record<string, unknown>): QuotaUnit {
  const haystack = JSON.stringify(raw).toLowerCase();
  if (haystack.includes("token")) return "tokens";
  if (haystack.includes("credit")) return "credits";
  if (haystack.includes("request") || haystack.includes("call")) return "requests";
  if (haystack.includes("second")) return "seconds";
  return "unknown";
}

function detectConfidence(raw: Record<string, unknown>): QuotaConfidence {
  // A reading only counts as authoritative if it carries an explicit limit or
  // remaining figure. Everything else is an estimate at best.
  const hasNumbers =
    typeof raw.limit === "number" ||
    typeof raw.remaining === "number" ||
    typeof raw.consumed === "number" ||
    typeof raw.used === "number" ||
    typeof raw.percent === "number" ||
    typeof raw.percentage === "number" ||
    typeof raw.remaining_ratio === "number" ||
    typeof raw.remainingRatio === "number";
  return hasNumbers ? "estimated" : "unknown";
}

function parseResetAt(raw: Record<string, unknown>): string | undefined {
  const candidates = [raw.resetAt, raw.reset_at, raw.reset, raw.resetsAt, raw.resets_at, raw.nextReset];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      // Epoch seconds vs milliseconds: values below 1e11 are seconds.
      const ms = candidate < 1e11 ? candidate * 1000 : candidate;
      return new Date(ms).toISOString();
    }
    if (typeof candidate === "string" && candidate.trim() !== "") {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
  }
  return undefined;
}

function firstNumber(raw: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Normalize one upstream telemetry record into a QuotaWindow. Never throws and
 * never invents numbers: a record it cannot read becomes an unknown-confidence
 * window, which routing treats as zero headroom.
 */
export function normalizeQuotaRecord(raw: Record<string, unknown>, observedAt: string): QuotaWindow {
  const windowType = detectWindowType(raw);
  const unit = detectUnit(raw);
  const confidence = detectConfidence(raw);

  const limit = firstNumber(raw, ["limit", "limitValue", "limit_value", "max", "total", "quota"]);
  const remaining = firstNumber(raw, ["remaining", "left", "available"]);
  const consumed = firstNumber(raw, ["consumed", "used", "spent"]);
  const ratioDirect = firstNumber(raw, ["remaining_ratio", "remainingRatio", "percent_remaining"]);

  let remainingRatio: number | undefined;
  if (ratioDirect !== undefined && ratioDirect >= 0 && ratioDirect <= 1) {
    remainingRatio = ratioDirect;
  } else if (ratioDirect !== undefined && ratioDirect > 1 && ratioDirect <= 100) {
    remainingRatio = ratioDirect / 100;
  } else if (remaining !== undefined && limit !== undefined && limit > 0) {
    remainingRatio = Math.min(1, Math.max(0, remaining / limit));
  } else if (
    remainingRatio === undefined &&
    remaining === undefined &&
    typeof raw.percent === "number" &&
    raw.percent >= 0 &&
    raw.percent <= 100
  ) {
    // A bare "percent" field is the percent USED in most provider dashboards.
    remainingRatio = Math.min(1, Math.max(0, 1 - raw.percent / 100));
  }

  return {
    windowType,
    label: typeof raw.label === "string" ? raw.label : windowType,
    consumed,
    limit,
    remaining,
    remainingRatio,
    resetAt: parseResetAt(raw),
    unit,
    confidence,
    observedAt,
  };
}

/**
 * Normalize an arbitrary upstream telemetry payload. Accepts an array of
 * records, a { records: [...] } wrapper, or an object keyed by provider/model.
 * Anything unreadable is skipped — the caller's store simply has no entry.
 */
export function normalizeQuotaPayload(
  payload: unknown,
  observedAt: string,
): Array<{ routeKeyHint: string; window: QuotaWindow }> {
  const out: Array<{ routeKeyHint: string; window: QuotaWindow }> = [];
  const rows: Array<Record<string, unknown>> = [];

  if (Array.isArray(payload)) {
    rows.push(...payload.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object"));
  } else if (payload !== null && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const nested = obj.records ?? obj.data ?? obj.quotas ?? obj.usage ?? obj.items;
    if (Array.isArray(nested)) {
      rows.push(...nested.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object"));
    } else {
      // Keyed object: { "provider/model": {...window fields} }
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && typeof value === "object") {
          rows.push({ routeKey: key, ...(value as Record<string, unknown>) });
        }
      }
    }
  }

  for (const row of rows) {
    const hint =
      typeof row.routeKey === "string"
        ? row.routeKey
        : [row.provider, row.providerId, row.provider_id, row.model, row.modelId, row.model_id]
            .filter((v): v is string => typeof v === "string")
            .join("/");
    if (!hint) continue;
    const { routeKey: _drop, ...fields } = row;
    void _drop;
    out.push({ routeKeyHint: hint, window: normalizeQuotaRecord(fields, observedAt) });
  }
  return out;
}

/**
 * Pick the window that best represents a route's capacity: the freshest
 * window that carries a remaining ratio, preferring concrete window types
 * over "unknown".
 */
export function selectPrimaryWindow(windows: readonly QuotaWindow[]): QuotaWindow | undefined {
  let best: QuotaWindow | undefined;
  let bestScore = -1;
  for (const window of windows) {
    let score = 0;
    if (window.remainingRatio !== undefined) score += 2;
    if (window.windowType !== "unknown") score += 1;
    if (window.confidence === "authoritative") score += 2;
    else if (window.confidence === "estimated") score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = window;
    }
  }
  return best;
}
