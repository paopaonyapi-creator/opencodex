// Phase 20.11 — Pao-hubPro Browser Domain Models & Types
//
// Core domain types for Agent-Native Browser Runtime,
// MCP control, safety gates, element snapshot ref engine, and audit log.

export type BrowserRiskLevel = "READ" | "LOW" | "CONTROLLED" | "CONFIRM_REQUIRED";

export type ApprovalStatus =
  | "not_required"
  | "pending"
  | "approved_once"
  | "approved_session"
  | "rejected";

export type ActionExecutionResult =
  | "success"
  | "failed"
  | "denied"
  | "rejected"
  | "cancelled";

export interface BrowserSession {
  id: string;
  name: string;
  workspace: string;
  profileDir?: string;
  status: "active" | "idle" | "closed";
  createdAt: number;
  updatedAt: number;
}

export interface BrowserTab {
  id: string;
  sessionId: string;
  title: string;
  url: string;
  active: boolean;
  status: "loading" | "ready" | "crashed" | "closed";
  createdAt: number;
  updatedAt: number;
}

export interface BrowserStatus {
  running: boolean;
  version: string;
  activeWorkspace: string;
  activeTabId: string | null;
  tabs: number;
  killSwitchActive: boolean;
  bridgePort: number;
  connectedAgents: string[];
}

export interface SnapshotElement {
  ref: string; // e.g. "e1", "e2"
  role: string; // "button", "link", "textbox", "checkbox", etc.
  name: string; // accessible name or label
  text?: string; // visible text snippet
  value?: string; // input value
  selector?: string; // CSS selector fallback
  tag: string; // "a", "button", "input", etc.
  clickable: boolean;
  disabled?: boolean;
  checked?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  tabId: string;
  timestamp: string;
  elements: SnapshotElement[];
  rawText?: string;
}

export interface ElementTarget {
  ref?: string; // e1, e2, etc.
  role?: string;
  name?: string;
  text?: string;
  selector?: string;
}

export interface ActionProposal {
  tool: string;
  tabId?: string;
  target?: ElementTarget | string; // ref or target descriptor
  text?: string;
  key?: string;
  button?: "left" | "right" | "middle";
  url?: string;
  deltaX?: number;
  deltaY?: number;
  sensitive?: boolean;
  agent?: string;
  workflowId?: string;
}

export interface ApprovalRequest {
  id: string;
  agent: string;
  actionTool: string;
  website: string;
  reason: string;
  affectedData: Record<string, unknown>;
  status: ApprovalStatus;
  reviewedBy?: string;
  createdAt: number;
  reviewedAt?: number;
}

export interface DownloadItem {
  id: string;
  tabId?: string;
  filename: string;
  url: string;
  mimeType?: string;
  sizeBytes: number;
  status: "started" | "in_progress" | "completed" | "cancelled" | "failed";
  localPath?: string;
  initiatingAgent?: string;
  workflowId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface AuditRecord {
  id?: number;
  timestamp: string;
  agent: string;
  workflowId?: string;
  tabId?: string;
  sessionId?: string;
  tool: string;
  arguments: Record<string, unknown>;
  url?: string;
  riskLevel: BrowserRiskLevel;
  approvalStatus: ApprovalStatus;
  result: ActionExecutionResult;
  error?: string;
  durationMs: number;
  createdAt: number;
}

export interface DomainPolicyRule {
  allow?: string[];
  confirm?: string[];
  deny?: string[];
}

export interface BrowserPolicy {
  defaultPolicy: "safe" | "strict" | "permissive";
  allow: {
    read?: string[];
    navigate?: string[];
  };
  confirm: {
    actions?: string[];
  };
  deny: {
    actions?: string[];
  };
  domains: Record<string, DomainPolicyRule>;
}
