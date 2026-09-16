// Phase 20.64 — Pao-hubPro × Vercel vgpu: Visual Compute Plane.
//
// GPU power is a capability, not a permission. Application code depends on
// the VisualGpuRuntime contract — never on raw VGPU/WebGPU singletons.
// VGPU-specific details stop in runtimes.ts; production baseline is the
// pinned vgpu@0.4.1 (MIT), experimental 0.5/native stays flag-gated off.

export const VISUAL_COMPUTE_POLICY_VERSION = "vc-1";
/** Pinned upstream production baseline (spec §2). */
export const VGPU_PINNED_VERSION = "0.4.1";

export type VisualErrorCode =
  | "VISUAL_COMPUTE_DISABLED"
  | "VISUAL_NOT_FOUND"
  | "VISUAL_INVALID_INPUT"
  | "VISUAL_SHADER_TOO_LARGE"
  | "VISUAL_SHADER_INVALID"
  | "VISUAL_SHADER_IMPORT_BLOCKED"
  | "VISUAL_POLICY_DENIED"
  | "VISUAL_RESOURCE_LIMIT"
  | "VISUAL_CAPABILITY_MISMATCH"
  | "VISUAL_ADAPTER_UNAVAILABLE"
  | "VISUAL_NATIVE_DISABLED"
  | "VISUAL_JOB_NOT_CANCELLABLE"
  | "VISUAL_QUOTA_EXCEEDED";

export class VisualComputeError extends Error {
  readonly code: VisualErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: VisualErrorCode, httpStatus: number, message: string, retryable = false) {
    super(message);
    this.name = "VisualComputeError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

// --- runtime contract (spec §9) ---

export type VisualRuntimeKind = "browser" | "node" | "mock" | "native-experimental";

export interface GpuCapabilitySnapshot {
  runtime: VisualRuntimeKind;
  available: boolean;
  adapterName: string | null;
  backend: string | null;
  features: string[];
  limits: Record<string, number | string | boolean>;
  softwareRenderer: boolean;
  detectedAt: string;
  vgpuVersion: string;
  incompatibilityReason: string | null;
}

export interface ShaderDiagnostic {
  severity: "info" | "warning" | "error";
  code?: string;
  message: string;
  line?: number;
}

export interface ShaderReflection {
  entryPoints: string[];
  bindings: Array<{ group: number; binding: number; class: string; name: string }>;
  workgroupDeclared: boolean;
  imports: Array<{ specifier: string; allowed: boolean; reason: string }>;
}

export interface ShaderValidationResult {
  valid: boolean;
  sourceHash: string;
  diagnostics: ShaderDiagnostic[];
  reflection: ShaderReflection;
}

export interface VisualGpuRuntime {
  readonly kind: VisualRuntimeKind;
  probe(): Promise<GpuCapabilitySnapshot>;
  validateShader(source: string): Promise<ShaderValidationResult>;
  render(input: { shaderSource: string; name: string; width: number; height: number; inputs: Record<string, unknown> }): Promise<VisualJobOutput>;
  compute(input: { shaderSource: string; name: string; inputs: Record<string, unknown> }): Promise<VisualJobOutput>;
  dispose(): Promise<void>;
}

// --- shaders (spec §14-§15) ---

export type ShaderStatus = "draft" | "validating" | "valid" | "invalid" | "approved" | "deprecated" | "blocked";

export interface VisualShader {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ShaderStatus;
  riskClass: "low" | "medium" | "high";
  currentVersionId: string | null;
  currentVersionNo: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualShaderVersion {
  id: string;
  shaderId: string;
  versionNo: number;
  source: string;
  sourceHash: string;
  reflectionJson: ShaderReflection;
  validationJson: ShaderDiagnostic[];
  vgpuVersion: string;
  /** Set once a job has executed this version; source becomes immutable. */
  executedAt: string | null;
  createdBy: string;
  createdAt: string;
}

// --- jobs (spec §18) ---

export type VisualJobType = "render" | "compute" | "validate" | "readback" | "preview";
export type VisualJobStatus =
  | "queued" | "policy_check" | "awaiting_approval" | "scheduled" | "running"
  | "readback" | "persisting" | "completed" | "failed" | "cancelled" | "timed_out" | "blocked";

export const VISUAL_JOB_TRANSITIONS: Record<VisualJobStatus, readonly VisualJobStatus[]> = {
  queued: ["policy_check", "cancelled"],
  policy_check: ["awaiting_approval", "scheduled", "blocked", "cancelled"],
  awaiting_approval: ["scheduled", "cancelled"],
  scheduled: ["running", "cancelled"],
  running: ["readback", "completed", "failed", "timed_out", "cancelled"],
  readback: ["persisting", "failed"],
  persisting: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  blocked: [],
};

export function assertJobTransition(from: VisualJobStatus, to: VisualJobStatus): void {
  if (from === to) return;
  if (!VISUAL_JOB_TRANSITIONS[from].includes(to)) {
    throw new VisualComputeError("VISUAL_INVALID_INPUT", 409, `job transition ${from} -> ${to} is not permitted`);
  }
}

export interface VisualResourceRequest {
  width: number;
  height: number;
  bufferBytes: number;
  readbackBytes: number;
}

export interface VisualGpuJob {
  id: string;
  type: VisualJobType;
  status: VisualJobStatus;
  shaderVersionId: string;
  runtimePreference: "auto" | "browser" | "node" | "mock";
  assignedRuntime: VisualRuntimeKind | null;
  requestedByType: "user" | "agent" | "system";
  requestedById: string;
  width: number;
  height: number;
  inputs: Record<string, unknown>;
  outputFormat: "raw-buffer" | "json";
  policyDecisionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  fingerprint: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// --- artifacts (spec §25) ---

export interface VisualArtifact {
  id: string;
  jobId: string;
  type: "image" | "raw-buffer" | "json" | "manifest" | "metrics";
  mimeType: string;
  storageKey: string | null;
  sha256: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface VisualJobOutput {
  kind: "raw-buffer" | "json";
  /** Raw RGBA pixels (render) or structured result (compute). */
  data: Uint8Array | Record<string, unknown> | number[];
  width: number | null;
  height: number | null;
  metrics: Record<string, unknown>;
}

// --- policy (spec §20-§21) ---

export type VisualRisk = "low" | "medium" | "high" | "blocked";

export interface VisualPolicyDecision {
  id: string;
  jobId: string | null;
  effect: "allow" | "deny" | "require_approval";
  risk: VisualRisk;
  reasons: string[];
  evaluatedRules: Array<{ ruleId: string; result: "pass" | "fail" | "skip" }>;
  actorId: string;
  createdAt: string;
}

// --- docs gateway (spec §27-§28): local preferred, sandboxed ---

export interface DocsEntry {
  path: string;
  title: string;
  excerpt: string;
}
