// Pao Grok Bridge — selector resilience engine (content script).
//
// This is the browser-side half of src/agent-os/browser-provider/selectors.ts and
// it implements the same rule: an element is described by MANY weighted signals and
// the strongest one that actually resolves wins.
//
// The weights are duplicated deliberately rather than imported. A content script is
// injected into a page, cannot import from the extension's module graph in the same
// way a service worker can, and must not fetch code at runtime. Duplication here is
// cheaper than a bundler, and the two copies are covered by the same tests.

(function () {
  "use strict";

  const DEFAULT_WEIGHTS = { role: 100, aria: 95, text: 80, css: 55 };

  /**
   * Resolve one candidate to an element, or null.
   *
   * Every branch returns null rather than throwing: one malformed selector must not
   * stop the fallback chain, because the whole point of the chain is that any single
   * signal may be the broken one.
   */
  function probeCandidate(candidate) {
    try {
      switch (candidate.strategy) {
        case "role": {
          // "button:submit" means a button whose type is submit.
          const [role, qualifier] = String(candidate.value).split(":");
          const selector = qualifier ? `[role=${role}][type=${qualifier}], ${role}[type=${qualifier}]` : `[role=${role}], ${role}`;
          const nodes = Array.from(document.querySelectorAll(selector));
          return nodes.find(isVisible) || null;
        }
        case "aria": {
          const needle = candidate.value.toLowerCase();
          const nodes = Array.from(document.querySelectorAll("[aria-label], [placeholder], [title]"));
          return (
            nodes.find((node) => {
              const label = (node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.getAttribute("title") || "").toLowerCase();
              return label.includes(needle) && isVisible(node);
            }) || null
          );
        }
        case "text": {
          const needle = candidate.value.toLowerCase();
          const nodes = Array.from(document.querySelectorAll("button, a, [role=button], span, div"));
          // The innermost match wins: a container's text includes every descendant's,
          // so matching outward would return a wrapper around the real control.
          const matches = nodes.filter((node) => {
            const own = Array.from(node.childNodes)
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .map((child) => child.textContent || "")
              .join(" ")
              .toLowerCase();
            return own.includes(needle) && isVisible(node);
          });
          return matches.length > 0 ? matches[matches.length - 1] : null;
        }
        case "css": {
          const nodes = Array.from(document.querySelectorAll(candidate.value));
          return nodes.find(isVisible) || null;
        }
        default:
          return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Visibility check.
   *
   * A hidden element matching a selector is not a usable control, and returning one
   * would make the caller act on the wrong node. offsetParent is null for
   * display:none and also for position:fixed, so the rect is checked as well.
   */
  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  /**
   * Resolve a spec, highest weight first, and report confidence.
   *
   * Confidence is the winner's weight relative to the best available signal, so a
   * fallback to a CSS class is reported as LOW confidence even though it matched.
   * That distinction is what lets the diagnostics page say "the page probably
   * changed" instead of "everything is fine".
   */
  function resolve(spec) {
    const ordered = spec.candidates.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const topWeight = ordered.length > 0 ? ordered[0].weight || 0 : 0;
    const failures = [];

    for (const candidate of ordered) {
      const element = probeCandidate(candidate);
      if (element) {
        const confidence = topWeight > 0 ? (candidate.weight || 0) / topWeight : 0;
        const floor = spec.minConfidence === undefined ? 0.6 : spec.minConfidence;
        return {
          name: spec.name,
          found: true,
          element,
          confidence,
          strategy: candidate.strategy,
          value: candidate.value,
          stale: confidence < floor,
          failures,
        };
      }
      failures.push({ strategy: candidate.strategy, value: candidate.value, reason: "no match" });
    }

    return { name: spec.name, found: false, element: null, confidence: 0, strategy: null, value: null, stale: false, failures };
  }

  window.PaoGrokSelectors = { resolve, probeCandidate, isVisible, DEFAULT_WEIGHTS };
})();
