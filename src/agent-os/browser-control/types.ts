/**
 * Phase 20.101 — Pao-hubPro Universal AI Browser Control Plane
 * Provider Contracts, Capabilities, Lease Models, and Persona Specifications.
 */

export type BrowserRiskClass = "R0" | "R1" | "R2" | "R3" | "R4";

export interface BrowserCapabilities {
  cdp: boolean;
  liveView: boolean;
  headful: boolean;
  headless: boolean;
  persona: boolean;
  sessionRestore: boolean;
  humanTakeover: boolean;
  proxySupport: boolean;
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  activeLeases: number;
  maxCapacity: number;
  details?: string;
}

export interface BrowserStartRequest {
  personaId?: string;
  headful?: boolean;
  humanTakeoverRequired?: boolean;
  locale?: string;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface BrowserLease {
  leaseId: string;
  providerId: string;
  browserId: string;
  personaId?: string;
  state: "ready" | "busy" | "paused_for_human" | "released";
  wsEndpoint: string;
  httpEndpoint?: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionSnapshot {
  snapshotId: string;
  personaId: string;
  cookies: Array<{ name: string; value: string; domain: string; path?: string }>;
  localStorage: Record<string, string>;
  url: string;
  capturedAt: string;
}

export interface BrowserConnection {
  leaseId: string;
  executeAction(action: {
    type: "goto" | "click" | "fill" | "upload" | "screenshot" | "evaluate";
    target?: string;
    value?: string;
  }): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  takeScreenshot(): Promise<string>;
}

export interface BrowserProvider {
  readonly id: string;
  readonly name: string;
  readonly trustLevel: "high" | "medium" | "low";
  readonly costPerMinuteUsd: number;

  capabilities(): Promise<BrowserCapabilities>;
  health(): Promise<ProviderHealth>;
  start(req: BrowserStartRequest): Promise<BrowserLease>;
  connect(leaseId: string): Promise<BrowserConnection>;
  stop(leaseId: string): Promise<void>;
  snapshot(leaseId: string): Promise<SessionSnapshot>;
  restore(snapshot: SessionSnapshot): Promise<BrowserLease>;
}

export interface BrowserPersona {
  id: string;
  name: string;
  owner: string;
  mode: "persistent" | "ephemeral";
  browserPreferences: {
    locale: string;
    timezone: string;
    viewport: { width: number; height: number };
    platformPolicy: string;
  };
  auth: {
    credentialRefs: string[];
  };
  storage: {
    cookiesEncrypted: string;
    localStorageEncrypted: string;
  };
  policy: {
    humanRequiredFor: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookStep {
  id: string;
  action: "goto" | "click" | "fill" | "upload" | "assert" | "approval";
  target?: string;
  value?: string;
  policy?: string;
}

export interface BrowserPlaybook {
  id: string;
  version: number;
  description: string;
  personaId?: string;
  allowedHosts: string[];
  inputs: string[];
  steps: PlaybookStep[];
  status: "draft" | "approved" | "deprecated";
  createdAt: string;
}
