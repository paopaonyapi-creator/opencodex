// Phase 20.19 — Universal browser job state machine and result correlation.
//
// The state machine is a SUPERSET of the Phase 20.18 one, extended with the states a
// multi-site system needs: detecting_site (which adapter owns this tab) and adapter_ready
// (detection succeeded and the adapter is loaded). The Phase 20.18 states are all still
// reachable, so a job created under the old naming can still be driven.

export const UNIVERSAL_JOB_STATES = [
  'queued',
  'waiting_browser',
  'detecting_site',
  'adapter_ready',
  'preparing',
  'waiting_user',
  'submitting',
  'running',
  'collecting',
  'reviewing',
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'needs_review',
  'unsupported',
] as const;

export type UniversalJobState = (typeof UNIVERSAL_JOB_STATES)[number];

const TRANSITIONS: Readonly<Record<UniversalJobState, readonly UniversalJobState[]>> = {
  queued: ['waiting_browser', 'cancelled', 'blocked', 'waiting_user', 'unsupported'],
  waiting_browser: ['detecting_site', 'queued', 'cancelled', 'blocked', 'waiting_user', 'unsupported'],
  detecting_site: ['adapter_ready', 'unsupported', 'failed', 'cancelled', 'blocked', 'needs_review'],
  adapter_ready: ['preparing', 'cancelled', 'blocked', 'waiting_user', 'unsupported'],
  preparing: ['submitting', 'waiting_user', 'failed', 'cancelled', 'blocked', 'needs_review'],
  waiting_user: ['preparing', 'submitting', 'cancelled', 'failed', 'needs_review'],
  submitting: ['running', 'failed', 'cancelled', 'blocked', 'needs_review'],
  running: ['collecting', 'failed', 'cancelled', 'blocked', 'waiting_user', 'needs_review'],
  collecting: ['reviewing', 'completed', 'failed', 'cancelled', 'needs_review'],
  reviewing: ['completed', 'needs_review', 'failed', 'cancelled'],
  // Terminal by construction: nothing leaves these without an explicit human action,
  // which arrives as a fresh transition from a person rather than from the queue.
  completed: [],
  cancelled: [],
  blocked: ['waiting_user', 'preparing', 'cancelled', 'failed', 'needs_review'],
  unsupported: ['cancelled', 'needs_review'],
  failed: ['preparing', 'cancelled'],
  needs_review: ['preparing', 'cancelled', 'failed', 'completed'],
};

export function canTransitionUniversal(from: UniversalJobState, to: UniversalJobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertUniversalTransition(from: UniversalJobState, to: UniversalJobState): void {
  if (!canTransitionUniversal(from, to)) {
    throw new Error('Illegal universal job transition ' + from + ' to ' + to);
  }
}

export function isUniversalTerminal(state: UniversalJobState): boolean {
  return state === 'completed' || state === 'cancelled';
}

/**
 * States where a restart cannot know what happened.
 *
 * preparing, submitting, running, and collecting are the dangerous ones: a submission may
 * have reached the site, and a prompt may already be typed into a field. Re-preparing would
 * duplicate the typed text; resubmitting could duplicate a real generation.
 */
export function isUniversalInFlight(state: UniversalJobState): boolean {
  return state === 'preparing' || state === 'submitting' || state === 'running' || state === 'collecting';
}

// ---------------------------------------------------------------------------
// Result correlation
// ---------------------------------------------------------------------------

/**
 * Evidence used to decide whether a result belongs to THIS job.
 *
 * The failure this prevents is specific and expensive: a chat page still shows the
 * PREVIOUS answer when a new job starts, and a collector that grabs the first visible
 * response would attach the wrong text to the job, file it as a success, and send it
 * downstream. Nothing about that looks like an error.
 */
export interface CorrelationInput {
  readonly submittedAt: number;
  readonly promptHash: string;
  readonly resultObservedAt: number | null;
  readonly resultPromptHash: string | null;
  readonly resultContainerId: string | null;
  readonly expectedContainerId: string | null;
  readonly collectorConfidence: number;
}

export interface CorrelationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface CorrelationVerdict {
  readonly status: 'correlated' | 'needs_review';
  readonly reason: string;
  readonly checks: readonly CorrelationCheck[];
}

/** Minimum collector confidence below which a result is not trusted. */
export const MIN_COLLECTOR_CONFIDENCE = 0.6;

/**
 * Decide whether a collected result can be attributed to the job.
 *
 * Every check must pass. A failure produces needs_review rather than a rejection, because
 * a mismatched result may still BE the right result whose marker was misread, and
 * discarding it would lose work while assuming it is correct would file the wrong output
 * as a success. A human resolves the ambiguity.
 */
export function correlateResult(input: CorrelationInput): CorrelationVerdict {
  const checks: CorrelationCheck[] = [];

  checks.push({
    name: 'result_existed',
    passed: input.resultObservedAt !== null,
    detail: input.resultObservedAt === null ? 'No result element was observed.' : 'A result element was observed.',
  });

  // The timestamp check is the one that catches a stale answer: a result present BEFORE
  // the submission cannot have been produced by it.
  const afterSubmit = input.resultObservedAt !== null && input.resultObservedAt >= input.submittedAt;
  checks.push({
    name: 'produced_after_submit',
    passed: afterSubmit,
    detail: input.resultObservedAt === null
      ? 'Cannot check ordering without an observed result.'
      : afterSubmit
        ? 'The result appeared after the submission.'
        : 'The result appeared before the submission, so it belongs to an earlier turn.',
  });

  const promptMatches = input.resultPromptHash !== null && input.resultPromptHash === input.promptHash;
  checks.push({
    name: 'prompt_matches',
    passed: promptMatches,
    detail: input.resultPromptHash === null
      ? 'The page did not expose the prompt that produced the result.'
      : promptMatches
        ? 'The result carries the prompt this job submitted.'
        : 'The result carries a different prompt.',
  });

  const containerMatches = input.expectedContainerId === null || input.resultContainerId === input.expectedContainerId;
  checks.push({
    name: 'container_identity',
    passed: containerMatches,
    detail: input.expectedContainerId === null
      ? 'No container identity was available; this check is inconclusive and treated as passing.'
      : containerMatches
        ? 'The result came from the expected container.'
        : 'The result came from a different container than the job was bound to.',
  });

  checks.push({
    name: 'collector_confidence',
    passed: input.collectorConfidence >= MIN_COLLECTOR_CONFIDENCE,
    detail: 'Collector confidence ' + input.collectorConfidence.toFixed(2) + ' against a floor of ' + MIN_COLLECTOR_CONFIDENCE + '.',
  });

  const failed = checks.filter((check) => !check.passed);
  if (failed.length === 0) {
    return { status: 'correlated', reason: 'All correlation checks passed.', checks };
  }
  return {
    status: 'needs_review',
    reason: 'Correlation failed: ' + failed.map((check) => check.detail).join(' '),
    checks,
  };
}

/**
 * Is resubmitting a previously-submitted job safe?
 *
 * The duplicate side-effect guard. Resubmitting is safe only when the system can PROVE
 * nothing reached the site. Anything unproven goes to a human, because the cost of a
 * duplicate generation is real money and real time, while the cost of asking is a minute
 * of attention.
 */
export interface ResubmitCheckInput {
  readonly previousSubmitAt: number | null;
  readonly resultObserved: boolean;
  readonly downloadExists: boolean;
  readonly pageShowsGeneration: boolean;
}

export function canSafelyResubmit(input: ResubmitCheckInput): { safe: boolean; reason: string } {
  if (input.previousSubmitAt === null) {
    return { safe: true, reason: 'The job was never submitted, so a fresh submission cannot duplicate anything.' };
  }
  if (input.resultObserved || input.downloadExists) {
    return { safe: false, reason: 'A result or download already exists for this job; resubmitting would duplicate it.' };
  }
  if (input.pageShowsGeneration) {
    return { safe: false, reason: 'The page still shows a generation in progress; wait rather than submitting again.' };
  }
  return {
    safe: false,
    reason: 'The job was submitted and the outcome could not be determined; a person must confirm before any retry.',
  };
}

/**
 * Reviewer loop guard.
 *
 * A browser provider can generate AND review, which makes a review chain possible: Grok
 * generates, ChatGPT reviews, and then the review itself could be sent for review. The
 * depth cap turns that into a bounded process rather than an unbounded one.
 */
export const MAX_REVIEWER_DEPTH = 2;

export function canReviewFurther(currentDepth: number): { allowed: boolean; reason: string } {
  if (currentDepth >= MAX_REVIEWER_DEPTH) {
    return {
      allowed: false,
      reason: 'Review depth ' + currentDepth + ' has reached the cap of ' + MAX_REVIEWER_DEPTH + '; escalating to a person instead of reviewing again.',
    };
  }
  return { allowed: true, reason: 'Review depth ' + currentDepth + ' is within the cap.' };
}

/** Detection confidence below which acting would be a guess. */
export function detectionIsActionable(confidence: number, ambiguous: boolean): boolean {
  return !ambiguous && confidence >= 0.5;
}
