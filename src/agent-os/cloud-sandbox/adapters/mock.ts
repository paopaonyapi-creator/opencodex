// Phase 20.15 — Cloud Sandbox Plane: in-memory adapter used by every test.
//
// Source spec §39 wants isolation, failure and lifecycle proven; §40 wanted Testcontainers
// for that. This repository is Bun-native with no Docker client and no testcontainers
// dependency, and Docker Desktop on the target host needs a manual start, so tests that
// required a daemon would be tests nobody could run. This adapter is the substitute: the
// full SPI, deterministic, no I/O. Shape follows the adapter+mock pair already in
// `src/agent-os/generation/cloud/runpod/`.
//
// Isolation is the property that matters most here. Source spec §39.3 requires that two
// sandboxes holding a resource with the same name still see different resources, so every
// internal key is sandbox-scoped and the mock allocates a distinct endpoint port per
// sandbox — a shared namespace would let the assertion pass for the wrong reason.

import { CloudSandboxError } from "../errors";
import { CloudCapabilityRegistry, getCloudCapabilityRegistry } from "../capability-registry";
import type { DockerControlPort } from "../docker-control/port";
import { getNullDockerControlPort } from "../docker-control/null-port";
import { SANDBOX_LABELS } from "../docker-control/port";
import type { CloudEmulatorAdapter } from "../adapter-spi";
import { SANDBOX_TTL_LIMITS } from "../types";
import type {
  AdapterAvailability,
  CloudActionResult,
  CloudActionRequest,
  CloudEndpointSet,
  CloudResource,
  DestroyReport,
  HealthReport,
  LeakFinding,
  LogBundle,
  SandboxRuntime,
  ServiceFidelity,
  StartSandboxInput,
} from "../types";

export interface MockAdapterOptions {
  id?: string;
  basePort?: number;
  region?: string;
  docker?: DockerControlPort;
  capabilities?: CloudCapabilityRegistry;
  /** Force `isAvailable()` to report unavailable, for §39.4 failure tests. */
  simulateUnavailable?: boolean;
}

interface MockResourceEntry {
  resource: CloudResource;
}

interface MockSandbox {
  runtime: SandboxRuntime;
  input: StartSandboxInput;
  status: "ready" | "stopped";
  resources: Map<string, MockResourceEntry>;
  logs: string[];
  createdAt: string;
  expiresAt: string | null;
}

export class MockCloudEmulatorAdapter implements CloudEmulatorAdapter {
  readonly id: string;
  readonly provider = "aws" as const;

  private readonly basePort: number;
  private readonly region: string;
  private readonly docker: DockerControlPort;
  private readonly capabilities: CloudCapabilityRegistry;
  private readonly sandboxes = new Map<string, MockSandbox>();
  private readonly portsAllocated: number[] = [];
  private nextPortOffset = 0;

  simulateUnavailable = false;

  constructor(options: MockAdapterOptions = {}) {
    this.id = options.id ?? "mock-aws";
    this.basePort = options.basePort ?? 4566;
    this.region = options.region ?? "us-east-1";
    this.docker = options.docker ?? getNullDockerControlPort();
    this.capabilities = options.capabilities ?? getCloudCapabilityRegistry();
    this.simulateUnavailable = options.simulateUnavailable ?? false;
  }

  private log(sandbox: MockSandbox, line: string): void {
    sandbox.logs.push(`${new Date().toISOString()} ${line}`);
  }

  private require(sandboxId: string): MockSandbox {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new CloudSandboxError("SANDBOX_NOT_FOUND", `No sandbox "${sandboxId}" in this adapter.`, {
        sandboxId,
        operation: "mock.require",
      });
    }
    return sandbox;
  }

  async isAvailable(): Promise<AdapterAvailability> {
    const dockerReachable = await this.docker.isReachable();
    if (this.simulateUnavailable) {
      return {
        adapter: this.id,
        available: false,
        reason: "adapter reported unavailable (simulated)",
        dockerRequired: false,
        dockerReachable,
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      adapter: this.id,
      available: true,
      dockerRequired: false,
      dockerReachable,
      checkedAt: new Date().toISOString(),
    };
  }

  async startSandbox(input: StartSandboxInput): Promise<SandboxRuntime> {
    if (input.ttlMinutes < SANDBOX_TTL_LIMITS.minMinutes || input.ttlMinutes > SANDBOX_TTL_LIMITS.maxMinutes) {
      throw new CloudSandboxError(
        "SANDBOX_START_FAILED",
        `TTL ${input.ttlMinutes}m is outside ${SANDBOX_TTL_LIMITS.minMinutes}-${SANDBOX_TTL_LIMITS.maxMinutes}m.`,
        { sandboxId: input.id, operation: "mock.startSandbox" },
      );
    }
    if (this.sandboxes.has(input.id)) {
      throw new CloudSandboxError("SANDBOX_START_FAILED", `Sandbox "${input.id}" already exists.`, {
        sandboxId: input.id,
        operation: "mock.startSandbox",
      });
    }

    const dockerReachable = await this.docker.isReachable();
    const port = this.basePort + this.nextPortOffset++;
    this.portsAllocated.push(port);
    const base = `http://127.0.0.1:${port}`;

    const fidelity: Record<string, ServiceFidelity> = {};
    const services: Record<string, string> = {};
    for (const service of input.services) {
      fidelity[service] = this.capabilities.effectiveFidelity(service, dockerReachable);
      services[service] = base;
    }

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(createdAt) + input.ttlMinutes * 60_000).toISOString();
    const runtime: SandboxRuntime = {
      id: input.id,
      adapter: this.id,
      endpoints: { base, region: this.region, services },
      startedAt: createdAt,
      fidelity,
    };

    this.sandboxes.set(input.id, {
      runtime,
      input,
      status: "ready",
      resources: new Map(),
      logs: [`sandbox started on ${base} with services: ${input.services.join(", ") || "(none)"}`],
      createdAt,
      expiresAt,
    });

    return runtime;
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    const sandbox = this.require(sandboxId);
    sandbox.status = "stopped";
    this.log(sandbox, "sandbox stopped");
  }

  async health(sandboxId: string): Promise<HealthReport> {
    const sandbox = this.require(sandboxId);
    const dockerReachable = await this.docker.isReachable();

    const readyServices: string[] = [];
    const unavailableServices: string[] = [];
    for (const [service, fidelity] of Object.entries(sandbox.runtime.fidelity)) {
      if (fidelity === "UNAVAILABLE") unavailableServices.push(service);
      else readyServices.push(service);
    }

    const state: HealthReport["state"] =
      unavailableServices.length === 0
        ? "healthy"
        : readyServices.length > 0
          ? "degraded"
          : "unhealthy";

    return {
      sandboxId,
      state,
      endpointReachable: sandbox.status === "ready",
      readyServices,
      unavailableServices,
      dockerRequired: unavailableServices.length > 0 || !dockerReachable,
      checkedAt: new Date().toISOString(),
      detail:
        unavailableServices.length > 0
          ? `no Docker daemon: ${unavailableServices.join(", ")} cannot be emulated`
          : undefined,
    };
  }

  async endpoints(sandboxId: string): Promise<CloudEndpointSet> {
    return this.require(sandboxId).runtime.endpoints;
  }

  async serviceFidelity(sandboxId: string, service: string): Promise<ServiceFidelity> {
    const sandbox = this.require(sandboxId);
    return sandbox.runtime.fidelity[service] ?? "UNKNOWN";
  }

  async listResources(sandboxId: string): Promise<CloudResource[]> {
    const sandbox = this.require(sandboxId);
    return [...sandbox.resources.values()].map((entry) => entry.resource);
  }

  async execute(sandboxId: string, request: CloudActionRequest): Promise<CloudActionResult> {
    const sandbox = this.require(sandboxId);

    if (!this.capabilities.isKnown(request.service)) {
      return {
        ok: false,
        service: request.service,
        operation: request.operation,
        errorCode: "SERVICE_UNSUPPORTED",
        message: `Service "${request.service}" is not in the capability registry.`,
      };
    }

    const fidelity = sandbox.runtime.fidelity[request.service];
    if (fidelity === "UNAVAILABLE") {
      return {
        ok: false,
        service: request.service,
        operation: request.operation,
        errorCode: "DOCKER_UNAVAILABLE",
        message: `"${request.service}" is Docker-backed and no daemon is reachable.`,
      };
    }

    if (request.operation === "create") {
      const name = typeof request.payload?.name === "string" ? request.payload.name : null;
      if (!name) {
        return {
          ok: false,
          service: request.service,
          operation: request.operation,
          errorCode: "SERVICE_UNSUPPORTED",
          message: 'create requires payload.name',
        };
      }
      const resource: CloudResource = {
        id: `${sandboxId}:${request.service}:${name}`,
        sandboxId,
        provider: this.provider,
        service: request.service,
        type: `${request.service}:${name}`,
        name,
        region: this.region,
        state: "available",
        fidelity: fidelity ?? "UNKNOWN",
        tags: { [SANDBOX_LABELS.sandbox]: sandboxId, [SANDBOX_LABELS.workspace]: sandbox.input.workspaceId },
        parentIds: [],
        discoveredAt: new Date().toISOString(),
      };
      sandbox.resources.set(resource.id, { resource });
      this.log(sandbox, `created ${request.service} "${name}"`);
      return { ok: true, service: request.service, operation: request.operation, data: resource };
    }

    if (request.operation === "list") {
      const data = [...sandbox.resources.values()]
        .map((entry) => entry.resource)
        .filter((resource) => resource.service === request.service);
      return { ok: true, service: request.service, operation: request.operation, data };
    }

    if (request.operation === "delete") {
      const name = typeof request.payload?.name === "string" ? request.payload.name : null;
      const key = name ? `${sandboxId}:${request.service}:${name}` : null;
      const removed = key ? sandbox.resources.delete(key) : false;
      this.log(sandbox, `delete ${request.service} "${name ?? ""}" removed=${removed}`);
      return { ok: removed, service: request.service, operation: request.operation, data: { removed } };
    }

    return {
      ok: false,
      service: request.service,
      operation: request.operation,
      errorCode: "SERVICE_UNSUPPORTED",
      message: `Mock adapter implements create/list/delete only; got "${request.operation}".`,
    };
  }

  async collectLogs(sandboxId: string): Promise<LogBundle> {
    const sandbox = this.require(sandboxId);
    return {
      sandboxId,
      collectedAt: new Date().toISOString(),
      streams: [{ name: "mock-emulator", content: sandbox.logs.join("\n"), truncated: false }],
    };
  }

  async destroy(sandboxId: string): Promise<DestroyReport> {
    const sandbox = this.require(sandboxId);
    const resourcesRemoved = sandbox.resources.size;
    sandbox.resources.clear();
    this.log(sandbox, `destroyed, ${resourcesRemoved} resource(s) removed`);

    const leaked: LeakFinding[] = [];
    const orphans = await this.docker.listByLabel(`${SANDBOX_LABELS.sandbox}=${sandboxId}`);
    for (const orphan of orphans) {
      leaked.push({ kind: "container", identifier: orphan.id, sandboxId });
    }

    this.sandboxes.delete(sandboxId);

    return {
      sandboxId,
      destroyedAt: new Date().toISOString(),
      resourcesRemoved,
      leaked,
      ok: leaked.length === 0,
    };
  }

  /**
   * Test helper: every port handed out, including by destroyed sandboxes, so a collision
   * assertion still holds after teardown.
   */
  allocatedPorts(): number[] {
    return [...this.portsAllocated];
  }
}
