import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CLOUD_SANDBOX_SCHEMA_VERSION,
  CloudSandboxDbStore,
} from "../src/agent-os/cloud-sandbox/db-store";
import type {
  CloudPromotionRecord,
  CloudResource,
  CloudSandboxRecord,
} from "../src/agent-os/cloud-sandbox/types";

let dir: string;
let dbPath: string;
let store: CloudSandboxDbStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cloud-sandbox-db-"));
  dbPath = join(dir, "cloud-sandbox.sqlite3");
  store = new CloudSandboxDbStore(dbPath);
});

afterEach(() => {
  // Close before removing: WAL leaves -wal/-shm siblings and an open handle makes rmSync
  // fail with EBUSY on Windows, which is what commit a6b97c01b fixed elsewhere here.
  store.close();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(id: string, overrides: Partial<CloudSandboxRecord> = {}): CloudSandboxRecord {
  return {
    id,
    workspaceId: "ws_1",
    taskId: null,
    runId: null,
    actorId: "agent_codex_01",
    provider: "aws",
    adapter: "mock-aws",
    profile: "ephemeral",
    status: "ready",
    endpoints: { base: "http://127.0.0.1:4566", region: "us-east-1", services: { s3: "http://127.0.0.1:4566" } },
    config: { services: ["s3"], storageMode: "memory", ttlMinutes: 60 },
    createdAt: "2026-09-23T00:00:00.000Z",
    expiresAt: "2026-09-23T01:00:00.000Z",
    destroyedAt: null,
    ...overrides,
  };
}

function resource(id: string, sandboxId: string, service: string, name: string): CloudResource {
  return {
    id,
    sandboxId,
    provider: "aws",
    service,
    type: `${service}:bucket`,
    name,
    region: "us-east-1",
    state: "available",
    fidelity: "IN_PROCESS",
    tags: { "pao.sandbox.id": sandboxId },
    parentIds: [],
    discoveredAt: "2026-09-23T00:05:00.000Z",
  };
}

describe("phase 20.15 — sidecar schema migration", () => {
  test("a fresh database is stamped at the current version", () => {
    expect(store.getSchemaVersion()).toBe(CLOUD_SANDBOX_SCHEMA_VERSION);
    expect(store.getDbPath()).toBe(dbPath);
  });

  test("reopening is a no-op and preserves data", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.close();

    const reopened = new CloudSandboxDbStore(dbPath);
    expect(reopened.getSchemaVersion()).toBe(CLOUD_SANDBOX_SCHEMA_VERSION);
    expect(reopened.getSandbox("sbx_1")?.id).toBe("sbx_1");
    reopened.close();
    // Re-create so afterEach has a live handle to close.
    store = new CloudSandboxDbStore(dbPath);
  });

  test("a database from a newer build refuses to open rather than being half-migrated", () => {
    store.close();
    const raw = new Database(dbPath);
    raw.exec(`PRAGMA user_version = ${CLOUD_SANDBOX_SCHEMA_VERSION + 1}`);
    raw.close();

    expect(() => new CloudSandboxDbStore(dbPath)).toThrow(/newer database/);
    store = new CloudSandboxDbStore(join(dir, "unused.sqlite3"));
  });

  test("foreign keys are enforced, so an orphan resource cannot be written", () => {
    store.insertSandbox(sandbox("sbx_1"));
    expect(() => store.upsertResource(resource("res_orphan", "sbx_missing", "s3", "b"))).toThrow();
  });
});

describe("phase 20.15 — sandbox records", () => {
  test("round-trips a record including its JSON columns", () => {
    store.insertSandbox(sandbox("sbx_1", { taskId: "task_9", runId: "run_9" }));
    const read = store.getSandbox("sbx_1");
    expect(read?.taskId).toBe("task_9");
    expect(read?.endpoints.base).toBe("http://127.0.0.1:4566");
    expect(read?.config.services).toEqual(["s3"]);
    expect(read?.profile).toBe("ephemeral");
  });

  test("missing rows and corrupt JSON degrade instead of throwing", () => {
    expect(store.getSandbox("nope")).toBeNull();
    store.insertSandbox(sandbox("sbx_bad"));
    // A hand-corrupted column must not make the row unreadable; the mapper falls back.
    const raw = new Database(dbPath);
    raw.exec(`UPDATE cloud_sandboxes SET config_json = '{oops' WHERE id = 'sbx_bad'`);
    raw.close();
    const read = store.getSandbox("sbx_bad");
    expect(read?.config.services).toEqual([]);
  });

  test("status, endpoints and expiry update independently", () => {
    store.insertSandbox(sandbox("sbx_1"));
    expect(store.updateSandboxStatus("sbx_1", "running")).toBe(true);
    expect(store.setSandboxEndpoints("sbx_1", { base: "b", region: "r", services: {} })).toBe(true);
    expect(store.extendSandboxExpiry("sbx_1", "2026-09-23T05:00:00.000Z")).toBe(true);

    const read = store.getSandbox("sbx_1");
    expect(read?.status).toBe("running");
    expect(read?.endpoints.base).toBe("b");
    expect(read?.expiresAt).toBe("2026-09-23T05:00:00.000Z");
  });

  test("updates against an unknown id report no change rather than throwing", () => {
    expect(store.updateSandboxStatus("sbx_missing", "running")).toBe(false);
    expect(store.extendSandboxExpiry("sbx_missing", "2026-09-23T05:00:00.000Z")).toBe(false);
  });

  test("listExpiredSandboxes is what the cleanup controller works from", () => {
    store.insertSandbox(sandbox("sbx_old", { expiresAt: "2026-09-23T00:30:00.000Z" }));
    store.insertSandbox(sandbox("sbx_new", { expiresAt: "2026-09-23T09:00:00.000Z" }));
    store.insertSandbox(sandbox("sbx_gone", { expiresAt: "2026-09-23T00:10:00.000Z", destroyedAt: "2026-09-23T00:11:00.000Z", status: "destroyed" }));
    store.insertSandbox(sandbox("sbx_forever", { expiresAt: null, profile: "durable" }));

    const expired = store.listExpiredSandboxes("2026-09-23T01:00:00.000Z").map((row) => row.id);
    // Already-destroyed and never-expiring sandboxes must not be picked up for teardown.
    expect(expired).toEqual(["sbx_old"]);
  });

  test("markSandboxDestroyed stamps the tombstone", () => {
    store.insertSandbox(sandbox("sbx_1"));
    expect(store.markSandboxDestroyed("sbx_1", "2026-09-23T02:00:00.000Z")).toBe(true);
    const read = store.getSandbox("sbx_1");
    expect(read?.status).toBe("destroyed");
    expect(read?.destroyedAt).toBe("2026-09-23T02:00:00.000Z");
    expect(store.listExpiredSandboxes("2026-09-30T00:00:00.000Z")).toEqual([]);
  });

  test("listSandboxes scopes by workspace", () => {
    store.insertSandbox(sandbox("sbx_a", { workspaceId: "ws_1" }));
    store.insertSandbox(sandbox("sbx_b", { workspaceId: "ws_2" }));
    expect(store.listSandboxes("ws_1").map((row) => row.id)).toEqual(["sbx_a"]);
    expect(store.listSandboxes()).toHaveLength(2);
  });
});

describe("phase 20.15 — resources", () => {
  test("upsert updates in place instead of duplicating", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.upsertResource(resource("res_1", "sbx_1", "s3", "assets"));
    store.upsertResource({ ...resource("res_1", "sbx_1", "s3", "assets"), state: "deleted" });
    const rows = store.listResources("sbx_1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("deleted");
  });

  test("two sandboxes holding the same resource name stay separate", () => {
    store.insertSandbox(sandbox("sbx_a", { workspaceId: "ws_a" }));
    store.insertSandbox(sandbox("sbx_b", { workspaceId: "ws_b" }));
    store.upsertResource(resource("sbx_a:s3:assets", "sbx_a", "s3", "assets"));
    store.upsertResource(resource("sbx_b:s3:assets", "sbx_b", "s3", "assets"));

    expect(store.listResources("sbx_a").map((row) => row.sandboxId)).toEqual(["sbx_a"]);
    expect(store.listResources("sbx_b").map((row) => row.sandboxId)).toEqual(["sbx_b"]);
    expect(store.listResources("sbx_a", "s3")).toHaveLength(1);
    expect(store.listResources("sbx_a", "dynamodb")).toHaveLength(0);
  });

  test("fidelity is a column, not buried in JSON, so the §43 gate can query it", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.upsertResource({ ...resource("res_1", "sbx_1", "lambda", "worker"), fidelity: "UNAVAILABLE" });
    expect(store.listResources("sbx_1")[0]?.fidelity).toBe("UNAVAILABLE");
  });

  test("destroy clears a sandbox's resources and reports how many", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.upsertResource(resource("res_1", "sbx_1", "s3", "a"));
    store.upsertResource(resource("res_2", "sbx_1", "sqs", "q"));
    expect(store.deleteResourcesForSandbox("sbx_1")).toBe(2);
    expect(store.listResources("sbx_1")).toEqual([]);
  });
});

describe("phase 20.15 — idempotency fence (source spec §60)", () => {
  const base = {
    actorId: "agent_codex_01",
    operation: "cloud.sandbox.create",
    riskLevel: "medium" as const,
    policyDecision: "allow",
  };

  test("a retry with the same key returns the FIRST operation, not a second one", () => {
    store.insertSandbox(sandbox("sbx_1"));
    const first = store.beginOperation({ ...base, id: "op_1", sandboxId: "sbx_1", idempotencyKey: "task_1:run_1:create" });
    expect(first.deduplicated).toBe(false);

    const retry = store.beginOperation({ ...base, id: "op_2", sandboxId: "sbx_1", idempotencyKey: "task_1:run_1:create" });
    expect(retry.deduplicated).toBe(true);
    expect(retry.operation.id).toBe("op_1");
    expect(store.listOperations("sbx_1")).toHaveLength(1);
  });

  test("replaying a finished operation still reports deduplicated", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.beginOperation({ ...base, id: "op_1", sandboxId: "sbx_1", idempotencyKey: "k1" });
    store.finishOperation("op_1", "succeeded", { sandboxId: "sbx_1" });

    const replay = store.beginOperation({ ...base, id: "op_9", sandboxId: "sbx_1", idempotencyKey: "k1" });
    expect(replay.deduplicated).toBe(true);
    expect(replay.operation.status).toBe("succeeded");
    expect(replay.operation.result).toEqual({ sandboxId: "sbx_1" });
  });

  test("different keys are different operations", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.beginOperation({ ...base, id: "op_1", sandboxId: "sbx_1", idempotencyKey: "k1" });
    const second = store.beginOperation({ ...base, id: "op_2", sandboxId: "sbx_1", idempotencyKey: "k2" });
    expect(second.deduplicated).toBe(false);
    expect(store.listOperations("sbx_1")).toHaveLength(2);
  });

  test("a null key never deduplicates, and does not collide with other nulls", () => {
    store.insertSandbox(sandbox("sbx_1"));
    const a = store.beginOperation({ ...base, id: "op_a", sandboxId: "sbx_1", idempotencyKey: null });
    const b = store.beginOperation({ ...base, id: "op_b", sandboxId: "sbx_1" });
    expect(a.deduplicated).toBe(false);
    expect(b.deduplicated).toBe(false);
    expect(store.listOperations("sbx_1")).toHaveLength(2);
  });

  test("finish records status, timestamp and result", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.beginOperation({ ...base, id: "op_1", sandboxId: "sbx_1", idempotencyKey: "k1" });
    expect(store.finishOperation("op_1", "blocked", null)).toBe(true);
    const read = store.getOperation("op_1");
    expect(read?.status).toBe("blocked");
    expect(read?.finishedAt).not.toBeNull();
    expect(store.finishOperation("op_missing", "failed", null)).toBe(false);
  });

  test("the fence is a UNIQUE index, so it survives concurrent writers", () => {
    // Asserting the mechanism, not just the behaviour: an application-level check-then-insert
    // would pass the tests above and still race two agents into two sandboxes.
    const raw = new Database(dbPath);
    const indexes = raw
      .query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_cloud_operations_idem'")
      .all() as Array<{ sql: string }>;
    raw.close();
    expect(indexes[0]?.sql.toUpperCase()).toContain("UNIQUE");
  });
});

describe("phase 20.15 — promotions (source spec §24)", () => {
  function promotion(id: string, overrides: Partial<CloudPromotionRecord> = {}): CloudPromotionRecord {
    return {
      id,
      workspaceId: "ws_1",
      sourceSandboxId: "sbx_1",
      targetEnvironment: "staging",
      planDigest: "sha256:aaaa",
      evidenceBundleId: "ev_1",
      status: "prepared",
      approvalId: null,
      createdAt: "2026-09-23T00:00:00.000Z",
      appliedAt: null,
      ...overrides,
    };
  }

  test("round-trips and lists by workspace", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.insertPromotion(promotion("pr_1"));
    store.insertPromotion(promotion("pr_2", { workspaceId: "ws_2" }));
    expect(store.getPromotion("pr_1")?.planDigest).toBe("sha256:aaaa");
    expect(store.listPromotions("ws_1").map((row) => row.id)).toEqual(["pr_1"]);
  });

  test("status moves and the approval id lands without clobbering the digest", () => {
    store.insertSandbox(sandbox("sbx_1"));
    store.insertPromotion(promotion("pr_1"));
    expect(
      store.updatePromotionStatus("pr_1", "approved", { approvalId: "apr_1" }),
    ).toBe(true);
    const read = store.getPromotion("pr_1");
    expect(read?.status).toBe("approved");
    expect(read?.approvalId).toBe("apr_1");
    // The digest is what Gate E re-checks against; an approval must never rewrite it.
    expect(read?.planDigest).toBe("sha256:aaaa");
    expect(read?.appliedAt).toBeNull();

    store.updatePromotionStatus("pr_1", "applied", { appliedAt: "2026-09-23T03:00:00.000Z" });
    expect(store.getPromotion("pr_1")?.appliedAt).toBe("2026-09-23T03:00:00.000Z");
  });
});
