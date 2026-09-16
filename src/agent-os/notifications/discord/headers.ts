import type { DiscordRateLimitObservation } from "../types";

function finiteNonNegative(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function secondsToMs(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value * 1_000));
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  const numeric = finiteNonNegative(value);
  if (numeric !== null) return secondsToMs(numeric);
  if (!value) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? Math.max(0, epoch - nowMs) : null;
}

function parseBody(bodyText: string | undefined): { retryAfter: number | null; global: boolean | null } {
  if (!bodyText) return { retryAfter: null, global: null };
  try {
    const body = JSON.parse(bodyText) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return { retryAfter: null, global: null };
    const record = body as Record<string, unknown>;
    const retryAfter = typeof record.retry_after === "number" && Number.isFinite(record.retry_after) && record.retry_after >= 0
      ? secondsToMs(record.retry_after)
      : null;
    return { retryAfter, global: typeof record.global === "boolean" ? record.global : null };
  } catch {
    return { retryAfter: null, global: null };
  }
}

export function parseDiscordRateLimitResponse(input: {
  status: number;
  headers: Headers;
  bodyText?: string;
  nowMs?: number;
}): DiscordRateLimitObservation {
  const nowMs = input.nowMs ?? Date.now();
  const limit = finiteNonNegative(input.headers.get("x-ratelimit-limit"));
  const remaining = finiteNonNegative(input.headers.get("x-ratelimit-remaining"));
  const resetAfterMs = secondsToMs(finiteNonNegative(input.headers.get("x-ratelimit-reset-after")));
  const resetEpochSeconds = finiteNonNegative(input.headers.get("x-ratelimit-reset"));
  const resetAtMs = resetAfterMs !== null
    ? nowMs + resetAfterMs
    : resetEpochSeconds !== null
      ? Math.max(nowMs, Math.round(resetEpochSeconds * 1_000))
      : null;
  const body = input.status === 429 ? parseBody(input.bodyText) : { retryAfter: null, global: null };
  const headerGlobal = input.headers.get("x-ratelimit-global");
  return {
    limit,
    remaining,
    resetAfterMs,
    resetAtMs,
    bucketId: input.headers.get("x-ratelimit-bucket")?.trim() || null,
    scope: input.headers.get("x-ratelimit-scope")?.trim() || null,
    retryAfterMs: parseRetryAfter(input.headers.get("retry-after"), nowMs) ?? body.retryAfter,
    global: headerGlobal === null ? (body.global ?? false) : headerGlobal.trim().toLowerCase() === "true",
  };
}
