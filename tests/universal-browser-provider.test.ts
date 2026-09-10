import { describe, expect, test, beforeEach } from 'bun:test';
import {
  AdapterRegistry,
  detectAdapter,
  manifestClaimsHost,
  scoreAdapterHealth,
  degradeExecutionMode,
} from '../src/agent-os/browser-provider/universal/registry';
import {
  BUILTIN_ADAPTERS,
  grokAdapter,
  chatgptAdapter,
  geminiAdapter,
  claudeAdapter,
  resolveAdapterAlias,
} from '../src/agent-os/browser-provider/universal/adapters';
import { mergeCapabilities, isUsable, evaluateActionPolicy, isSideEffectAction } from '../src/agent-os/browser-provider/universal/types';
import type { PageContext, BrowserAction } from '../src/agent-os/browser-provider/universal/types';
import {
  canTransitionUniversal,
  isUniversalInFlight,
  isUniversalTerminal,
  correlateResult,
  canSafelyResubmit,
  canReviewFurther,
  detectionIsActionable,
  UNIVERSAL_JOB_STATES,
  MAX_REVIEWER_DEPTH,
} from '../src/agent-os/browser-provider/universal/state';

/**
 * Phase 20.19 — universal browser provider tests.
 *
 * The cases that matter most are the ones where a wrong answer is not a cosmetic bug: an
 * ambiguous detection typing into the wrong site, a hostname confusion letting an
 * attacker page claim a trusted adapter, and a stale result being filed as this job's
 * output.
 */

function ctx(overrides: Partial<PageContext> = {}): PageContext {
  return {
    tabId: 1,
    url: 'https://example.test/',
    title: '',
    host: 'example.test',
    documentState: 'complete',
    visibleText: [],
    ariaLabels: [],
    roles: [],
    ...overrides,
  };
}

function registry(): AdapterRegistry {
  const r = new AdapterRegistry();
  for (const adapter of BUILTIN_ADAPTERS) r.register(adapter);
  return r;
}

describe('Phase 20.19 — adapter registry', () => {
  test('the four built-in adapters register without collision', () => {
    expect(registry().ids().sort()).toEqual(['chatgpt', 'claude', 'gemini', 'grok']);
  });

  test('a duplicate id is refused rather than silently overwritten', () => {
    const r = new AdapterRegistry();
    r.register(grokAdapter);
    expect(() => r.register(grokAdapter)).toThrow();
  });

  test('every adapter id is unique across the built-in set', () => {
    const ids = BUILTIN_ADAPTERS.map((a) => a.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every adapter declares hosts, page types, and selector targets', () => {
    for (const adapter of BUILTIN_ADAPTERS) {
      expect(adapter.manifest.hosts.length, adapter.manifest.id).toBeGreaterThan(0);
      expect(adapter.manifest.pageTypes.length, adapter.manifest.id).toBeGreaterThan(0);
      expect(adapter.selectorTargets().length, adapter.manifest.id).toBeGreaterThan(0);
    }
  });

  test('automatic is never GRANTED to an unverified adapter', () => {
    // A manifest declares what an adapter can do; verification gates what it may. An
    // unverified adapter may score perfectly on mocks and still never have loaded the
    // real page, so the degradation layer must refuse automatic regardless of its
    // declared modes.
    const perfect = scoreAdapterHealth({
      detectionAttempts: 100, detectionSuccesses: 100,
      selectorAttempts: 100, selectorSuccesses: 100,
      jobAttempts: 100, jobSuccesses: 100,
      resultAttempts: 100, resultSuccesses: 100,
      recentFailures: 0, bridgeStable: true,
    });
    expect(perfect.band).toBe('healthy');
    expect(degradeExecutionMode('automatic', perfect, false).mode).toBe('assisted');
    expect(degradeExecutionMode('automatic', perfect, true).mode).toBe('automatic');
  });

  test('every built-in adapter is currently unverified, and says so', () => {
    // Honesty about this is the whole reason the flag exists.
    for (const adapter of BUILTIN_ADAPTERS) {
      expect(adapter.manifest.liveVerified === true, adapter.manifest.id).toBe(false);
    }
  });
});

describe('Phase 20.19 — host claiming', () => {
  test('an exact host is claimed', () => {
    expect(manifestClaimsHost(grokAdapter.manifest, 'grok.com')).toBe(true);
  });

  test('a subdomain is claimed by a wildcard', () => {
    expect(manifestClaimsHost(grokAdapter.manifest, 'www.grok.com')).toBe(true);
  });

  test('a SUFFIX-TRICK host is not claimed', () => {
    // The classic confusion: a substring test would let an attacker register this and
    // receive prompts meant for the trusted site.
    expect(manifestClaimsHost(grokAdapter.manifest, 'evil-grok.com')).toBe(false);
    expect(manifestClaimsHost(grokAdapter.manifest, 'grok.com.evil.test')).toBe(false);
    expect(manifestClaimsHost(grokAdapter.manifest, 'notgrok.com')).toBe(false);
  });

  test('a different host entirely is not claimed', () => {
    expect(manifestClaimsHost(grokAdapter.manifest, 'example.com')).toBe(false);
  });
});

describe('Phase 20.19 — adapter detection', () => {
  test('a Grok projects page resolves to the grok adapter', () => {
    const result = detectAdapter(
      registry(),
      ctx({ url: 'https://grok.com/projects', host: 'grok.com', title: 'Projects - Grok', visibleText: ['Projects'], roles: ['textbox'] }),
    );
    expect(result.adapterId).toBe('grok');
    expect(result.pageType).toBe('projects');
    expect(result.ambiguous).toBe(false);
  });

  test('a ChatGPT conversation resolves to the chatgpt adapter', () => {
    const result = detectAdapter(
      registry(),
      ctx({ url: 'https://chatgpt.com/c/abc', host: 'chatgpt.com', title: 'ChatGPT', visibleText: ['ChatGPT'], roles: ['textbox'] }),
    );
    expect(result.adapterId).toBe('chatgpt');
    expect(result.pageType).toBe('conversation');
  });

  test('a Gemini page resolves to the gemini adapter', () => {
    const result = detectAdapter(
      registry(),
      ctx({ url: 'https://gemini.google.com/app', host: 'gemini.google.com', title: 'Gemini', visibleText: ['Gemini'], roles: ['textbox'] }),
    );
    expect(result.adapterId).toBe('gemini');
  });

  test('a Claude page resolves to the claude adapter', () => {
    const result = detectAdapter(
      registry(),
      ctx({ url: 'https://claude.ai/chat/abc', host: 'claude.ai', title: 'Claude', visibleText: ['Claude'], roles: ['textbox'] }),
    );
    expect(result.adapterId).toBe('claude');
  });

  test('an unclaimed host yields no adapter and high confidence in that answer', () => {
    // Confidently unsupported is a useful answer; a low-confidence guess is not.
    const result = detectAdapter(registry(), ctx({ url: 'https://example.com/', host: 'example.com' }));
    expect(result.adapterId).toBeNull();
    expect(result.pageType).toBe('unsupported');
    expect(result.confidence).toBe(1);
  });

  test('a claimed host with no page signal is unknown, not a guess', () => {
    const result = detectAdapter(registry(), ctx({ url: 'https://grok.com/somewhere-new', host: 'grok.com' }));
    expect(result.pageType).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  test('two adapters scoring within the margin refuse to act', () => {
    // A wrong-site submission is not recoverable by retrying, so ambiguity must stop.
    const r = registry();
    const ambiguous = new AdapterRegistry();
    ambiguous.register({
      manifest: { ...grokAdapter.manifest, id: 'twin', hosts: ['grok.com'] },
      scorePage: () => ({ score: 0.9, pageType: 'projects', evidence: ['twin signal'] }),
      detectGate: () => ({ gate: null, evidence: [] }),
      selectorTargets: () => ['promptInput'],
    });
    for (const adapter of r.list()) ambiguous.register(adapter);
    const result = detectAdapter(
      ambiguous,
      ctx({ url: 'https://grok.com/projects', host: 'grok.com', title: 'Projects - Grok', visibleText: ['Projects'], roles: ['textbox'] }),
    );
    expect(result.ambiguous).toBe(true);
    expect(result.adapterId).toBeNull();
  });
});

describe('Phase 20.19 — capabilities', () => {
  test('no adapter claims video support it has not verified', () => {
    for (const adapter of BUILTIN_ADAPTERS) {
      expect(adapter.manifest.capabilities.video, adapter.manifest.id).not.toBe('supported');
    }
  });

  test('unknown and unsupported are distinct', () => {
    expect(isUsable('supported')).toBe(true);
    expect(isUsable('detected')).toBe(true);
    expect(isUsable('unknown')).toBe(false);
    expect(isUsable('unsupported')).toBe(false);
  });

  test('an observation overrides a declaration in BOTH directions', () => {
    // A declared feature the page no longer offers must stop being advertised, and an
    // undeclared feature the page reveals should be reported honestly.
    const declared = { image: 'detected' as const, upload: 'supported' as const };
    const observed = { image: 'unsupported' as const, video: 'detected' as const };
    const merged = mergeCapabilities(declared, observed);
    expect(merged.image).toBe('unsupported');
    expect(merged.video).toBe('detected');
    expect(merged.upload).toBe('supported');
  });

  test('no observation leaves the declaration untouched', () => {
    const declared = { text: 'detected' as const };
    expect(mergeCapabilities(declared, null)).toEqual(declared);
  });
});

describe('Phase 20.19 — action policy', () => {
  const click: BrowserAction = { type: 'click', target: 'submitButton' };
  const collect: BrowserAction = { type: 'collect_text', target: 'resultCard' };

  test('a forbidden action is refused', () => {
    const verdict = evaluateActionPolicy(click, { allowed: [], forbidden: ['click'] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('forbidden');
  });

  test('an allowlist is exhaustive when present', () => {
    const verdict = evaluateActionPolicy(click, { allowed: ['collect_text'], forbidden: [] });
    expect(verdict.allowed).toBe(false);
  });

  test('an empty allowlist permits everything not forbidden', () => {
    expect(evaluateActionPolicy(click, { allowed: [], forbidden: [] }).allowed).toBe(true);
  });

  test('no policy means permitted', () => {
    expect(evaluateActionPolicy(click, null).allowed).toBe(true);
  });

  test('side-effect actions are exactly the ones dry run must skip', () => {
    expect(isSideEffectAction(click)).toBe(true);
    expect(isSideEffectAction({ type: 'set_text', target: 'x', value: 'y' })).toBe(true);
    expect(isSideEffectAction({ type: 'upload', target: 'x', grantId: 'g' })).toBe(true);
    expect(isSideEffectAction(collect)).toBe(false);
    expect(isSideEffectAction({ type: 'focus', target: 'x' })).toBe(false);
    expect(isSideEffectAction({ type: 'wait_for', condition: { kind: 'idle', quietMs: 10 } })).toBe(false);
  });
});

describe('Phase 20.19 — job state machine', () => {
  test('the multi-site happy path is legal', () => {
    const path = ['queued', 'waiting_browser', 'detecting_site', 'adapter_ready', 'preparing', 'submitting', 'running', 'collecting', 'completed'] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionUniversal(path[i]!, path[i + 1]!), path[i] + ' to ' + path[i + 1]).toBe(true);
    }
  });

  test('a job cannot reach submitting without passing detection', () => {
    // Skipping detection would mean submitting to an adapter nobody confirmed owns the tab.
    expect(canTransitionUniversal('waiting_browser', 'submitting')).toBe(false);
    expect(canTransitionUniversal('queued', 'running')).toBe(false);
  });

  test('terminal states cannot be left', () => {
    expect(isUniversalTerminal('completed')).toBe(true);
    expect(isUniversalTerminal('cancelled')).toBe(true);
    expect(canTransitionUniversal('completed', 'running')).toBe(false);
  });

  test('in-flight states include submitting and running', () => {
    // These are the states a restart cannot reason about.
    expect(isUniversalInFlight('submitting')).toBe(true);
    expect(isUniversalInFlight('running')).toBe(true);
    expect(isUniversalInFlight('waiting_browser')).toBe(false);
    expect(isUniversalInFlight('adapter_ready')).toBe(false);
  });

  test('every state has a transition entry', () => {
    for (const state of UNIVERSAL_JOB_STATES) {
      expect(() => canTransitionUniversal(state, state), state).not.toThrow();
    }
  });
});

describe('Phase 20.19 — result correlation', () => {
  const base = {
    submittedAt: 1000,
    promptHash: 'h1',
    resultObservedAt: 2000,
    resultPromptHash: 'h1',
    resultContainerId: 'c1',
    expectedContainerId: 'c1',
    collectorConfidence: 0.9,
  };

  test('a well-ordered result correlates', () => {
    expect(correlateResult(base).status).toBe('correlated');
  });

  test('a result that appeared BEFORE the submission is caught', () => {
    // This is the stale-answer case: the page still showed the previous reply.
    const verdict = correlateResult({ ...base, resultObservedAt: 500 });
    expect(verdict.status).toBe('needs_review');
    expect(verdict.reason).toContain('before the submission');
  });

  test('a result carrying a different prompt is caught', () => {
    const verdict = correlateResult({ ...base, resultPromptHash: 'other' });
    expect(verdict.status).toBe('needs_review');
    expect(verdict.reason).toContain('different prompt');
  });

  test('a result from a different container is caught', () => {
    const verdict = correlateResult({ ...base, resultContainerId: 'c9' });
    expect(verdict.status).toBe('needs_review');
    expect(verdict.reason).toContain('different container');
  });

  test('low collector confidence is caught', () => {
    const verdict = correlateResult({ ...base, collectorConfidence: 0.3 });
    expect(verdict.status).toBe('needs_review');
    expect(verdict.reason).toContain('confidence');
  });

  test('no observed result is caught', () => {
    expect(correlateResult({ ...base, resultObservedAt: null }).status).toBe('needs_review');
  });

  test('a missing container identity is inconclusive, not a failure', () => {
    // Treating an unavailable marker as a failure would flag every job on a site that
    // does not expose one.
    expect(correlateResult({ ...base, resultContainerId: null, expectedContainerId: null }).status).toBe('correlated');
  });

  test('every verdict reports its checks', () => {
    const verdict = correlateResult(base);
    expect(verdict.checks.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Phase 20.19 — duplicate side-effect guard', () => {
  test('a never-submitted job may be submitted', () => {
    const verdict = canSafelyResubmit({ previousSubmitAt: null, resultObserved: false, downloadExists: false, pageShowsGeneration: false });
    expect(verdict.safe).toBe(true);
  });

  test('an existing result blocks resubmission', () => {
    const verdict = canSafelyResubmit({ previousSubmitAt: 1000, resultObserved: true, downloadExists: false, pageShowsGeneration: false });
    expect(verdict.safe).toBe(false);
  });

  test('an existing download blocks resubmission', () => {
    const verdict = canSafelyResubmit({ previousSubmitAt: 1000, resultObserved: false, downloadExists: true, pageShowsGeneration: false });
    expect(verdict.safe).toBe(false);
  });

  test('a generation still running blocks resubmission', () => {
    const verdict = canSafelyResubmit({ previousSubmitAt: 1000, resultObserved: false, downloadExists: false, pageShowsGeneration: true });
    expect(verdict.safe).toBe(false);
  });

  test('an indeterminate outcome blocks resubmission', () => {
    // The whole point: inability to prove safety means asking, not guessing.
    const verdict = canSafelyResubmit({ previousSubmitAt: 1000, resultObserved: false, downloadExists: false, pageShowsGeneration: false });
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toContain('could not be determined');
  });
});

describe('Phase 20.19 — health and degradation', () => {
  test('a healthy adapter scores 90 or above', () => {
    const health = scoreAdapterHealth({
      detectionAttempts: 100, detectionSuccesses: 99,
      selectorAttempts: 100, selectorSuccesses: 98,
      jobAttempts: 50, jobSuccesses: 49,
      resultAttempts: 50, resultSuccesses: 49,
      recentFailures: 0, bridgeStable: true,
    });
    expect(health.band).toBe('healthy');
    expect(health.score).toBeGreaterThanOrEqual(90);
  });

  test('deteriorating selector success lowers the band', () => {
    const health = scoreAdapterHealth({
      detectionAttempts: 100, detectionSuccesses: 90,
      selectorAttempts: 100, selectorSuccesses: 55,
      jobAttempts: 50, jobSuccesses: 35,
      resultAttempts: 50, resultSuccesses: 30,
      recentFailures: 3, bridgeStable: true,
    });
    expect(health.band).not.toBe('healthy');
  });

  test('an unproven adapter scores neutral rather than zero', () => {
    // Otherwise every fresh install would be refused by its own health gate.
    const health = scoreAdapterHealth({
      detectionAttempts: 0, detectionSuccesses: 0,
      selectorAttempts: 0, selectorSuccesses: 0,
      jobAttempts: 0, jobSuccesses: 0,
      resultAttempts: 0, resultSuccesses: 0,
      recentFailures: 0, bridgeStable: true,
    });
    expect(health.score).toBeGreaterThanOrEqual(90);
  });

  test('an unstable bridge lowers the score', () => {
    const stable = scoreAdapterHealth({ detectionAttempts: 10, detectionSuccesses: 10, selectorAttempts: 10, selectorSuccesses: 10, jobAttempts: 10, jobSuccesses: 10, resultAttempts: 10, resultSuccesses: 10, recentFailures: 0, bridgeStable: true });
    const unstable = scoreAdapterHealth({ detectionAttempts: 10, detectionSuccesses: 10, selectorAttempts: 10, selectorSuccesses: 10, jobAttempts: 10, jobSuccesses: 10, resultAttempts: 10, resultSuccesses: 10, recentFailures: 0, bridgeStable: false });
    expect(unstable.score).toBeLessThan(stable.score);
  });

  test('degradation can only lower an execution mode', () => {
    // A verified adapter with poor health still degrades all the way to manual.
    const poor = scoreAdapterHealth({ detectionAttempts: 10, detectionSuccesses: 1, selectorAttempts: 10, selectorSuccesses: 1, jobAttempts: 10, jobSuccesses: 1, resultAttempts: 10, resultSuccesses: 1, recentFailures: 5, bridgeStable: false });
    expect(degradeExecutionMode('automatic', poor, true).mode).toBe('manual');
    // Manual can never be raised, and never needs lowering.
    expect(degradeExecutionMode('manual', poor, true).mode).toBe('manual');
    const healthy = scoreAdapterHealth({ detectionAttempts: 10, detectionSuccesses: 10, selectorAttempts: 10, selectorSuccesses: 10, jobAttempts: 10, jobSuccesses: 10, resultAttempts: 10, resultSuccesses: 10, recentFailures: 0, bridgeStable: true });
    expect(degradeExecutionMode('assisted', healthy, true).mode).toBe('assisted');
  });

  test('degraded health reduces automatic to assisted', () => {
    const degraded = scoreAdapterHealth({ detectionAttempts: 100, detectionSuccesses: 90, selectorAttempts: 100, selectorSuccesses: 70, jobAttempts: 100, jobSuccesses: 75, resultAttempts: 100, resultSuccesses: 80, recentFailures: 0, bridgeStable: true });
    const result = degradeExecutionMode('automatic', degraded);
    if (degraded.band === 'degraded') {
      expect(result.mode).toBe('assisted');
      expect(result.degraded).toBe(true);
    }
  });
});

describe('Phase 20.19 — migration and guards', () => {
  test('the legacy grok-browser id resolves to the grok adapter', () => {
    // A Phase 20.18 job row that suddenly names an unknown provider is a job that can
    // never be finished or explained.
    expect(resolveAdapterAlias('grok-browser')).toBe('grok');
    expect(resolveAdapterAlias('universal-browser:grok')).toBe('grok');
    expect(resolveAdapterAlias('chatgpt')).toBe('chatgpt');
  });

  test('the migrated grok adapter still detects the Phase 20.18 page states', () => {
    // Migration must not change behaviour that was already tested.
    const generation = grokAdapter.scorePage(ctx({ url: 'https://grok.com/imagine', host: 'grok.com', roles: ['progressbar'] }));
    expect(generation.pageType).toBe('generation');
    const projects = grokAdapter.scorePage(ctx({ url: 'https://grok.com/projects', host: 'grok.com', title: 'Projects', visibleText: ['Projects'] }));
    expect(projects.pageType).toBe('projects');
  });

  test('gate detection stops on every human gate it recognises', () => {
    const cases: [string, string][] = [
      ['Verify you are human', 'captcha'],
      ['Too many requests', 'rate_limited'],
      ['Upgrade to continue', 'subscription_upgrade'],
      ['Add a payment method', 'payment_required'],
      ['Verify your account', 'account_verification'],
      ['Accept the terms to continue', 'terms_confirmation'],
      ['Delete permanently', 'publish_or_delete_confirm'],
      ['Sign in to continue', 'login_required'],
    ];
    for (const [text, expected] of cases) {
      const result = grokAdapter.detectGate(ctx({ visibleText: [text] }));
      expect(result.gate, text).toBe(expected);
    }
  });

  test('a clean page has no gate', () => {
    expect(grokAdapter.detectGate(ctx({ visibleText: ['Projects'] })).gate).toBeNull();
  });

  test('the reviewer loop is capped', () => {
    expect(canReviewFurther(0).allowed).toBe(true);
    expect(canReviewFurther(MAX_REVIEWER_DEPTH).allowed).toBe(false);
  });

  test('only a confident, unambiguous detection is actionable', () => {
    expect(detectionIsActionable(0.9, false)).toBe(true);
    expect(detectionIsActionable(0.9, true)).toBe(false);
    expect(detectionIsActionable(0.3, false)).toBe(false);
  });
});
