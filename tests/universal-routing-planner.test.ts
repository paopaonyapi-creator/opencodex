import { describe, expect, test } from 'bun:test';
import {
  TabRouter,
  concurrencyFor,
  DEFAULT_CONCURRENCY,
} from '../src/agent-os/browser-provider/universal/tab-router';
import { buildExecutionPlan, planActions, validateOutputPolicy } from '../src/agent-os/browser-provider/universal/planner';
import {
  buildFormModel,
  outputPolicyFrom,
  isSubmittable,
  describeCapabilities,
} from '../src/agent-os/browser-provider/universal/form-model';
import { scoreAdapterHealth } from '../src/agent-os/browser-provider/universal/registry';
import type { BrowserJob, DetectionResult, BrowserAdapterManifest } from '../src/agent-os/browser-provider/universal/types';
import { grokAdapter, chatgptAdapter } from '../src/agent-os/browser-provider/universal/adapters';

/**
 * Phase 20.19 — tab routing, planning, and the capability-driven form.
 *
 * These are the layers that decide what the UI offers and what a dry run would do, so the
 * cases that matter are the ones where a control or an action appears that should not.
 */

function detection(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    adapterId: 'grok',
    pageType: 'projects',
    confidence: 0.9,
    evidence: ['test'],
    ambiguous: false,
    detail: 'test detection',
    ...overrides,
  };
}

const HEALTHY = scoreAdapterHealth({
  detectionAttempts: 100, detectionSuccesses: 100,
  selectorAttempts: 100, selectorSuccesses: 100,
  jobAttempts: 100, jobSuccesses: 100,
  resultAttempts: 100, resultSuccesses: 100,
  recentFailures: 0, bridgeStable: true,
});

function job(overrides: Partial<BrowserJob> = {}): BrowserJob {
  return {
    id: 'JOB-1',
    adapterId: 'grok',
    taskType: 'image',
    intent: 'image_generation',
    prompt: 'a farm at sunrise',
    inputs: [],
    options: {},
    executionMode: 'assisted',
    outputPolicy: { collectImages: true },
    priority: 5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Phase 20.19 — tab router', () => {
  test('an unambiguous detection binds a tab', () => {
    const router = new TabRouter();
    const result = router.bind({ tabId: 3, detection: detection(), now: 1000 });
    expect(result.ok).toBe(true);
    expect(result.binding?.adapterId).toBe('grok');
  });

  test('an AMBIGUOUS detection refuses to bind', () => {
    // Binding would let the router dispatch a job to an adapter nobody confirmed.
    const router = new TabRouter();
    const result = router.bind({ tabId: 3, detection: detection({ ambiguous: true, adapterId: null }), now: 1000 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ambiguous');
  });

  test('an unsupported page binds nothing', () => {
    const router = new TabRouter();
    const result = router.bind({ tabId: 3, detection: detection({ adapterId: null, pageType: 'unsupported' }), now: 1000 });
    expect(result.ok).toBe(false);
  });

  test('an unknown page type binds nothing', () => {
    const router = new TabRouter();
    const result = router.bind({ tabId: 3, detection: detection({ pageType: 'unknown' }), now: 1000 });
    expect(result.ok).toBe(false);
  });

  test('three tabs hold three adapters independently', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection({ adapterId: 'grok' }), now: 1000 });
    router.bind({ tabId: 5, detection: detection({ adapterId: 'chatgpt', pageType: 'conversation' }), now: 1000 });
    router.bind({ tabId: 7, detection: detection({ adapterId: 'gemini', pageType: 'conversation' }), now: 1000 });
    expect(router.tabsForAdapter('grok')).toHaveLength(1);
    expect(router.tabsForAdapter('chatgpt')[0]?.tabId).toBe(5);
    expect(router.tabsForAdapter('gemini')[0]?.tabId).toBe(7);
  });

  test('a fresh binding preserves an existing job assignment', () => {
    // Re-detection on a heartbeat must not silently orphan the job that is running.
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    router.bind({ tabId: 3, detection: detection(), now: 2000 });
    expect(router.get(3)?.jobId).toBe('JOB-1');
  });

  test('a job always returns to its own tab', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.bind({ tabId: 4, detection: detection(), now: 2000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    expect(router.selectTabForJob('grok', 'JOB-1')?.tabId).toBe(3);
  });

  test('an unbound tab is preferred and the least-recent is chosen first', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.bind({ tabId: 4, detection: detection(), now: 3000 });
    expect(router.selectTabForJob('grok', 'JOB-NEW')?.tabId).toBe(3);
  });

  test('no free tab means no selection', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    expect(router.selectTabForJob('grok', 'JOB-2')).toBeNull();
  });

  test('concurrency is enforced PER ADAPTER, not globally', () => {
    // Serialising across sites would make the queue look slow for no safety gain: two
    // different sites are two different prompt fields.
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection({ adapterId: 'grok' }), now: 1000 });
    router.bind({ tabId: 5, detection: detection({ adapterId: 'chatgpt', pageType: 'conversation' }), now: 1000 });
    expect(router.assignJob('grok', 3, 'JOB-1', 1000).ok).toBe(true);
    const second = router.assignJob('chatgpt', 5, 'JOB-2', 1000);
    expect(second.ok).toBe(true);
  });

  test('a second job on the SAME adapter is refused at the default limit', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.bind({ tabId: 4, detection: detection(), now: 1000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    const second = router.assignJob('grok', 4, 'JOB-2', 1000);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('1 of 1');
  });

  test('a raised per-adapter limit is honoured', () => {
    const router = new TabRouter({ defaultConcurrency: 1, adapters: { grok: 2 } });
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.bind({ tabId: 4, detection: detection(), now: 1000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    expect(router.assignJob('grok', 4, 'JOB-2', 1000).ok).toBe(true);
  });

  test('a zero concurrency falls back to the default rather than deadlocking', () => {
    // A configured zero would mean the adapter never runs, which is never intended.
    expect(concurrencyFor({ defaultConcurrency: 1, adapters: { grok: 0 } }, 'grok')).toBe(1);
    expect(concurrencyFor(DEFAULT_CONCURRENCY, 'anything')).toBe(1);
  });

  test('assigning to a tab bound to a different adapter is refused', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection({ adapterId: 'grok' }), now: 1000 });
    expect(router.assignJob('chatgpt', 3, 'JOB-1', 1000).ok).toBe(false);
  });

  test('releasing a job frees the tab', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    expect(router.releaseJob(3, 2000)).toBe(true);
    expect(router.get(3)?.jobId).toBeNull();
  });

  test('a stale binding is reaped by age', () => {
    // A closed tab leaves a binding that looks available while pointing at nothing.
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    expect(router.reap(1000 + 200_000)).toBe(1);
    expect(router.list()).toHaveLength(0);
  });

  test('a recent binding survives reaping', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    expect(router.reap(1500)).toBe(0);
  });

  test('in-flight bindings are listed for reconciliation', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    router.assignJob('grok', 3, 'JOB-1', 1000);
    expect(router.inFlight()).toHaveLength(1);
  });

  test('unbinding a tab removes it', () => {
    const router = new TabRouter();
    router.bind({ tabId: 3, detection: detection(), now: 1000 });
    expect(router.unbind(3)).toBe(true);
    expect(router.get(3)).toBeNull();
  });
});

describe('Phase 20.19 — execution planning and dry run', () => {
  test('an assisted image job plans type, submit, wait, and collect', () => {
    const actions = planActions(job());
    const types = actions.map((a) => a.type);
    expect(types).toContain('set_text');
    expect(types).toContain('click');
    expect(types).toContain('collect_media');
  });

  test('a manual job plans typing but NO submit', () => {
    // The whole distinction between manual and assisted: a person presses the button.
    const types = planActions(job({ executionMode: 'manual' })).map((a) => a.type);
    expect(types).toContain('set_text');
    expect(types).not.toContain('click');
  });

  test('a text job collects text rather than media', () => {
    const types = planActions(job({ taskType: 'text' })).map((a) => a.type);
    expect(types).toContain('collect_text');
    expect(types).not.toContain('collect_media');
  });

  test('file inputs become upload actions carrying grant ids', () => {
    const actions = planActions(job({ inputs: [{ kind: 'file', grantId: 'grant_abc' }] }));
    const upload = actions.find((a) => a.type === 'upload');
    expect(upload).toBeDefined();
    if (upload && upload.type === 'upload') expect(upload.grantId).toBe('grant_abc');
  });

  test('dry run skips exactly the side-effect actions', () => {
    const plan = buildExecutionPlan({ job: job(), health: HEALTHY, liveVerified: true, policy: null, gate: null });
    for (const entry of plan.dryRunActions) {
      expect(entry.sideEffect).toBe(false);
    }
    for (const entry of plan.skippedInDryRun) {
      expect(entry.sideEffect).toBe(true);
    }
    expect(plan.dryRunActions.length + plan.skippedInDryRun.length).toBe(plan.actions.length);
  });

  test('a policy-forbidden action blocks the whole plan', () => {
    const plan = buildExecutionPlan({
      job: job(),
      health: HEALTHY,
      liveVerified: true,
      policy: { allowed: [], forbidden: ['click'] },
      gate: null,
    });
    expect(plan.ready).toBe(false);
    expect(plan.blocked.length).toBeGreaterThan(0);
    expect(plan.summary).toContain('forbidden');
  });

  test('a human gate blocks the plan even though actions are listed', () => {
    // The actions are still shown so an operator can see what was about to happen.
    const plan = buildExecutionPlan({ job: job(), health: HEALTHY, liveVerified: true, policy: null, gate: 'captcha' });
    expect(plan.ready).toBe(false);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.summary).toContain('requires a person');
  });

  test('an unverified adapter degrades the planned mode', () => {
    const plan = buildExecutionPlan({
      job: job({ executionMode: 'automatic' }),
      health: HEALTHY,
      liveVerified: false,
      policy: null,
      gate: null,
    });
    expect(plan.effectiveMode).toBe('assisted');
    expect(plan.modeDegraded).toBe(true);
  });

  test('the plan never echoes the full prompt', () => {
    // A plan is read at a glance, and a long prompt would swamp it.
    const long = 'x'.repeat(5000);
    const plan = buildExecutionPlan({ job: job({ prompt: long }), health: HEALTHY, liveVerified: true, policy: null, gate: null });
    const typing = plan.actions.find((entry) => entry.action.type === 'set_text');
    expect(typing?.description).toContain('5000 character');
    expect(typing?.description.length).toBeLessThan(120);
  });

  test('every planned action carries a description and a policy verdict', () => {
    const plan = buildExecutionPlan({ job: job(), health: HEALTHY, liveVerified: true, policy: null, gate: null });
    for (const entry of plan.actions) {
      expect(entry.description.length).toBeGreaterThan(5);
      expect(entry.policy.allowed).toBe(true);
    }
  });

  test('a mismatched output policy is reported at plan time', () => {
    // Better than discovering it after a successful generation that produced nothing usable.
    const result = validateOutputPolicy({ collectImages: true }, 'text');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('text task');
  });

  test('a coherent output policy passes', () => {
    expect(validateOutputPolicy({ collectImages: true, autoDownload: true }, 'image').ok).toBe(true);
  });

  test('auto download without media collection is reported', () => {
    expect(validateOutputPolicy({ autoDownload: true }, 'image').ok).toBe(false);
  });
});

describe('Phase 20.19 — capability-driven form', () => {
  test('the Grok form offers image and download, not video', () => {
    const model = buildFormModel({
      adapterId: 'grok',
      capabilities: grokAdapter.manifest.capabilities,
      declaredModes: grokAdapter.manifest.executionModes,
      liveVerified: false,
    });
    const images = model.fields.find((f) => f.key === 'outputImages');
    const video = model.fields.find((f) => f.key === 'outputVideos');
    expect(images?.enabled).toBe(true);
    expect(video?.enabled).toBe(false);
    expect(video?.reason).toBeTruthy();
  });

  test('automatic is NOT offered for an unverified adapter', () => {
    const model = buildFormModel({
      adapterId: 'grok',
      capabilities: grokAdapter.manifest.capabilities,
      declaredModes: grokAdapter.manifest.executionModes,
      liveVerified: false,
    });
    expect(model.allowedModes).not.toContain('automatic');
    expect(model.defaultMode).toBe('assisted');
  });

  test('automatic IS offered once verified', () => {
    const model = buildFormModel({
      adapterId: 'grok',
      capabilities: grokAdapter.manifest.capabilities,
      declaredModes: grokAdapter.manifest.executionModes,
      liveVerified: true,
    });
    expect(model.allowedModes).toContain('automatic');
  });

  test('a caller-permitted subset further narrows the modes', () => {
    const model = buildFormModel({
      adapterId: 'grok',
      capabilities: grokAdapter.manifest.capabilities,
      declaredModes: grokAdapter.manifest.executionModes,
      permittedModes: ['manual'],
      liveVerified: true,
    });
    expect(model.allowedModes).toEqual(['manual']);
  });

  test('the ChatGPT form disables upload because the capability is unknown', () => {
    const model = buildFormModel({
      adapterId: 'chatgpt',
      capabilities: chatgptAdapter.manifest.capabilities,
      declaredModes: chatgptAdapter.manifest.executionModes,
      liveVerified: false,
    });
    const upload = model.fields.find((f) => f.key === 'referenceFiles');
    expect(upload?.enabled).toBe(false);
    expect(upload?.reason).toContain('Not yet detected');
  });

  test('a disabled field NEVER contributes to the output policy', () => {
    // The usual form-to-policy bug: the UI hides a field and the default still requests it.
    const model = buildFormModel({
      adapterId: 'chatgpt',
      capabilities: chatgptAdapter.manifest.capabilities,
      declaredModes: chatgptAdapter.manifest.executionModes,
      liveVerified: false,
    });
    const policy = outputPolicyFrom(model.fields);
    expect(policy.collectImages).toBe(false);
    expect(policy.collectText).toBe(true);
  });

  test('an adapter with no modes is not submittable', () => {
    const model = buildFormModel({
      adapterId: 'x',
      capabilities: { text: 'detected' },
      declaredModes: [],
      liveVerified: false,
    });
    expect(isSubmittable(model).ok).toBe(false);
  });

  test('a normal form is submittable', () => {
    const model = buildFormModel({
      adapterId: 'chatgpt',
      capabilities: chatgptAdapter.manifest.capabilities,
      declaredModes: chatgptAdapter.manifest.executionModes,
      liveVerified: false,
    });
    expect(isSubmittable(model).ok).toBe(true);
  });

  test('capability gaps name every unavailable field', () => {
    const model = buildFormModel({
      adapterId: 'chatgpt',
      capabilities: chatgptAdapter.manifest.capabilities,
      declaredModes: chatgptAdapter.manifest.executionModes,
      liveVerified: false,
    });
    expect(model.capabilityGaps.length).toBeGreaterThan(0);
  });

  test('describeCapabilities preserves unknown rather than flattening it', () => {
    const described = describeCapabilities({ text: 'detected', video: 'unknown', audio: 'unsupported' });
    const video = described.find((entry) => entry.key === 'video');
    const audio = described.find((entry) => entry.key === 'audio');
    expect(video?.state).toBe('unknown');
    expect(audio?.state).toBe('unsupported');
    expect(video?.usable).toBe(false);
  });
});
