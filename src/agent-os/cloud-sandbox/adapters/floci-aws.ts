// Phase 20.15 M2 — Floci AWS adapter: lifecycle of a real emulator instance.
//
// Scope decision that shapes this whole file: the broker does NOT proxy AWS calls. A sandbox is
// handed an endpoint plus a fake local credential frame (§10 of the source spec) and the agent's
// own AWS SDK, CLI, Terraform or CDK talks to the emulator directly. So this adapter implements
// the parts that need no AWS client -- start, stop, health, endpoints, fidelity, logs, destroy --
// and refuses the parts that would pretend otherwise.
//
// That also decides where resource inventory comes from later: not from emulator internals, which
// upstream does not document, but from Terraform state and plan in M3. `listResources` therefore
// fails loudly rather than returning an empty list that would read as "the sandbox is empty".
//
// Health is a reachability probe, not a documented status endpoint: upstream publishes no core
// `/health` route (only the console sidecar's `/api/health`, which is a different thing and is off
// by default). Any HTTP response -- including a 4xx from an unsigned AWS request -- proves the
// gateway is listening; a transport error does not.

import { CloudSandboxError } from "../errors";
import type { CloudEmulatorAdapter } from "../adapter-spi";
import type { CloudCapabilityRegistry } from "../capability-registry";
import type { DockerControlPort } from "../docker-control/port";
import { SANDBOX_LABELS } from "../docker-control/port";
import { planFlociLaunch, flociClientEnvironment, FLOCI_DEFAULT_REGION } from "./floci-config";
import type { FlociLaunchPlan } from "./floci-config";
import type {
  AdapterAvailability,
  CloudActionResult,
  CloudActionRequest,
  CloudEndpointSet,
  CloudResource,
  DestroyReport,
  HealthReport,
  LogBundle,
  SandboxRuntime,
  ServiceFidelity,
  StartSandboxInput,
} from "../types";

export interface FlociAdapterOptions {
  docker: DockerControlPort;
  capabilities: CloudCapabilityRegistry;
  /** Where per-sandbox emulator state directories are created. Must not be the host home. */
  stateRoot: string;
  /** First port of the range this adapter may bind. Default 4570, deliberately off 4566. */
  portBase?: number;
  region?: string;
  id?: string;
  /** Injectable so tests never touch a network stack. */
  probe?: (url: string, signal?: AbortSignal) => Promise<{ status: number }>;
  pollDeadlineMs?: number;
}

interface ManagedSandbox {
  plan: FlociLaunchPlan;
  containerId: string;
  endpoints: CloudEndpointSet;
  fidelity: Record<string, ServiceFidelity>;
  startedAt: string;
}

const defaultProbe = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, { method: "GET", signal });
  return { status: response.status };
};

export class FlociAwsAdapter implements CloudEmulatorAdapter {
  readonly id: string;
  readonly provider = "aws" as const;

  private readonly docker: DockerControlPort;
  private readonly capabilities: CloudCapabilityRegistry;
  private readonly stateRoot: string;
  private readonly portBase: number;
  private readonly region: string;
  private readonly probe: (url: string, signal?: AbortSignal) => Promise<{ status: number }>;
  private readonly pollDeadlineMs: number;
  private readonly sandboxes = new Map<string, ManagedSandbox>();
  private nextPortIndex = 0;

  constructor(options: FlociAdapterOptions) {
    this.id = options.id ?? "floci-aws";
    this.docker = options.docker;
    this.capabilities = options.capabilities;
    this.stateRoot = options.stateRoot;
    this.portBase = options.portBase ?? 4570;
    this.region = options.region ?? FLOCI_DEFAULT_REGION;
    this.probe = options.probe ?? defaultProbe;
    this.pollDeadlineMs = options.pollDeadlineMs ?? 200;
  }

  private require(sandboxId: string): ManagedSandbox {
    const managed = this.sandboxes.get(sandboxId);
    if (!managed) {
      throw new CloudSandboxError(
        "SANDBOX_NOT_FOUND",
        `This adapter never started sandbox "${sandboxId}".`,
        { sandboxId, operation: "floci.require" },
      );
    }
    return managed;
  }

  /**
   * Availability is Docker-gated by construction.
   *
   * Starting a Floci instance means creating a container, and the only control path to the daemon
   * is the brokered port (source spec §15). With the null port in place this adapter is honestly
   * unavailable rather than optimistically half-working.
   */
  async isAvailable(): Promise<AdapterAvailability> {
    const dockerReachable = await this.docker.isReachable();
    const checkedAt = new Date().toISOString();
    return {
      adapter: this.id,
      available: dockerReachable,
      reason: dockerReachable
        ? undefined
        : "Floci runs as a container, and no brokered Docker control port is reachable.",
      dockerRequired: true,
      dockerReachable,
      checkedAt,
    };
  }

  private async waitForGateway(baseUrl: string, sandboxId: string): Promise<void> {
    const deadline = Date.now() + this.pollDeadlineMs;
    let lastError = "no probe attempted";

    while (Date.now() <= deadline) {
      try {
        // Any HTTP status counts: the gateway answering 403 to an unsigned request is proof it
        // is up, which is the only thing this probe can legitimately conclude.
        await this.probe(`${baseUrl}/health`, undefined);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    throw new CloudSandboxError(
      "SANDBOX_NOT_READY",
      `Floci gateway did not answer on ${baseUrl} within ${this.pollDeadlineMs}ms (${lastError}).`,
      { sandboxId, operation: "floci.waitForGateway" },
    );
  }

  async startSandbox(input: StartSandboxInput): Promise<SandboxRuntime> {
    const availability = await this.isAvailable();
    if (!availability.available) {
      throw new CloudSandboxError(
        "DOCKER_UNAVAILABLE",
        availability.reason ?? "Docker control port is not reachable.",
        { sandboxId: input.id, operation: "floci.startSandbox" },
      );
    }
    if (this.sandboxes.has(input.id)) {
      throw new CloudSandboxError("SANDBOX_START_FAILED", `Sandbox "${input.id}" is already running.`, {
        sandboxId: input.id,
        operation: "floci.startSandbox",
      });
    }

    const port = this.portBase + this.nextPortIndex++;
    const plan = planFlociLaunch({
      sandboxId: input.id,
      stateRoot: this.stateRoot,
      port,
      profile: input.profile,
      storageMode: input.storageMode,
      region: this.region,
    });

    const dockerReachable = await this.docker.isReachable();
    const fidelity: Record<string, ServiceFidelity> = {};
    const services: Record<string, string> = {};
    for (const service of input.services) {
      fidelity[service] = this.capabilities.effectiveFidelity(service, dockerReachable);
      services[service] = plan.baseUrl;
    }

    // Container settings are validated by the port, not here, so the rules cannot drift between
    // adapters. `readonlyRootfs` and the resource limits are what §37 host protection asks for.
    const containerId = await this.docker.createContainer({
      image: plan.image,
      name: `pao-${input.id}`,
      labels: { ...plan.labels, [SANDBOX_LABELS.workspace]: input.workspaceId },
      env: plan.environment,
      networkMode: "bridge",
      readonlyRootfs: false,
      ports: [`${port}/tcp`],
      limits: { cpus: 2, memoryMb: 2048, pidsLimit: 512 },
    });
    await this.docker.startContainer(containerId);

    try {
      await this.waitForGateway(plan.baseUrl, input.id);
    } catch (err) {
      await this.docker.stopContainer(containerId);
      await this.docker.removeContainer(containerId);
      this.sandboxes.delete(input.id);
      throw err;
    }

    const endpoints: CloudEndpointSet = { base: plan.baseUrl, region: this.region, services };
    const startedAt = new Date().toISOString();
    this.sandboxes.set(input.id, { plan, containerId, endpoints, fidelity, startedAt });

    return { id: input.id, adapter: this.id, endpoints, startedAt, fidelity };
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    const managed = this.require(sandboxId);
    await this.docker.stopContainer(managed.containerId);
  }

  async health(sandboxId: string): Promise<HealthReport> {
    const managed = this.require(sandboxId);
    const readyServices: string[] = [];
    const unavailableServices: string[] = [];
    for (const [service, fidelity] of Object.entries(managed.fidelity)) {
      (fidelity === "UNAVAILABLE" ? unavailableServices : readyServices).push(service);
    }

    let endpointReachable = false;
    let detail: string | undefined;
    try {
      endpointReachable = (await this.probe(`${managed.plan.baseUrl}/health`)).status > 0;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }

    return {
      sandboxId,
      state: endpointReachable
        ? unavailableServices.length === 0
          ? "healthy"
          : "degraded"
        : "unreachable",
      endpointReachable,
      readyServices,
      unavailableServices,
      dockerRequired: true,
      checkedAt: new Date().toISOString(),
      detail,
    };
  }

  async endpoints(sandboxId: string): Promise<CloudEndpointSet> {
    return this.require(sandboxId).endpoints;
  }

  async serviceFidelity(sandboxId: string, service: string): Promise<ServiceFidelity> {
    return this.require(sandboxId).fidelity[service] ?? "UNKNOWN";
  }

  /**
   * The client frame an isolated runner should receive.
   *
   * Exposed as a method rather than returned from `endpoints` so a caller cannot mistake the
   * fake local credentials for anything reusable: they are valid only against `baseUrl`.
   */
  clientEnvironment(sandboxId: string): Record<string, string> {
    return flociClientEnvironment(this.require(sandboxId).plan, this.region);
  }

  async listResources(sandboxId: string): Promise<CloudResource[]> {
    // Refusing is correct here. An empty array would tell the observatory, the diff engine and
    // the promotion gate that the sandbox holds nothing, and a "nothing leaked" verdict built on
    // that would be worse than no verdict at all.
    throw new CloudSandboxError(
      "RESOURCE_DISCOVERY_FAILED",
      `Resource inventory for ${sandboxId} comes from IaC state in milestone M3, not from an ` +
        "undocumented emulator endpoint. Assert emptiness against the plan, not the emulator.",
      { sandboxId, operation: "floci.listResources" },
    );
  }

  async execute(sandboxId: string, request: CloudActionRequest): Promise<CloudActionResult> {
    return {
      ok: false,
      service: request.service,
      operation: request.operation,
      errorCode: "SERVICE_UNSUPPORTED",
      message:
        `The broker does not relay AWS actions for ${sandboxId}. Use the injected endpoint and ` +
        "local credential frame from an isolated runner instead.",
    };
  }

  async collectLogs(sandboxId: string): Promise<LogBundle> {
    const managed = this.require(sandboxId);
    return {
      sandboxId,
      collectedAt: new Date().toISOString(),
      streams: [
        {
          name: "floci-container",
          content: `container ${managed.containerId} image ${managed.plan.image}`,
          truncated: false,
        },
      ],
    };
  }

  async destroy(sandboxId: string): Promise<DestroyReport> {
    const managed = this.require(sandboxId);
    const resourcesRemoved = Object.keys(managed.fidelity).length;

    await this.docker.stopContainer(managed.containerId);
    await this.docker.removeContainer(managed.containerId);

    // §47: the label query is what catches an emulator that started service containers of its
    // own (Lambda, RDS, EKS) and left them behind.
    const orphans = await this.docker.listByLabel(`${SANDBOX_LABELS.sandbox}=${sandboxId}`);
    const leaked = orphans
      .filter((orphan) => orphan.id !== managed.containerId)
      .map((orphan) => ({ kind: "container" as const, identifier: orphan.id, sandboxId }));

    this.sandboxes.delete(sandboxId);

    return {
      sandboxId,
      destroyedAt: new Date().toISOString(),
      resourcesRemoved,
      leaked,
      ok: leaked.length === 0,
    };
  }

  /** Ports handed out so far. Not reusable until the gateway probe path is documented upstream. */
  allocatedPorts(): number[] {
    return [...this.sandboxes.values()].map((entry) => entry.plan.port);
  }
}
