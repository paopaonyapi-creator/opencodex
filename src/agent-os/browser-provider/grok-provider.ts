// Phase 20.18 — Pao Grok Production Bridge: the browser-backed provider.
//
// This is the ADAPTER the phase is really about. Pao-hubPro core speaks
// `GenerationProvider`; everything Grok-specific is behind it. Swapping to a future
// official API means writing another implementation of the same interface, with no
// change to the queue, the dashboard, or the reviewer.
//
// The provider holds NO browser state itself. It records a job, and the extension
// reports progress back. That separation is what makes restart recovery possible:
// the job's truth lives in SQLite, not in a content script's memory.

import { randomUUID } from "node:crypto";
import {
  type BrowserJobState,
  type GenerationJobRecord,
  type GenerationRequest,
  type GenerationResultRecord,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderSubmission,
  type GrokErrorCode,
  GrokBridgeError,
  requiresUserAction,
  nowIso,
} from "./types";
import { getGrokBridgeStore, type GrokBridgeStore, type ProviderSessionRecord } from "./store";
import { getSecretRedactor } from "../desktop-runtime/security/secret-redactor";

/**
 * Heartbeat staleness threshold.
 *
 * The extension beats every ~10s; twice that is the point at which the provider is
 * reported disconnected. A missed heartbeat moves jobs to `waiting_browser` — it
 * never fails them, because a closed laptop is not a failed generation.
 */
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_STALE_MS = 30_000;

export interface ExtensionReport {
  readonly jobId: string;
  readonly state: BrowserJobState;
  readonly errorCode?: GrokErrorCode;
  readonly errorMessage?: string;
  /**
   * Results the extension collected. The extension knows when it OBSERVED an output,
   * while the bridge is authoritative for when the result was recorded, so
   * createdAt is optional here and filled in on arrival.
   */
  readonly results?: readonly (Omit<GenerationResultRecord, "jobId" | "provider" | "createdAt"> & {
    createdAt?: string;
  })[];
  readonly metadata?: Record<string, unknown>;
}

export class GrokBrowserProvider {
  readonly id = "grok-browser";
  private store: GrokBridgeStore;
  private now: () => number;

  constructor(deps: { store?: GrokBridgeStore; now?: () => number } = {}) {
    this.store = deps.store ?? getGrokBridgeStore();
    this.now = deps.now ?? (() => Date.now());
    this.store.init();
  }

  /**
   * Capabilities as REPORTED by the extension, never assumed.
   *
   * `unknown` is the honest answer before the page has been inspected. The spec
   * forbids hard-coding a feature as available, and a hard-coded `true` here would
   * make the dashboard claim video support on a page that has none.
   */
  async capabilities(): Promise<ProviderCapabilities> {
    const session = this.store.getSession(this.id);
    return (
      session?.capabilities ?? {
        image: "unknown",
        video: "unknown",
        referenceUpload: "unknown",
        batch: "unknown",
        negativePrompt: "unknown",
        aspectRatio: "unknown",
      }
    );
  }

  async health(): Promise<ProviderHealth> {
    const session = this.store.getSession(this.id);
    if (!session) {
      return {
        provider: this.id,
        available: false,
        extensionVersion: null,
        pageType: "unknown",
        lastHeartbeat: null,
        stale: false,
        detail: "The extension has never registered with this bridge.",
      };
    }
    const age = session.lastHeartbeat ? this.now() - Date.parse(session.lastHeartbeat) : Number.POSITIVE_INFINITY;
    const stale = age > HEARTBEAT_STALE_MS;
    return {
      provider: this.id,
      available: session.status === "connected" && !stale,
      extensionVersion: session.extensionVersion,
      pageType: session.pageType,
      lastHeartbeat: session.lastHeartbeat,
      stale,
      detail: stale
        ? `No heartbeat for ${Math.round(age / 1000)}s; the extension is treated as disconnected.`
        : `Connected, last heartbeat ${Math.round(age / 1000)}s ago.`,
    };
  }
  
  /**
   * Accept a generation request.
   *
   * Validation happens here rather than in the extension, because a rejection that
   * arrives before a job exists is a clear error, while one that arrives mid-flight
   * leaves an orphaned job to reconcile.
   */
  async submit(request: GenerationRequest): Promise<ProviderSubmission> {
    if (!request.prompt || request.prompt.trim() === "") {
      throw new GrokBridgeError("GROK_PROMPT_INPUT_NOT_FOUND", "A prompt is required.");
    }
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > 16) {
      throw new GrokBridgeError("GROK_USER_ACTION_REQUIRED", "Count must be an integer between 1 and 16.");
    }

    const job = this.store.createJob(request);
    // A job is created queued and IMMEDIATELY moved to waiting_browser: the bridge
    // cannot dispatch until an extension says it has a tab, and pretending otherwise
    // would show a job as dispatched that nothing has seen.
    this.store.setState(job.id, "waiting_browser");
    this.store.audit({ jobId: job.id, action: "submit", provider: this.id, statusAfter: "waiting_browser" });
    return {
      jobId: job.id,
      accepted: true,
      detail: `Job ${job.id} queued and waiting for a Grok tab.`,
    };
  }

  async getStatus(jobId: string): Promise<BrowserJobState> {
    const job = this.store.getJob(jobId);
    if (!job) throw new GrokBridgeError("GROK_TAB_NOT_FOUND", `Unknown job ${jobId}.`);
    return job.state;
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) throw new GrokBridgeError("GROK_TAB_NOT_FOUND", `Unknown job ${jobId}.`);
    if (job.state === "completed" || job.state === "cancelled") return;
    this.store.setState(jobId, "cancelled");
  }

  async collect(jobId: string): Promise<readonly GenerationResultRecord[]> {
    return this.store.listResults(jobId);
  }

  // -- Extension-facing surface --------------------------------------------

  /**
   * Record an extension heartbeat.
   *
   * A heartbeat that goes stale moves waiting jobs back to `waiting_browser`.
   * Critically it does NOT fail them: a closed laptop, a sleeping machine, or a
   * browser restart are all normal, and failing queued work for any of them would
   * make the queue unusable in ordinary use.
   */
  recordHeartbeat(input: {
    extensionVersion: string;
    pageType: ProviderSessionRecord["pageType"];
    capabilities?: ProviderCapabilities;
  }): ProviderSessionRecord {
    const session: ProviderSessionRecord = {
      provider: this.id,
      status: "connected",
      extensionVersion: input.extensionVersion,
      pageType: input.pageType,
      // Stamped from the SAME clock that health() compares against. Using the wall
      // clock here while health() used an injected one produced a negative age, so a
      // long-stale provider reported as connected — two clocks deciding one staleness
      // check is the same defect class as the Domain Control Plane's approval expiry.
      lastHeartbeat: new Date(this.now()).toISOString(),
      capabilities: input.capabilities ?? this.store.getSession(this.id)?.capabilities ?? null,
    };
    this.store.upsertSession(session);
    return session;
  }

  /**
   * Apply an extension state report.
   *
   * A user-action code moves the job to `blocked` and a result arrives only through
   * this path, so the extension cannot mark a job complete without reporting the
   * outputs that justify it.
   */
  applyReport(report: ExtensionReport): GenerationJobRecord {
    const job = this.store.getJob(report.jobId);
    if (!job) throw new GrokBridgeError("GROK_TAB_NOT_FOUND", `Unknown job ${report.jobId}.`);

    if (report.errorCode && requiresUserAction(report.errorCode)) {
      const blocked = this.store.setState(report.jobId, "blocked", {
        errorCode: report.errorCode,
        errorMessage: report.errorMessage ?? null,
      });
      this.store.audit({
        jobId: report.jobId,
        action: "user_action_required",
        provider: this.id,
        statusAfter: "blocked",
        errorCode: report.errorCode,
      });
      return blocked;
    }

    if (report.results && report.results.length > 0) {
      for (const result of report.results) {
        this.store.addResult({
          ...result,
          jobId: report.jobId,
          provider: this.id,
          createdAt: result.createdAt ?? nowIso(),
        });
      }
    }

    if (report.errorCode) {
      const redactor = getSecretRedactor();
      return this.store.setState(report.jobId, report.state, {
        errorCode: report.errorCode,
        // Extension messages can echo page content; redact before storing.
        errorMessage: report.errorMessage ? redactor.redact(report.errorMessage).redacted : null,
      });
    }

    return this.store.setState(report.jobId, report.state);
  }

  /**
   * The job the extension should work on next.
   *
   * Grok concurrency is 1 by default and the phase requires the queue to live in
   * Pao-hubPro rather than in a content script, so this returns at most one job and
   * only when nothing else is in flight.
   */
  nextDispatchable(exclude: readonly string[] = []): GenerationJobRecord | null {
    const jobs = this.store.listJobs(undefined, 500);
    const inFlight = jobs.filter(
      (job) =>
        job.state === "preparing" ||
        job.state === "uploading" ||
        job.state === "prompting" ||
        job.state === "generating" ||
        job.state === "collecting",
    );
    if (inFlight.length > 0) return null;

    const waiting = jobs
      .filter((job) => job.state === "waiting_browser" && !exclude.includes(job.id))
      .sort((a, b) => a.priority - b.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return waiting[0] ?? null;
  }

  /** Provider identifier used by the download manager for its folder layout. */
  resultsFor(jobId: string): GenerationResultRecord[] {
    return this.store.listResults(jobId);
  }
}

let defaultProvider: GrokBrowserProvider | null = null;

export function getGrokBrowserProvider(): GrokBrowserProvider {
  if (!defaultProvider) defaultProvider = new GrokBrowserProvider();
  return defaultProvider;
}

export function resetGrokBrowserProvider(): void {
  defaultProvider = null;
}

export { randomUUID };
