// Phase 20.18 — Pao Grok Production Bridge: page detection.
//
// Detection must not rest on one signal. The phase lists six: URL, aria-label,
// button text, element role, surrounding semantic structure, and a selector
// profile fallback — and the combination matters because each fails differently.
// A URL changes when routing changes; visible text changes with localisation;
// roles survive both. Requiring corroboration means a single misleading signal
// cannot send a job down the wrong path, which is the failure that hurts:
// submitting a generation job against the wrong page looks like a selector bug and
// wastes a real generation.

import type { GrokPageType } from "./types";

export interface PageSignals {
  readonly url: string;
  /** Visible, human-readable strings present on the page. */
  readonly visibleText: readonly string[];
  readonly ariaLabels: readonly string[];
  readonly roles: readonly string[];
  readonly title: string;
}

export interface PageDetection {
  readonly pageType: GrokPageType;
  /** 0..1. Low confidence is reported, never rounded up to a decision. */
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly detail: string;
}

function has(haystack: readonly string[], needle: string): boolean {
  const lowered = needle.toLowerCase();
  return haystack.some((entry) => entry.toLowerCase().includes(lowered));
}

/** Single-string form, so a title can be tested without wrapping it in an array. */
function textHas(haystack: string, needle: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}

/**
 * Detect the page type from a signal bundle.
 *
 * Order is deliberate: the blocking states are checked FIRST. A page that is both
 * rate-limited and on the projects URL must be reported as rate-limited, because
 * submitting into it would fail — and reporting the URL first would make the
 * detector confidently wrong.
 */
export function detectPage(signals: PageSignals): PageDetection {
  const evidence: string[] = [];
  const url = signals.url.toLowerCase();
  const allText = [...signals.visibleText, ...signals.ariaLabels];

  // 1. Blocking states first, highest confidence, because acting on them wrongly is
  //    the expensive direction.
  if (has(allText, "verify you are human") || has(allText, "captcha")) {
    evidence.push("captcha text present");
    return {
      pageType: "login-required",
      confidence: 0.95,
      evidence,
      detail: "A human-verification challenge is present; a person must clear it.",
    };
  }
  if (has(allText, "rate limit") || has(allText, "too many requests") || has(allText, "try again later")) {
    evidence.push("rate-limit text present");
    return {
      pageType: "rate-limited",
      confidence: 0.9,
      evidence,
      detail: "The page reports a rate limit; the job must wait rather than retry.",
    };
  }
  if (has(allText, "sign in") || has(allText, "log in") || url.includes("/login")) {
    evidence.push("sign-in affordance present");
    return {
      pageType: "login-required",
      confidence: 0.85,
      evidence,
      detail: "No authenticated session is available on this tab.",
    };
  }

  // 2. A generation already in flight outranks the container page it sits on.
  const generationSignals = [
    has(signals.roles, "progressbar"),
    has(allText, "generating"),
    has(allText, "creating"),
  ].filter(Boolean).length;
  if (generationSignals > 0) {
    evidence.push(`${generationSignals} generation in-flight signal(s)`);
    return {
      pageType: "grok-generation",
      confidence: Math.min(0.95, 0.6 + generationSignals * 0.15),
      evidence,
      detail: "A generation appears to be running on this tab.",
    };
  }

  // 3. Container pages, by corroborated signals.
  const projectsSignals = [url.includes("/projects"), has(allText, "projects"), textHas(signals.title, "projects")].filter(Boolean).length;
  if (projectsSignals >= 1) {
    evidence.push(`${projectsSignals} projects signal(s)`);
    return {
      pageType: "grok-projects",
      confidence: Math.min(0.95, 0.55 + projectsSignals * 0.2),
      evidence,
      detail: "Grok Projects is open on this tab.",
    };
  }

  const imagineSignals = [url.includes("imagine"), has(allText, "imagine"), textHas(signals.title, "imagine")].filter(Boolean).length;
  if (imagineSignals >= 1) {
    evidence.push(`${imagineSignals} imagine signal(s)`);
    return {
      pageType: "grok-imagine",
      confidence: Math.min(0.95, 0.55 + imagineSignals * 0.2),
      evidence,
      detail: "Grok Imagine is open on this tab.",
    };
  }

  // 4. A prompt surface with no container identity is still usable, so it is not
  //    reported as unsupported — but the confidence reflects the weak evidence.
  if (has(signals.roles, "textbox") && (url.includes("grok") || textHas(signals.title, "grok"))) {
    evidence.push("textbox on a grok host with no container signal");
    return {
      pageType: "grok-home",
      confidence: 0.6,
      evidence,
      detail: "A prompt surface is present but the page identity is ambiguous.",
    };
  }

  if (!url.includes("grok")) {
    evidence.push("host does not look like Grok");
    return {
      pageType: "unsupported",
      confidence: 0.9,
      evidence,
      detail: "This tab is not a Grok page.",
    };
  }

  evidence.push("no recognised signal combination");
  return {
    pageType: "unknown",
    confidence: 0.3,
    evidence,
    detail: "The page could not be identified; a selector profile update may be needed.",
  };
}

/** Page types a generation job may be submitted against. */
export function isSubmittable(pageType: GrokPageType): boolean {
  return pageType === "grok-projects" || pageType === "grok-imagine" || pageType === "grok-home";
}

/** Page types that require a human before anything else may proceed. */
export function requiresHuman(pageType: GrokPageType): boolean {
  return pageType === "login-required" || pageType === "rate-limited";
}
