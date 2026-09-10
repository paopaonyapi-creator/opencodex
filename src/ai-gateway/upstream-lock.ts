/**
 * Pao AI Gateway — pinned upstream boundary.
 *
 * The lock file is the contract with Experiential. Two distinct checks exist and
 * they answer different questions:
 *
 *   1. `verifyUpstreamLock` reads the lock file and validates its SHAPE. It is
 *      offline and synchronous, so it can run at boot without making startup depend
 *      on a network call.
 *   2. `probeUpstreamVersion` optionally asks the running gateway what it is. A
 *      gateway that is older or newer than the pin is reported as a WARNING, never
 *      as a hard failure: refusing to route because a version string differs would
 *      turn a configuration drift into an outage.
 *
 * A pin that is only advisory is not a pin, so the SHAPE check is strict: a
 * floating range fails the check outright rather than logging a note nobody reads.
 */

import { existsSync, readFileSync } from "node:fs";

export interface UpstreamPin {
  readonly version: string;
  readonly python: string;
  readonly license: string;
  readonly verifiedDate: string;
  readonly upgradePolicy: string;
  readonly contractRoutes: readonly { method: string; path: string }[];
  readonly notes: readonly string[];
}

export interface UpstreamLockResult {
  readonly ok: boolean;
  readonly pin: UpstreamPin | null;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Minimal YAML reader for the lock file.
 *
 * Deliberately not a general parser: the lock file has a fixed, shallow shape, and
 * adding a YAML dependency to read four scalars would be the kind of dependency the
 * dependency guard exists to reject.
 */
export function parseUpstreamLock(raw: string): UpstreamPin | null {
  const lines = raw.split(/\r?\n/);
  const scalars: Record<string, string> = {};
  const routes: { method: string; path: string }[] = [];
  const notes: string[] = [];
  let inContract = false;
  let pendingMethod: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed === "contract:") {
      inContract = true;
      continue;
    }
    if (trimmed === "known_limitations:") {
      inContract = false;
      continue;
    }

    const scalar = /^([a-z_]+):\s*"?([^"#]+?)"?\s*$/.exec(trimmed);
    if (scalar && !inContract && !trimmed.startsWith("-")) {
      scalars[scalar[1]!] = scalar[2]!.trim();
      continue;
    }

    if (trimmed.startsWith("- method:")) {
      pendingMethod = trimmed.slice("- method:".length).trim().replace(/^"|"$/g, "");
      continue;
    }
    // The path is a CONTINUATION line of the same list item, so it carries no
    // leading dash. Requiring one silently produced an empty contract list, which
    // is the failure mode that matters least visibly and most: a lock file that
    // documents no dependency surface looks just as valid as one that does.
    const pathMatch = /^-?\s*path:\s*(.+)$/.exec(trimmed);
    if (pathMatch && pendingMethod) {
      const path = pathMatch[1]!.trim().replace(/^"|"$/g, "");
      routes.push({ method: pendingMethod, path });
      pendingMethod = null;
      continue;
    }
    if (trimmed.startsWith("- ") && !inContract) {
      notes.push(trimmed.slice(2).trim().replace(/^"|"$/g, ""));
    }
  }

  if (!scalars.version) return null;
  return {
    version: scalars.version,
    python: scalars.python ?? "",
    license: scalars.license ?? "",
    verifiedDate: scalars.verified_date ?? "",
    upgradePolicy: scalars.upgrade_policy ?? "",
    contractRoutes: routes,
    notes,
  };
}

/** Version strings that mean "we did not actually pin anything". */
function isFloating(version: string): boolean {
  const v = version.trim();
  return (
    v === "" ||
    v === "latest" ||
    v === "*" ||
    v.startsWith(">=") ||
    v.startsWith("<=") ||
    v.startsWith(">") ||
    v.startsWith("<") ||
    v.startsWith("^") ||
    v.startsWith("~") ||
    v.includes("*") ||
    v.includes("latest")
  );
}

export function verifyUpstreamLock(lockPath: string): UpstreamLockResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(lockPath)) {
    return {
      ok: false,
      pin: null,
      problems: [`Upstream lock file not found at ${lockPath}.`],
      warnings: [],
    };
  }

  const pin = parseUpstreamLock(readFileSync(lockPath, "utf8"));
  if (!pin) {
    return { ok: false, pin: null, problems: ["Upstream lock file has no version entry."], warnings: [] };
  }

  if (isFloating(pin.version)) {
    problems.push(`Upstream version "${pin.version}" is not pinned. Use an exact version.`);
  }
  if (pin.upgradePolicy !== "manual-after-contract-tests") {
    warnings.push(`Upgrade policy is "${pin.upgradePolicy}" rather than manual-after-contract-tests.`);
  }
  if (pin.contractRoutes.length === 0) {
    warnings.push("No contract routes recorded; the dependency surface is undocumented.");
  }
  if (pin.license && !pin.license.toUpperCase().includes("APACHE")) {
    // Not a failure: a license change is a human decision, not a boot blocker.
    warnings.push(`Upstream license recorded as "${pin.license}"; confirm redistribution terms before shipping.`);
  }

  return { ok: problems.length === 0, pin, problems, warnings };
}

export interface VersionProbeResult {
  readonly status: "match" | "mismatch" | "unknown";
  readonly pinned: string;
  readonly observed: string | null,
  readonly detail: string;
}

/**
 * Ask the running gateway about itself, best-effort.
 *
 * Upstream is not required to expose a version route, so an absent or unparsable
 * answer is reported as `unknown` rather than as a failure. Claiming a mismatch we
 * did not observe would be worse than admitting we could not check.
 */
export async function probeUpstreamVersion(input: {
  baseUrl: string;
  pinned: string,
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<VersionProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  try {
    const resp = await fetchImpl(`${base}/models`, {
      headers: {
        Accept: "application/json",
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
    });
    if (!resp.ok) {
      return { status: "unknown", pinned: input.pinned, observed: null, detail: `Gateway responded HTTP ${resp.status}.` };
    }
    // The OpenAI-compatible models payload has no standard version field. Look for
    // one in the non-standard places upstream might use, and if none is found say so.
    const body = (await resp.json()) as Record<string, unknown>;
    const observed =
      typeof body.version === "string"
        ? body.version
        : typeof body.gateway_version === "string"
          ? body.gateway_version
          : null;
    if (!observed) {
      return {
        status: "unknown",
        pinned: input.pinned,
        observed: null,
        detail: "Gateway reachable but does not report a version; pin cannot be confirmed remotely.",
      };
    }
    return observed === input.pinned
      ? { status: "match", pinned: input.pinned, observed, detail: `Gateway reports ${observed}, matching the pin.` }
      : {
          status: "mismatch",
          pinned: input.pinned,
          observed,
          detail: `Gateway reports ${observed} but the pin is ${input.pinned}; contract tests have not been run against the running version.`,
        };
  } catch (error) {
    return {
      status: "unknown",
      pinned: input.pinned,
      observed: null,
      detail: `Version probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Default lock path, resolved from the repository root. */
export function defaultLockPath(rootDir: string): string {
  return `${rootDir.replace(/\\+$/, "")}/config/ai-gateway/upstream.lock.yaml`;
}
