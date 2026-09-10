// Pao Universal AI Extension — per-adapter selector profiles.
//
// Each adapter has its OWN profile, keyed by target name. The names are stable across
// adapters (`promptInput`, `submitButton`, `resultCard`) while the EVIDENCE differs, which is
// what lets the planner describe a job without knowing the site.
//
// Two rules carried over from Phase 20.18 and worth restating:
//   - Several independent signals per element, never one CSS class. A class name is the
//     least stable thing about a web UI and carries no meaning the site has reason to keep.
//   - A fallback match is reported as STALE rather than as healthy. That is the signal that
//     says "this will break next time" while it still works.

(function () {
  'use strict';

  const W = { role: 100, aria: 95, text: 80, css: 55 };

  function spec(name, candidates, minConfidence) {
    return { name: name, candidates: candidates, minConfidence: minConfidence };
  }

  const PROFILES = {
    grok: {
      version: '1.1.0',
      specs: {
        promptInput: spec('promptInput', [
          { strategy: 'role', value: 'textbox', weight: W.role },
          { strategy: 'aria', value: 'prompt', weight: W.aria },
          { strategy: 'aria', value: 'Ask anything', weight: W.aria },
          { strategy: 'css', value: 'textarea', weight: W.css },
          { strategy: 'css', value: '[contenteditable=true]', weight: W.css },
        ]),
        submitButton: spec('submitButton', [
          { strategy: 'role', value: 'button:submit', weight: W.role },
          { strategy: 'aria', value: 'Submit', weight: W.aria },
          { strategy: 'aria', value: 'Send', weight: W.aria },
          { strategy: 'text', value: 'Generate', weight: W.text },
          { strategy: 'text', value: 'Send', weight: W.text },
        ]),
        uploadInput: spec('uploadInput', [
          { strategy: 'css', value: 'input[type=file]', weight: W.role },
          { strategy: 'aria', value: 'upload', weight: W.aria },
          { strategy: 'text', value: 'Attach', weight: W.text },
        ]),
        // Media elements are reused for avatars and icons, so output detection is the
        // weakest signal on a generative page and carries a higher floor.
        resultCard: spec('resultCard', [
          { strategy: 'role', value: 'img', weight: W.role },
          { strategy: 'css', value: 'figure img', weight: W.css },
          { strategy: 'css', value: '[data-testid*=result]', weight: W.css },
        ], 0.75),
        generatingIndicator: spec('generatingIndicator', [
          { strategy: 'role', value: 'progressbar', weight: W.role },
          { strategy: 'aria', value: 'Generating', weight: W.aria },
          { strategy: 'text', value: 'Generating', weight: W.text },
          { strategy: 'css', value: '[class*=shimmer]', weight: W.css },
        ]),
      },
    },

    chatgpt: {
      version: '0.1.0',
      specs: {
        promptInput: spec('promptInput', [
          { strategy: 'aria', value: 'Message ChatGPT', weight: W.aria },
          { strategy: 'aria', value: 'Ask anything', weight: W.aria },
          { strategy: 'role', value: 'textbox', weight: W.role },
          { strategy: 'css', value: '#prompt-textarea', weight: W.css },
          { strategy: 'css', value: '[contenteditable=true]', weight: W.css },
        ]),
        submitButton: spec('submitButton', [
          { strategy: 'aria', value: 'Send message', weight: W.aria },
          { strategy: 'role', value: 'button:submit', weight: W.role },
          { strategy: 'css', value: '[data-testid=send-button]', weight: W.css },
        ]),
        stopButton: spec('stopButton', [
          { strategy: 'aria', value: 'Stop generating', weight: W.aria },
          { strategy: 'css', value: '[data-testid=stop-button]', weight: W.css },
        ]),
        // The LAST assistant message, not the first: a conversation page holds every turn,
        // and collecting the wrong one is the stale-result failure.
        resultCard: spec('resultCard', [
          { strategy: 'css', value: '[data-message-author-role=assistant]:last-of-type', weight: W.role },
          { strategy: 'css', value: '.markdown:last-of-type', weight: W.css },
        ], 0.75),
      },
    },

    gemini: {
      version: '0.1.0',
      specs: {
        promptInput: spec('promptInput', [
          { strategy: 'aria', value: 'Enter a prompt', weight: W.aria },
          { strategy: 'role', value: 'textbox', weight: W.role },
          { strategy: 'css', value: 'rich-textarea [contenteditable=true]', weight: W.css },
        ]),
        submitButton: spec('submitButton', [
          { strategy: 'aria', value: 'Send message', weight: W.aria },
          { strategy: 'role', value: 'button:submit', weight: W.role },
        ]),
        resultCard: spec('resultCard', [
          { strategy: 'css', value: 'model-response:last-of-type', weight: W.role },
          { strategy: 'css', value: '.response-container:last-of-type', weight: W.css },
        ], 0.75),
      },
    },

    claude: {
      version: '0.1.0',
      specs: {
        promptInput: spec('promptInput', [
          { strategy: 'aria', value: 'Write your prompt', weight: W.aria },
          { strategy: 'role', value: 'textbox', weight: W.role },
          { strategy: 'css', value: '[contenteditable=true]', weight: W.css },
        ]),
        submitButton: spec('submitButton', [
          { strategy: 'aria', value: 'Send message', weight: W.aria },
          { strategy: 'role', value: 'button:submit', weight: W.role },
        ]),
        artifactPanel: spec('artifactPanel', [
          { strategy: 'aria', value: 'Artifact', weight: W.aria },
          { strategy: 'css', value: '[data-testid*=artifact]', weight: W.css },
        ]),
        resultCard: spec('resultCard', [
          { strategy: 'css', value: '[data-testid=assistant-message]:last-of-type', weight: W.role },
          { strategy: 'css', value: '.font-claude-message:last-of-type', weight: W.css },
        ], 0.75),
      },
    },
  };

  function specFor(adapterId, targetName) {
    const profile = PROFILES[adapterId];
    if (!profile) return null;
    return profile.specs[targetName] || null;
  }

  function profileVersion(adapterId) {
    const profile = PROFILES[adapterId];
    return profile ? profile.version : 'unknown';
  }

  function targetsFor(adapterId) {
    const profile = PROFILES[adapterId];
    return profile ? Object.keys(profile.specs) : [];
  }

  window.PaoSelectorProfiles = {
    specFor: specFor,
    profileVersion: profileVersion,
    targetsFor: targetsFor,
    PROFILES: PROFILES,
  };
})();
