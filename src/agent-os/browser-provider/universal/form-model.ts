// Phase 20.19 — Capability-driven form model.
//
// THE RULE THIS ENFORCES. A form must not offer a control that cannot work. The document
// forbids provider-specific UI branches, and the reason is not aesthetic: a hard-coded branch
// keeps offering the field after the site removes the feature, and the operator only finds
// out when a job fails mid-flight.
//
// So the form is COMPUTED from capabilities. Every field visibility is derived from what
// the adapter reported, and unknown DISABLES a field rather than hiding it — a hidden
// control is a control nobody knows exists, while a disabled one can explain itself.

import {
  type BrowserCapabilities,
  type CapabilityState,
  type ExecutionMode,
  type OutputPolicy,
  isUsable,
} from './types';

export type FieldKey =
  | 'prompt'
  | 'referenceFiles'
  | 'outputText'
  | 'outputImages'
  | 'outputVideos'
  | 'autoDownload'
  | 'executionMode';

export interface FormField {
  readonly key: FieldKey;
  readonly label: string;
  /** Rendered but disabled when false. */
  readonly enabled: boolean;
  /** Disabled fields explain themselves rather than silently refusing input. */
  readonly reason: string | null;
  readonly required: boolean;
}

export interface FormModel {
  readonly adapterId: string;
  readonly fields: readonly FormField[];
  /** Modes the adapter declares AND verification permits. */
  readonly allowedModes: readonly ExecutionMode[];
  readonly defaultMode: ExecutionMode;
  readonly capabilityGaps: readonly string[];
  readonly summary: string;
}

function field(
  key: FieldKey,
  label: string,
  state: CapabilityState | undefined,
  options: { required?: boolean; always?: boolean; unknownReason?: string } = {},
): FormField {
  if (options.always) {
    return { key, label, enabled: true, reason: null, required: options.required ?? false };
  }
  if (state === undefined) {
    return { key, label, enabled: false, reason: 'This adapter does not declare this capability.', required: false };
  }
  if (state === 'unsupported') {
    return { key, label, enabled: false, reason: 'This site does not offer it.', required: false };
  }
  if (state === 'unknown') {
    return {
      key,
      label,
      enabled: false,
      reason: options.unknownReason ?? 'Not yet detected on this site; run diagnostics to probe it.',
      required: false,
    };
  }
  return { key, label, enabled: true, reason: null, required: options.required ?? false };
}

/**
 * Build the form for one adapter.
 *
 * allowedModes is intersected with the caller permitted set, so an adapter that supports
 * automatic still does not offer it to an installation that has not enabled it.
 */
export function buildFormModel(input: {
  readonly adapterId: string;
  readonly capabilities: BrowserCapabilities;
  readonly declaredModes: readonly ExecutionMode[];
  readonly permittedModes?: readonly ExecutionMode[];
  readonly liveVerified: boolean;
}): FormModel {
  const caps = input.capabilities;
  const permitted = input.permittedModes ?? (['manual', 'assisted', 'automatic'] as const);

  // Automatic is offered only when the adapter is verified, matching what the degradation
  // layer would enforce anyway. Showing a mode that would be silently reduced teaches the
  // operator that the selector does not mean anything.
  const modes = input.declaredModes.filter((mode) => {
    if (!permitted.includes(mode)) return false;
    if (mode === 'automatic' && !input.liveVerified) return false;
    return true;
  });

  const fields: FormField[] = [
    field('prompt', 'Prompt', 'supported', { always: true, required: true }),
    field('referenceFiles', 'Reference files', caps.upload),
    field('outputText', 'Collect response text', caps.text),
    field('outputImages', 'Collect images', caps.image),
    field('outputVideos', 'Collect video', caps.video),
    field('autoDownload', 'Download results automatically', caps.download),
    field('executionMode', 'Execution mode', 'supported', { always: true }),
  ];

  const gaps = fields
    .filter((entry) => !entry.enabled && entry.key !== 'executionMode')
    .map((entry) => entry.label + ': ' + (entry.reason ?? 'unavailable'));

  const usableCount = fields.filter((entry) => entry.enabled).length;
  const summary =
    usableCount +
    ' of ' +
    fields.length +
    ' fields are available; modes: ' +
    (modes.length > 0 ? modes.join(', ') : 'none');

  return {
    adapterId: input.adapterId,
    fields,
    allowedModes: modes,
    defaultMode: modes.includes('assisted') ? 'assisted' : (modes[0] ?? 'manual'),
    capabilityGaps: gaps,
    summary,
  };
}

/**
 * Derive an output policy from the enabled fields.
 *
 * Only enabled fields contribute, so a disabled collectImages cannot end up in the policy
 * through a default. That is the failure a form-to-policy mapping usually has: the UI hides a
 * field and the default still requests it.
 */
export function outputPolicyFrom(fields: readonly FormField[]): OutputPolicy {
  const enabled = new Set(fields.filter((entry) => entry.enabled).map((entry) => entry.key));
  return {
    collectText: enabled.has('outputText'),
    collectImages: enabled.has('outputImages'),
    collectVideos: enabled.has('outputVideos'),
    autoDownload: enabled.has('autoDownload'),
    saveProvenance: true,
  };
}

/** True when a job could be submitted with this form model at all. */
export function isSubmittable(model: FormModel): { ok: boolean; reason: string } {
  if (model.allowedModes.length === 0) {
    return { ok: false, reason: 'No execution mode is available for this adapter.' };
  }
  const prompt = model.fields.find((entry) => entry.key === 'prompt');
  if (!prompt || !prompt.enabled) {
    return { ok: false, reason: 'The prompt field is unavailable for this adapter.' };
  }
  return { ok: true, reason: 'The form is submittable.' };
}

/** Capabilities a UI needs to display, with unknown preserved rather than flattened. */
export function describeCapabilities(
  caps: BrowserCapabilities,
): { key: string; state: CapabilityState; usable: boolean }[] {
  return Object.entries(caps).map(([key, state]) => ({
    key,
    state: (state ?? 'unknown') as CapabilityState,
    usable: isUsable(state),
  }));
}
