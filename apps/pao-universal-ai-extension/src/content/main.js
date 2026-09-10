// Pao Universal AI Extension — content script entry point.
//
// MIGRATION NOTE. Phase 20.18 had a Grok-only main.js that called a Grok detector and filled
// a Grok prompt field directly. This version keeps the same safety rules and reaches them
// through the universal path: detect the adapter, check for a gate, execute the plan. The
// rules that survive unchanged are the ones that were never Grok-specific — verify the prompt
// by read-back before submit, stop on any human gate, and refuse to act when the adapter is
// ambiguous.

(function () {
  'use strict';

  const PROTOCOL = 'pao-browser-bridge/2';
  let currentJob = null;
  let observer = null;

  function collectSignals() {
    const visibleText = (document.body ? document.body.innerText || '' : '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 200)
      .slice(0, 200);
    const ariaLabels = Array.from(document.querySelectorAll('[aria-label]'))
      .map((node) => node.getAttribute('aria-label') || '')
      .filter((label) => label.length > 0)
      .slice(0, 200);
    const roles = Array.from(document.querySelectorAll('[role]'))
      .map((node) => node.getAttribute('role') || '')
      .filter((role) => role.length > 0)
      .slice(0, 200);
    return {
      url: window.location.href,
      host: window.location.hostname,
      title: document.title || '',
      documentState: document.readyState,
      visibleText: visibleText,
      ariaLabels: ariaLabels,
      roles: roles,
    };
  }

  function detectPage() {
    return window.PaoUniversal.detect(collectSignals());
  }

  function report(message) {
    try {
      chrome.runtime.sendMessage({ protocol: PROTOCOL, ...message });
    } catch (error) {
      // The extension context can be invalidated by a reload. Losing one report is
      // survivable; throwing here would break the page own scripts.
    }
  }

  /**
   * Map a gate onto the legacy error code where one exists, so a job created under the
   * Phase 20.18 naming keeps its error identity.
   */
  function gateCode(gate) {
    if (gate === 'login_required') return 'GROK_SESSION_REQUIRED';
    if (gate === 'rate_limited') return 'GROK_RATE_LIMITED';
    return 'GROK_USER_ACTION_REQUIRED';
  }

  /**
   * Run a job through the universal path.
   *
   * The order is fixed and each step can stop the job: detect, check for a gate, execute the
   * plan. Detection is first because everything downstream depends on which adapter owns this
   * page, and a wrong answer there makes the rest confidently wrong.
   */
  async function runJob(job) {
    currentJob = job;
    const detection = detectPage();

    if (detection.ambiguous) {
      report({ type: 'generation.error', jobId: job.id, errorCode: 'GROK_USER_ACTION_REQUIRED', errorMessage: detection.detail });
      return;
    }
    if (!detection.adapterId) {
      report({ type: 'generation.error', jobId: job.id, errorCode: 'GROK_TAB_NOT_FOUND', errorMessage: detection.detail });
      return;
    }
    if (detection.pageType === 'unsupported' || detection.pageType === 'unknown') {
      report({ type: 'generation.error', jobId: job.id, errorCode: 'GROK_UNSUPPORTED_PAGE', errorMessage: detection.detail });
      return;
    }

    const adapter = window.PaoUniversal.getAdapter(detection.adapterId);
    if (!adapter) {
      report({ type: 'generation.error', jobId: job.id, errorCode: 'GROK_UNSUPPORTED_PAGE', errorMessage: 'Adapter not registered.' });
      return;
    }

    // A gate is checked before anything is typed. Typing into a page showing a CAPTCHA would
    // be acting on a page that is asking for a person.
    const gate = adapter.detectGate(collectSignals());
    if (gate.gate) {
      report({
        type: 'generation.error',
        jobId: job.id,
        errorCode: gateCode(gate.gate),
        errorMessage: 'The page requires a person: ' + gate.gate + '.',
        gate: gate.gate,
      });
      return;
    }

    report({ type: 'generation.state', jobId: job.id, state: 'preparing' });

    const plan = job.plan || [];
    for (const action of plan) {
      const result = await window.PaoActionExecutor.execute(action, {
        adapterId: detection.adapterId,
        dryRun: Boolean(job.dryRun),
        timeoutMs: job.timeoutMs,
      });
      if (!result.ok) {
        report({ type: 'generation.error', jobId: job.id, errorCode: result.code, errorMessage: result.detail });
        return;
      }
      if (result.media && result.media.length > 0) {
        report({ type: 'generation.result', jobId: job.id, result: { media: result.media, confidence: result.confidence } });
      }
      if (result.text) {
        report({ type: 'generation.result', jobId: job.id, result: { text: result.text, confidence: result.confidence } });
      }
      if (action.type === 'set_text') {
        report({ type: 'generation.state', jobId: job.id, state: 'prompting' });
      }
      if (action.type === 'click' && action.target === 'submitButton') {
        report({ type: 'generation.state', jobId: job.id, state: 'generating' });
        startObserver(job, adapter);
      }
    }
  }

  /**
   * Watch for a blocking state while a generation runs.
   *
   * Event-driven rather than a polling loop, per the phase requirement, with a slow timer as
   * a backstop for conditions that produce no mutation.
   */
  function startObserver(job, adapter) {
    if (observer) observer.disconnect();
    let lastGate = null;
    const check = () => {
      const gate = adapter.detectGate(collectSignals());
      if (gate.gate && gate.gate !== lastGate) {
        lastGate = gate.gate;
        report({
          type: 'generation.error',
          jobId: job.id,
          errorCode: gateCode(gate.gate),
          errorMessage: 'The page entered a blocked state: ' + gate.gate + '.',
          gate: gate.gate,
        });
      }
    };
    observer = new MutationObserver(() => check());
    observer.observe(document.body, { childList: true, subtree: true });
    const backstop = setInterval(check, 3000);
    setTimeout(() => {
      if (observer) observer.disconnect();
      observer = null;
      clearInterval(backstop);
    }, job.timeoutMs || 600000);
  }

  function describeTargets(adapterId, adapter) {
    return adapter.targets.map((target) => {
      const resolved = window.PaoActionExecutor.resolveTarget(adapterId, target);
      return {
        target: target,
        found: resolved.found,
        confidence: resolved.confidence,
        strategy: resolved.strategy,
        stale: resolved.stale,
      };
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.protocol !== PROTOCOL) return false;

    if (message.type === 'job.start') {
      runJob(message.job);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'job.cancel') {
      if (observer) observer.disconnect();
      observer = null;
      currentJob = null;
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'job.dryRun' || message.type === 'diagnostics.run') {
      const detection = detectPage();
      const adapter = detection.adapterId ? window.PaoUniversal.getAdapter(detection.adapterId) : null;
      const gate = adapter ? adapter.detectGate(collectSignals()) : { gate: null, evidence: [] };
      sendResponse({
        ok: true,
        detection: detection,
        gate: gate.gate,
        targets: adapter ? describeTargets(detection.adapterId, adapter) : [],
        adapterVersion: adapter ? adapter.manifest.version : null,
        url: window.location.href,
        title: document.title || '',
      });
      return true;
    }

    if (message.type === 'adapter.list') {
      sendResponse({ ok: true, adapters: window.PaoUniversal.listManifests() });
      return true;
    }

    return false;
  });

  // Announce this tab so the service worker can bind it without a round trip.
  report({ type: 'browser.page', detection: detectPage(), url: window.location.href });
})();
