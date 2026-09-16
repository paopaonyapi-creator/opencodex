// Phase 20.29 — Pao-hubPro × ClawFlows-inspired Workflow Registry & Safe
// Automation Engine: canonical contracts.
//
// Workflow definition != direct execution (doc §3): every WORKFLOW.md passes
// parse → schema validation → static security scan → permission analysis →
// risk scoring → checksum → dry-run → approval → runtime → audit. Inspired by
// ClawFlows; no upstream code or runtime dependency.

import { randomUUID } from "node:crypto";

export type TriggerType = "manual" | "schedule" | "webhook" | "filesystem" | "git" | "api" | "event" | "pipeline";
export type PermissionMode = "deny" | "read" | "write" | "allow" | "allowlist" | "named";
export type WorkflowRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type WorkflowSource = "local" | "community" | "imported" | "generated" | "system";
export type RunState =
  | "queued" | "planning" | "awaiting_approval" | "running" | "paused"
  | "retrying" | "completed" | "failed" | "cancelled" | "blocked";
export type StepState = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_approval";
export type RetryStrategy = "none" | "fixed" | "linear" | "exponential";

export interface WorkflowPermissions {
  filesystem?: { mode: PermissionMode; paths?: string[] };
  shell?: { mode: PermissionMode; commands?: string[] };
  network?: { mode: PermissionMode; domains?: string[] };
  browser?: { mode: PermissionMode };
  git?: { mode: PermissionMode };
  database?: { mode: PermissionMode };
  secrets?: { mode: PermissionMode; names?: string[] };
  mcp?: { mode: PermissionMode; servers?: string[] };
  external_api?: { mode: PermissionMode; domains?: string[] };
  notifications?: { mode: PermissionMode };
}

export interface WorkflowApprovalConfig {
  before_write?: boolean;
  before_shell?: boolean;
  before_external_action?: boolean;
}

export interface WorkflowRetryConfig {
  max_attempts?: number;
  strategy?: RetryStrategy;
  backoff_seconds?: number;
}

export interface WorkflowFrontMatter {
  id: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  trigger: { type: TriggerType; cron?: string; interval_seconds?: number; timezone?: string };
  runtime: { agent?: string; timeout_seconds?: number };
  permissions: WorkflowPermissions;
  approval?: WorkflowApprovalConfig;
  retry?: WorkflowRetryConfig;
  artifacts?: { output_directory?: string };
  dependencies?: { workflows?: string[] };
  concurrency?: { mode: "single" | "queue" | "parallel" | "replace" };
  tags?: string[];
}

export interface ParsedWorkflow {
  frontMatter: WorkflowFrontMatter;
  body: string;
  steps: string[];
  checksum: string;
}

export interface PermissionManifestEntry {
  domain: keyof WorkflowPermissions;
  mode: PermissionMode;
  detail?: string;
}

export interface CompiledWorkflow {
  workflowId: string;
  version: string;
  name: string;
  steps: Array<{ index: number; title: string; advisory: boolean }>;
  permissions: PermissionManifestEntry[];
  riskScore: number;
  riskLevel: WorkflowRisk;
  requiresApproval: boolean;
  checksum: string;
  warnings: string[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  version: string;
  checksum: string;
  state: RunState;
  dryRun: boolean;
  mode: "normal" | "safe";
  currentStepIndex: number;
  retryCount: number;
  riskLevel: WorkflowRisk;
  approvalId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkflowStepRun {
  id: string;
  runId: string;
  stepIndex: number;
  title: string;
  state: StepState;
  outputSummary?: string;
  error?: string;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowAuditEntry {
  id: string;
  timestamp: string;
  workflowId: string;
  version: string;
  runId?: string;
  stepIndex?: number;
  eventType: string;
  detail: string;
}

export function newWorkflowId(prefix: string): string {
  return prefix + "_" + randomUUID().slice(0, 12);
}
