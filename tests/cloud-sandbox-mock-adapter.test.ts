import { afterEach, describe, expect, test } from "bun:test";

import { MockCloudEmulatorAdapter } from "../src/agent-os/cloud-sandbox/adapters/mock";
import { CloudEmulatorAdapterRegistry } from "../src/agent-os/cloud-sandbox/adapter-spi";
import { CloudSandboxError } from "../src/agent-os/cloud-sandbox/errors";
import {
  activateCloudSandboxPlane,
  getCloudEmulatorAdapterRegistry,
  resetCloudSandboxForTests,
} from "../src/agent-os/cloud-sandbox/index";
import type { StartSandboxInput } from "../src/agent-os/cloud-sandbox/types";
import { SANDBOX_TTL_LIMITS } from "../src/agent-os/cloud-sandbox/types";

function input(id: string, overrides: Partial<StartSandboxInput> = {}): StartSandboxInput {
  return {
    id,
    workspaceId: "ws_1",
    taskId: "task_1",
    runId: "run_1",
    actorId: "agent_codex_01",
    profile: "ephemeral",
    services: ["s3", "dynamodb", "sqs"],
    storageMode: "memory",
    ttlMinutes: SANDBOX_TTL_LIMITS.defaultMinutes,
    ...overrides,
  };
}

describe("phase 20.15 — mock adapter lifecycle", () => {
  test("starting a sandbox yields endpoints and per-service fidelity", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    const runtime = await adapter.startSandbox(input("sbx_1"));

    expect(runtime.id).toBe("sbx_1");
    expect(runtime.adapter).toBe("mock-aws");
    expect(runtime.endpoints.region).toBe("us-east-1");
    expect(runtime.endpoints.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Object.keys(runtime.endpoints.services).sort()).toEqual(["dynamodb", "s3", "sqs"]);
    expect(runtime.fidelity.s3).toBe("IN_PROCESS");
    expect(runtime.fidelity.lambda).toBeUndefined();
  });

  test("availability reflects the Docker port, and can be forced down for §39.4", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    const up = await adapter.isAvailable();
    expect(up.available).toBe(true);
    expect(up.dockerReachable).toBe(false);
    expect(up.dockerRequired).toBe(false);

    const down = new MockCloudEmulatorAdapter({ simulateUnavailable: true });
    const verdict = await down.isAvailable();
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("simulated");
  });

  test("a TTL outside the §5.3 bounds refuses to start", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    for (const ttlMinutes of [0, 1, SANDBOX_TTL_LIMITS.minMinutes - 1, SANDBOX_TTL_LIMITS.maxMinutes + 1, 9999]) {
      await expect(adapter.startSandbox(input("sbx_ttl", { ttlMinutes }))).rejects.toThrow(CloudSandboxError);
    }
    for (const ttlMinutes of [SANDBOX_TTL_LIMITS.minMinutes, SANDBOX_TTL_LIMITS.maxMinutes]) {
      await expect(adapter.startSandbox(input(`sbx_ok_${ttlMinutes}`, { ttlMinutes }))).resolves.toBeDefined();
    }
  });

  test("the same sandbox id cannot be started twice", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1"));
    await expect(adapter.startSandbox(input("sbx_1"))).rejects.toThrow(/already exists/);
  });

  test("operations on an unknown sandbox fail closed with SANDBOX_NOT_FOUND", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await expect(adapter.health("sbx_ghost")).rejects.toThrow(CloudSandboxError);
    await expect(adapter.endpoints("sbx_ghost")).rejects.toThrow(/No sandbox/);
    await expect(adapter.listResources("sbx_ghost")).rejects.toThrow(CloudSandboxError);
    await expect(adapter.destroy("sbx_ghost")).rejects.toThrow(CloudSandboxError);
  });

  test("stop marks the endpoint unreachable but keeps the sandbox inspectable", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1"));
    await adapter.stopSandbox("sbx_1");
    const health = await adapter.health("sbx_1");
    expect(health.endpointReachable).toBe(false);
    expect(await adapter.endpoints("sbx_1")).toBeDefined();
  });
});

describe("phase 20.15 — sandbox isolation (source spec §39.3)", () => {
  test("two sandboxes holding an identically named bucket see only their own", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_a", { workspaceId: "ws_a" }));
    await adapter.startSandbox(input("sbx_b", { workspaceId: "ws_b" }));

    await adapter.execute("sbx_a", { service: "s3", operation: "create", payload: { name: "assets" } });
    await adapter.execute("sbx_b", { service: "s3", operation: "create", payload: { name: "assets" } });

    const a = await adapter.listResources("sbx_a");
    const b = await adapter.listResources("sbx_b");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.id).toBe("sbx_a:s3:assets");
    expect(b[0]?.id).toBe("sbx_b:s3:assets");
    expect(a[0]?.sandboxId).toBe("sbx_a");
    expect(b[0]?.tags["pao.workspace.id"]).toBe("ws_b");
  });

  test("destroying one sandbox leaves the other untouched", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_a"));
    await adapter.startSandbox(input("sbx_b"));
    await adapter.execute("sbx_a", { service: "s3", operation: "create", payload: { name: "assets" } });
    await adapter.execute("sbx_b", { service: "s3", operation: "create", payload: { name: "assets" } });

    const report = await adapter.destroy("sbx_a");
    expect(report.resourcesRemoved).toBe(1);
    expect(await adapter.listResources("sbx_b")).toHaveLength(1);
    await expect(adapter.listResources("sbx_a")).rejects.toThrow(CloudSandboxError);
  });

  test("endpoint ports never collide, including after teardown", async () => {
    const adapter = new MockCloudEmulatorAdapter({ basePort: 4566 });
    const a = await adapter.startSandbox(input("sbx_a"));
    const b = await adapter.startSandbox(input("sbx_b"));
    expect(a.endpoints.base).not.toBe(b.endpoints.base);

    await adapter.destroy("sbx_a");
    const ports = adapter.allocatedPorts();
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports).toEqual([4566, 4567]);
  });
});

describe("phase 20.15 — action execution", () => {
  test("create, list and delete round-trip a resource", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1"));

    const created = await adapter.execute("sbx_1", {
      service: "s3",
      operation: "create",
      payload: { name: "assets" },
    });
    expect(created.ok).toBe(true);
    expect(await adapter.listResources("sbx_1")).toHaveLength(1);

    const listed = await adapter.execute("sbx_1", { service: "s3", operation: "list" });
    expect(listed.ok).toBe(true);
    expect(Array.isArray(listed.data)).toBe(true);
    expect((listed.data as unknown[])).toHaveLength(1);

    const deleted = await adapter.execute("sbx_1", {
      service: "s3",
      operation: "delete",
      payload: { name: "assets" },
    });
    expect(deleted.ok).toBe(true);
    expect(await adapter.listResources("sbx_1")).toHaveLength(0);

    const secondDelete = await adapter.execute("sbx_1", {
      service: "s3",
      operation: "delete",
      payload: { name: "assets" },
    });
    expect(secondDelete.ok).toBe(false);
  });

  test("create without a name is refused rather than inventing one", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1"));
    const result = await adapter.execute("sbx_1", { service: "s3", operation: "create", payload: {} });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("SERVICE_UNSUPPORTED");
    expect(await adapter.listResources("sbx_1")).toHaveLength(0);
  });

  test("a Docker-backed service answers DOCKER_UNAVAILABLE instead of faking success", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1", { services: ["lambda"] }));

    expect(await adapter.serviceFidelity("sbx_1", "lambda")).toBe("UNAVAILABLE");
    const result = await adapter.execute("sbx_1", {
      service: "lambda",
      operation: "create",
      payload: { name: "worker" },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("DOCKER_UNAVAILABLE");
    expect(await adapter.listResources("sbx_1")).toHaveLength(0);
  });

  test("an unregistered service and an unimplemented operation are both refused", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1"));

    const unknownService = await adapter.execute("sbx_1", { service: "quantumledger", operation: "create" });
    expect(unknownService.ok).toBe(false);
    expect(unknownService.errorCode).toBe("SERVICE_UNSUPPORTED");

    const unknownOp = await adapter.execute("sbx_1", { service: "s3", operation: "replicate" });
    expect(unknownOp.ok).toBe(false);
    expect(unknownOp.errorCode).toBe("SERVICE_UNSUPPORTED");
    expect(unknownOp.message).toContain("replicate");
  });
});

describe("phase 20.15 — health, logs and destroy evidence", () => {
  test("a fully in-process sandbox is healthy", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1", { services: ["s3", "sqs"] }));
    const health = await adapter.health("sbx_1");
    expect(health.state).toBe("healthy");
    expect(health.endpointReachable).toBe(true);
    expect(health.readyServices.sort()).toEqual(["s3", "sqs"]);
    expect(health.unavailableServices).toEqual([]);
  });

  test("a Docker-backed service alongside a working one degrades rather than passing", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1", { services: ["s3", "lambda"] }));
    const health = await adapter.health("sbx_1");
    expect(health.state).toBe("degraded");
    expect(health.readyServices).toEqual(["s3"]);
    expect(health.unavailableServices).toEqual(["lambda"]);
    expect(health.detail).toContain("no Docker daemon");
  });

  test("a sandbox of only Docker-backed services is unhealthy, not degraded", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1", { services: ["lambda", "rds"] }));
    expect((await adapter.health("sbx_1")).state).toBe("unhealthy");
  });

  test("an empty service list is still healthy", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1", { services: [] }));
    expect((await adapter.health("sbx_1")).state).toBe("healthy");
  });

  test("logs accumulate and come back as a bundle", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1", { services: ["s3"] }));
    await adapter.execute("sbx_1", { service: "s3", operation: "create", payload: { name: "assets" } });

    const bundle = await adapter.collectLogs("sbx_1");
    expect(bundle.sandboxId).toBe("sbx_1");
    expect(bundle.streams).toHaveLength(1);
    expect(bundle.streams[0]?.name).toBe("mock-emulator");
    expect(bundle.streams[0]?.content).toContain("sandbox started");
    expect(bundle.streams[0]?.content).toContain('created s3 "assets"');
  });

  test("destroy reports what it removed and whether anything leaked", async () => {
    const adapter = new MockCloudEmulatorAdapter();
    await adapter.startSandbox(input("sbx_1"));
    await adapter.execute("sbx_1", { service: "s3", operation: "create", payload: { name: "a" } });
    await adapter.execute("sbx_1", { service: "sqs", operation: "create", payload: { name: "q" } });

    const report = await adapter.destroy("sbx_1");
    expect(report.ok).toBe(true);
    expect(report.resourcesRemoved).toBe(2);
    expect(report.leaked).toEqual([]);
    expect(report.destroyedAt).toBeTruthy();
  });
});

describe("phase 20.15 — adapter registry and activation seam", () => {
  afterEach(() => {
    resetCloudSandboxForTests();
    delete process.env.PAO_CLOUD_SANDBOX_ENABLED;
  });

  test("adapters resolve by id and by provider", () => {
    const registry = new CloudEmulatorAdapterRegistry();
    const aws = new MockCloudEmulatorAdapter({ id: "mock-aws" });
    registry.register(aws);
    expect(registry.get("mock-aws")).toBe(aws);
    expect(registry.forProvider("aws")).toBe(aws);
    expect(registry.forProvider("gcp")).toBeUndefined();
    expect(registry.list()).toHaveLength(1);

    registry.unregister("mock-aws");
    expect(registry.get("mock-aws")).toBeUndefined();
  });

  test("activation is idempotent and registers into the shared registry", () => {
    process.env.PAO_CLOUD_SANDBOX_ENABLED = "1";
    const first = activateCloudSandboxPlane();
    const second = activateCloudSandboxPlane();
    expect(first).toBe(second);
    expect(first).toBe(getCloudEmulatorAdapterRegistry());
    expect(first.list()).toHaveLength(1);
    expect(first.get("mock-aws")?.provider).toBe("aws");
  });

  test("reset empties the registry so the next activation re-registers", () => {
    activateCloudSandboxPlane();
    expect(getCloudEmulatorAdapterRegistry().list()).toHaveLength(1);
    resetCloudSandboxForTests();
    expect(activateCloudSandboxPlane().list()).toHaveLength(1);
  });
});
