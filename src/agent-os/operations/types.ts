/**
 * Phase 23 — Pao Autonomous Operations & Self-Healing Fleet (AOF) Types
 */

export type NodeType = "local_desktop" | "remote_worker" | "cloud_vm" | "mobile_gateway";

export type NodeStatus = "online" | "degraded" | "offline" | "draining";

export type JobPriority = "P0" | "P1" | "P2" | "P3";

export type JobStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "migrating";

export interface FleetNode {
  id: string;
  name: string;
  nodeType: NodeType;
  status: NodeStatus;
  capabilities: string[];
  endpointUrl?: string;
  activeJobs: number;
  maxConcurrency: number;
  lastHeartbeat: number;
  latencyMs: number;
  cpuLoadPercent: number;
  memoryUsageMb: number;
  metadata?: Record<string, unknown>;
}

export interface FleetJob {
  id: string;
  taskType: string;
  priority: JobPriority;
  payload: Record<string, unknown>;
  requiredCapabilities: string[];
  assignedNodeId?: string;
  status: JobStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  checkpointData?: Record<string, unknown>;
  error?: string;
}

export interface NodeHeartbeatInput {
  latencyMs?: number;
  cpuLoadPercent?: number;
  memoryUsageMb?: number;
  activeJobs?: number;
}

export interface FailoverEvent {
  id: string;
  failedNodeId: string;
  targetNodeId: string;
  migratedJobIds: string[];
  reason: string;
  timestamp: number;
  recoveredSuccessfully: boolean;
}

export interface SloMetrics {
  availabilityPercent: number; // e.g. 99.94
  targetAvailabilityPercent: number; // e.g. 99.9
  errorBudgetMinutesRemaining: number;
  totalErrorBudgetMinutes: number;
  p95LatencyMs: number;
  burnRate: number; // 1.0 = standard consumption, > 2.0 = dangerous
  backpressureActive: boolean;
  evaluatedAt: string;
}

export interface SwarmMessage {
  id: string;
  topic: string;
  senderAgentId: string;
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}
