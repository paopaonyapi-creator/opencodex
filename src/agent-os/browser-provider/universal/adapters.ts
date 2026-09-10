// Phase 20.19 — Site adapters.
//
// Each adapter is a manifest, a page scorer, a gate detector, and a selector-target list.
// That is the whole contract, and it is deliberately small: everything an adapter could
// otherwise do — touch the DOM, call a Chrome API, read a file — is a typed action the
// runtime performs on its behalf.
//
// MIGRATION NOTE (Phase 20.18 to 20.19). The Grok detection rules are the Phase 20.18
// rules, moved verbatim. They are not re-derived, because the Phase 20.18 fixtures pass
// against them and re-deriving would silently change behaviour that is already tested.
// What changed is only WHERE the rules live and WHO may call them.

import type { BrowserAdapter } from './registry';
import type { BrowserAdapterManifest, PageContext } from './types';

/** Shared scorer shape: count corroborating signals, then convert to a score. */
function scoreFromSignals(hits: number, total: number): number {
  if (total <= 0) return 0;
  // A floor of 0.55 for a single hit, rising with corroboration. One signal is weak
  // evidence, several independent ones are strong, and the curve reflects that.
  return Math.min(0.98, 0.55 + (hits - 1) * 0.15);
}

function hasAny(haystack: readonly string[], needle: string): boolean {
  const lowered = needle.toLowerCase();
  return haystack.some((entry) => entry.toLowerCase().includes(lowered));
}

function textHas(haystack: string, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

/**
 * Gate detection shared by every adapter.
 *
 * Order matters: the gates that block hardest are checked first, so a page that is both
 * rate-limited and showing a sign-in prompt reports the rate limit. Either answer stops
 * the job, but the reported cause is what the operator acts on.
 */
function detectCommonGates(context: PageContext): { gate: string | null; evidence: string[] } {
  const all = [...context.visibleText, ...context.ariaLabels];
  const evidence: string[] = [];

  if (hasAny(all, 'verify you are human') || hasAny(all, 'captcha') || hasAny(all, 'recaptcha')) {
    evidence.push('CAPTCHA or human-verification text present');
    return { gate: 'captcha', evidence };
  }
  if (hasAny(all, 'rate limit') || hasAny(all, 'too many requests') || hasAny(all, 'try again later')) {
    evidence.push('rate-limit text present');
    return { gate: 'rate_limited', evidence };
  }
  if (hasAny(all, 'upgrade to') || hasAny(all, 'subscribe to continue') || hasAny(all, 'plus plan')) {
    evidence.push('subscription-upgrade text present');
    return { gate: 'subscription_upgrade', evidence };
  }
  if (hasAny(all, 'add a payment method') || hasAny(all, 'update your billing')) {
    evidence.push('payment text present');
    return { gate: 'payment_required', evidence };
  }
  if (hasAny(all, 'verify your account') || hasAny(all, 'confirm your identity')) {
    evidence.push('account-verification text present');
    return { gate: 'account_verification', evidence };
  }
  if (hasAny(all, 'accept the terms') || hasAny(all, 'agree to the terms')) {
    evidence.push('terms-confirmation text present');
    return { gate: 'terms_confirmation', evidence };
  }
  if (hasAny(all, 'delete conversation') || hasAny(all, 'delete permanently')) {
    evidence.push('destructive confirmation text present');
    return { gate: 'publish_or_delete_confirm', evidence };
  }
  if (hasAny(all, 'sign in') || hasAny(all, 'log in') || context.url.toLowerCase().includes('/login')) {
    evidence.push('sign-in affordance present');
    return { gate: 'login_required', evidence };
  }

  return { gate: null, evidence };
}

// ---------------------------------------------------------------------------
// Grok — migrated from Phase 20.18
// ---------------------------------------------------------------------------

const GROK_MANIFEST: BrowserAdapterManifest = {
  id: 'grok',
  name: 'Grok Projects / Imagine',
  version: '1.1.0',
  hosts: ['grok.com', '*.grok.com'],
  pageTypes: ['projects', 'imagine', 'generation', 'home', 'unknown'],
  capabilities: {
    // Image generation is the verified Phase 20.18 surface. Video is UNKNOWN rather than
    // unsupported: nobody has probed it, and claiming either answer without looking is
    // the mistake the manifest exists to prevent.
    image: 'detected',
    video: 'unknown',
    text: 'detected',
    upload: 'detected',
    download: 'detected',
    projectMode: 'detected',
    conversationMode: 'detected',
    audio: 'unknown',
  },
  executionModes: ['manual', 'assisted', 'automatic'],
  permissions: { downloads: true, fileUpload: true },
  liveVerified: false,
};

export const grokAdapter: BrowserAdapter = {
  manifest: GROK_MANIFEST,
  scorePage(context: PageContext) {
    const evidence: string[] = [];
    const url = context.url.toLowerCase();
    const all = [...context.visibleText, ...context.ariaLabels];
    let hits = 0;

    // A generation in flight is the most specific state, so it is tested first.
    if (context.roles.includes('progressbar') || hasAny(all, 'generating')) {
      hits += 3;
      evidence.push('generation in flight');
      return { score: scoreFromSignals(hits, 1), pageType: 'generation', evidence };
    }
    if (url.includes('/projects') || hasAny(all, 'projects')) {
      hits += 2;
      evidence.push('projects surface');
    }
    if (url.includes('imagine') || hasAny(all, 'imagine')) {
      hits += 2;
      evidence.push('imagine surface');
    }
    if (context.roles.includes('textbox')) {
      hits += 1;
      evidence.push('prompt textbox present');
    }
    if (textHas(context.title, 'grok')) {
      hits += 1;
      evidence.push('title mentions grok');
    }

    if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no grok signal'] };

    const pageType = url.includes('/projects')
      ? 'projects'
      : url.includes('imagine')
        ? 'imagine'
        : 'home';
    return { score: scoreFromSignals(hits, 4), pageType, evidence };
  },
  detectGate: detectCommonGates,
  selectorTargets: () => ['promptInput', 'submitButton', 'uploadInput', 'resultCard', 'generatingIndicator'],
};

// ---------------------------------------------------------------------------
// ChatGPT
// ---------------------------------------------------------------------------

const CHATGPT_MANIFEST: BrowserAdapterManifest = {
  id: 'chatgpt',
  name: 'ChatGPT',
  version: '0.1.0',
  hosts: ['chatgpt.com', '*.chatgpt.com', 'chat.openai.com'],
  pageTypes: ['conversation', 'home', 'gallery', 'unknown'],
  capabilities: {
    text: 'detected',
    // Image and upload are UNKNOWN until a capability scan runs on a real page. A first
    // implementation that declared them supported would offer controls that may not
    // exist, and the resulting failure would look like a Pao-hubPro bug.
    image: 'unknown',
    upload: 'unknown',
    download: 'unknown',
    conversationMode: 'detected',
    projectMode: 'unknown',
    video: 'unsupported',
    audio: 'unknown',
  },
  // NO automatic mode. ChatGPT is text-first and the response observation path is
  // unverified against a live page, so submitting on the user behalf is left to a person
  // until that verification exists.
  executionModes: ['manual', 'assisted'],
  permissions: { fileUpload: false },
  liveVerified: false,
};

export const chatgptAdapter: BrowserAdapter = {
  manifest: CHATGPT_MANIFEST,
  scorePage(context: PageContext) {
    const evidence: string[] = [];
    const url = context.url.toLowerCase();
    const all = [...context.visibleText, ...context.ariaLabels];
    let hits = 0;

    if (url.includes('/c/')) {
      hits += 2;
      evidence.push('conversation url');
    }
    if (hasAny(all, 'chatgpt')) {
      hits += 2;
      evidence.push('chatgpt text present');
    }
    if (context.roles.includes('textbox')) {
      hits += 1;
      evidence.push('prompt textbox present');
    }
    if (hasAny(all, 'message chatgpt') || hasAny(all, 'ask anything')) {
      hits += 1;
      evidence.push('prompt placeholder matched');
    }
    if (textHas(context.title, 'chatgpt')) {
      hits += 1;
      evidence.push('title mentions chatgpt');
    }

    if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no chatgpt signal'] };
    const pageType = url.includes('/c/') ? 'conversation' : url.includes('gallery') ? 'gallery' : 'home';
    return { score: scoreFromSignals(hits, 4), pageType, evidence };
  },
  detectGate: detectCommonGates,
  selectorTargets: () => ['promptInput', 'submitButton', 'resultCard', 'stopButton'],
};

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const GEMINI_MANIFEST: BrowserAdapterManifest = {
  id: 'gemini',
  name: 'Google Gemini',
  version: '0.1.0',
  hosts: ['gemini.google.com', '*.gemini.google.com'],
  pageTypes: ['conversation', 'home', 'unknown'],
  capabilities: {
    text: 'detected',
    upload: 'unknown',
    image: 'unknown',
    video: 'unknown',
    audio: 'unknown',
    download: 'unknown',
    conversationMode: 'detected',
    projectMode: 'unknown',
  },
  executionModes: ['manual', 'assisted'],
  permissions: {},
  liveVerified: false,
};

export const geminiAdapter: BrowserAdapter = {
  manifest: GEMINI_MANIFEST,
  scorePage(context: PageContext) {
    const evidence: string[] = [];
    const all = [...context.visibleText, ...context.ariaLabels];
    let hits = 0;

    if (context.url.toLowerCase().includes('gemini.google.com')) {
      hits += 2;
      evidence.push('gemini host');
    }
    if (hasAny(all, 'gemini')) {
      hits += 2;
      evidence.push('gemini text present');
    }
    if (context.roles.includes('textbox')) {
      hits += 1;
      evidence.push('prompt textbox present');
    }
    if (textHas(context.title, 'gemini')) {
      hits += 1;
      evidence.push('title mentions gemini');
    }

    if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no gemini signal'] };
    return { score: scoreFromSignals(hits, 4), pageType: 'conversation', evidence };
  },
  detectGate: detectCommonGates,
  selectorTargets: () => ['promptInput', 'submitButton', 'resultCard'],
};

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const CLAUDE_MANIFEST: BrowserAdapterManifest = {
  id: 'claude',
  name: 'Claude',
  version: '0.1.0',
  hosts: ['claude.ai', '*.claude.ai'],
  pageTypes: ['conversation', 'project', 'artifacts', 'unknown'],
  capabilities: {
    text: 'detected',
    upload: 'unknown',
    image: 'unknown',
    // Artifacts are a Claude-specific surface. Marked unknown, not supported: the
    // manifest must not assert a UI feature nobody has verified.
    download: 'unknown',
    conversationMode: 'detected',
    projectMode: 'unknown',
    video: 'unsupported',
    audio: 'unknown',
  },
  executionModes: ['manual', 'assisted'],
  permissions: {},
  liveVerified: false,
};

export const claudeAdapter: BrowserAdapter = {
  manifest: CLAUDE_MANIFEST,
  scorePage(context: PageContext) {
    const evidence: string[] = [];
    const url = context.url.toLowerCase();
    const all = [...context.visibleText, ...context.ariaLabels];
    let hits = 0;

    if (url.includes('/chat/')) {
      hits += 2;
      evidence.push('chat url');
    }
    if (url.includes('/project/')) {
      hits += 2;
      evidence.push('project url');
    }
    if (hasAny(all, 'claude')) {
      hits += 2;
      evidence.push('claude text present');
    }
    if (context.roles.includes('textbox')) {
      hits += 1;
      evidence.push('prompt textbox present');
    }
    if (textHas(context.title, 'claude')) {
      hits += 1;
      evidence.push('title mentions claude');
    }

    if (hits === 0) return { score: 0, pageType: 'unknown', evidence: ['no claude signal'] };
    const pageType = url.includes('/project/') ? 'project' : url.includes('/chat/') ? 'conversation' : 'conversation';
    return { score: scoreFromSignals(hits, 4), pageType, evidence };
  },
  detectGate: detectCommonGates,
  selectorTargets: () => ['promptInput', 'submitButton', 'artifactPanel', 'resultCard'],
};

/** The built-in adapter set. */
export const BUILTIN_ADAPTERS: readonly BrowserAdapter[] = [
  grokAdapter,
  chatgptAdapter,
  geminiAdapter,
  claudeAdapter,
];

/**
 * Legacy provider id to universal adapter id.
 *
 * Phase 20.18 jobs carry `grok-browser`. They must keep resolving, because a job row that
 * suddenly names an unknown provider is a job that can never be finished or explained.
 */
export function resolveAdapterAlias(providerId: string): string {
  const aliases: Readonly<Record<string, string>> = {
    'grok-browser': 'grok',
    'universal-browser:grok': 'grok',
  };
  return aliases[providerId] ?? providerId;
}
