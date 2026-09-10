// Pao Grok Bridge — generation observer (content script).
//
// Event-driven via MutationObserver, per the phase specification. The spec forbids
// polling the DOM every 100ms, and the reason is not only efficiency: a poll samples
// the page at arbitrary moments and can MISS a transient state entirely, whereas an
// observer sees every mutation.
//
// The observer is deliberately quiet. It classifies the page on mutation but emits
// only on a CHANGE of classification, so a busy page does not produce a stream of
// identical events.

(function () {
  "use strict";

  const QUIET_MS = 400;

  class GenerationObserver {
    constructor(options) {
      this.onState = options.onState;
      this.onResult = options.onResult;
      this.timeoutMs = options.timeoutMs || 600000;
      this.lastState = null;
      this.observer = null;
      this.debounceTimer = null;
      this.timeoutTimer = null;
      this.startedAt = null;
      this.resultSeen = false;
    }

    start() {
      if (this.observer) return;
      this.startedAt = Date.now();
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "role", "class", "src"]
      });
      // The timeout is the backstop for a generation that never resolves. It is
      // generous because a real video generation is slow, and a premature timeout
      // would mark a succeeding job as failed.
      this.timeoutTimer = setTimeout(() => {
        this.onState({ state: "failed", errorCode: "GROK_GENERATION_TIMEOUT", errorMessage: `No completion within ${this.timeoutMs}ms.` });
        this.stop();
      }, this.timeoutMs);
      this.evaluate();
    }

    stop() {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
      this.debounceTimer = null;
      this.timeoutTimer = null;
    }

    schedule() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.evaluate(), QUIET_MS);
    }

    evaluate() {
      const detector = window.PaoGrokDetector;
      const selectors = window.PaoGrokSelectors;
      if (!detector || !selectors) return;

      const pageType = detector.detect();

      // A blocking state ends observation immediately: there is nothing to wait for
      // and continuing would eventually fire the timeout as a FALSE failure.
      if (pageType === "login-required" || pageType === "rate-limited") {
        this.onState({
          state: "blocked",
          errorCode: pageType === "rate-limited" ? "GROK_RATE_LIMITED" : "GROK_SESSION_REQUIRED",
          errorMessage: `The page entered state '${pageType}'; a person must resolve it.`
        });
        this.stop();
        return;
      }

      const generating = selectors.resolve(detector.PROFILE.specs.generatingIndicator);
      if (generating.found) {
        this.emit("generating");
        return;
      }

      const result = selectors.resolve(detector.PROFILE.specs.resultCard);
      if (result.found && !result.stale) {
        this.emit("collecting");
        if (!this.resultSeen) {
          this.resultSeen = true;
          this.onResult({
            sourceUrl: result.element && result.element.src ? result.element.src : null,
            width: result.element && result.element.naturalWidth ? result.element.naturalWidth : null,
            height: result.element && result.element.naturalHeight ? result.element.naturalHeight : null,
            strategy: result.strategy,
            confidence: result.confidence
          });
        }
        return;
      }

      // Nothing generating and no result: the page is idle, which means the submit
      // either has not taken effect or the output was already cleared.
      this.emit("preparing");
    }

    emit(state) {
      if (this.lastState === state) return;
      this.lastState = state;
      this.onState({ state });
    }
  }

  window.PaoGrokObserver = { GenerationObserver };
})();
