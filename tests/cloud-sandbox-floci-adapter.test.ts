import { describe, expect, test } from "bun:test";

import {
  FLOCI_IMAGE_REPOSITORY,
  FLOCI_PINNED_IMAGE,
  flociClientEnvironment,
  planFlociLaunch,
} from "../src/agent-os/cloud-sandbox/adapters/floci-config";
import { FlociAwsAdapter } from "../src/agent-os/cloud-sandbox/adapters/floci-aws";
import { NullDockerControlPort } from "../src/agent-os/cloud-sandbox/docker-control/null-port";
import type { ContainerSpec, DockerControlPort, DockerValidationResult, ContainerInfo } from "../src/agent-os/cloud-sandbox/docker-control/port";
import { SANDBOX_LABELS } from "../src/agent-os/cloud-sandbox/docker-control/port";
import { CloudCapabilityRegistry } from "../src/agent-os/cloud-sandbox/capability-registry";
import { CloudSandboxError } from "../src/agent-os/cloud-sandbox/errors";
import type { StartSandboxInput } from "../src/agent-os/cloud-sandbox/types";

class FakeDockerPort implements DockerControlPort {
  readonly id = "fake";
  reachable = true;
  created: ContainerSpec[] = [];
  stopped: string[] = [];
  removed: string[] = [];
  orphans: ContainerInfo[] = [];
  private seq = 0;

  async isReachable(): Promise<boolean> {
    return this.reachable;
  }
  validate(): DockerValidationResult {
    return { ok: true, rejections: [], detail: [] };
  }
  async createContainer(spec: ContainerSpec): Promise<string> {
    this.created.push(spec);
    return `c${++this.seq}`;
  }
  async startContainer(): Promise<void> {}
  async inspectContainer(id: string): Promise<ContainerInfo> {
    return { id, image: "x", name: "n", state: "running", labels: {}, createdAt: "" };
  }
  async stopContainer(id: string): Promise<void> {
    this.stopped.push(id);
  }
  async removeContainer(id: string): Promise<void> {
    this.removed.push(id);
  }
  async listByLabel(): Promise<ContainerInfo[]> {
    return this.orphans;
  }
}

const baseInput = (overrides: Partial<StartSandboxInput> = {}): StartSandboxInput => ({
  id: "sbx_01",
  workspaceId: "ws_1",
  taskId: null,
  runId: null,
  actorId: "agent_codex_01",
  profile: "ephemeral",
  services: ["s3", "dynamodb"],
  storageMode: "memory",
  ttlMinutes: 60,
  ...overrides,
});

const planInput = (overrides = {}) => ({
  sandboxId: "sbx_01",
  stateRoot: "/tmp/pao-cloud",
  port: 4570,
  profile: "ephemeral" as const,
  ...overrides,
});

describe("phase 20.15 M2 — floci launch plan", () => {
  test("the pinned image carries a digest, never a floating tag", () => {
    expect(FLOCI_PINNED_IMAGE).toContain("@sha256:");
    expect(FLOCI_PINNED_IMAGE).not.toContain(":latest");
    expect(FLOCI_PINNED_IMAGE.startsWith(`${FLOCI_IMAGE_REPOSITORY}@`)).toBe(true);
    expect(planInput()).toBeDefined();
    expect(planFlociLaunch(planInput()).image).toBe(FLOCI_PINNED_IMAGE);
  });

  test("profile selects the storage mode", () => {
    expect(planFlociLaunch(planInput({ profile: "ephemeral" })).storageMode).toBe("memory");
    expect(planFlociLaunch(planInput({ profile: "resumable" })).storageMode).toBe("hybrid");
    expect(planFlociLaunch(planInput({ profile: "durable" })).storageMode).toBe("persistent");
    expect(planFlociLaunch(planInput({ profile: "forensic" })).storageMode).toBe("wal");
  });

  test("an ephemeral sandbox cannot upgrade itself to durable storage", () => {
    expect(() => planFlociLaunch(planInput({ storageMode: "wal" }))).toThrow(/memory-only/);
    expect(planFlociLaunch(planInput({ profile: "durable", storageMode: "wal" })).storageMode).toBe("wal");
  });

  test("the state directory is per sandbox", () => {
    const a = planFlociLaunch(planInput({ sandboxId: "sbx_a" }));
    const b = planFlociLaunch(planInput({ sandboxId: "sbx_b" }));
    expect(a.storagePath).toBe("/tmp/pao-cloud/sbx_a/state");
    expect(a.storagePath).not.toBe(b.storagePath);
    expect(a.environment.FLOCI_STORAGE_PERSISTENT_PATH).toBe(a.storagePath);
  });

  test("a sandbox id that could escape the state root is refused", () => {
    // The id is interpolated into a directory name and a container name, so this is the point
    // where a crafted id would otherwise become a path traversal.
    for (const bad of ["sbx_../../etc", "sbx_a/b", "notprefixed", "sbx_", `sbx_${"x".repeat(49)}`]) {
      expect(() => planFlociLaunch(planInput({ sandboxId: bad }))).toThrow(/must match/);
    }
  });

  test("ports outside the safe range are refused", () => {
    for (const port of [22, 445, 1023, 0, -1, 65536, 4570.5]) {
      expect(() => planFlociLaunch(planInput({ port }))).toThrow(/outside 1024-65535/);
    }
    expect(planFlociLaunch(planInput({ port: 1024 })).port).toBe(1024);
    expect(planFlociLaunch(planInput({ port: 65535 })).port).toBe(65535);
  });

  test("the launch plan never carries AWS client variables", () => {
    // Configuring the emulator and configuring a client of it are different surfaces; mixing
    // them is how fake local credentials leak into a process that should not hold any.
    const env = planFlociLaunch(planInput()).environment;
    expect(Object.keys(env).filter((key) => key.startsWith("AWS_"))).toEqual([]);
    expect(env.FLOCI_SERVICES_UI_ENABLED).toBe("false");
    expect(env.FLOCI_DEFAULT_ACCOUNT_ID).toBe("000000000000");
  });

  test("the console sidecar is opt-in only", () => {
    expect(planFlociLaunch(planInput({ consoleEnabled: true })).environment.FLOCI_SERVICES_UI_ENABLED).toBe("true");
  });

  test("the client frame is local-only and fake", () => {
    const frame = flociClientEnvironment({ baseUrl: "http://127.0.0.1:4570" });
    expect(frame).toEqual({
      AWS_ENDPOINT_URL: "http://127.0.0.1:4570",
      AWS_DEFAULT_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_EC2_METADATA_DISABLED: "true",
    });
  });
});

describe("phase 20.15 M2 — floci adapter availability", () => {
  const capabilities = new CloudCapabilityRegistry();

  function adapterWith(docker: DockerControlPort, probe = async () => ({ status: 200 })) {
    return new FlociAwsAdapter({ docker, capabilities, stateRoot: "/tmp/pao-cloud", probe, pollDeadlineMs: 30 });
  }

  test("with the null Docker port the adapter says so and refuses to start", async () => {
    const adapter = adapterWith(new NullDockerControlPort());
    const availability = await adapter.isAvailable();
    expect(availability.available).toBe(false);
    expect(availability.dockerRequired).toBe(true);

    const err = await adapter.startSandbox(baseInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudSandboxError);
    expect((err as CloudSandboxError).code).toBe("DOCKER_UNAVAILABLE");
    expect((err as CloudSandboxError).retryable).toBe(true);
  });

  test("a reachable port yields a running sandbox with isolated endpoint and labels", async () => {
    const docker = new FakeDockerPort();
    const adapter = adapterWith(docker);
    const runtime = await adapter.startSandbox(baseInput());

    expect(runtime.adapter).toBe("floci-aws");
    expect(runtime.endpoints.base).toBe("http://127.0.0.1:4570");
    expect(runtime.endpoints.services.s3).toBe(runtime.endpoints.base);
    expect(runtime.fidelity.s3).toBe("IN_PROCESS");

    const spec = docker.created[0]!;
    expect(spec.image).toBe(FLOCI_PINNED_IMAGE);
    expect(spec.name).toBe("pao-sbx_01");
    expect(spec.labels[SANDBOX_LABELS.sandbox]).toBe("sbx_01");
    expect(spec.labels[SANDBOX_LABELS.workspace]).toBe("ws_1");
    expect(spec.limits?.memoryMb).toBeGreaterThan(0);
    expect(spec.networkMode).toBe("bridge");
  });

  test("each sandbox binds its own port", async () => {
    const docker = new FakeDockerPort();
    const adapter = adapterWith(docker);
    const a = await adapter.startSandbox(baseInput({ id: "sbx_a" }));
    const b = await adapter.startSandbox(baseInput({ id: "sbx_b" }));
    expect(a.endpoints.base).not.toBe(b.endpoints.base);
    expect(adapter.allocatedPorts()).toEqual([4570, 4571]);
  });

  test("the same id cannot be started twice", async () => {
    const adapter = adapterWith(new FakeDockerPort());
    await adapter.startSandbox(baseInput());
    await expect(adapter.startSandbox(baseInput())).rejects.toThrow(/already running/);
  });

  test("a gateway that never answers is torn down, not left running", async () => {
    const docker = new FakeDockerPort();
    const adapter = adapterWith(docker, async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(adapter.startSandbox(baseInput())).rejects.toMatchObject({ code: "SANDBOX_NOT_READY" });
    expect(docker.stopped).toEqual(["c1"]);
    expect(docker.removed).toEqual(["c1"]);
    await expect(adapter.health("sbx_01")).rejects.toMatchObject({ code: "SANDBOX_NOT_FOUND" });
  });

  test("a Docker-backed service is honest about its fidelity once the port works", async () => {
    // The expectation here was wrong before and the code was right: this adapter can only reach
    // startSandbox when the brokered Docker port is reachable, so a Docker-backed service is
    // DOCKER_BACKED here, not UNAVAILABLE. UNAVAILABLE is the mock's answer, because the mock
    // runs behind NullDockerControlPort. Degradation for this adapter means the gateway itself
    // stopped answering, which is the next case.
    const adapter = adapterWith(new FakeDockerPort());
    await adapter.startSandbox(baseInput({ id: "sbx_ok" }));
    expect((await adapter.health("sbx_ok")).state).toBe("healthy");

    await adapter.startSandbox(baseInput({ id: "sbx_dk", services: ["s3", "lambda"] }));
    const report = await adapter.health("sbx_dk");
    expect(report.state).toBe("healthy");
    expect(report.readyServices.sort()).toEqual(["lambda", "s3"]);
    expect(report.unavailableServices).toEqual([]);
    expect(await adapter.serviceFidelity("sbx_dk", "lambda")).toBe("DOCKER_BACKED");
    expect(await adapter.serviceFidelity("sbx_ok", "nope")).toBe("UNKNOWN");
  });

  test("an adapter whose gateway stops answering reports unreachable", async () => {
    // The probe has to succeed at start and fail afterwards: a probe that never answers makes
    // startSandbox tear the container down (the previous case), so health would never be reached.
    let answering = true;
    const adapter = new FlociAwsAdapter({
      docker: new FakeDockerPort(),
      capabilities,
      stateRoot: "/tmp/pao-cloud",
      pollDeadlineMs: 10,
      probe: async () => {
        if (!answering) throw new Error("connection refused");
        return { status: 200 };
      },
    });

    await adapter.startSandbox(baseInput({ id: "sbx_gone" }));
    expect((await adapter.health("sbx_gone")).state).toBe("healthy");

    answering = false;
    const report = await adapter.health("sbx_gone");
    // Reachability is re-probed per call rather than cached at start, or a dead emulator would
    // keep reporting itself healthy forever.
    expect(report.state).toBe("unreachable");
    expect(report.endpointReachable).toBe(false);
    expect(report.detail).toContain("connection refused");
    expect(report.dockerRequired).toBe(true);
  });

  test("resource inventory refuses instead of reporting an empty sandbox", async () => {
    const adapter = adapterWith(new FakeDockerPort());
    await adapter.startSandbox(baseInput({ id: "sbx_r" }));
    await expect(adapter.listResources("sbx_r")).rejects.toMatchObject({ code: "RESOURCE_DISCOVERY_FAILED" });
  });

  test("the broker does not relay AWS actions", async () => {
    const adapter = adapterWith(new FakeDockerPort());
    await adapter.startSandbox(baseInput({ id: "sbx_x" }));
    const result = await adapter.execute("sbx_x", { service: "s3", operation: "create", payload: { name: "b" } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("SERVICE_UNSUPPORTED");
    expect(result.message).toContain("injected endpoint");
  });

  test("clientEnvironment hands out the fake local frame for the isolated runner", async () => {
    const adapter = adapterWith(new FakeDockerPort());
    await adapter.startSandbox(baseInput({ id: "sbx_c" }));
    const frame = adapter.clientEnvironment("sbx_c");
    expect(frame.AWS_ACCESS_KEY_ID).toBe("test");
    expect(frame.AWS_ENDPOINT_URL).toBe("http://127.0.0.1:4570");
  });

  test("destroy stops, removes, and reports orphaned service containers as leaks", async () => {
    const docker = new FakeDockerPort();
    const adapter = adapterWith(docker);
    await adapter.startSandbox(baseInput({ id: "sbx_d" }));

    docker.orphans = [
      { id: "c1", image: "x", name: "pao-sbx_d", state: "exited", labels: {}, createdAt: "" },
      { id: "orphan-lambda", image: "lambda", name: "n", state: "running", labels: {}, createdAt: "" },
    ];

    const report = await adapter.destroy("sbx_d");
    expect(docker.removed).toEqual(["c1"]);
    // The adapter's own container is not a leak; a Lambda container Floci started is.
    expect(report.leaked).toEqual([{ kind: "container", identifier: "orphan-lambda", sandboxId: "sbx_d" }]);
    expect(report.ok).toBe(false);
    await expect(adapter.destroy("sbx_d")).rejects.toMatchObject({ code: "SANDBOX_NOT_FOUND" });
  });

  test("logs identify the container without inventing a log source", async () => {
    const adapter = adapterWith(new FakeDockerPort());
    await adapter.startSandbox(baseInput({ id: "sbx_l" }));
    const bundle = await adapter.collectLogs("sbx_l");
    expect(bundle.streams[0]?.name).toBe("floci-container");
    expect(bundle.streams[0]?.content).toContain("c1");
    expect(bundle.streams[0]?.content).toContain(FLOCI_IMAGE_REPOSITORY);
  });
});
