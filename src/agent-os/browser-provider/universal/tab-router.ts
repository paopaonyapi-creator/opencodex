// Phase 20.19 — Tab router.
//
// WHAT PROBLEM THIS SOLVES. With one site there is one tab and no routing question. With
// four sites the questions start: which tab is ChatGPT in, which job is bound to which tab,
// and can two jobs run at once.
//
// The answer to the last one is per-ADAPTER, not global. Concurrency of one is correct
// within a site — two jobs would type into the same prompt field — but across sites it is
// wrong and wasteful. Grok can generate while ChatGPT answers, because they are different
// pages in different tabs, and serialising them would make the queue look slow for no
// safety gain.
//
// The router is pure state plus queries. No Chrome API, no timers, no I/O, so the binding
// rules are testable without a browser.

import type { DetectionResult } from './types';

export interface TabBinding {
  readonly tabId: number;
  readonly adapterId: string;
  readonly pageType: string;
  /** Confidence of the detection that produced this binding. */
  readonly confidence: number;
  /** Job currently bound to this tab, if any. */
  readonly jobId: string | null;
  readonly lastSeenAt: number;
}

export interface ConcurrencyPolicy {
  readonly defaultConcurrency: number;
  readonly adapters: Readonly<Record<string, number>>;
}

export const DEFAULT_CONCURRENCY: ConcurrencyPolicy = {
  defaultConcurrency: 1,
  adapters: {},
};

export function concurrencyFor(policy: ConcurrencyPolicy, adapterId: string): number {
  const configured = policy.adapters[adapterId];
  // A configured zero would deadlock the adapter queue, which is never what an operator
  // means, so it is treated as the default rather than honoured.
  if (typeof configured === 'number' && configured > 0) return configured;
  return policy.defaultConcurrency > 0 ? policy.defaultConcurrency : 1;
}

export interface BindInput {
  readonly tabId: number;
  readonly detection: DetectionResult;
  readonly now: number;
}

export interface BindResult {
  readonly ok: boolean;
  readonly binding: TabBinding | null;
  readonly reason: string;
}

export class TabRouter {
  private bindings = new Map<number, TabBinding>();
  private policy: ConcurrencyPolicy;

  constructor(policy: ConcurrencyPolicy = DEFAULT_CONCURRENCY) {
    this.policy = policy;
  }

  setPolicy(policy: ConcurrencyPolicy): void {
    this.policy = policy;
  }

  /**
   * Bind a tab to the adapter that owns it.
   *
   * An AMBIGUOUS or unidentified detection is refused. Binding a tab to an adapter nobody
   * confirmed is the routing equivalent of the wrong-site submission the detection layer
   * exists to prevent — the router would happily dispatch a job to it.
   */
  bind(input: BindInput): BindResult {
    const { detection } = input;
    if (detection.ambiguous) {
      return { ok: false, binding: null, reason: 'Detection is ambiguous; refusing to bind a tab to either adapter.' };
    }
    if (!detection.adapterId) {
      return { ok: false, binding: null, reason: detection.detail };
    }
    if (detection.pageType === 'unsupported' || detection.pageType === 'unknown') {
      return {
        ok: false,
        binding: null,
        reason: 'Page type ' + detection.pageType + ' is not actionable, so no binding is created.',
      };
    }

    const existing = this.bindings.get(input.tabId);
    const binding: TabBinding = {
      tabId: input.tabId,
      adapterId: detection.adapterId,
      pageType: detection.pageType,
      confidence: detection.confidence,
      jobId: existing ? existing.jobId : null,
      lastSeenAt: input.now,
    };
    this.bindings.set(input.tabId, binding);
    return { ok: true, binding, reason: 'Tab ' + input.tabId + ' bound to ' + detection.adapterId + '.' };
  }

  unbind(tabId: number): boolean {
    return this.bindings.delete(tabId);
  }

  get(tabId: number): TabBinding | null {
    return this.bindings.get(tabId) ?? null;
  }

  list(): TabBinding[] {
    return [...this.bindings.values()];
  }

  /** Tabs currently holding a given adapter. */
  tabsForAdapter(adapterId: string): TabBinding[] {
    return this.list().filter((binding) => binding.adapterId === adapterId);
  }

  /**
   * Pick a tab to run a job on.
   *
   * Prefers a tab that is not already bound, then the least-recently-bound, so repeated
   * dispatches spread across open tabs rather than hammering one and leaving the others idle.
   * The job own binding always wins, so a resumed job returns to its tab.
   */
  selectTabForJob(adapterId: string, jobId: string): TabBinding | null {
    const candidates = this.tabsForAdapter(adapterId);
    if (candidates.length === 0) return null;

    const own = candidates.find((binding) => binding.jobId === jobId);
    if (own) return own;

    const free = candidates.filter((binding) => binding.jobId === null);
    if (free.length > 0) {
      return free.sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0]!;
    }
    return null;
  }

  /**
   * Attach a job to a tab, enforcing per-adapter concurrency.
   *
   * The count is per ADAPTER, so a second site is unaffected by a busy first one.
   */
  assignJob(adapterId: string, tabId: number, jobId: string, now: number): { ok: boolean; reason: string } {
    const binding = this.bindings.get(tabId);
    if (!binding) return { ok: false, reason: 'Tab ' + tabId + ' is not bound to any adapter.' };
    if (binding.adapterId !== adapterId) {
      return { ok: false, reason: 'Tab ' + tabId + ' is bound to ' + binding.adapterId + ', not ' + adapterId + '.' };
    }
    const limit = concurrencyFor(this.policy, adapterId);
    const running = this.tabsForAdapter(adapterId).filter((b) => b.jobId !== null).length;
    if (binding.jobId === null && running >= limit) {
      return {
        ok: false,
        reason: 'Adapter ' + adapterId + ' already has ' + running + ' of ' + limit + ' jobs in flight.',
      };
    }
    this.bindings.set(tabId, { ...binding, jobId, lastSeenAt: now });
    return { ok: true, reason: 'Job ' + jobId + ' assigned to tab ' + tabId + '.' };
  }

  releaseJob(tabId: number, now: number): boolean {
    const binding = this.bindings.get(tabId);
    if (!binding || binding.jobId === null) return false;
    this.bindings.set(tabId, { ...binding, jobId: null, lastSeenAt: now });
    return true;
  }

  /**
   * Drop bindings older than a threshold.
   *
   * A closed tab leaves a stale binding, and a stale binding looks available while pointing
   * at nothing. Reaping by age rather than by an unload event is deliberate: an unload event
   * is not guaranteed, and a binding that outlives its tab is what the age check catches.
   */
  reap(now: number, staleAfterMs = 120_000): number {
    let removed = 0;
    for (const [tabId, binding] of this.bindings.entries()) {
      if (now - binding.lastSeenAt > staleAfterMs) {
        this.bindings.delete(tabId);
        removed += 1;
      }
    }
    return removed;
  }

  /** Bindings that hold work, for restart reconciliation. */
  inFlight(): TabBinding[] {
    return this.list().filter((binding) => binding.jobId !== null);
  }

  snapshot(): { bindings: TabBinding[]; policy: ConcurrencyPolicy } {
    return { bindings: this.list(), policy: this.policy };
  }

  reset(): void {
    this.bindings.clear();
  }
}

let defaultRouter: TabRouter | null = null;

export function getTabRouter(): TabRouter {
  if (!defaultRouter) defaultRouter = new TabRouter();
  return defaultRouter;
}

export function resetTabRouter(): void {
  defaultRouter = null;
}
