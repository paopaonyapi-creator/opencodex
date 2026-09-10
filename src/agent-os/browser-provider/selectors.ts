// Phase 20.18 — Pao Grok Production Bridge: selector resilience engine.
//
// The specification forbids anchoring on a single CSS class, and the reason is
// concrete: a class name is the least stable thing about a web UI. It changes with
// every design-system refactor, it is minified in some builds, and it carries no
// semantic meaning the site owner has any reason to preserve. An automation that
// depends on one class breaks silently and then reports "element not found" with no
// hint about why.
//
// So an element is described by MANY weighted candidates, each using a different
// signal, and the engine picks the highest-confidence one that actually resolves.
// When the best candidate drops below the accepted floor the engine reports a
// confidence value rather than a boolean, so a caller can distinguish "found it"
// from "found something that is probably it".
//
// This module is pure: it never touches a real DOM. The `resolve` function takes a
// probe callback, so the scoring logic is testable without a browser and the same
// logic is reused by the mock fixtures.

export type SelectorStrategy = "role" | "aria" | "text" | "css";

export interface SelectorCandidate {
  readonly strategy: SelectorStrategy;
  readonly value: string;
  /** Base trust in this signal. Higher is more reliable. */
  readonly weight: number;
}

export interface SelectorSpec {
  readonly name: string;
  readonly candidates: readonly SelectorCandidate[];
  /** Below this confidence the element is reported as unreliable, not absent. */
  readonly minConfidence?: number;
}

export interface SelectorResolution {
  readonly name: string;
  readonly found: boolean;
  /** 0..1. Weight of the winning candidate relative to the best available. */
  readonly confidence: number;
  readonly strategy: SelectorStrategy | null;
  readonly value: string | null;
  /** Candidates that did not resolve, for the diagnostics page. */
  readonly failures: readonly { strategy: SelectorStrategy; value: string; reason: string }[];
  /** True when found but below the spec's own floor. */
  readonly stale: boolean;
  readonly detail: string;
}

/**
 * Base weights are DEFAULTS for authoring a spec, not a global ranking.
 *
 * The ordering reflects how much a signal actually constrains the search: a role
 * narrows to an element kind, an aria label narrows to a named control, visible
 * text narrows to a string, and a CSS selector may match a layout artefact that
 * happens to look right today. A spec may override any weight, because for a
 * specific control the site's own test id genuinely is the strongest signal.
 */
export const DEFAULT_WEIGHTS: Readonly<Record<SelectorStrategy, number>> = {
  role: 100,
  aria: 95,
  text: 80,
  css: 55,
};

/**
 * Resolve a selector spec.
 *
 * `probe` returns true when a candidate resolves to a usable element. It is the
 * ONLY browser-dependent part, which is what keeps this function testable.
 *
 * Candidates are tried in descending weight and the first hit wins. Ties break on
 * declaration order, so two candidates with equal weight behave predictably rather
 * than depending on object iteration.
 */
export function resolveSelector(
  spec: SelectorSpec,
  probe: (candidate: SelectorCandidate) => boolean,
): SelectorResolution {
  const failures: { strategy: SelectorStrategy; value: string; reason: string }[] = [];
  const ordered = [...spec.candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => (b.candidate.weight - a.candidate.weight) || (a.index - b.index));

  if (ordered.length === 0) {
    return {
      name: spec.name,
      found: false,
      confidence: 0,
      strategy: null,
      value: null,
      failures: [],
      stale: false,
      detail: `Selector '${spec.name}' has no candidates defined.`,
    };
  }

  const topWeight = ordered[0]!.candidate.weight;

  for (const { candidate } of ordered) {
    let hit = false;
    try {
      hit = probe(candidate);
    } catch (error) {
      // A probe that throws is a failed candidate, not a failed resolution: one
      // malformed CSS selector must not prevent a role-based fallback from working.
      failures.push({
        strategy: candidate.strategy,
        value: candidate.value,
        reason: error instanceof Error ? error.message : "probe threw",
      });
      continue;
    }
    if (!hit) {
      failures.push({ strategy: candidate.strategy, value: candidate.value, reason: "no match" });
      continue;
    }

    // Confidence is the winner's weight relative to the best available signal.
    // It answers "how strong is the evidence we got", not "did we find something".
    const confidence = topWeight > 0 ? candidate.weight / topWeight : 0;
    const floor = spec.minConfidence ?? 0.6;
    const stale = confidence < floor;
    return {
      name: spec.name,
      found: true,
      confidence,
      strategy: candidate.strategy,
      value: candidate.value,
      failures,
      stale,
      detail: stale
        ? `Selector '${spec.name}' matched via ${candidate.strategy} at confidence ${confidence.toFixed(2)}, below the ${floor} floor; the page may have changed.`
        : `Selector '${spec.name}' matched via ${candidate.strategy} at confidence ${confidence.toFixed(2)}.`,
    };
  }

  return {
    name: spec.name,
    found: false,
    confidence: 0,
    strategy: null,
    value: null,
    failures,
    stale: false,
    detail: `Selector '${spec.name}' did not resolve any of its ${ordered.length} candidates.`,
  };
}

/**
 * A named set of specs, versioned so a stale profile is detectable.
 *
 * The version matters because a profile can be updated remotely from Pao-hubPro
 * local config. Without a version there is no way to tell a page-changing-again
 * apart from a profile-that-was-never-loaded.
 */
export interface SelectorProfile {
  readonly version: string;
  readonly updatedAt: string;
  readonly specs: Readonly<Record<string, SelectorSpec>>;
}

export function resolveProfile(
  profile: SelectorProfile,
  names: readonly string[],
  probe: (name: string, candidate: SelectorCandidate) => boolean,
): SelectorResolution[] {
  return names
    .map((name) => profile.specs[name])
    .filter((spec): spec is SelectorSpec => spec !== undefined)
    .map((spec) => resolveSelector(spec, (candidate) => probe(spec.name, candidate)));
}

/**
 * Aggregate selector health for the diagnostics page.
 *
 * Reported as counts and a rate rather than a pass/fail, because the useful signal
 * is a RATE: one selector falling back to a lower-weight strategy is a warning;
 * five doing it at once means the page changed.
 */
export interface SelectorHealthReport {
  readonly total: number;
  readonly resolved: number;
  readonly unresolved: number;
  readonly stale: number;
  readonly byStrategy: Readonly<Record<SelectorStrategy, number>>;
  readonly health: "healthy" | "degraded" | "stale";
  readonly detail: string;
}

export function summarizeSelectorHealth(resolutions: readonly SelectorResolution[]): SelectorHealthReport {
  const byStrategy: Record<SelectorStrategy, number> = { role: 0, aria: 0, text: 0, css: 0 };
  let resolved = 0;
  let unresolved = 0;
  let stale = 0;

  for (const resolution of resolutions) {
    if (resolution.found) {
      resolved += 1;
      if (resolution.strategy) byStrategy[resolution.strategy] += 1;
      if (resolution.stale) stale += 1;
    } else {
      unresolved += 1;
    }
  }

  const total = resolutions.length;
  let health: SelectorHealthReport["health"] = "healthy";
  let detail = "All selectors resolved on a high-confidence signal.";

  if (total > 0 && unresolved > 0) {
    health = "stale";
    detail = `${unresolved} of ${total} selectors did not resolve; the page likely changed.`;
  } else if (stale > 0) {
    health = "degraded";
    detail = `${stale} of ${total} selectors resolved below their confidence floor.`;
  }

  return { total, resolved, unresolved, stale, byStrategy, health, detail };
}

/**
 * The Grok selector profile.
 *
 * Every entry lists several independent signals. This is the file to edit when the
 * Grok UI changes, and it is the ONLY file that should need editing.
 */
export const GROK_SELECTOR_PROFILE: SelectorProfile = {
  version: "1.0.0",
  updatedAt: "2026-09-11",
  specs: {
    promptInput: {
      name: "promptInput",
      candidates: [
        { strategy: "role", value: "textbox", weight: DEFAULT_WEIGHTS.role },
        { strategy: "aria", value: "prompt", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "aria", value: "Ask anything", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "css", value: "textarea", weight: DEFAULT_WEIGHTS.css },
        { strategy: "css", value: "[contenteditable=true]", weight: DEFAULT_WEIGHTS.css },
      ],
    },
    submitButton: {
      name: "submitButton",
      candidates: [
        { strategy: "role", value: "button:submit", weight: DEFAULT_WEIGHTS.role },
        { strategy: "aria", value: "Submit", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "aria", value: "Send", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "text", value: "Generate", weight: DEFAULT_WEIGHTS.text },
        { strategy: "text", value: "Send", weight: DEFAULT_WEIGHTS.text },
      ],
    },
    uploadInput: {
      name: "uploadInput",
      candidates: [
        { strategy: "css", value: "input[type=file]", weight: DEFAULT_WEIGHTS.role },
        { strategy: "aria", value: "upload", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "text", value: "Attach", weight: DEFAULT_WEIGHTS.text },
      ],
    },
    resultCard: {
      name: "resultCard",
      candidates: [
        { strategy: "role", value: "img", weight: DEFAULT_WEIGHTS.role },
        { strategy: "css", value: "figure img", weight: DEFAULT_WEIGHTS.css },
        { strategy: "css", value: "[data-testid*=result]", weight: DEFAULT_WEIGHTS.css },
      ],
      // Output detection is genuinely the weakest signal on a generative page:
      // media elements are reused for avatars and icons, so a low floor here would
      // report a completed generation that never happened.
      minConfidence: 0.75,
    },
    generatingIndicator: {
      name: "generatingIndicator",
      candidates: [
        { strategy: "role", value: "progressbar", weight: DEFAULT_WEIGHTS.role },
        { strategy: "aria", value: "Generating", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "text", value: "Generating", weight: DEFAULT_WEIGHTS.text },
        { strategy: "css", value: "[class*=shimmer]", weight: DEFAULT_WEIGHTS.css },
      ],
    },
    sessionExpired: {
      name: "sessionExpired",
      candidates: [
        { strategy: "text", value: "Sign in", weight: DEFAULT_WEIGHTS.text },
        { strategy: "text", value: "Log in", weight: DEFAULT_WEIGHTS.text },
        { strategy: "css", value: "[data-testid*=login]", weight: DEFAULT_WEIGHTS.css },
      ],
    },
    captcha: {
      name: "captcha",
      candidates: [
        { strategy: "css", value: "iframe[src*=captcha]", weight: DEFAULT_WEIGHTS.role },
        { strategy: "css", value: "[class*=captcha]", weight: DEFAULT_WEIGHTS.aria },
        { strategy: "text", value: "verify you are human", weight: DEFAULT_WEIGHTS.text },
      ],
    },
    rateLimited: {
      name: "rateLimited",
      candidates: [
        { strategy: "text", value: "rate limit", weight: DEFAULT_WEIGHTS.text },
        { strategy: "text", value: "too many requests", weight: DEFAULT_WEIGHTS.text },
        { strategy: "text", value: "try again later", weight: DEFAULT_WEIGHTS.text },
      ],
    },
  },
};

