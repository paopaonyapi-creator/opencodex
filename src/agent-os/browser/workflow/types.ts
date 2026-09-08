// Phase 20.12 — Pao-hubPro Browser Workflow Intelligence Types & Domain Models
//
// Defines domain models for Workflow DSL, interactive recording, deterministic replay,
// visual/semantic validation, self-healing element matching, checkpoints, and task memory.

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StepExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "healed"
  | "retried"
  | "failed"
  | "skipped";

export type RecoveryStrategy = "abort" | "retry" | "heal" | "skip";

export interface ValidationRule {
  type: "url_contains" | "url_matches" | "element_present" | "text_visible" | "element_value";
  expected: string;
  ref?: string;
  selector?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: string; // e.g. "browser.navigate", "browser.click", "approval", "checkpoint"
  arguments: Record<string, unknown>;
  validations?: ValidationRule[];
  recoveryStrategy?: RecoveryStrategy;
  maxRetries?: number;
  isCheckpoint?: boolean;
  timeoutMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: WorkflowStep[];
  parameters?: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "object";
      default?: unknown;
      description?: string;
      required?: boolean;
    }
  >;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Checkpoint {
  stepIndex: number;
  timestamp: string;
  url: string;
  variables: Record<string, unknown>;
  tabId?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentStepIndex: number;
  variables: Record<string, unknown>;
  checkpoints: Checkpoint[];
  error?: string;
  initiatingAgent?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StepLog {
  id?: number;
  runId: string;
  stepIndex: number;
  stepName: string;
  actionTool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: StepExecutionStatus;
  durationMs: number;
  validationResult?: {
    passed: boolean;
    rule?: ValidationRule;
    message?: string;
  };
  createdAt: number;
}

export interface ElementSignature {
  role?: string;
  name?: string;
  text?: string;
  tag?: string;
  selector?: string;
  xpath?: string;
  adjacentText?: string;
}

export interface TaskMemoryRecord {
  id: string;
  domain: string;
  taskPattern: string;
  elementSignatures: Record<string, ElementSignature>;
  successRate: number;
  lastUsedAt: number;
  createdAt: number;
}

export interface SelfHealingResult {
  healed: boolean;
  originalTarget: string;
  healedTarget: string;
  confidence: number;
  strategy: string;
}
