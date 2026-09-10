// Phase 20.19 — Pao Universal AI Browser Provider: adapter registry and detection.
//
// Detection answers one question: which adapter owns this page? Getting it wrong means
// a prompt typed into the wrong site, which is not recoverable by retrying, so the
// engine is built to be UNSURE out loud rather than decisive by accident.
//
// Two specific behaviours follow from that:
//   - A detection with no host match never wins on text signals alone. Text is the
//     weakest signal and the most likely to be spoofed by a page that merely mentions a
//     product name.
//   - Two adapters within AMBIGUITY_MARGIN produce `ambiguous` and the caller must
//     refuse. Picking the margin winner would mean acting on a coin flip.

import {
  AMBIGUITY_MARGIN,
  type BrowserAdapterManifest,
  type DetectionResult,
  type PageContext,
} from './types';

/**
 * The runtime surface an adapter must supply.
 *
 * Deliberately narrower than the SDK sketch: every method here is something the
 * runtime genuinely calls by name. A method nobody calls is a method nobody tests.
 */
export interface BrowserAdapter {
  readonly manifest: BrowserAdapterManifest;
  /** Score this page for this adapter. 0 means no opinion, 1 means certain. */
  scorePage(context: PageContext): { score: number; pageType: string; evidence: string[] };
  /** Detect conditions that require a person, from the page's visible state. */
  detectGate(context: PageContext): { gate: string | null; evidence: string[] };
  /** Selector target names this adapter understands, for diagnostics and validation. */
  selectorTargets(): readonly string[];
}

export class AdapterRegistry {
  private adapters = new Map<string, BrowserAdapter>();

  register(adapter: BrowserAdapter): void {
    const id = adapter.manifest.id;
    if (this.adapters.has(id)) {
      throw new Error('Adapter ' + id + ' is already registered.');
    }
    this.adapters.set(id, adapter);
  }

  /** Replace an existing registration. Used by tests and by adapter reload. */
  replace(adapter: BrowserAdapter): void {
    this.adapters.set(adapter.manifest.id, adapter);
  }

  get(id: string): BrowserAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): BrowserAdapter[] {
    return [...this.adapters.values()];
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }

  clear(): void {
    this.adapters.clear();
  }
}

/**
 * Does a manifest claim this host?
 *
 * Matching is per LABEL, not per substring. A substring test would let `evil-grok.com`
 * claim a `grok.com` manifest, or `grok.com.evil.test` count as grok.com — the classic
 * suffix-confusion bug, and here it would mean driving an attacker's page with a
 * prompt meant for a trusted site.
 */
export function manifestClaimsHost(manifest: BrowserAdapterManifest, host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return manifest.hosts.some((pattern) => {
    const candidate = pattern.toLowerCase().replace(/\.$/, '');
    if (candidate === normalized) return true;
    // A leading wildcard covers subdomains only.
    if (candidate.startsWith('*.')) {
      const base = candidate.slice(2);
      return normalized === base || normalized.endsWith('.' + base);
    }
    return false;
  });
}

/**
 * Detect which adapter owns a page.
 *
 * Candidates are filtered to host-claiming adapters FIRST. An adapter that does not
 * claim the host cannot win on page text, because text can be anything a page chooses
 * to display — including the name of a competitor.
 */
export function detectAdapter(registry: AdapterRegistry, context: PageContext): DetectionResult {
  const candidates = registry.list().filter((adapter) => manifestClaimsHost(adapter.manifest, context.host));

  if (candidates.length === 0) {
    return {
      adapterId: null,
      pageType: 'unsupported',
      confidence: 1,
      evidence: ['no registered adapter claims host ' + context.host],
      ambiguous: false,
      detail: 'No adapter claims this host, so nothing will be driven here.',
    };
  }

  const scored = candidates
    .map((adapter) => {
      const result = adapter.scorePage(context);
      return { adapter, score: result.score, pageType: result.pageType, evidence: result.evidence };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const runnerUp = scored[1];

  if (best.score <= 0) {
    return {
      adapterId: best.adapter.manifest.id,
      pageType: 'unknown',
      confidence: 0,
      evidence: best.evidence,
      ambiguous: false,
      detail: 'The host is claimed but the page could not be identified; a selector or detector update may be needed.',
    };
  }

  const ambiguous = Boolean(runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN);

  return {
    adapterId: ambiguous ? null : best.adapter.manifest.id,
    pageType: best.pageType,
    confidence: best.score,
    evidence: best.evidence,
    ambiguous,
    detail: ambiguous
      ? 'Adapters ' + best.adapter.manifest.id + ' and ' + runnerUp!.adapter.manifest.id + ' scored within the ambiguity margin; refusing to act.'
      : 'Adapter ' + best.adapter.manifest.id + ' matched at confidence ' + best.score.toFixed(2) + '.',
  };
}

/**
 * Health score for an adapter, 0-100.
 *
 * A weighted blend rather than a simple pass rate, because the component failures differ
 * in consequence. A detection failure means nothing happens; a selector failure means a
 * job stalls mid-flight; a job failure can mean work was submitted and lost. The weights
 * reflect that ordering.
 */
export interface AdapterHealthInput {
  readonly detectionAttempts: number;
  readonly detectionSuccesses: number;
  readonly selectorAttempts: number;
  readonly selectorSuccesses: number;
  readonly jobAttempts: number;
  readonly jobSuccesses: number;
  readonly resultAttempts: number;
  readonly resultSuccesses: number;
  readonly recentFailures: number;
  readonly bridgeStable: boolean;
}

export interface AdapterHealth {
  readonly score: number;
  readonly band: 'healthy' | 'degraded' | 'poor';
  readonly detail: string;
}

/**
 * Whether the adapter has been verified against the live site.
 *
 * This is separate from HEALTH, and the distinction is the point. Health says "is it
 * working"; verification says "has anyone ever confirmed it works". An adapter can score
 * a perfect 100 on mocks and still be unverified, and that combination must not submit
 * on its own — the mock is a guess about a page nobody has loaded.
 */
export interface DegradationInput {
  readonly health: AdapterHealth;
  readonly liveVerified: boolean;
}

function rate(successes: number, attempts: number, fallback: number): number {
  // No data is NOT a failure. An adapter that has never run scores neutral rather than
  // zero, or every fresh install would be refused.
  if (attempts <= 0) return fallback;
  return Math.max(0, Math.min(1, successes / attempts));
}

export function scoreAdapterHealth(input: AdapterHealthInput): AdapterHealth {
  const detection = rate(input.detectionSuccesses, input.detectionAttempts, 0.9);
  const selector = rate(input.selectorSuccesses, input.selectorAttempts, 0.9);
  const job = rate(input.jobSuccesses, input.jobAttempts, 0.9);
  const result = rate(input.resultSuccesses, input.resultAttempts, 0.9);

  let score = detection * 20 + selector * 25 + job * 35 + result * 20;

  // Recent failures are a leading indicator: a page that changed today will show up here
  // before it drags the long-run rates down.
  score -= Math.min(20, input.recentFailures * 4);
  if (!input.bridgeStable) score -= 15;

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band: AdapterHealth['band'] = clamped >= 90 ? 'healthy' : clamped >= 75 ? 'degraded' : 'poor';
  return {
    score: clamped,
    band,
    detail:
      band === 'healthy'
        ? 'Adapter health is good; automatic mode may be permitted if configured.'
        : band === 'degraded'
          ? 'Adapter health is degraded; assisted mode only until it recovers.'
          : 'Adapter health is poor; manual mode only until it recovers.',
  };
}

/**
 * Reduce an execution mode to what health permits.
 *
 * Degradation is one-way by construction: this function can only lower the mode. An
 * adapter cannot talk its way back up, and neither can a job.
 */
export function degradeExecutionMode(
  requested: 'manual' | 'assisted' | 'automatic',
  health: AdapterHealth,
  liveVerified = false,
): {
  mode: 'manual' | 'assisted' | 'automatic';
  degraded: boolean;
  reason: string;
} {
  // Verification is checked BEFORE health, because it is the stronger constraint: an
  // unverified adapter may score perfectly on mocks while never having loaded the real
  // page. Submitting on its own would act on a guess, so automatic is never granted.
  if (!liveVerified && requested === 'automatic') {
    return {
      mode: 'assisted',
      degraded: true,
      reason: 'Automatic is not available for an adapter that has not been verified against the live site.',
    };
  }
  if (health.band === 'healthy') return { mode: requested, degraded: false, reason: health.detail };
  if (health.band === 'degraded') {
    const mode = requested === 'automatic' ? 'assisted' : requested;
    return {
      mode,
      degraded: requested !== mode,
      reason: requested === mode ? health.detail : 'Automatic reduced to assisted because adapter health is degraded.',
    };
  }
  return {
    mode: 'manual',
    degraded: requested !== 'manual',
    reason: 'Execution reduced to manual because adapter health is poor.',
  };
}
