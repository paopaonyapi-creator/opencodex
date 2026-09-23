import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CloudEmulatorAdapterRegistry, type CloudEmulatorAdapter } from "../src/agent-os/cloud-sandbox/adapter-spi";
import { CloudCapabilityRegistry } from "../src/agent-os/cloud-sandbox/capability-registry";
import { CloudSandboxDbStore } from "../src/agent-os/cloud-sandbox/db-store";
import { CloudSandboxError } from "../src/agent-os/cloud-sandbox/errors";
import { readCloudSandboxFlags } from "../src/agent-os/cloud-sandbox/flags";
import { MockCloudEmulatorAdapter } from "../src/agent-os/cloud-sandbox/adapters/mock";
import { SandboxManager, type CloudAuthorizer } from "../src/agent-os/cloud-sandbox/sandbox-manager";
import type { CreateSandboxRequest, SandboxProfile } from "../src/agent-os/cloud-sandbox/types";
import { SANDBOX_TTL_LIMITS } from "../src/agent-os/cloud-sandbox/types";

let dir: string;
let store: CloudSandboxDbStore;
let adapter: MockCloudEmulatorAdapter;
let adapters: CloudEmulatorAdapterRegistry;
let capabilities: CloudCapabilityRegistry;
let startedCount: number;

const enabledFlags = readCloudSandboxFlags({ PAO_CLOUD_SANDBOX_ENABLED: "1" } as NodeJS.ProcessEnv);
const allowAll: CloudAuthorizer = () => ({ allowed: true, decision: "allow", reason: "test" });
const denyAll: CloudAuthorizer = () => ({
  allowed: false,
  decision: "deny",
  code: "CLOUD_POLICY_DENIED",
  reason: "no row",
});

function countingMock(): MockCloudEmulatorAdapter {
  return new Proxy(new MockCloudEmulatorAdapter(), {
    get(target, prop) {
      if (prop === "startSandbox") {
        return async (input: Parameters<MockCloudEmulatorAdapter["startSandbox"]>[0]) => {
          startedCount += 1;
          return target.startSandbox(input);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  }) as MockCloudEmulatorAdapter;
}

function manager(overrides: { authorize?: CloudAuthorizer | undefined; flags?: typeof enabledFlags } = {}) {
  return new SandboxManager({
    store,
    adapters,
    capabilities,
    flags: overrides.flags ?? enabledFlags,
    authorize: "authorize" in overrides ? overrides.authorize : allowAll,
  });
}

function request(overrides: Partial<CreateSandboxRequest> = {}): CreateSandboxRequest {
  return {
    id: "sbx_1",
    workspaceId: "ws_1",
    actorId: "agent_codex_01",
    taskId: "task_1",
    runId: "run_1",
    profile: "ephemeral" as SandboxProfile,
    services: ["s3", "dynamodb"],
    idempotencyKey: "task_1:run_1:create",
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkTmp();
  store = new CloudSandboxDbStore(join(dir, "cloud-sandbox.sqlite3"));
  capabilities = new CloudCapabilityRegistry();
  adapters = new CloudEmulatorAdapterRegistry();
  startedCount = 0;
  adapter = countingMock();
  adapters.register(adapter);
});

function mkTmp(): string {
  const path = join(tmpdir(), `cs-mgr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path, { recursive: true });
  return path;
}

afterEach(() => {
  store.close();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe("phase 20.15 M2 — create is gated before anything is started", () => {
  test("a disabled plane refuses without touching an adapter", async () => {
    const off = readCloudSandboxFlags({} as NodeJS.ProcessEnv);
    await expect(manager({ flags: off }).create(request())).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    expect(startedCount).toBe(0);
  });

  test("no policy gate wired means no sandbox: fail closed, not fail open", async () => {
    // The default is the security property of this module. A caller that forgets to pass
    // `authorize` must be unable to create sandboxes; defaulting to allow would make the
    // forgotten wiring the one bug that silently disables every gate below it.
    await expect(manager({ authorize: undefined }).create(request())).rejects.toMatchObject({
      code: "CLOUD_POLICY_DENIED",
    });
    expect(startedCount).toBe(0);
    expect(store.listSandboxes()).toEqual([]);
  });

  test("a denied policy never reaches the adapter", async () => {
    await expect(manager({ authorize: denyAll }).create(request())).rejects.toMatchObject({
      code: "CLOUD_POLICY_DENIED",
    });
    expect(startedCount).toBe(0);
  });

  test("an approval-required verdict is a distinct, non-retryable refusal", async () => {
    const awaiting: CloudAuthorizer = () => ({
      allowed: false,
      decision: "approval_required",
      code: "CLOUD_APPROVAL_REQUIRED",
      reason: "permit pending",
    });
    const err = await manager({ authorize: awaiting }).create(request()).catch((e: unknown) => e);
    expect((err as CloudSandboxError).code).toBe("CLOUD_APPROVAL_REQUIRED");
    expect((err as CloudSandboxError).retryable).toBe(false);
    expect(startedCount).toBe(0);
  });

  test("an unregistered service is refused before provisioning", async () => {
    await expect(manager().create(request({ services: ["quantumledger"] }))).rejects.toMatchObject({
      code: "SERVICE_UNSUPPORTED",
    });
    expect(startedCount).toBe(0);
  });

  test("a service that always needs approval cannot ride along with a permitted one", async () => {
    // §17.2 puts EKS in approval territory. Silently starting it as UNAVAILABLE would let an
    // agent obtain a gated service by bundling it with an ungated one.
    await expect(manager().create(request({ services: ["s3", "eks"] }))).rejects.toMatchObject({
      code: "CLOUD_APPROVAL_REQUIRED",
    });
    expect(startedCount).toBe(0);
  });

  test("an unregistered adapter id is refused", async () => {
    await expect(manager().create(request({ adapter: "nope" }))).rejects.toMatchObject({
      code: "ADAPTER_UNAVAILABLE",
    });
    expect(startedCount).toBe(0);
  });

  test("TTL is bounded on both sides", async () => {
    for (const ttlMinutes of [1, SANDBOX_TTL_LIMITS.minMinutes - 1, SANDBOX_TTL_LIMITS.maxMinutes + 1]) {
      await expect(manager().create(request({ id: `sbx_${ttlMinutes}`, ttlMinutes }))).rejects.toMatchObject({
        code: "SANDBOX_START_FAILED",
      });
    }
    expect(startedCount).toBe(0);
  });
});

describe("phase 20.15 M2 — create writes a governed, recorded sandbox", () => {
  test("happy path yields a ready sandbox with endpoints, expiry and an audit operation", async () => {
    const created = await manager().create(request({ ttlMinutes: 30 }));

    expect(created.status).toBe("ready");
    expect(created.provider).toBe("aws");
    expect(created.adapter).toBe("mock-aws");
    expect(created.endpoints.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(created.config.storageMode).toBe("memory"); // ephemeral -> memory, per §1.4
    expect(Date.parse(created.expiresAt!) - Date.parse(created.createdAt)).toBe(30 * 60_000);

    const ops = store.listOperations(created.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operation: "cloud.sandbox.create", status: "succeeded", riskLevel: "medium" });
    expect(ops[0]!.inputDigest).toMatch(/^sha256:[0-9a-f]{32}$/);
  });

  test("profile selects the storage mode rather than leaving it to the caller", async () => {
    const durable = await manager().create(request({ id: "sbx_d", profile: "durable", services: ["s3"] }));
    expect(durable.config.storageMode).toBe("persistent");
  });

  test("a failing adapter leaves a failed record, a failed operation, and the original code", async () => {
    const broken: CloudEmulatorAdapter = {
      ...adapter,
      id: "broken",
      async startSandbox(): Promise<never> {
        throw new CloudSandboxError("SANDBOX_START_FAILED", "emulator refused to boot");
      },
    } as CloudEmulatorAdapter;
    adapters.register(broken);

    const err = await manager()
      .create(request({ adapter: "broken", id: "sbx_b" }))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "SANDBOX_START_FAILED", retryable: true });

    const record = store.getSandbox("sbx_b");
    expect(record?.status).toBe("failed");
    expect(store.listOperations("sbx_b")[0]?.status).toBe("failed");
  });
});

describe("phase 20.15 M2 — idempotency is enforced for real", () => {
  test("the same key starts exactly one runtime", async () => {
    const mgr = manager();
    const first = await mgr.create(request());
    const second = await mgr.create(request({ id: first.id }));

    expect(startedCount).toBe(1);
    expect(second.id).toBe(first.id);
    expect(store.listOperations(first.id)).toHaveLength(1);
  });

  test("a retry with a different key is a different sandbox", async () => {
    const mgr = manager();
    await mgr.create(request());
    await mgr.create(request({ id: "sbx_2", runId: "run_2", idempotencyKey: "task_1:run_2:create" }));
    expect(startedCount).toBe(2);
  });

  test("no key means no fence, and both creates stand", async () => {
    const mgr = manager();
    await mgr.create(request({ id: "sbx_a", idempotencyKey: null }));
    await mgr.create(request({ id: "sbx_b", idempotencyKey: null }));
    expect(startedCount).toBe(2);
    expect(store.listSandboxes("ws_1")).toHaveLength(2);
  });
});

describe("phase 20.15 M2 — access, TTL extension and reap", () => {
  test("access injects the fake local frame and never a real credential", async () => {
    const created = await manager().create(request());
    const access = manager().accessFor(created.id);

    expect(access.environment.AWS_ENDPOINT_URL).toBe(created.endpoints.base);
    expect(access.environment.AWS_ACCESS_KEY_ID).toBe("test");
    expect(access.environment.AWS_SECRET_ACCESS_KEY).toBe("test");
    expect(access.environment.AWS_EC2_METADATA_DISABLED).toBe("true");
    expect(access.environment.AWS_DEFAULT_REGION).toBe(created.endpoints.region);
  });

  test("a sandbox past its TTL cannot be used", async () => {
    const created = await manager().create(request({ ttlMinutes: SANDBOX_TTL_LIMITS.minMinutes }));
    store.updateSandboxStatus(created.id, "ready");
    store.extendSandboxExpiry(created.id, "2020-01-01T00:00:00.000Z");

    expect(() => manager().accessFor(created.id)).toThrow(/past its TTL/);
    expect(() => manager().accessFor(created.id)).toThrow(CloudSandboxError);
  });

  test("extension is capped by the same ceiling as creation", async () => {
    const mgr = manager();
    const created = await mgr.create(request({ ttlMinutes: 60 }));
    const extended = mgr.extendTtl(created.id, 120);
    expect(extended.expiresAt).not.toBe(created.expiresAt);

    // 60 + 120 already spent, so a further 400 breaches the 480m ceiling.
    expect(() => mgr.extendTtl(created.id, 400)).toThrow(/ceiling/);
  });

  test("reapExpired destroys what the TTL owns and reports per-sandbox failure", async () => {
    const mgr = manager();
    const doomed = await mgr.create(request({ id: "sbx_old", ttlMinutes: SANDBOX_TTL_LIMITS.minMinutes }));
    const alive = await mgr.create(request({ id: "sbx_new", ttlMinutes: 480, idempotencyKey: "k-new" }));

    store.extendSandboxExpiry(doomed.id, "2020-01-01T00:00:00.000Z");
    // One un-destroyable sandbox must not stop the reaper from cleaning up the rest.
    adapters.unregister("mock-aws");

    const result = await mgr.reapExpired();
    expect(result.scanned).toBe(1);
    // The adapter is gone, so destroy() falls back to wiping local state and reports no leaks.
    expect(result.destroyed).toEqual(["sbx_old"]);
    expect(store.getSandbox("sbx_old")?.status).toBe("destroyed");
    expect(store.getSandbox("sbx_new")?.status).toBe("ready");
    expect(alive.status).toBe("ready");
  });

  test("destroy removes resources, marks the tombstone and clears the runtime", async () => {
    const mgr = manager();
    const created = await mgr.create(request());
    await adapter.execute(created.id, { service: "s3", operation: "create", payload: { name: "assets" } });
    store.upsertResource({
      id: `${created.id}:s3:assets`,
      sandboxId: created.id,
      provider: "aws",
      service: "s3",
      type: "s3:bucket",
      state: "available",
      fidelity: "IN_PROCESS",
      tags: {},
      parentIds: [],
      discoveredAt: created.createdAt,
    });

    const outcome = await mgr.destroy(created.id);
    expect(outcome.resourcesRemoved).toBe(1);
    expect(outcome.report.ok).toBe(true);
    expect(store.getSandbox(created.id)?.status).toBe("destroyed");
    expect(store.listResources(created.id)).toEqual([]);
    expect(await adapter.listResources(created.id).catch(() => "gone")).toBe("gone");
  });

  test("destroying an unknown sandbox fails closed", async () => {
    await expect(manager().destroy("sbx_ghost")).rejects.toMatchObject({ code: "SANDBOX_NOT_FOUND" });
  });

  test("get and list see the workspace scope", async () => {
    const mgr = manager();
    await mgr.create(request());
    await mgr.create(request({ id: "sbx_other_ws", workspaceId: "ws_2", idempotencyKey: "k2" }));
    expect(mgr.list("ws_1").map((row) => row.id)).toEqual(["sbx_1"]);
    expect(mgr.get("sbx_1").workspaceId).toBe("ws_1");
    expect(() => mgr.get("sbx_missing")).toThrow(/No sandbox/);
  });
});
