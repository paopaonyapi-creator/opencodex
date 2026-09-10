// Phase 20.18 — Pao Grok Production Bridge: provider SDK and shared schemas.
//
// The point of this file is the ADAPTER BOUNDARY. Pao-hubPro core must never know
// what the Grok DOM looks like, so everything browser-specific stops here and the
// rest of the system speaks these types. When the Grok UI changes, one selector
// profile changes and nothing else does.
//
// The shapes deliberately mirror `agent-os/generation/types.ts` rather than
// defining a parallel job model: a browser-backed provider is another generation
// provider, and a second job vocabulary would mean two queues that cannot see each
// other's work.

import { randomUUID } from "node:crypto";

/**
 * Browser-backed job states.
 *
 * These are the states a BROWSER introduces and the existing machine has no
 * vocabulary for: "waiting for the extension to see a tab", "the prompt is typed
 * but not verified", "a human must act before this can continue". They are kept as
 * a separate union from `JobStatus` so the Phase 19 machine is not widened by a
 * provider that most installations never enable.
 */
export const BROWSER_JOB_STATES = [
  "queued",
  "waiting_browser",
  "preparing",
  "uploading",
  "prompting",
  "generating",
  "collecting",
  // The terminal states a browser needs that a server-side provider does not.
  "blocked",
  "waiting_user",
  "needs_review",
  "completed",
  "failed",
  "cancelled",
] as const;

export type BrowserJobState = (typeof BROWSER_JOB_STATES)[number];

/**
 * Legal transitions.
 *
 * `blocked` and `waiting_user` are reachable from any active state because a
 * CAPTCHA or an expired session can appear at any point. `needs_review` is entered
 * only by reconciliation, never by a happy path — its whole purpose is to mark the
 * cases where the system could NOT determine what happened, so that a human looks
 * before anything is resubmitted.
 */
const TRANSITIONS: Readonly<Record<BrowserJobState, readonly BrowserJobState[]>> = {
  queued: ["waiting_browser", "cancelled", "blocked", "waiting_user"],
  waiting_browser: ["preparing", "queued", "cancelled", "blocked", "waiting_user", "needs_review"],
  preparing: ["uploading", "prompting", "failed", "cancelled", "blocked", "waiting_user", "needs_review"],
  uploading: ["prompting", "failed", "cancelled", "blocked", "waiting_user", "needs_review"],
  prompting: ["generating", "failed", "cancelled", "blocked", "waiting_user", "needs_review"],
  generating: ["collecting", "failed", "cancelled", "blocked", "waiting_user", "needs_review"],
  collecting: ["completed", "failed", "cancelled", "blocked", "needs_review"],
  blocked: ["waiting_user", "preparing", "cancelled", "failed", "needs_review"],
  waiting_user: ["preparing", "cancelled", "failed", "needs_review"],
  // A needs_review job may be resumed by a human decision, or abandoned.
  needs_review: ["preparing", "cancelled", "failed", "completed"],
  completed: [],
  failed: ["preparing", "cancelled"],
  cancelled: [],
};

export function canTransitionBrowserJob(from: BrowserJobState, to: BrowserJobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertBrowserTransition(from: BrowserJobState, to: BrowserJobState): void {
  if (!canTransitionBrowserJob(from, to)) {
    throw new Error(`Illegal browser job transition ${from} -> ${to}`);
  }
}

/** States from which a job will never progress without intervention. */
export function isTerminal(state: BrowserJobState): boolean {
  return state === "completed" || state === "cancelled";
}

/** States that a restart must reconcile rather than assume. */
export function isInFlight(state: BrowserJobState): boolean {
  return (
    state === "preparing" ||
    state === "uploading" ||
    state === "prompting" ||
    state === "generating" ||
    state === "collecting"
  );
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Typed errors, as the phase requires. Every one of these is a condition the
 * operator can act on; a generic "generation failed" would not be.
 */
export const GROK_ERROR_CODES = [
  "GROK_TAB_NOT_FOUND",
  "GROK_UNSUPPORTED_PAGE",
  "GROK_PROMPT_INPUT_NOT_FOUND",
  "GROK_PROMPT_VERIFY_FAILED",
  "GROK_UPLOAD_FAILED",
  "GROK_GENERATION_TIMEOUT",
  "GROK_OUTPUT_NOT_FOUND",
  "GROK_SESSION_REQUIRED",
  "GROK_RATE_LIMITED",
  "GROK_USER_ACTION_REQUIRED",
  "GROK_SELECTOR_STALE",
  "BRIDGE_DISCONNECTED",
  "EXTENSION_DISCONNECTED",
  "DOWNLOAD_FAILED",
] as const;

export type GrokErrorCode = (typeof GROK_ERROR_CODES)[number];

/**
 * Errors that must move a job to `blocked` rather than `failed`.
 *
 * The distinction is the safety mechanism: a `failed` job may be retried by the
 * queue, while a `blocked` job requires a human. A CAPTCHA that the system retried
 * would be an attempted bypass, and an expired session that it retried would spin
 * forever against a login wall.
 */
const USER_ACTION_CODES: ReadonlySet<GrokErrorCode> = new Set<GrokErrorCode>([
  "GROK_SESSION_REQUIRED",
  "GROK_RATE_LIMITED",
  "GROK_USER_ACTION_REQUIRED",
]);

export function requiresUserAction(code: GrokErrorCode): boolean {
  return USER_ACTION_CODES.has(code);
}

export class GrokBridgeError extends Error {
  readonly code: GrokErrorCode;
  readonly retryable: boolean;
  readonly detail: unknown;

  constructor(code: GrokErrorCode, message: string, options: { retryable?: boolean; detail?: unknown } = {}) {
    super(message);
    this.name = "GrokBridgeError";
    this.code = code;
    // "Retryable" here means the QUEUE may retry it. A user-action block is not
    // retryable by the queue even though the human may retry it by hand.
    this.retryable = options.retryable ?? !requiresUserAction(code);
    this.detail = options.detail;
  }

  toJSON(): { code: GrokErrorCode; message: string; retryable: boolean; detail?: unknown } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Tri-state capability, not a boolean.
 *
 * The phase is explicit that a feature must not be hard-coded as available when
 * the page has not been inspected. `detected` means we saw evidence for it;
 * `unknown` means we have not looked. Collapsing `unknown` into `false` would make
 * the dashboard claim a feature is missing when it is merely unprobed.
 */
export type CapabilityState = "supported" | "unsupported" | "detected" | "unknown";

export interface ProviderCapabilities {
  readonly image: CapabilityState;
  readonly video: CapabilityState;
  readonly referenceUpload: CapabilityState;
  readonly batch: CapabilityState;
  readonly negativePrompt: CapabilityState;
  readonly aspectRatio: CapabilityState;
}

export interface ProviderHealth {
  readonly provider: string;
  readonly available: boolean;
  readonly extensionVersion: string | null;
  readonly pageType: GrokPageType;
  readonly lastHeartbeat: string | null;
  /** True when the heartbeat is older than twice the interval. */
  readonly stale: boolean;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Page detection
// ---------------------------------------------------------------------------

export type GrokPageType =
  | "grok-home"
  | "grok-projects"
  | "grok-imagine"
  | "grok-generation"
  | "login-required"
  | "rate-limited"
  | "unknown"
  | "unsupported";

// ---------------------------------------------------------------------------
// Job and result
// ---------------------------------------------------------------------------

export type MediaType = "image" | "video";

/**
 * A generation request, in provider-neutral terms.
 *
 * `executionMode` is here rather than in the bridge config because it is a
 * property of the WORK, not of the installation: the same operator may want one
 * batch to run assisted and another to run fully automatic.
 */
export const EXECUTION_MODES = ["manual", "assisted", "automatic"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export interface GenerationRequest {
  readonly provider: string;
  readonly mediaType: MediaType;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly count: number;
  readonly aspectRatio?: string;
  readonly project?: string;
  readonly referencePaths?: readonly string[];
  readonly autoDownload?: boolean;
  readonly executionMode?: ExecutionMode;
  readonly priority?: number;
  readonly idempotencyKey?: string;
}

export interface GenerationJobRecord {
  readonly id: string;
  readonly provider: string;
  readonly mediaType: MediaType;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly count: number;
  readonly aspectRatio: string | null;
  readonly project: string | null;
  readonly referencePaths: readonly string[];
  readonly autoDownload: boolean;
  readonly executionMode: ExecutionMode;
  readonly priority: number;
  readonly state: BrowserJobState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly errorCode: GrokErrorCode | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface GenerationResultRecord {
  readonly id: string;
  readonly jobId: string;
  readonly provider: string;
  readonly mediaType: MediaType;
  readonly index: number;
  readonly sourceUrl: string | null;
  readonly localPath: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: number | null;
  readonly prompt: string;
  readonly sha256: string | null;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ProviderSubmission {
  readonly jobId: string;
  readonly accepted: boolean;
  readonly detail: string;
}

/**
 * The provider interface the phase specifies.
 *
 * Every method is async even where an implementation could answer synchronously,
 * because the browser-backed provider can never answer without a round trip and a
 * synchronous signature would force a fake.
 */
export interface GenerationProvider {
  readonly id: string;
  capabilities(): Promise<ProviderCapabilities>;
  submit(request: GenerationRequest): Promise<ProviderSubmission>;
  getStatus(jobId: string): Promise<BrowserJobState>;
  cancel(jobId: string): Promise<void>;
  collect(jobId: string): Promise<readonly GenerationResultRecord[]>;
  health(): Promise<ProviderHealth>;
}

export function newJobId(): string {
  return `JOB-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

