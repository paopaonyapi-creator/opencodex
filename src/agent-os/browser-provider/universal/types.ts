// Phase 20.19 — Pao Universal AI Browser Provider: core contracts.
//
// WHY THIS LAYER EXISTS. Phase 20.18 built one bridge for one site. Every part of it
// that was not Grok-specific — the job state machine, the selector engine, the bridge
// protocol, the download safety — was already general, but it was filed under a name
// that made adding a second site look like writing a second system.
//
// This file is the boundary that fixes that. A site is described by a MANIFEST and
// implemented by an ADAPTER; nothing above this layer knows which site it is talking to.
// The test of the design is concrete: adding a fifth site should touch an adapter
// directory and a fixture set, and nothing else.
//
// Two rules are load-bearing and are enforced in code rather than in prose:
//   1. Capability is DETECTED, never inferred from a site name. A manifest declares what
//      an adapter CAN do; capabilities() reports what the page actually offers, and the
//      UI is driven by the second. Otherwise every feature silently becomes a claim
//      about a site UI that nobody re-checked.
//   2. An adapter receives a RESTRICTED context. It cannot call Chrome APIs, cannot
//      execute a string as code, and cannot name an arbitrary local file. The typed
//      action vocabulary below is the entire surface it has.

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Capability states
// ---------------------------------------------------------------------------

/**
 * Four states, not a boolean.
 *
 * `detected` and `unknown` are distinct on purpose. `detected` means evidence was seen
 * on this page; `unknown` means nobody has looked yet. Collapsing `unknown` into
 * `unsupported` would make a freshly-installed adapter claim features are missing when
 * they are merely unprobed — and collapsing it into `supported` is worse, because the
 * UI would offer a control that fails.
 */
export type CapabilityState = 'supported' | 'unsupported' | 'detected' | 'unknown';

export const CAPABILITY_KEYS = [
  'text',
  'image',
  'video',
  'audio',
  'upload',
  'download',
  'projectMode',
  'conversationMode',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type BrowserCapabilities = Readonly<Partial<Record<CapabilityKey, CapabilityState>>>;

/** True only when a capability is usable right now. `detected` is not enough to act on. */
export function isUsable(state: CapabilityState | undefined): boolean {
  return state === 'supported' || state === 'detected';
}

/**
 * Merge a manifest declared capability with what was observed.
 *
 * The observation ALWAYS wins when present, in both directions: a page that no longer
 * offers a declared feature must not keep advertising it, and a page that reveals an
 * undeclared feature should be reported honestly rather than hidden by the manifest.
 */
export function mergeCapabilities(
  declared: BrowserCapabilities,
  observed: BrowserCapabilities | null,
): BrowserCapabilities {
  if (!observed) return declared;
  const merged: Partial<Record<CapabilityKey, CapabilityState>> = { ...declared };
  for (const key of CAPABILITY_KEYS) {
    const seen = observed[key];
    if (seen !== undefined) merged[key] = seen;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Adapter manifest
// ---------------------------------------------------------------------------

export interface AdapterPermissions {
  readonly downloads?: boolean;
  readonly clipboard?: boolean;
  readonly fileUpload?: boolean;
}

export interface BrowserAdapterManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Host patterns this adapter claims. Used for detection and permission scoping. */
  readonly hosts: readonly string[];
  /** Page types the adapter understands. */
  readonly pageTypes: readonly string[];
  readonly capabilities: BrowserCapabilities;
  /** Modes this adapter may run in. An adapter that cannot submit omits automatic. */
  readonly executionModes: readonly ExecutionMode[];
  readonly permissions: AdapterPermissions;
  /** Set when the adapter has not been verified against the live site. */
  readonly liveVerified?: boolean;
}

// ---------------------------------------------------------------------------
// Execution modes and human gates
// ---------------------------------------------------------------------------

export const EXECUTION_MODES = ['manual', 'assisted', 'automatic'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/**
 * Conditions that stop automation and require a person.
 *
 * The list is a taxonomy of everything a site can put in the way that must not be
 * worked around. Every one of them maps to a terminal state for the job, never to a
 * retry, because retrying a login wall or a payment prompt is at best useless and at
 * worst an attempted bypass.
 */
export const HUMAN_GATES = [
  'login_required',
  'captcha',
  'account_verification',
  'payment_required',
  'subscription_upgrade',
  'rate_limited',
  'terms_confirmation',
  'sensitive_account_setting',
  'unexpected_dialog',
  'publish_or_delete_confirm',
] as const;

export type HumanGate = (typeof HUMAN_GATES)[number];

/** Human-readable explanation for the operator facing the block. */
export const HUMAN_GATE_DETAIL: Readonly<Record<HumanGate, string>> = {
  login_required: 'The site needs a signed-in session in that tab.',
  captcha: 'The site is asking for human verification.',
  account_verification: 'The account needs verification before it can continue.',
  payment_required: 'The site is asking for payment.',
  subscription_upgrade: 'The site is asking for a plan upgrade.',
  rate_limited: 'The site is applying a rate limit.',
  terms_confirmation: 'The site is asking to accept terms.',
  sensitive_account_setting: 'The page is an account or security setting surface.',
  unexpected_dialog: 'An unexpected dialog appeared; a person should look at it.',
  publish_or_delete_confirm: 'The page asks to publish or delete something.',
};

// ---------------------------------------------------------------------------
// Page context and detection
// ---------------------------------------------------------------------------

/**
 * What the extension reports about a page.
 *
 * Deliberately structural rather than content-bearing: a URL, a title, visible text
 * fragments, aria labels, and roles. The extension never ships whole HTML, and never
 * ships page text that is not needed for detection — a page can contain a private
 * conversation, and detection needs none of it.
 */
export interface PageContext {
  readonly tabId: number;
  readonly url: string;
  readonly title: string;
  readonly host: string;
  readonly documentState: 'loading' | 'interactive' | 'complete';
  readonly visibleText: readonly string[];
  readonly ariaLabels: readonly string[];
  readonly roles: readonly string[];
}

export interface DetectionResult {
  readonly adapterId: string | null;
  readonly pageType: string;
  /** 0..1. Reported rather than rounded into a decision. */
  readonly confidence: number;
  readonly evidence: readonly string[];
  /** True when two or more adapters matched within the ambiguity margin. */
  readonly ambiguous: boolean;
  readonly detail: string;
}

/**
 * Confidence gap below which a detection is ambiguous.
 *
 * When two adapters score within this margin the system refuses to act. Picking the
 * marginally-higher one would mean typing a prompt into whichever site happened to
 * score 0.02 higher, and a wrong-site submission is not recoverable by retrying.
 */
export const AMBIGUITY_MARGIN = 0.15;

// ---------------------------------------------------------------------------
// Typed browser actions
// ---------------------------------------------------------------------------

/** Opaque handle minted by the runtime. An adapter never holds a DOM node. */
export interface ElementHandleRef {
  readonly handle: string;
  readonly adapterId: string;
}

export type BrowserCondition =
  | { readonly kind: 'element_present'; readonly target: string }
  | { readonly kind: 'element_absent'; readonly target: string }
  | { readonly kind: 'text_present'; readonly text: string }
  | { readonly kind: 'idle'; readonly quietMs: number };

/**
 * The complete vocabulary an adapter has for touching a page.
 *
 * There is no evaluate, no runScript, and no querySelector returning a live node. That
 * absence is the security boundary: an adapter is data plus typed intents, and the
 * runtime decides how each intent is carried out. It also means every action is
 * inspectable before it runs, which is what makes dry run meaningful rather than
 * decorative.
 */
export type BrowserAction =
  | { readonly type: 'focus'; readonly target: string }
  | { readonly type: 'set_text'; readonly target: string; readonly value: string }
  | { readonly type: 'click'; readonly target: string }
  | { readonly type: 'upload'; readonly target: string; readonly grantId: string }
  | { readonly type: 'wait_for'; readonly condition: BrowserCondition }
  | { readonly type: 'collect_text'; readonly target: string }
  | { readonly type: 'collect_media'; readonly target: string };

export type BrowserActionType = BrowserAction['type'];

/**
 * Actions that change the outside world.
 *
 * Dry run executes everything EXCEPT these. Separating them by name rather than by a
 * flag on each action means a new action type defaults to the safe side: forgetting to
 * mark something is a compile error in this table, not a silent side effect.
 */
const SIDE_EFFECT_ACTIONS: ReadonlySet<BrowserActionType> = new Set<BrowserActionType>([
  'click',
  'set_text',
  'upload',
]);

export function isSideEffectAction(action: BrowserAction): boolean {
  return SIDE_EFFECT_ACTIONS.has(action.type);
}

/** Per-adapter allow/deny lists, checked before any action is dispatched. */
export interface AdapterPolicy {
  readonly allowed: readonly BrowserActionType[];
  readonly forbidden: readonly BrowserActionType[];
}

export interface PolicyVerdict {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateActionPolicy(action: BrowserAction, policy: AdapterPolicy | null): PolicyVerdict {
  if (!policy) return { allowed: true, reason: 'No policy configured for this adapter.' };
  if (policy.forbidden.includes(action.type)) {
    return { allowed: false, reason: 'Action ' + action.type + ' is forbidden for this adapter.' };
  }
  if (policy.allowed.length > 0 && !policy.allowed.includes(action.type)) {
    return { allowed: false, reason: 'Action ' + action.type + ' is not on this adapter allowed list.' };
  }
  return { allowed: true, reason: 'Action ' + action.type + ' is permitted.' };
}

// ---------------------------------------------------------------------------
// Safe adapter context
// ---------------------------------------------------------------------------

export type SafeLogger = {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
};

export interface ResolvedFileGrant {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
}

export interface SafeFileUploadAPI {
  /** Resolve a grant id into an uploadable reference, or null when unusable. */
  readonly resolve: (grantId: string) => ResolvedFileGrant | null;
}

export interface AdapterEventAPI {
  readonly state: (state: string, detail?: string) => void;
  readonly progress: (percent: number, detail?: string) => void;
}

/**
 * The ONLY surface an adapter receives.
 *
 * No chrome API, no window, no document, no fetch. An adapter that needs one of those
 * is telling you it wants to be a privileged component, and the answer is to add a
 * typed action instead — which makes the capability visible to the policy layer and
 * inspectable in dry run.
 */
export interface AdapterContext {
  readonly tabId: number;
  readonly adapterId: string;
  readonly pageUrl: string;
  readonly page: SafePageAPI;
  readonly files: SafeFileUploadAPI;
  readonly events: AdapterEventAPI;
  readonly logger: SafeLogger;
  readonly config: Readonly<Record<string, unknown>>;
  readonly dryRun: boolean;
}

export interface ElementInfo {
  readonly handle: string;
  readonly text: string;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly editable: boolean;
}

export interface CollectedMedia {
  readonly kind: 'image' | 'video' | 'audio';
  readonly sourceUrl: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: number | null;
}

/**
 * Page operations, expressed as intents.
 *
 * An adapter calls find with a selector target NAME, not a CSS string. The name
 * resolves through the own selector profile, so a page change is a profile edit and
 * never an adapter code change.
 */
export interface SafePageAPI {
  readonly find: (target: string) => Promise<ElementInfo | null>;
  readonly click: (handle: string) => Promise<void>;
  readonly setText: (handle: string, value: string) => Promise<void>;
  readonly getText: (handle: string) => Promise<string>;
  readonly upload: (handle: string, grantId: string) => Promise<void>;
  readonly waitFor: (condition: BrowserCondition) => Promise<boolean>;
  readonly collectMedia: (handle: string) => Promise<readonly CollectedMedia[]>;
}

// ---------------------------------------------------------------------------
// Universal job
// ---------------------------------------------------------------------------

export const TASK_TYPES = ['text', 'image', 'video', 'audio', 'file_analysis', 'custom'] as const;
export type BrowserTaskType = (typeof TASK_TYPES)[number];

export const JOB_INTENTS = [
  'chat',
  'research',
  'image_generation',
  'video_generation',
  'file_analysis',
  'writing',
  'coding',
  'review',
  'custom',
] as const;
export type JobIntent = (typeof JOB_INTENTS)[number];

export interface BrowserJobInput {
  readonly kind: 'file';
  /** A grant id, never a filesystem path. See the file grant broker. */
  readonly grantId: string;
}

export interface OutputPolicy {
  readonly collectText?: boolean;
  readonly collectImages?: boolean;
  readonly collectVideos?: boolean;
  readonly autoDownload?: boolean;
  readonly saveTranscript?: boolean;
  readonly saveProvenance?: boolean;
}

export interface BrowserJob {
  readonly id: string;
  readonly adapterId: string;
  readonly taskType: BrowserTaskType;
  readonly intent: JobIntent;
  readonly prompt: string;
  readonly inputs: readonly BrowserJobInput[];
  readonly options: Readonly<Record<string, unknown>>;
  readonly executionMode: ExecutionMode;
  readonly outputPolicy: OutputPolicy;
  readonly priority: number;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Universal result
// ---------------------------------------------------------------------------

export type BrowserResultType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'mixed';

export interface BrowserMediaResult {
  readonly kind: 'image' | 'video' | 'audio';
  readonly sourceUrl: string | null;
  readonly localPath: string | null;
  readonly sha256: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: number | null;
}

export interface BrowserFileResult {
  readonly name: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly localPath: string | null;
  readonly sha256: string | null;
}

/**
 * A normalized result.
 *
 * provenance is required rather than optional because the downstream pipelines — the
 * reviewer council, the stock export — need to answer where a result came from without
 * consulting a separate table that may have been pruned.
 */
export interface BrowserResult {
  readonly id: string;
  readonly jobId: string;
  readonly adapterId: string;
  readonly resultType: BrowserResultType;
  readonly text: string | null;
  readonly media: readonly BrowserMediaResult[];
  readonly files: readonly BrowserFileResult[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly provenance: {
    readonly source: 'browser';
    readonly adapterVersion: string;
    readonly pageUrl: string | null;
    readonly collectedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Universal errors
// ---------------------------------------------------------------------------

export const BROWSER_ERROR_CODES = [
  'BROWSER_TAB_NOT_FOUND',
  'BROWSER_UNSUPPORTED_PAGE',
  'BROWSER_ADAPTER_NOT_FOUND',
  'BROWSER_ADAPTER_AMBIGUOUS',
  'BROWSER_PROMPT_INPUT_NOT_FOUND',
  'BROWSER_PROMPT_VERIFY_FAILED',
  'BROWSER_UPLOAD_FAILED',
  'BROWSER_FILE_GRANT_INVALID',
  'BROWSER_GENERATION_TIMEOUT',
  'BROWSER_OUTPUT_NOT_FOUND',
  'BROWSER_RESULT_CORRELATION_FAILED',
  'BROWSER_SELECTOR_STALE',
  'BROWSER_ACTION_FORBIDDEN',
  'BROWSER_ADAPTER_DEGRADED',
  'BRIDGE_DISCONNECTED',
  'EXTENSION_DISCONNECTED',
  'DOWNLOAD_FAILED',
  // Legacy codes kept so a Phase 20.18 job in flight does not lose its error identity.
  'GROK_TAB_NOT_FOUND',
  'GROK_UNSUPPORTED_PAGE',
  'GROK_PROMPT_INPUT_NOT_FOUND',
  'GROK_PROMPT_VERIFY_FAILED',
  'GROK_UPLOAD_FAILED',
  'GROK_GENERATION_TIMEOUT',
  'GROK_OUTPUT_NOT_FOUND',
  'GROK_SESSION_REQUIRED',
  'GROK_RATE_LIMITED',
  'GROK_USER_ACTION_REQUIRED',
  'GROK_SELECTOR_STALE',
] as const;

export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];

/** Map a legacy Phase 20.18 error code onto its universal equivalent. */
export function modernizeErrorCode(code: string): BrowserErrorCode {
  const map: Record<string, BrowserErrorCode> = {
    GROK_TAB_NOT_FOUND: 'BROWSER_TAB_NOT_FOUND',
    GROK_UNSUPPORTED_PAGE: 'BROWSER_UNSUPPORTED_PAGE',
    GROK_PROMPT_INPUT_NOT_FOUND: 'BROWSER_PROMPT_INPUT_NOT_FOUND',
    GROK_PROMPT_VERIFY_FAILED: 'BROWSER_PROMPT_VERIFY_FAILED',
    GROK_UPLOAD_FAILED: 'BROWSER_UPLOAD_FAILED',
    GROK_GENERATION_TIMEOUT: 'BROWSER_GENERATION_TIMEOUT',
    GROK_OUTPUT_NOT_FOUND: 'BROWSER_OUTPUT_NOT_FOUND',
    GROK_SELECTOR_STALE: 'BROWSER_SELECTOR_STALE',
  };
  if (map[code]) return map[code]!;
  return (BROWSER_ERROR_CODES as readonly string[]).includes(code)
    ? (code as BrowserErrorCode)
    : 'BROWSER_ADAPTER_NOT_FOUND';
}

/** Legacy gate codes, so a Phase 20.18 job still resolves to a gate. */
export function gateForLegacyCode(code: string): HumanGate | null {
  if (code === 'GROK_SESSION_REQUIRED') return 'login_required';
  if (code === 'GROK_RATE_LIMITED') return 'rate_limited';
  if (code === 'GROK_USER_ACTION_REQUIRED') return 'unexpected_dialog';
  return null;
}

export class BrowserProviderError extends Error {
  readonly code: BrowserErrorCode;
  readonly retryable: boolean;
  readonly gate: HumanGate | null;
  readonly detail: unknown;

  constructor(
    code: BrowserErrorCode,
    message: string,
    options: { retryable?: boolean; gate?: HumanGate; detail?: unknown } = {},
  ) {
    super(message);
    this.name = 'BrowserProviderError';
    this.code = code;
    this.gate = options.gate ?? null;
    // A gated failure is never queue-retryable: retrying a login wall or a CAPTCHA is an
    // attempted bypass, and the job must wait for a person instead.
    this.retryable = options.retryable ?? this.gate === null;
    this.detail = options.detail;
  }

  toJSON(): { code: BrowserErrorCode; message: string; retryable: boolean; gate: HumanGate | null } {
    return { code: this.code, message: this.message, retryable: this.retryable, gate: this.gate };
  }
}

export function newBrowserJobId(): string {
  return 'JOB-' + randomUUID().slice(0, 8).toUpperCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}
