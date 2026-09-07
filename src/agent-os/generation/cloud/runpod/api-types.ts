// Phase 20 — RunPod REST API v1 typed interfaces.
// Official spec: https://docs.runpod.io/api-reference

export interface RunPodPodPort {
  ip?: string;
  isIpPublic?: boolean;
  privatePort: number;
  publicPort?: number;
  type: "http" | "tcp";
}

export interface RunPodRuntime {
  uptimeInSeconds?: number;
  ports?: RunPodPodPort[];
  gpus?: Array<{
    id: string;
    gpuUtilPercent?: number;
    memoryUtilPercent?: number;
  }>;
  container?: {
    cpuPercent?: number;
    memoryPercent?: number;
  };
}

export interface RunPodPod {
  id: string;
  name: string;
  desiredStatus: "RUNNING" | "PAUSED" | "TERMINATED";
  lastStatusChange?: string;
  imageName?: string;
  env?: string[];
  machineId?: string;
  machine?: {
    podHostId?: string;
    gpuDisplayName?: string;
  };
  runtime?: RunPodRuntime;
  costPerHour?: number;
  gpuCount?: number;
  gpuTypeId?: string;
  templateId?: string;
  networkVolumeId?: string;
  volumeMountPath?: string;
  volumeInGb?: number;
  containerDiskInGb?: number;
  dataCenterId?: string;
  createdAt?: string;
  port?: number;
}

export interface RunPodCreatePodInput {
  name: string;
  templateId?: string;
  imageName?: string;
  gpuTypeIds: string[];
  gpuCount?: number;
  containerDiskInGb?: number;
  volumeInGb?: number;
  volumeMountPath?: string;
  networkVolumeId?: string;
  env?: Record<string, string>;
  ports?: string;
  dataCenterId?: string;
  countryCode?: string;
  cloudType?: "ALL" | "COMMUNITY" | "SECURE";
}

export interface RunPodTemplate {
  id: string;
  name: string;
  imageName: string;
  isServerless: boolean;
  category?: string;
  containerDiskInGb?: number;
  volumeInGb?: number;
  volumeMountPath?: string;
  ports?: string;
  env?: Array<{ key: string; value: string }>;
  readme?: string;
}

export interface RunPodNetworkVolume {
  id: string;
  name: string;
  size: number;
  dataCenterId: string;
}

export interface RunPodBillingPodRecord {
  id: string;
  podId: string;
  timeBilledMs: number;
  costPerHour: number;
  amount: number;
  periodStart?: string;
  periodEnd?: string;
  gpuType?: string;
}

export interface RunPodApiErrorResponse {
  error?: string;
  message?: string;
  statusCode?: number;
}
