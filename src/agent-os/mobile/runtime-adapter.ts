/**
 * Phase 20.55 — Pao-owned mobile runtime adapter.
 * Callers depend on this contract, not ARTEMIS MCP tool names.
 */

import type { DeviceState, MobileTrace } from "./types";
import { getArtemisProvider, type ArtemisProvider } from "./artemis-adapter";
import { diagnoseMobileRuntime, type MobileDiagnosticReport } from "./diagnostics";

export interface RuntimeDevice {
  readonly serial: string;
  readonly status: string;
  readonly deviceType: "emulator" | "physical";
  readonly model?: string;
}

export interface MobileRuntimeAdapter {
  runtimeName(): string;
  runtimeVersion(): Promise<string | null>;
  listDevices(): Promise<RuntimeDevice[]>;
  runTask(input: { serial: string; goal: string; profile: "flash" | "pro"; verificationLevel: "off" | "final" | "checkpoints" | "strict" }): Promise<{ providerTaskId: string; traceId: string; status: string }>;
  getDeviceState(serial: string): Promise<DeviceState>;
  inspectTrace(traceId: string): Promise<MobileTrace | null>;
  diagnose(): Promise<MobileDiagnosticReport>;
}

export class ArtemisMcpAdapter implements MobileRuntimeAdapter {
  constructor(private readonly provider: ArtemisProvider = getArtemisProvider()) {}

  runtimeName(): string {
    return this.provider.name;
  }

  async runtimeVersion(): Promise<string | null> {
    const health = await this.provider.health();
    return health.version ?? null;
  }

  listDevices(): Promise<RuntimeDevice[]> {
    return this.provider.listDevices();
  }

  async runTask(input: { serial: string; goal: string; profile: "flash" | "pro"; verificationLevel: "off" | "final" | "checkpoints" | "strict" }) {
    const result = await this.provider.runTask({
      serial: input.serial,
      goal: input.goal,
      profile: input.profile,
      verificationLevel: input.verificationLevel,
      evidence: { screenshot: true, trace: true, hierarchy: true },
    });
    return { providerTaskId: result.providerTaskId, traceId: result.traceId, status: result.status };
  }

  getDeviceState(serial: string): Promise<DeviceState> {
    return this.provider.getDeviceState(serial);
  }

  inspectTrace(traceId: string): Promise<MobileTrace | null> {
    return this.provider.inspectTrace(traceId);
  }

  diagnose(): Promise<MobileDiagnosticReport> {
    return diagnoseMobileRuntime();
  }
}

let adapter: ArtemisMcpAdapter | null = null;
export function getMobileRuntimeAdapter(): MobileRuntimeAdapter {
  if (!adapter) adapter = new ArtemisMcpAdapter();
  return adapter;
}

