// Phase 20.13 — Pao-hubPro Browser Multi-Agent Web Operations Types & Domain Models
//
// Defines domain models for multi-agent missions, role dispatches, cross-agent handshakes,
// QA evaluations, and approval proposals.

export type AgentRole =
  | "researcher"
  | "uploader"
  | "metadata"
  | "qa"
  | "reviewer"
  | "coordinator";

export type MissionStatus =
  | "pending"
  | "researching"
  | "drafting"
  | "uploading"
  | "qa_evaluating"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export type DispatchStatus = "pending" | "running" | "completed" | "failed";

export type HandshakeArtifactType =
  | "research_brief"
  | "metadata_payload"
  | "upload_receipt"
  | "qa_report"
  | "approval_proposal"
  | "custom";

export interface MultiAgentMission {
  id: string;
  name: string;
  targetDomain: string;
  goal: string;
  status: MissionStatus;
  assignedAgents: AgentRole[];
  contextData: Record<string, unknown>;
  evidencePackId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDispatch {
  id: string;
  missionId: string;
  agentRole: AgentRole;
  status: DispatchStatus;
  tabId?: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  error?: string;
  durationMs: number;
  createdAt: number;
  completedAt?: number;
}

export interface WebHandshake {
  id: string;
  missionId: string;
  fromAgent: AgentRole;
  toAgent: AgentRole;
  artifactType: HandshakeArtifactType;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface QACheckItem {
  id: string;
  name: string;
  passed: boolean;
  message?: string;
  severity: "info" | "warn" | "error";
}

export interface QAEvaluation {
  id: string;
  missionId: string;
  stepIndex: number;
  url: string;
  screenshotB64?: string;
  checks: QACheckItem[];
  verdict: "pass" | "warn" | "fail";
  issues: string[];
  createdAt: number;
}

export interface ResearchBrief {
  domain: string;
  competitorAssets: Array<{
    title: string;
    keywords?: string[];
    viewsOrDownloads?: number;
    url?: string;
  }>;
  recommendedTags: string[];
  marketDemandSignals: string[];
  summary: string;
}

export interface MetadataPayload {
  title: string;
  description: string;
  keywords: string[];
  category?: string;
  complianceTags?: string[];
}

export interface UploadJob {
  files: string[];
  targetSelector?: string;
  allowlistVerified: boolean;
  uploadedCount: number;
  receiptId?: string;
}

export interface ApprovalProposal {
  action: string;
  website: string;
  reason: string;
  riskLevel: "CONTROLLED" | "CONFIRM_REQUIRED";
  affectedData: Record<string, unknown>;
  recommendation: "approve" | "modify" | "reject";
}
