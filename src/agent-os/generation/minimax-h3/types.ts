// Phase 20.6 — Pao MiniMax H3 Image Studio domain types.

export type H3Mode =
  | "text_to_image"
  | "image_to_image"
  | "reference_edit"
  | "text_to_image_single"
  | "image_to_image_single"
  | "reference_edit_single"
  | "detail_refiner";

export type H3Preset =
  | "QUALITY"
  | "BALANCED"
  | "FAST"
  | "TURBO_FAST"
  | "REFERENCE_EDIT"
  | "REFERENCE_EDIT_STRONG"
  | "DETAIL_REFINE"
  | "STOCK_SAFE"
  | "EXPERIMENTAL_SINGLE";

export type H3FrameProfile = 1 | 5 | 9 | 13 | 20;
export type H3FrameProfileName = "SINGLE_IMAGE" | "RECOMMENDED" | "EXTENDED" | "HIGH" | "MAXIMUM";

export const FRAME_PROFILE_MAP: Record<H3FrameProfileName, H3FrameProfile> = {
  SINGLE_IMAGE: 1,
  RECOMMENDED: 5,
  EXTENDED: 9,
  HIGH: 13,
  MAXIMUM: 20,
};

export type H3SamplingProfile =
  | "BASE_QUALITY"
  | "BASE_SPEED"
  | "FL2VA_TURBO_8"
  | "FL2VA_TURBO_4_768"
  | "REF2VA_TURBO_4"
  | "HYBRID_SINGLE"
  | "CUSTOM";

export type H3ResolutionPreset = "NATIVE_DETAIL" | "TWO_MP" | "CUSTOM";

export interface H3ResolutionConfig {
  preset: H3ResolutionPreset;
  width: number;
  height: number;
  megapixels: number;
}

export type ReferenceRole =
  | "PRIMARY_IDENTITY"
  | "POSE_REFERENCE"
  | "OUTFIT_REFERENCE"
  | "ENVIRONMENT_REFERENCE"
  | "LIGHTING_REFERENCE"
  | "STYLE_REFERENCE"
  | "COMPOSITION_REFERENCE"
  | "OBJECT_REFERENCE"
  | "COLOR_REFERENCE";

export type LicenseStatus = "ALLOWED" | "REVIEW_REQUIRED" | "DISALLOWED" | "UNKNOWN";

export type H3JobStatus =
  | "QUEUED"
  | "VALIDATING"
  | "WAITING_MODELS"
  | "RUNNING"
  | "SELECTING_OUTPUT"
  | "REVIEW_REQUIRED"
  | "REFINING"
  | "QC"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED_LICENSE"
  | "BLOCKED_POLICY"
  | "CANCELED";

export type H3JobStage =
  | "validating"
  | "waiting_models"
  | "generating"
  | "selecting_output"
  | "review_required"
  | "refining"
  | "qc"
  | "exporting";

export interface StructuredPrompt {
  subject?: string;
  environment?: string;
  action?: string;
  camera?: string;
  lighting?: string;
  style?: string;
  mood?: string;
  composition?: string;
  negativeConstraints?: string;
  stockConstraints?: string;
  repairTarget?: string;
}

export interface ReferenceImageInput {
  role: ReferenceRole;
  imagePath: string;
  description?: string;
  weight?: number;
}

export interface H3WorkflowDefinition {
  id: string;
  name: string;
  category: string;
  mode: H3Mode;
  workflowJson: Record<string, unknown>;
  modelStack: string[];
  experimental: boolean;
  stockSafe: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface H3PresetConfig {
  id: H3Preset;
  name: string;
  mode: H3Mode;
  frameProfile: H3FrameProfile;
  samplingProfile: H3SamplingProfile;
  resolutionPreset: H3ResolutionPreset;
  defaultFidelity: number;
  turboAdapter?: string;
  stockSafe: boolean;
  description: string;
}

export interface H3ModelDefinition {
  id: string;
  modelKey: string;
  category: "diffusion" | "text_encoder" | "vae" | "turbo_adapter" | "refiner";
  filename: string;
  expectedFolder: string;
  sourceUrl: string;
  officialOrCommunity: "official" | "community";
  licenseName: string;
  commercialUseStatus: LicenseStatus;
  stockUseStatus: LicenseStatus;
  approvedForLocal: boolean;
  approvedForRemote: boolean;
  checksum?: string;
  status: "installed" | "missing" | "downloading";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface H3LicensePolicy {
  id: string;
  targetType: "code_repo" | "model_asset" | "output_preset";
  targetKey: string;
  repoCodeLicense: string;
  modelAssetLicense: string;
  commercialUseStatus: LicenseStatus;
  stockUseStatus: LicenseStatus;
  notes: string;
  updatedAt: string;
}

export interface H3JobInput {
  id?: string;
  mode?: H3Mode;
  preset?: H3Preset;
  prompt: string;
  structuredPrompt?: StructuredPrompt;
  resolution?: H3ResolutionPreset;
  width?: number;
  height?: number;
  frameProfile?: H3FrameProfile;
  seed?: number;
  sourceImagePath?: string;
  referenceImages?: ReferenceImageInput[];
  detailRefine?: boolean;
  stockMode?: boolean;
  targetExecutionNode?: "local" | "remote";
  metadata?: Record<string, unknown>;
}

export interface H3Job {
  id: string;
  mode: H3Mode;
  preset: H3Preset;
  prompt: string;
  structuredPrompt?: StructuredPrompt;
  resolution: H3ResolutionPreset;
  width: number;
  height: number;
  frameProfile: H3FrameProfile;
  seed: number;
  sourceImagePath?: string;
  referenceImages: ReferenceImageInput[];
  detailRefine: boolean;
  stockMode: boolean;
  status: H3JobStatus;
  stage: H3JobStage;
  progress: number;
  targetExecutionNode: "local" | "remote";
  selectedCandidateIndex?: number;
  outputImagePath?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface H3Candidate {
  id: string;
  jobId: string;
  candidateIndex: number;
  imagePath: string;
  diagnosticScore?: number;
  isRecommended: boolean;
  isSelected: boolean;
  createdAt: string;
}

export interface H3StockQCResult {
  id: string;
  jobId: string;
  assetId?: string;
  licensePassed: boolean;
  logoCheckPassed: boolean;
  textCheckPassed: boolean;
  anatomyCheckPassed: boolean;
  ipCheckPassed: boolean;
  overallPassed: boolean;
  reviewerNotes: string;
  reviewedBy?: string;
  reviewedAt: string;
}

export interface H3ProvenanceRecord {
  id: string;
  jobId: string;
  assetPath: string;
  promptHash: string;
  workflowKey: string;
  preset: H3Preset;
  seed: number;
  modelManifest: Record<string, unknown>;
  referenceRoles: Array<{ role: ReferenceRole; path: string }>;
  refinementUsed: boolean;
  stockMode: boolean;
  knowledgeSyncStatus: "PENDING" | "SYNCED" | "FAILED";
  createdAt: string;
}

export interface RefinementOptions {
  defectTarget: "eyes" | "hands" | "edges" | "texture" | "general";
  refinePrompt?: string;
  toneLock?: boolean;
  strength?: number;
}
