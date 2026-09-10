// Phase 20.19 — Action planner: dry run and the execution plan.
//
// DRY RUN IS A REAL CAPABILITY, NOT A FLAG. The plan below is the complete list of typed
// actions a job would perform, computed without executing any of them. That is only
// possible because the action vocabulary is closed: if an adapter could run arbitrary code,
// there would be nothing to enumerate and no way to say what a job would do before it did it.
//
// The plan also drives the operator-facing preview. Showing the actions before a run is what
// lets someone notice that a job would click a delete button before it clicks it.

import {
  type BrowserAction,
  type BrowserJob,
  type ExecutionMode,
  type HumanGate,
  type OutputPolicy,
  type PolicyVerdict,
  evaluateActionPolicy,
  isSideEffectAction,
  type AdapterPolicy,
} from './types';
import type { AdapterHealth } from './registry';
import { degradeExecutionMode } from './registry';

export interface PlannedAction {
  readonly index: number;
  readonly action: BrowserAction;
  /** True when dry run would skip this one. */
  readonly sideEffect: boolean;
  readonly policy: PolicyVerdict;
  /** Human-readable description for the preview. */
  readonly description: string;
}

export interface ExecutionPlan {
  readonly jobId: string;
  readonly adapterId: string;
  readonly requestedMode: ExecutionMode;
  readonly effectiveMode: ExecutionMode;
  readonly modeDegraded: boolean;
  readonly modeReason: string;
  readonly actions: readonly PlannedAction[];
  /** Actions dry run would execute. */
  readonly dryRunActions: readonly PlannedAction[];
  /** Actions dry run would skip, so the difference is explicit. */
  readonly skippedInDryRun: readonly PlannedAction[];
  /** Blocked by policy. A non-empty list means the job cannot proceed at all. */
  readonly blocked: readonly PlannedAction[];
  readonly ready: boolean;
  readonly summary: string;
}

export interface PlanInput {
  readonly job: BrowserJob;
  readonly health: AdapterHealth;
  readonly liveVerified: boolean;
  readonly policy: AdapterPolicy | null;
  /** Gate detected on the page before planning, if any. */
  readonly gate: HumanGate | null;
}

function describe(action: BrowserAction): string {
  switch (action.type) {
    case 'focus':
      return 'Focus ' + action.target + '.';
    case 'set_text':
      // The VALUE is summarised, not echoed: a prompt can be long, and a plan is read at a
      // glance. The length is enough to confirm the right field got the right payload.
      return 'Type ' + action.value.length + ' character(s) into ' + action.target + '.';
    case 'click':
      return 'Click ' + action.target + '.';
    case 'upload':
      return 'Attach granted file to ' + action.target + ' (grant ' + action.grantId.slice(0, 12) + ').';
    case 'wait_for':
      return 'Wait for ' + action.condition.kind + '.';
    case 'collect_text':
      return 'Collect text from ' + action.target + '.';
    case 'collect_media':
      return 'Collect media from ' + action.target + '.';
    default:
      return 'Unknown action.';
  }
}

/**
 * Actions a job of this shape would perform.
 *
 * The sequence is fixed and shared: focus, type, verify, then submit only when the mode
 * allows it, then wait, then collect. Builders cannot reorder it, which is what makes the
 * plan meaningful — a plan assembled by each adapter would describe a different procedure
 * per site and could not be reviewed as one thing.
 */
export function planActions(job: BrowserJob): BrowserAction[] {
  const actions: BrowserAction[] = [
    { type: 'focus', target: 'promptInput' },
    { type: 'set_text', target: 'promptInput', value: job.prompt },
    { type: 'wait_for', condition: { kind: 'element_present', target: 'promptInput' } },
  ];

  for (const input of job.inputs) {
    actions.push({ type: 'upload', target: 'uploadInput', grantId: input.grantId });
  }

  // Submit is planned for assisted and automatic. Manual stops after typing, which is the
  // whole distinction between the modes: a person presses the button.
  if (job.executionMode !== 'manual') {
    actions.push({ type: 'click', target: 'submitButton' });
    actions.push({ type: 'wait_for', condition: { kind: 'element_absent', target: 'generatingIndicator' } });
  }

  if (job.taskType === 'text') {
    actions.push({ type: 'collect_text', target: 'resultCard' });
  } else {
    actions.push({ type: 'collect_media', target: 'resultCard' });
  }

  return actions;
}

/**
 * Build the full plan.
 *
 * Three independent gates, each of which can stop the job before any action runs: the
 * execution mode is degraded by health and verification, every action is checked against
 * the adapter policy, and a human gate on the page stops planning outright.
 */
export function buildExecutionPlan(input: PlanInput): ExecutionPlan {
  const { job } = input;

  const degraded = degradeExecutionMode(job.executionMode, input.health, input.liveVerified);

  // A gate is checked FIRST because it makes the rest of the plan irrelevant: there is no
  // point describing actions that must not run. The plan still lists them so an operator can
  // see what was about to happen.
  const gateBlocks = input.gate !== null;

  const planned: PlannedAction[] = planActions({ ...job, executionMode: degraded.mode }).map((action, index) => {
    const policy = evaluateActionPolicy(action, input.policy);
    return {
      index,
      action,
      sideEffect: isSideEffectAction(action),
      policy,
      description: describe(action),
    };
  });

  const blocked = planned.filter((entry) => !entry.policy.allowed);
  const dryRunActions = planned.filter((entry) => !entry.sideEffect);
  const skippedInDryRun = planned.filter((entry) => entry.sideEffect);

  const ready = !gateBlocks && blocked.length === 0;

  let summary: string;
  if (gateBlocks) {
    summary =
      'Blocked before planning: the page requires a person (' + input.gate + '). ' +
      planned.length +
      ' action(s) were planned but none may run.';
  } else if (blocked.length > 0) {
    summary =
      blocked.length + ' action(s) are forbidden by policy, so the job cannot proceed.';
  } else {
    summary =
      planned.length +
      ' action(s) planned; dry run would perform ' +
      dryRunActions.length +
      ' and skip ' +
      skippedInDryRun.length +
      ' side-effect action(s).';
  }

  return {
    jobId: job.id,
    adapterId: job.adapterId,
    requestedMode: job.executionMode,
    effectiveMode: degraded.mode,
    modeDegraded: degraded.degraded,
    modeReason: degraded.reason,
    actions: planned,
    dryRunActions,
    skippedInDryRun,
    blocked,
    ready,
    summary,
  };
}

/**
 * Does this output policy ask for anything the job cannot deliver?
 *
 * Collecting images from a text-only adapter is a configuration mistake, and reporting it at
 * plan time is far better than discovering it after a successful generation that produced
 * nothing collectable.
 */
export function validateOutputPolicy(
  policy: OutputPolicy,
  taskType: BrowserJob['taskType'],
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (policy.collectImages && taskType === 'text') {
    problems.push('Image collection was requested for a text task.');
  }
  if (policy.collectVideos && taskType === 'text') {
    problems.push('Video collection was requested for a text task.');
  }
  if (policy.collectText && (taskType === 'image' || taskType === 'video')) {
    problems.push('Text collection was requested for a media task; the result may be empty.');
  }
  if (policy.autoDownload && !policy.collectImages && !policy.collectVideos && taskType !== 'text') {
    problems.push('Auto download was requested without collecting any media, so there would be nothing to download.');
  }
  return { ok: problems.length === 0, problems };
}
