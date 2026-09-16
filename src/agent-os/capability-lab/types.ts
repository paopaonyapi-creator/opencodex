/**
 * Phase 20.56 — Micro-App Capability Lab types.
 * Provider-neutral capability factory: import recipes, analyze without executing,
 * promote only through policy + human review.
 */

export type SourceType = "local" | "github" | "pao-seed";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type CandidateType =
  | "FUNCTION"
  | "CLI_SCRIPT"
  | "MODULE"
  | "HTTP_CLIENT"
  | "GUI_APP"
  | "MEDIA_PROCESSOR"
  | "FILE_TOOL"
  | "AUTOMATION"
  | "AI_TOOL"
  | "DATA_PIPELINE"
  | "DEVICE_TOOL"
  | "UNKNOWN";
export type RecipeRecommendation =
  | "GOOD_CANDIDATE"
  | "NEEDS_REFACTOR"
  | "INTERACTIVE_ONLY"
  | "DEVICE_BOUND"
  | "UNSAFE"
  | "DUPLICATE"
  | "IGNORE";
export type CapabilityStatus =
  | "DISCOVERED"
  | "ANALYZED"
  | "MANIFESTED"
  | "QUARANTINED"
  | "TESTING"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "PUBLISHED"
  | "DEPRECATED"
  | "REVOKED"
  | "REJECTED"
  | "FAILED";
export type PolicyEffect = "allow" | "deny" | "require_approval" | "constrain";

export interface CapabilityError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class CapError extends Error implements CapabilityError {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, httpStatus = 409, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface AnalysisSignals {
  readonly imports: readonly string[];
  readonly filesystem: boolean;
  readonly network: boolean;
  readonly subprocess: boolean;
  readonly shell: boolean;
  readonly evalExec: boolean;
  readonly envRead: boolean;
  readonly secrets: boolean;
  readonly gui: boolean;
  readonly device: boolean;
  readonly destructive: boolean;
  readonly dynamicImport: boolean;
}

export interface AnalysisResult {
  readonly filePath: string;
  readonly language: "python";
  readonly candidateType: CandidateType;
  readonly entrypoint: string | null;
  readonly summary: string;
  readonly signals: AnalysisSignals;
  readonly permissions: readonly string[];
  readonly riskScore: number;
  readonly riskLevel: RiskLevel;
  readonly reasons: readonly string[];
  readonly recommendation: RecipeRecommendation;
  readonly licenseHint: string | null;
}

export interface CapabilitySource {
  readonly id: string;
  readonly sourceType: SourceType;
  readonly repositoryUrl?: string;
  readonly sourceRef?: string;
  readonly localPath: string;
  readonly snapshotPath: string;
  readonly sourceSha256: string;
  readonly licenseSpdx: string | null;
  readonly importedBy: string;
  readonly importedAt: string;
}

export interface CapabilityRecipe {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly filePath: string;
  readonly entrypoint: string | null;
  readonly candidateType: CandidateType;
  readonly summary: string;
  readonly status: CapabilityStatus;
  readonly analysis: AnalysisResult;
  readonly riskScore: number;
  readonly riskLevel: RiskLevel;
  readonly recommendation: RecipeRecommendation;
  readonly createdAt: string;
}

export interface CapabilityRecord {
  readonly id: string;
  readonly key: string;
  readonly namespace: string;
  readonly name: string;
  readonly description: string;
  readonly status: CapabilityStatus;
  readonly recipeId: string | null;
  readonly version: string;
  readonly channel: string;
  readonly manifest: CapabilityManifest;
  readonly adapters: readonly AdapterRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdapterRecord {
  readonly type: "mcp" | "skill" | "rest";
  readonly name: string;
  readonly enabled: boolean;
  readonly sha256: string;
  readonly body: string;
}

export interface CapabilityManifest {
  readonly apiVersion: "pao.dev/v1";
  readonly kind: "Capability";
  readonly metadata: {
    readonly id: string;
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly source: {
      readonly type: SourceType;
      readonly path: string;
      readonly repository?: string;
    };
    readonly license: { readonly spdx: string; readonly attributionRequired: boolean };
  };
  readonly runtime: {
    readonly language: "python" | "typescript";
    readonly entrypoint: string;
    readonly timeoutSeconds: number;
    readonly networkMode: "none" | "allowlist";
  };
  readonly inputs: Record<string, unknown>;
  readonly outputs: Record<string, unknown>;
  readonly permissions: readonly string[];
  readonly risk: { readonly level: RiskLevel; readonly score: number; readonly reasons: readonly string[] };
  readonly policy: { readonly approvalRequired: boolean; readonly allowedCallers: readonly string[] };
  readonly adapters: { readonly mcp: boolean; readonly skill: boolean; readonly rest: boolean };
  readonly integrity: { readonly sourceSha256: string; readonly wrapperSha256: string };
}

export interface CapabilityRun {
  readonly id: string;
  readonly capabilityKey: string;
  readonly version: string;
  readonly callerType: string;
  readonly status: "success" | "denied" | "failed";
  readonly policyDecision: string;
  readonly output: unknown;
  readonly artifactIds: readonly string[];
  readonly errorCode?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface CapabilityArtifact {
  readonly id: string;
  readonly runId: string;
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

