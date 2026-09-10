// Pao Grok Bridge — page detector (content script).
//
// Mirrors src/agent-os/browser-provider/page-detector.ts. The bridge re-runs the same
// detection on the heartbeats the extension sends, so the extension supplies
// OBSERVATIONS and the bridge owns the INTERPRETATION. Keeping one authority means a
// detection change cannot take effect in one place and not the other.

(function () {
  "use strict";

  const PROFILE = {
    version: "1.0.0",
    specs: {
      promptInput: {
        name: "promptInput",
        candidates: [
          { strategy: "role", value: "textbox", weight: 100 },
          { strategy: "aria", value: "prompt", weight: 95 },
          { strategy: "aria", value: "Ask anything", weight: 95 },
          { strategy: "css", value: "textarea", weight: 55 },
          { strategy: "css", value: "[contenteditable=true]", weight: 55 }
        ]
      },
      submitButton: {
        name: "submitButton",
        candidates: [
          { strategy: "role", value: "button:submit", weight: 100 },
          { strategy: "aria", value: "Submit", weight: 95 },
          { strategy: "aria", value: "Send", weight: 95 },
          { strategy: "text", value: "Generate", weight: 80 },
          { strategy: "text", value: "Send", weight: 80 }
        ]
      },
      uploadInput: {
        name: "uploadInput",
        candidates: [
          { strategy: "css", value: "input[type=file]", weight: 100 },
          { strategy: "aria", value: "upload", weight: 95 },
          { strategy: "text", value: "Attach", weight: 80 }
        ]
      },
      resultCard: {
        name: "resultCard",
        candidates: [
          { strategy: "role", value: "img", weight: 100 },
          { strategy: "css", value: "figure img", weight: 55 },
          { strategy: "css", value: "[data-testid*=result]", weight: 55 }
        ],
        // Output detection is the weakest signal on a generative page: media
        // elements are reused for avatars and icons, so a low floor here reports a
        // completed generation that never happened.
        minConfidence: 0.75
      },
      generatingIndicator: {
        name: "generatingIndicator",
        candidates: [
          { strategy: "role", value: "progressbar", weight: 100 },
          { strategy: "aria", value: "Generating", weight: 95 },
          { strategy: "text", value: "Generating", weight: 80 },
          { strategy: "css", value: "[class*=shimmer]", weight: 55 }
        ]
      },
      sessionExpired: {
        name: "sessionExpired",
        candidates: [
          { strategy: "text", value: "Sign in", weight: 80 },
          { strategy: "text", value: "Log in", weight: 80 },
          { strategy: "css", value: "[data-testid*=login]", weight: 55 }
        ]
      },
      captcha: {
        name: "captcha",
        candidates: [
          { strategy: "css", value: "iframe[src*=captcha]", weight: 100 },
          { strategy: "css", value: "[class*=captcha]", weight: 95 },
          { strategy: "text", value: "verify you are human", weight: 80 }
        ]
      },
      rateLimited: {
        name: "rateLimited",
        candidates: [
          { strategy: "text", value: "rate limit", weight: 80 },
          { strategy: "text", value: "too many requests", weight: 80 },
          { strategy: "text", value: "try again later", weight: 80 }
        ]
      }
    }
  };

  /**
   * Collect the signal bundle the bridge's detector expects.
   *
   * Visible text is capped: a generative page can hold an enormous transcript, and
   * shipping all of it on every heartbeat would be wasteful for a decision that
   * only ever looks for a handful of phrases.
   */
  function collectSignals() {
    const visibleText = (document.body ? document.body.innerText || "" : "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 200)
      .slice(0, 200);

    const ariaLabels = Array.from(document.querySelectorAll("[aria-label]"))
      .map((node) => node.getAttribute("aria-label") || "")
      .filter((label) => label.length > 0)
      .slice(0, 200);

    const roles = Array.from(document.querySelectorAll("[role]"))
      .map((node) => node.getAttribute("role") || "")
      .filter((role) => role.length > 0)
      .slice(0, 200);

    return {
      url: window.location.href,
      visibleText,
      ariaLabels,
      roles,
      title: document.title || ""
    };
  }

  function detect() {
    const signals = collectSignals();
    const url = signals.url.toLowerCase();
    const allText = signals.visibleText.concat(signals.ariaLabels);
    const hasAny = (needle) => allText.some((entry) => entry.toLowerCase().includes(needle));

    // Blocking states first. A page that is both rate-limited and on a projects URL
    // must report rate-limited, because submitting into it fails and reporting the
    // URL would make the detector confidently wrong.
    if (hasAny("verify you are human") || hasAny("captcha")) return "login-required";
    if (hasAny("rate limit") || hasAny("too many requests") || hasAny("try again later")) return "rate-limited";
    if (hasAny("sign in") || hasAny("log in") || url.includes("/login")) return "login-required";

    if (signals.roles.includes("progressbar") || hasAny("generating") || hasAny("creating")) return "grok-generation";
    if (url.includes("/projects") || allText.some((t) => t.toLowerCase().includes("projects"))) return "grok-projects";
    if (url.includes("imagine") || allText.some((t) => t.toLowerCase().includes("imagine"))) return "grok-imagine";
    if (signals.roles.includes("textbox") && (url.includes("grok") || (document.title || "").toLowerCase().includes("grok"))) {
      return "grok-home";
    }
    if (!url.includes("grok")) return "unsupported";
    return "unknown";
  }

  window.PaoGrokDetector = { PROFILE, detect, collectSignals };
})();
