// Phase 20.15 — Domain Control Plane: post-mutation verification.
//
// Three independent checks, each with an injected transport so every path is
// testable without a network and no test can accidentally resolve a real name.
//
// Propagation uses BOUNDED POLLING, never a fixed sleep: a fixed sleep is both
// slower than necessary in the common case and silently wrong in the slow one.

import {
  type DnsVerification,
  type HttpHealthVerification,
  type TlsVerification,
  DomainControlError,
} from "./types";

export interface ResolverResult {
  /** Resolver address the answer came from. */
  readonly resolver: string;
  /** Observed values, normalized. Empty means NXDOMAIN or no answer. */
  readonly values: readonly string[];
}

export type ResolveFn = (
  hostname: string,
  type: string,
  resolver: string,
) => Promise<ResolverResult | null>;

export interface PropagationOptions {
  readonly hostname: string;
  readonly type: string;
  /** Values the mutation intended. Verification succeeds on any of them. */
  readonly expected: readonly string[];
  readonly resolvers: readonly string[];
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalize a record value for comparison (case, trailing dot, quotes). */
export function normalizeValue(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^"|"$/g, "")
    .replace(/\.$/, "");
}

/**
 * Poll every configured resolver until each one reports an expected value.
 *
 * Returns a report rather than throwing on mismatch: the caller decides whether a
 * mismatch is a failure or a "not yet propagated" state, and the report is what
 * gets written to the audit row either way.
 */
export async function verifyPropagation(
  options: PropagationOptions,
  resolveFn: ResolveFn,
): Promise<DnsVerification> {
  const sleep = options.sleep ?? defaultSleep;
  const expected = options.expected.map(normalizeValue);
  const started = Date.now();
  const deadline = started + Math.max(0, options.timeoutMs);
  const results: Record<string, string> = {};
  let attempts = 0;
  let lastSeen: Record<string, string> = {};
  // A resolver that returns SOMETHING WHICH IS NOT the expected value is making a
  // claim that contradicts the intent; one that returns nothing is merely silent.
  // Collapsing the two would report a slow resolver as "another record takes
  // precedence", which sends an operator hunting for a conflict that does not exist.
  let contradicted = false;

  // At least one attempt even with a zero timeout, so a test can assert the
  // "one look, reported honestly" path without waiting.
  do {
    attempts += 1;
    lastSeen = {};
    contradicted = false;
    await Promise.all(
      options.resolvers.map(async (resolver) => {
        try {
          const answer = await resolveFn(options.hostname, options.type, resolver);
          const values = (answer?.values ?? []).map(normalizeValue);
          lastSeen[resolver] = values.join(", ");
          if (values.length === 0) return;
          if (values.some((value) => expected.includes(value))) {
            results[resolver] = answer ? answer.values.join(", ") : "";
          } else {
            contradicted = true;
          }
        } catch {
          // A resolver that errors simply has no answer for this attempt; the
          // next attempt retries it. Recording an error string here would make a
          // transient resolver failure look like an observed record value.
          lastSeen[resolver] = "";
        }
      }),
    );
    const allResolved = options.resolvers.every((resolver) => resolver in results);
    if (allResolved) break;
    if (Date.now() >= deadline) break;
    await sleep(options.intervalMs);
  } while (Date.now() <= deadline);

  const resolvedEverything = options.resolvers.every((resolver) => resolver in results);
  const status: DnsVerification["status"] = resolvedEverything
    ? "verified"
    : contradicted
      ? "mismatch"
      : "timeout";

  return {
    status,
    expected: options.expected.join(", "),
    results: { ...lastSeen, ...results },
    attempts,
    elapsedMs: Date.now() - started,
  };
}

/** Throwing form for the deploy path, where verification is a gate. */
export function assertPropagated(verification: DnsVerification): void {
  if (verification.status === "verified") return;
  if (verification.status === "timeout") {
    throw new DomainControlError(
      "DNS_VERIFY_TIMEOUT",
      `DNS propagation was not observed within the verification window (${verification.attempts} attempts, ${verification.elapsedMs}ms).`,
      {
        retryable: false,
        nextAction: "re-run dns.check_propagation; the provider write may still be settling",
        detail: verification,
      },
    );
  }
  throw new DomainControlError(
    "RECORD_CONFLICT",
    "Resolvers returned a value that does not match the intended record.",
    { nextAction: "inspect the diff and provider state; another record may take precedence" },
  );
}

export type TlsProbeFn = (hostname: string, port: number) => Promise<{
  ok: boolean;
  issuer?: string;
  validTo?: string;
  error?: string;
}>;

export async function verifyTls(
  hostname: string,
  probe: TlsProbeFn,
  port = 443,
): Promise<TlsVerification> {
  try {
    const result = await probe(hostname, port);
    const daysRemaining = result.validTo
      ? Math.floor((new Date(result.validTo).getTime() - Date.now()) / 86_400_000)
      : undefined;
    return {
      hostname,
      ok: result.ok,
      ...(result.issuer ? { issuer: result.issuer } : {}),
      ...(result.validTo ? { validTo: result.validTo } : {}),
      ...(daysRemaining === undefined ? {} : { daysRemaining }),
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (error) {
    return { hostname, ok: false, error: String(error) };
  }
}

export type HttpProbeFn = (url: string) => Promise<{ status: number; latencyMs: number }>;

/**
 * Post-deployment health check.
 *
 * Only 2xx-3xx is healthy. A 3xx is accepted because a proxy legitimately answers
 * with a redirect, but 4xx/5xx are not: a 404 from the origin means the route was
 * never wired, which is precisely what this check exists to catch.
 */
export async function verifyHttpHealth(
  url: string,
  probe: HttpProbeFn,
): Promise<HttpHealthVerification> {
  try {
    const { status, latencyMs } = await probe(url);
    const ok = status >= 200 && status < 400;
    return { url, ok, status, latencyMs };
  } catch (error) {
    return { url, ok: false, error: String(error) };
  }
}

export function assertHealthy(result: HttpHealthVerification): void {
  if (result.ok) return;
  throw new DomainControlError(
    "HEALTH_CHECK_FAILED",
    `Health check failed for ${result.url} (status ${result.status ?? "none"}).`,
    {
      retryable: true,
      nextAction: "inspect the target service and the reverse proxy route",
      detail: result,
    },
  );
}
