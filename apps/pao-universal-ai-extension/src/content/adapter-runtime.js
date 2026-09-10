// Pao Universal AI Extension — content-script adapter runtime.
//
// WHY THE ADAPTERS LIVE IN THE CONTENT SCRIPT AND NOT IN THE SERVICE WORKER. An adapter
// describes how to read and drive a page, and only the content script has the page. The
// worker orchestrates, the content script implements. Splitting it the other way would mean
// the worker holding page knowledge it can never verify.
//
// THE ADAPTER BOUNDARY IS THE SAME AS THE TYPESCRIPT ONE. An adapter is a manifest, a page
// scorer, a gate detector, and a selector-target list. It never receives `document`, never
// calls a chrome API, and never executes a string. The runtime below is the only thing that
// touches the DOM, and it does so through typed intents.

(function () {
  'use strict';

  const AMBIGUITY_MARGIN = 0.15;

  /**
   * Score conversion shared by every adapter.
   *
   * A single signal is weak evidence, several independent ones are strong, and the curve
   * reflects that: a floor of 0.55 for one hit, rising with corroboration. Hard-coding a
   * ceiling below 1.0 is deliberate — a heuristic scorer should never claim certainty.
   */
  function scoreFromSignals(hits) {
    if (hits <= 0) return 0;
    return Math.min(0.98, 0.55 + (hits - 1) * 0.15);
  }

  function hasAny(haystack, needle) {
    const lowered = needle.toLowerCase();
    return haystack.some((entry) => String(entry).toLowerCase().includes(lowered));
  }

  function textHas(haystack, needle) {
    return String(haystack || '').toLowerCase().includes(needle.toLowerCase());
  }

  /**
   * Gates shared by every adapter, hardest first.
   *
   * Order matters because a page can present two at once, and the reported cause is what the
   * operator acts on. All of them block; the sequence only decides which one is named.
   */
  function detectCommonGates(context) {
    const all = context.visibleText.concat(context.ariaLabels);
    const checks = [
      { gate: 'captcha', hits: ['verify you are human', 'captcha', 'recaptcha'] },
      { gate: 'rate_limited', hits: ['rate limit', 'too many requests', 'try again later'] },
      { gate: 'subscription_upgrade', hits: ['upgrade to', 'subscribe to continue', 'plus plan'] },
      { gate: 'payment_required', hits: ['add a payment method', 'update your billing'] },
      { gate: 'account_verification', hits: ['verify your account', 'confirm your identity'] },
      { gate: 'terms_confirmation', hits: ['accept the terms', 'agree to the terms'] },
      { gate: 'publish_or_delete_confirm', hits: ['delete conversation', 'delete permanently'] },
      { gate: 'login_required', hits: ['sign in', 'log in'] },
    ];
    for (const check of checks) {
      if (hasAny(all, check.hits[0])) {
        return { gate: check.gate, evidence: [check.hits[0] + ' matched'] };
      }
    }
    if (String(context.url).toLowerCase().includes('/login')) {
      return { gate: 'login_required', evidence: ['login url'] };
    }
    return { gate: null, evidence: [] };
  }

  // --- Adapters ---------------------------------------------------------

  const GROK = {
    manifest: {
      id: 'grok',
      name: 'Grok Projects / Imagine',
      version: '1.1.0',
      hosts: ['grok.com', '*.grok.com'],
      executionModes: ['manual', 'assisted', 'automatic'],
      liveVerified: false,
    },
    targets: ['promptInput', 'submitButton', 'uploadInput', 'resultCard', 'generatingIndicator'],
    score: function (context) {
      const evidence = [];
      const url = String(context.url).toLowerCase();
      const all = context.visibleText.concat(context.ariaLabels);
      let hits = 0;
      if (context.roles.includes('progressbar') || hasAny(all, 'generating')) {
        return { score: 0.9, pageType: 'generation', evidence: ['generation in flight'] };
      }
      if (url.includes('/projects') || hasAny(all, 'projects')) { hits += 2; evidence.push('projects surface'); }
      if (url.includes('imagine') || hasAny(all, 'imagine')) { hits += 2; evidence.push('imagine surface'); }
      if (context.roles.includes('textbox')) { hits += 1; evidence.push('prompt textbox'); }
      if (textHas(context.title, 'grok')) { hits += 1; evidence.push('title mentions grok'); }
      if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no grok signal'] };
      const pageType = url.includes('/projects') ? 'projects' : url.includes('imagine') ? 'imagine' : 'home';
      return { score: scoreFromSignals(hits), pageType, evidence };
    },
    detectGate: detectCommonGates,
  };

  const CHATGPT = {
    manifest: {
      id: 'chatgpt',
      name: 'ChatGPT',
      version: '0.1.0',
      hosts: ['chatgpt.com', '*.chatgpt.com', 'chat.openai.com'],
      executionModes: ['manual', 'assisted'],
      liveVerified: false,
    },
    targets: ['promptInput', 'submitButton', 'resultCard', 'stopButton'],
    score: function (context) {
      const evidence = [];
      const url = String(context.url).toLowerCase();
      const all = context.visibleText.concat(context.ariaLabels);
      let hits = 0;
      if (url.includes('/c/')) { hits += 2; evidence.push('conversation url'); }
      if (hasAny(all, 'chatgpt')) { hits += 2; evidence.push('chatgpt text'); }
      if (context.roles.includes('textbox')) { hits += 1; evidence.push('prompt textbox'); }
      if (hasAny(all, 'message chatgpt') || hasAny(all, 'ask anything')) { hits += 1; evidence.push('prompt placeholder'); }
      if (textHas(context.title, 'chatgpt')) { hits += 1; evidence.push('title mentions chatgpt'); }
      if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no chatgpt signal'] };
      const pageType = url.includes('/c/') ? 'conversation' : url.includes('gallery') ? 'gallery' : 'home';
      return { score: scoreFromSignals(hits), pageType, evidence };
    },
    detectGate: detectCommonGates,
  };

  const GEMINI = {
    manifest: {
      id: 'gemini',
      name: 'Google Gemini',
      version: '0.1.0',
      hosts: ['gemini.google.com', '*.gemini.google.com'],
      executionModes: ['manual', 'assisted'],
      liveVerified: false,
    },
    targets: ['promptInput', 'submitButton', 'resultCard'],
    score: function (context) {
      const evidence = [];
      const all = context.visibleText.concat(context.ariaLabels);
      let hits = 0;
      if (String(context.url).toLowerCase().includes('gemini.google.com')) { hits += 2; evidence.push('gemini host'); }
      if (hasAny(all, 'gemini')) { hits += 2; evidence.push('gemini text'); }
      if (context.roles.includes('textbox')) { hits += 1; evidence.push('prompt textbox'); }
      if (textHas(context.title, 'gemini')) { hits += 1; evidence.push('title mentions gemini'); }
      if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no gemini signal'] };
      return { score: scoreFromSignals(hits), pageType: 'conversation', evidence };
    },
    detectGate: detectCommonGates,
  };

  const CLAUDE = {
    manifest: {
      id: 'claude',
      name: 'Claude',
      version: '0.1.0',
      hosts: ['claude.ai', '*.claude.ai'],
      executionModes: ['manual', 'assisted'],
      liveVerified: false,
    },
    targets: ['promptInput', 'submitButton', 'artifactPanel', 'resultCard'],
    score: function (context) {
      const evidence = [];
      const url = String(context.url).toLowerCase();
      const all = context.visibleText.concat(context.ariaLabels);
      let hits = 0;
      if (url.includes('/chat/')) { hits += 2; evidence.push('chat url'); }
      if (url.includes('/project/')) { hits += 2; evidence.push('project url'); }
      if (hasAny(all, 'claude')) { hits += 2; evidence.push('claude text'); }
      if (context.roles.includes('textbox')) { hits += 1; evidence.push('prompt textbox'); }
      if (textHas(context.title, 'claude')) { hits += 1; evidence.push('title mentions claude'); }
      if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no claude signal'] };
      return { score: scoreFromSignals(hits), pageType: url.includes('/project/') ? 'project' : 'conversation', evidence };
    },
    detectGate: detectCommonGates,
  };

  const ADAPTERS = [GROK, CHATGPT, GEMINI, CLAUDE];

  /**
   * Host claiming is LABEL-AWARE.
   *
   * A substring test would let `evil-grok.com` claim a grok.com manifest, which means
   * driving an attacker's page with a prompt meant for a trusted site.
   */
  function claimsHost(manifest, host) {
    const normalized = String(host).toLowerCase().replace(/\.$/, '');
    return manifest.hosts.some((pattern) => {
      const candidate = pattern.toLowerCase().replace(/\.$/, '');
      if (candidate === normalized) return true;
      if (candidate.startsWith('*.')) {
        const base = candidate.slice(2);
        return normalized === base || normalized.endsWith('.' + base);
      }
      return false;
    });
  }

  function detect(context) {
    const candidates = ADAPTERS.filter((adapter) => claimsHost(adapter.manifest, context.host));
    if (candidates.length === 0) {
      return {
        adapterId: null,
        pageType: 'unsupported',
        confidence: 1,
        ambiguous: false,
        evidence: ['no adapter claims ' + context.host],
        detail: 'No adapter claims this host.',
      };
    }
    const scored = candidates
      .map((adapter) => {
        const result = adapter.score(context);
        return { adapter, score: result.score, pageType: result.pageType, evidence: result.evidence };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const runnerUp = scored[1];
    if (best.score <= 0) {
      return {
        adapterId: best.adapter.manifest.id,
        pageType: 'unknown',
        confidence: 0,
        ambiguous: false,
        evidence: best.evidence,
        detail: 'Host claimed but the page could not be identified.',
      };
    }
    const ambiguous = Boolean(runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN);
    return {
      adapterId: ambiguous ? null : best.adapter.manifest.id,
      pageType: best.pageType,
      confidence: best.score,
      ambiguous,
      evidence: best.evidence,
      detail: ambiguous
        ? 'Adapters ' + best.adapter.manifest.id + ' and ' + runnerUp.adapter.manifest.id + ' scored within the ambiguity margin; refusing to act.'
        : 'Matched ' + best.adapter.manifest.id + ' at ' + best.score.toFixed(2) + '.',
    };
  }

  function getAdapter(id) {
    return ADAPTERS.find((adapter) => adapter.manifest.id === id) || null;
  }

  function listManifests() {
    return ADAPTERS.map((adapter) => ({ manifest: adapter.manifest, targets: adapter.targets }));
  }

  window.PaoUniversal = {
    detect: detect,
    getAdapter: getAdapter,
    listManifests: listManifests,
    claimsHost: claimsHost,
    detectCommonGates: detectCommonGates,
    AMBIGUITY_MARGIN: AMBIGUITY_MARGIN,
  };
})();
