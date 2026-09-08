// Provider abstraction for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import type { DeviceState, MobileTrace } from "./types";

export interface ProviderDevice {
  serial: string;
  status: string; // "device" | "offline" | "unauthorized"
  deviceType: "emulator" | "physical";
  model?: string;
}

export interface ProviderTaskRequest {
  serial: string;
  goal: string;
  profile: "flash" | "pro";
  verificationLevel: "off" | "final" | "checkpoints" | "strict";
  timeoutSec?: number;
  evidence?: {
    screenshot?: boolean;
    trace?: boolean;
    hierarchy?: boolean;
  };
}

export interface ProviderTaskResult {
  providerTaskId: string;
  status: "COMPLETED" | "RUNNING" | "FAILED" | "TIMED_OUT";
  traceId: string;
  resultSummary: Record<string, unknown>;
  errorMessage?: string;
}

export interface ProviderTaskStatus {
  providerTaskId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  progressPercent?: number;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
}

export abstract class MobileAutomationProvider {
  public abstract readonly name: string;

  public abstract health(): Promise<{ ok: boolean; version?: string; message?: string }>;

  public abstract listDevices(): Promise<ProviderDevice[]>;

  public abstract runTask(request: ProviderTaskRequest): Promise<ProviderTaskResult>;

  public abstract getTask(providerTaskId: string): Promise<ProviderTaskStatus>;

  public abstract stopTask(providerTaskId: string): Promise<boolean>;

  public abstract injectInstruction(providerTaskId: string, instruction: string): Promise<boolean>;

  public abstract getDeviceState(serial: string): Promise<DeviceState>;

  public abstract inspectTrace(traceId: string): Promise<MobileTrace | null>;
}
