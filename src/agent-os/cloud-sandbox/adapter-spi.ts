// Phase 20.15 — Cloud Sandbox Plane: Cloud Emulator Adapter SPI.
//
// Source spec §9, adjusted per docs/Phase-20.15 §6. `isAvailable()` and
// `serviceFidelity()` are additions rather than omissions: without them an adapter on a
// host with no Docker daemon has no honest way to answer, and §42 forbids substituting a
// fake success for one.

import type {
  AdapterAvailability,
  CloudActionResult,
  CloudActionRequest,
  CloudEndpointSet,
  CloudProvider,
  CloudResource,
  DestroyReport,
  HealthReport,
  LogBundle,
  SandboxRuntime,
  ServiceFidelity,
  SnapshotRef,
  StartSandboxInput,
} from "./types";

export interface CloudEmulatorAdapter {
  readonly id: string;
  readonly provider: CloudProvider;

  /** Probe the host before promising anything. Never throws. */
  isAvailable(): Promise<AdapterAvailability>;

  startSandbox(input: StartSandboxInput): Promise<SandboxRuntime>;
  stopSandbox(sandboxId: string): Promise<void>;
  health(sandboxId: string): Promise<HealthReport>;
  endpoints(sandboxId: string): Promise<CloudEndpointSet>;
  listResources(sandboxId: string): Promise<CloudResource[]>;

  /** Per-service fidelity so §43 can gate promotion on evidence instead of optimism. */
  serviceFidelity(sandboxId: string, service: string): Promise<ServiceFidelity>;

  execute(sandboxId: string, request: CloudActionRequest): Promise<CloudActionResult>;
  collectLogs(sandboxId: string): Promise<LogBundle>;
  destroy(sandboxId: string): Promise<DestroyReport>;

  snapshot?(sandboxId: string): Promise<SnapshotRef>;
  restore?(snapshot: SnapshotRef): Promise<SandboxRuntime>;
}

/**
 * Adapters register at activation; nothing in the core path imports a concrete one.
 *
 * Same shape as `src/agent-os/providers/provider-registry.ts` and required by
 * docs/Phase-20.15 §4.1: an optional subsystem reaches the core through a slot it
 * registers into, never through an import the core must carry.
 */
export class CloudEmulatorAdapterRegistry {
  private readonly adapters = new Map<string, CloudEmulatorAdapter>();

  register(adapter: CloudEmulatorAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(adapterId: string): void {
    this.adapters.delete(adapterId);
  }

  get(adapterId: string): CloudEmulatorAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  /** First adapter claiming the provider, so callers need not know the adapter id. */
  forProvider(provider: CloudProvider): CloudEmulatorAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.provider === provider) return adapter;
    }
    return undefined;
  }

  list(): CloudEmulatorAdapter[] {
    return [...this.adapters.values()];
  }

  clear(): void {
    this.adapters.clear();
  }
}
