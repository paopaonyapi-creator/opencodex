// Phase 20.14 — Pao-hubPro Browser Remote Worker & Cloud VM Fleet Types
//
// Domain models and schemas for distributed browser nodes, remote RPC,
// worker registry, fleet load balancing, and remote job execution.

export type WorkerStatus = "online" | "busy" | "draining" | "offline";

export type JobStatus =
  | "pending"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type JobType = "action" | "workflow" | "mission";

export interface WorkerCapabilities {
  headless: boolean;
  headed: boolean;
  os?: string;
  proxy?: string;
  tags?: string[];
  browserVersion?: string;
  platform?: string;
}

export interface RemoteWorker {
  id: string;
  name: string;
  endpointUrl: string;
  authTokenHash: string;
  status: WorkerStatus;
  geoRegion: string;
  maxConcurrentJobs: number;
  activeJobs: number;
  capabilities: WorkerCapabilities;
  lastHeartbeatAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteJobDispatch {
  id: string;
  workerId: string;
  jobType: JobType;
  targetDomain?: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string;
  durationMs: number;
  createdAt: number;
  completedAt?: number;
}

export interface RemoteRpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface RemoteRpcResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface FleetStatus {
  totalWorkers: number;
  onlineWorkers: number;
  busyWorkers: number;
  offlineWorkers: number;
  activeJobs: number;
  regions: Record<string, number>;
}
