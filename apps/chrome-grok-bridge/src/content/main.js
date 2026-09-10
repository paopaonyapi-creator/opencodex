// Pao Grok Bridge — content script entry point.
//
// THE SAFETY RULE THIS FILE ENFORCES: a prompt is verified BEFORE submit, and if
// verification fails the job does not proceed. Typing into a contenteditable field
// is not reliable — a framework can reformat, truncate, or partially reject the
// text — and submitting unverified text would generate something the operator never
// asked for while reporting success.
//
// The script also never bypasses a human gate. A CAPTCHA, a login wall, or a rate
// limit ends the job as `blocked` and asks for a person. It has no code path that
// could clear one, which is the strongest form of that guarantee.

(function () {
  "use strict";

  const PROTOCOL = "pao-grok-bridge/1";

  let currentJob = null;
  let observer = null;

  /**
   * Normalize text for comparison.
   *
   * A rich text field will reflow whitespace, so an exact string compare would fail
   * on a correct injection and block every job. Collapsing whitespace is the
   * narrowest normalization that still catches a truncation or a substitution.
   */
  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function readValue(element) {
    if (!element) return "";
    if ("value" in element && typeof element.value === "string") return element.value;
    return element.textContent || "";
  }

  function setValue(element, text) {
    element.focus();
    if ("value" in element && typeof element.value === "string") {
      // A raw value assignment does not notify a framework, so the input events are
      // dispatched explicitly. Without them the page's own state stays empty and the
      // submit button remains disabled.
      element.value = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    // contenteditable path: select-all then insert, which is what a paste does and
    // therefore what the page's handlers already expect.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    }
  }

  /**
   * Inject the prompt and verify it landed intact.
   *
   * Returns a typed outcome rather than throwing, so the caller can distinguish
   * "no prompt field" from "the field rejected our text" — two different problems
   * with two different fixes.
   */
  function injectPrompt(prompt) {
    const detector = window.PaoGrokDetector;
    const selectors = window.PaoGrokSelectors;
    const resolution = selectors.resolve(detector.PROFILE.specs.promptInput);

    if (!resolution.found) {
      return { ok: false, code: "GROK_PROMPT_INPUT_NOT_FOUND", detail: "No prompt field matched any candidate." };
    }
    if (resolution.stale) {
      // A low-confidence match is reported rather than used. Submitting into a field
      // matched only by a weak signal is how a job types into the wrong control.
      return {
        ok: false,
        code: "GROK_SELECTOR_STALE",
        detail: `Prompt field matched only via ${resolution.strategy} at confidence ${resolution.confidence.toFixed(2)}.`
      };
    }

    setValue(resolution.element, prompt);

    // Verification is a separate step on purpose: it reads back what the PAGE has,
    // not what we intended to write.
    const actual = normalize(readValue(resolution.element));
    const expected = normalize(prompt);
    if (actual !== expected) {
      return {
        ok: false,
        code: "GROK_PROMPT_VERIFY_FAILED",
        detail: `Expected ${expected.length} characters, the field holds ${actual.length}.`
      };
    }

    return { ok: true, detail: "Prompt injected and verified.", confidence: resolution.confidence };
  }

  function submit() {
    const detector = window.PaoGrokDetector;
    const selectors = window.PaoGrokSelectors;
    const resolution = selectors.resolve(detector.PROFILE.specs.submitButton);
    if (!resolution.found) {
      return { ok: false, code: "GROK_SELECTOR_STALE", detail: "No submit button matched any candidate." };
    }
    if (resolution.element.disabled) {
      return { ok: false, code: "GROK_PROMPT_VERIFY_FAILED", detail: "The submit button is disabled; the page did not accept the prompt." };
    }
    resolution.element.click();
    return { ok: true, detail: "Generation submitted." };
  }

  function report(message) {
    try {
      chrome.runtime.sendMessage({ protocol: PROTOCOL, ...message });
    } catch (error) {
      // The extension context can be invalidated by a reload. Losing one report is
      // survivable; throwing here would break the page's own scripts.
    }
  }

  function runJob(job) {
    currentJob = job;
    const detector = window.PaoGrokDetector;
    const pageType = detector.detect();

    if (pageType === "login-required" || pageType === "rate-limited") {
      report({
        type: "generation.error",
        jobId: job.id,
        errorCode: pageType === "rate-limited" ? "GROK_RATE_LIMITED" : "GROK_SESSION_REQUIRED",
        errorMessage: `Cannot start: the page is in state '${pageType}'.`
      });
      return;
    }
    if (pageType === "unsupported" || pageType === "unknown") {
      report({
        type: "generation.error",
        jobId: job.id,
        errorCode: "GROK_UNSUPPORTED_PAGE",
        errorMessage: `The page type '${pageType}' is not a Grok generation surface.`
      });
      return;
    }

    report({ type: "generation.state", jobId: job.id, state: "preparing" });

    const injection = injectPrompt(job.prompt);
    if (!injection.ok) {
      report({ type: "generation.error", jobId: job.id, errorCode: injection.code, errorMessage: injection.detail });
      return;
    }
    report({ type: "generation.state", jobId: job.id, state: "prompting" });

    // Manual mode stops here: the prompt is prepared and verified, and a human
    // presses Generate. That is the difference between preparing and acting.
    if (job.executionMode === "manual") {
      report({
        type: "generation.state",
        jobId: job.id,
        state: "waiting_user",
        errorMessage: "Manual mode: the prompt is ready; press Generate in Grok."
      });
      return;
    }

    const submitted = submit();
    if (!submitted.ok) {
      report({ type: "generation.error", jobId: job.id, errorCode: submitted.code, errorMessage: submitted.detail });
      return;
    }

    observer = new window.PaoGrokObserver.GenerationObserver({
      onState: (event) => {
        if (event.errorCode) {
          report({ type: "generation.error", jobId: job.id, errorCode: event.errorCode, errorMessage: event.errorMessage || "" });
        } else {
          report({ type: "generation.state", jobId: job.id, state: event.state });
        }
      },
      onResult: (event) => {
        report({ type: "generation.result", jobId: job.id, result: event });
      }
    });
    observer.start();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.protocol !== PROTOCOL) return false;
    if (message.type === "job.start") {
      runJob(message.job);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "job.cancel") {
      if (observer) observer.stop();
      observer = null;
      currentJob = null;
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "diagnostics.run") {
      const detector = window.PaoGrokDetector;
      const selectors = window.PaoGrokSelectors;
      const names = Object.keys(detector.PROFILE.specs);
      const results = names.map((name) => {
        const resolution = selectors.resolve(detector.PROFILE.specs[name]);
        return {
          name,
          found: resolution.found,
          confidence: resolution.confidence,
          strategy: resolution.strategy,
          stale: resolution.stale
        };
      });
      sendResponse({
        ok: true,
        pageType: detector.detect(),
        profileVersion: detector.PROFILE.version,
        selectors: results
      });
      return true;
    }
    return false;
  });

  // Announce this tab so the service worker can pick it up without a round trip.
  report({ type: "browser.page", pageType: window.PaoGrokDetector.detect(), url: window.location.href });
})();
