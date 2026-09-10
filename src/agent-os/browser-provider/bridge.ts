// Phase 20.18 — Pao Grok Production Bridge: local bridge service.
//
// Security posture, all of it deliberate:
//
//  - Bound to 127.0.0.1 only. Never 0.0.0.0 by default, and the bind address is not
//    configurable to a public interface through this module.
//  - A local token is REQUIRED on every route except /health. Pairing exists so the
//    token is not simply a constant: the extension must prove it saw a short-lived
//    code, which stops any other local process from attaching to the bridge by
//    guessing a port.
//  - Origin is checked on every request. A page can make requests to localhost from
//    a browser context, so without an origin check any website could drive the
//    bridge through a visitor's browser.
//  - The bridge NEVER receives a Grok cookie or session. It has no route that could
//    accept one, which is a stronger guarantee than a rule saying it must not.

import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import {
  type ExtensionReport,
  getGrokBrowserProvider,
  HEARTBEAT_STALE_MS,
} from "./grok-provider";
import { getGrokBridgeStore } from "./store";
import { detectPage, type PageSignals } from "./page-detector";
import { GROK_ERROR_CODES, type GrokPageType } from "./types";

export const BRIDGE_PROTOCOL = "pao-grok-bridge/1";
export const DEFAULT_BRIDGE_PORT = 43117;
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";

/**
 * Origins allowed to call the bridge.
 *
 * An extension id is a stable, browser-assigned origin. Allowing only chrome-extension
 * origins plus the Pao-hubPro dashboard blocks the drive-by case where an arbitrary
 * page tries to reach localhost.
 */
export function isAllowedOrigin(origin: string | null, allowedExtensionIds: readonly string[]): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol === "chrome-extension:") {
    const id = parsed.hostname;
    // An empty allowlist means the bridge is unusable rather than open. Failing
    // closed here is the whole point of the check.
    return allowedExtensionIds.includes(id);
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  }
  return false;
}

/**
 * Constant-time token comparison.
 *
 * A plain string compare leaks the token's length and prefix through timing. That
 * is a marginal attack on localhost and it costs three lines to remove, so there is
 * no reason to keep the weaker form.
 */
export function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Six-digit pairing code.
 *
 * Short because a human reads and types it, which is why it is also SINGLE USE and
 * time-limited: a code that stayed valid would be a permanent weak credential.
 */
export class PairingRegistry {
  private codes = new Map<string, { code: string; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.now = options.now ?? (() => Date.now());
  }

  issue(clientId: string): { code: string; expiresAt: number } {
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    const expiresAt = this.now() + this.ttlMs;
    this.codes.set(clientId, { code, expiresAt });
    return { code, expiresAt };
  }

  /** Redeem a code. Single use: a successful redeem removes it. */
  redeem(clientId: string, code: string): { ok: boolean; reason: string } {
    const entry = this.codes.get(clientId);
    if (!entry) return { ok: false, reason: "No pairing was started for this client." };
    if (this.now() > entry.expiresAt) {
      this.codes.delete(clientId);
      return { ok: false, reason: "The pairing code expired." };
    }
    if (!tokenMatches(code, entry.code)) return { ok: false, reason: "The pairing code did not match." };
    this.codes.delete(clientId);
    return { ok: true, reason: "Paired." };
  }

  reset(): void {
    this.codes.clear();
  }
}

export interface BridgeConfig {
  readonly port: number;
  readonly host: string;
  readonly token: string;
  readonly allowedExtensionIds: readonly string[];
  readonly downloadsRoot: string;
}

export interface BridgeDeps {
  readonly config: BridgeConfig;
  readonly pairing?: PairingRegistry;
  readonly now?: () => number;
}

/**
 * The bridge's request handling, expressed as pure functions over the store and
 * provider so it is testable without opening a socket.
 */
export class GrokBridgeService {
  readonly config: BridgeConfig;
  readonly pairing: PairingRegistry;
  private now: () => number;

  constructor(deps: BridgeDeps) {
    this.config = deps.config;
    this.pairing = deps.pairing ?? new PairingRegistry();
    this.now = deps.now ?? (() => Date.now());
  }

  /** Authorize a request. Returns null when permitted, or a refusal reason. */
  authorize(input: { origin: string | null; token: string | null; path: string }): string | null {
    // Health is intentionally open: it exposes no state beyond liveness, and the
    // extension needs it before it has a token.
    if (input.path === "/health") return null;
    if (!isAllowedOrigin(input.origin, this.config.allowedExtensionIds)) {
      return "Origin is not allowed to call this bridge.";
    }
    if (!tokenMatches(input.token, this.config.token)) {
      return "A valid bridge token is required.";
    }
    return null;
  }

  health(): {
    ok: boolean;
    service: string;
    protocol: string;
    extensionConnected: boolean;
    queued: number;
    running: string | null;
  } {
    const provider = getGrokBrowserProvider();
    const store = getGrokBridgeStore();
    const session = store.getSession(provider.id);
    const age = session?.lastHeartbeat ? this.now() - Date.parse(session.lastHeartbeat) : Number.POSITIVE_INFINITY;
    const jobs = store.listJobs(undefined, 500);
    const running = jobs.find(
      (job) =>
        job.state === "preparing" ||
        job.state === "prompting" ||
        job.state === "generating" ||
        job.state === "collecting" ||
        job.state === "uploading",
    );
    return {
      ok: true,
      service: "pao-grok-bridge",
      protocol: BRIDGE_PROTOCOL,
      extensionConnected: Boolean(session) && age <= HEARTBEAT_STALE_MS,
      queued: jobs.filter((job) => job.state === "waiting_browser" || job.state === "queued").length,
      running: running?.id ?? null,
    };
  }

  /**
   * Handle an extension heartbeat.
   *
   * The page is DETECTED from the reported signals rather than trusted from a
   * reported string: the extension supplies observations, the bridge decides what
   * they mean. That keeps the detection rules in one testable place.
   */
  heartbeat(input: {
    extensionVersion: string;
    signals: PageSignals;
    capabilities?: Parameters<ReturnType<typeof getGrokBrowserProvider>["recordHeartbeat"]>[0]["capabilities"];
  }): { pageType: GrokPageType; confidence: number; detail: string } {
    const detection = detectPage(input.signals);
    const provider = getGrokBrowserProvider();
    provider.recordHeartbeat({
      extensionVersion: input.extensionVersion,
      pageType: detection.pageType,
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    });
    getGrokBridgeStore().audit({
      action: "heartbeat",
      provider: provider.id,
      extensionVersion: input.extensionVersion,
      pageType: detection.pageType,
    });
    return { pageType: detection.pageType, confidence: detection.confidence, detail: detection.detail };
  }

  applyReport(report: ExtensionReport) {
    const provider = getGrokBrowserProvider();
    const updated = provider.applyReport(report);
    getGrokBridgeStore().audit({
      jobId: report.jobId,
      action: "extension_report",
      provider: provider.id,
      statusAfter: updated.state,
      errorCode: report.errorCode ?? null,
    });
    return updated;
  }

  /** The next job the extension should pick up, honouring the concurrency of one. */
  nextJob(): ReturnType<ReturnType<typeof getGrokBrowserProvider>["nextDispatchable"]> {
    return getGrokBrowserProvider().nextDispatchable();
  }

  /** Validated error code list, exposed so the extension cannot invent one. */
  errorCodes(): readonly string[] {
    return GROK_ERROR_CODES;
  }
}

/** Derive a stable bridge token from a secret rather than storing it in the clear. */
export function deriveBridgeToken(seed: string): string {
  return createHash("sha256").update(`pao-grok-bridge:${seed}`).digest("hex");
}

export function newPairingClientId(): string {
  return randomUUID();
}

let defaultService: GrokBridgeService | null = null;

export function getGrokBridgeService(config?: BridgeConfig): GrokBridgeService {
  if (!defaultService) {
    if (!config) throw new Error("GrokBridgeService has not been configured.");
    defaultService = new GrokBridgeService({ config });
  }
  return defaultService;
}

export function resetGrokBridgeService(): void {
  defaultService = null;
}

