import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CleanupController } from "../src/agent-os/cloud-sandbox/cleanup";
import { CloudEmulatorAdapterRegistry } from "../src/agent-os/cloud-sandbox/adapter-spi";
import { CloudCapabilityRegistry } from "../src/agent-os/cloud-sandbox/capability-registry";
import { CloudSandboxDbStore } from "../src/agent-os/cloud-sandbox/db-store";
import { MockCloudEmulatorAdapter } from "../src/agent-os/cloud-sandbox/adapters/mock";
import { NullDockerControlPort } from "../src/agent-os/cloud-sandbox/docker-control/null-port";
import { SANDBOX_LABELS, type ContainerInfo, type DockerControlPort, type DockerValidationResult } from "../src/agent-os/cloud-sandbox/docker-control/port";
import { SandboxManager, type CloudAuthorizer } from "../src/agent-os/cloud-sandbox/sandbox-manager";
import type { CloudResource } from "../src/agent-os/cloud-sandbox/types";

class RecordingDockerPort implements DockerControlPort {
  readonly id = "recording";
  containers: ContainerInfo[] = [];
  stopped: string[] = [];
  removed: string[] = [];
  failRemoval = false;

  async isReachable(): Promise<boolean> {
    return true;
  }
  validate(): DockerValidationResult {
    return { ok: true, rejections: [], detail: [] };
  }
  async createContainer(): Promise<string> {
    return "c1";
  }
  async startContainer(): Promise<void> {}
  async inspectContainer(id: string): Promise<ContainerInfo> {
    return this.containers.find((c) => c.id === id)!;
  }
  async stopContainer(id: string): Promise<void> {
    if (this.failRemoval) throw new Error("device or resource busy");
    this.stopped.push(id);
  }
  async removeContainer(id: string): Promise<void> {
    if (this.failRemoval) throw new Error("device or resource busy");
    this.removed.push(id);
    this.containers = this.containers.filter((c) => c.id !== id);
  }
  async listByLabel(label: string): Promise<ContainerInfo[]> {
    const key = label.split("=")[0]!;
    return this.containers.filter((c) => c.labels[key] !== undefined);
  }
}

function container(id: string, sandboxId: string): ContainerInfo {
  return {
    id,
    image: "floci/floci@sha256:x",
    name: `pao-${sandboxId}`,
    state: "running",
    labels: { [SANDBOX_LABELS.sandbox]: sandboxId },
    createdAt: "2026-09-23T00:00:00.000Z",
  };
}

function resource(sandboxId: string, name: string): CloudResource {
  return {
    id: `${sandboxId}:s3:${name}`,
    sandboxId,
    provider: "aws",
    service: "s3",
    type: "s3:bucket",
    name,
    state: "available",
    fidelity: "IN_PROCESS",
    tags: {},
    parentIds: [],
    discoveredAt: "2026-09-23T00:00:00.000Z",
  };
}

const allow: CloudAuthorizer = () => ({ allowed: true, decision: "allow", reason: "test" });

let dir: string;
let store: CloudSandboxDbStore;
let docker: RecordingDockerPort;
let adapter: MockCloudEmulatorAdapter;
let adapters: CloudEmulatorAdapterRegistry;
let manager: SandboxManager;
let cleanup: CleanupController;

beforeEach(() => {
  dir = join(tmpdir(), `cs-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  store = new CloudSandboxDbStore(join(dir, "cloud-sandbox.sqlite3"));
  docker = new RecordingDockerPort();
  adapters = new CloudEmulatorAdapterRegistry();
  adapter = new MockCloudEmulatorAdapter();
  adapters.register(adapter);
  const flags = {
    enabled: true,
    localOnly: true,
    flociImage: null,
    flociEndpoint: "http://127.0.0.1:4566",
    dockerControlEnabled: false,
    iacEnabled: false,
    productionPromotionEnabled: false,
    multiCloudEnabled: false,
    dbPathOverride: null,
  };
  manager = new SandboxManager({
    store,
    adapters,
    capabilities: new CloudCapabilityRegistry(),
    flags,
    authorize: allow,
  });
  cleanup = new CleanupController({ store, adapters, docker, manager });
});

afterEach(() => {
  store.close();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe("phase 20.15 M2 — leak detection surfaces", () => {
  test("a container whose sandbox is still live is never a leak", async () => {
    // The safety-critical direction of this assertion: over-reporting is annoying, but a
    // detector that calls a running sandbox's container an orphan hands a sweeper permission to
    // destroy live work.
    const created = await manager.create({
      id: "sbx_live",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      idempotencyKey: "k-live",
    });
    docker.containers = [container("c-live", created.id)];

    expect(await cleanup.detectContainerLeaks()).toEqual([]);
    expect((await cleanup.removeOrphans()).removed).toEqual([]);
    expect(docker.removed).toEqual([]);
  });

  test("a labelled container with no live sandbox row is reported", async () => {
    docker.containers = [container("c-gone", "sbx_missing"), container("c-failed", "sbx_failed")];
    store.insertSandbox({
      id: "sbx_failed",
      workspaceId: "ws_1",
      taskId: null,
      runId: null,
      actorId: "agent_1",
      provider: "aws",
      adapter: "mock-aws",
      profile: "ephemeral",
      status: "failed",
      endpoints: { base: "", region: "", services: {} },
      config: { services: [], storageMode: "memory", ttlMinutes: 5 },
      createdAt: "2026-09-23T00:00:00.000Z",
      expiresAt: null,
      destroyedAt: null,
    });

    const findings = await cleanup.detectContainerLeaks();
    expect(findings.map((f) => f.identifier).sort()).toEqual(["c-failed", "c-gone"]);
    expect(findings[0]!.kind).toBe("container");
  });

  test("registry rows surviving a destroyed sandbox are reported separately", async () => {
    docker.containers = [];
    await manager.create({
      id: "sbx_r",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      idempotencyKey: "k-r",
    });
    store.upsertResource(resource("sbx_r", "assets"));

    // Not destroyed yet: inventory on a live sandbox is the point, not a leak.
    expect(cleanup.detectRegistryLeaks()).toEqual([]);

    store.markSandboxDestroyed("sbx_r", "2026-09-23T01:00:00.000Z");
    const leaks = cleanup.detectRegistryLeaks();
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({ kind: "registry", identifier: "sbx_r:s3:assets" });
  });

  test("a host with no Docker daemon reports clean rather than erroring", async () => {
    // NullDockerControlPort.listByLabel returns [] by design; the controller must inherit that
    // as "nothing observable leaked", or every ephemeral teardown on Docker-less CI would look
    // like a cleanup failure.
    const quiet = new CleanupController({
      store,
      adapters,
      docker: new NullDockerControlPort(),
      manager,
    });
    expect(await quiet.detectContainerLeaks()).toEqual([]);
    expect(await quiet.detectLeaks()).toEqual([]);
  });
});

describe("phase 20.15 M2 — orphan removal", () => {
  test("removal stops then removes, in that order", async () => {
    docker.containers = [container("c1", "sbx_gone")];
    const result = await cleanup.removeOrphans();
    expect(result.removed).toEqual(["c1"]);
    expect(docker.stopped).toEqual(["c1"]);
    expect(docker.removed).toEqual(["c1"]);
    expect(result.stillLeaked).toEqual([]);
  });

  test("a container that refuses to die is reported, not swallowed", async () => {
    // The tempting bug is a sweep that counts an attempt as a removal. The next cycle would then
    // report a host that still has the container as clean.
    docker.containers = [container("c-stuck", "sbx_gone")];
    docker.failRemoval = true;

    const result = await cleanup.removeOrphans();
    expect(result.removed).toEqual([]);
    expect(result.stillLeaked).toEqual([
      { kind: "container", identifier: "c-stuck", sandboxId: "sbx_gone" },
    ]);
    expect(await cleanup.detectContainerLeaks()).toHaveLength(1);
  });
});

describe("phase 20.15 M2 — cycle and verified destroy", () => {
  test("runCycle reaps expired sandboxes and re-measures afterwards", async () => {
    const doomed = await manager.create({
      id: "sbx_due",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      ttlMinutes: 5,
      idempotencyKey: "k-due",
    });
    const alive = await manager.create({
      id: "sbx_keep",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      ttlMinutes: 480,
      idempotencyKey: "k-keep",
    });
    store.extendSandboxExpiry(doomed.id, "2020-01-01T00:00:00.000Z");
    docker.containers = [container("c-stale", doomed.id)];

    const report = await cleanup.runCycle();
    expect(report.reaped).toEqual([doomed.id]);
    // The sweep catches what the adapter's own destroy could not see.
    expect(report.orphansRemoved).toEqual(["c-stale"]);
    expect(report.outstandingLeaks).toEqual([]);
    expect(report.stranded).toEqual([]);
    expect(store.getSandbox(alive.id)?.status).toBe("ready");
    expect(report.finishedAt >= report.startedAt).toBe(true);
  });

  test("a sandbox left mid-transition is surfaced as stranded", async () => {
    await manager.create({
      id: "sbx_mid",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      idempotencyKey: "k-mid",
    });
    store.updateSandboxStatus("sbx_mid", "destroying");
    expect(cleanup.detectStranded()).toEqual(["sbx_mid"]);
  });

  test("destroyWithVerification reports an emulator-side container that outlives the sandbox", async () => {
    const created = await manager.create({
      id: "sbx_v",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      idempotencyKey: "k-v",
    });
    // Models what Floci actually does for a Docker-backed service: it starts a worker container
    // labelled for the sandbox that the emulator's own teardown does not remove. The mock
    // adapter's destroy only knows about its own container, so this is the leak only the
    // controller can see -- which is the entire reason it re-measures after destroying.
    docker.containers = [container("c-side", created.id)];

    const report = await cleanup.destroyWithVerification(created.id);
    expect(report.ok).toBe(false);
    expect(report.leaked).toEqual([
      { kind: "container", identifier: "c-side", sandboxId: "sbx_v" },
    ]);
    expect(store.getSandbox("sbx_v")?.status).toBe("destroyed");
  });

  test("destroyWithVerification refuses when the adapter vanished", async () => {
    const created = await manager.create({
      id: "sbx_noadapter",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3"],
      idempotencyKey: "k-na",
    });
    adapters.unregister("mock-aws");
    await expect(cleanup.destroyWithVerification(created.id)).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
    });
  });

  test("a healthy destroy with logs is reported ok", async () => {
    const created = await manager.create({
      id: "sbx_ok",
      workspaceId: "ws_1",
      actorId: "agent_1",
      profile: "ephemeral",
      services: ["s3", "dynamodb"],
      idempotencyKey: "k-ok",
    });
    await adapter.execute(created.id, { service: "s3", operation: "create", payload: { name: "b" } });
    // Two different counters, deliberately not conflated: the emulator holds the bucket, while
    // `resourcesRemoved` counts registry rows. Discovering the former from an emulator endpoint is
    // M3's job (Terraform state), so an inventory-only assertion here would be testing nothing.
    expect(await adapter.listResources(created.id)).toHaveLength(1);
    expect(store.listResources(created.id)).toHaveLength(0);

    store.upsertResource(resource(created.id, "b"));
    const report = await cleanup.destroyWithVerification(created.id);
    expect(report.ok).toBe(true);
    expect(report.resourcesRemoved).toBe(1);
    expect(report.leaked).toEqual([]);
  });
});
