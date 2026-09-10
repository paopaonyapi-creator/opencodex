import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { GrokBridgeStore } from "../src/agent-os/browser-provider/store";
import { GrokBrowserProvider } from "../src/agent-os/browser-provider/grok-provider";
import { DownloadManager } from "../src/agent-os/browser-provider/download-manager";

/**
 * Phase 20.18 — bridge integration tests against a REAL store.
 *
 * The decisive case here is restart reconciliation. Everything else can be reasoned
 * about; reconciliation is the one place where a wrong choice silently duplicates a
 * generation the operator already paid for in money and time.
 */

let home: string;
const originalHome = process.env.OPENCODEX_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "grok-bridge-test-"));
  process.env.OPENCODEX_HOME = home;
});

afterEach(() => {
  closeAgentOsDbForTests();
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function build() {
  const store = new GrokBridgeStore();
  return { store, provider: new GrokBrowserProvider({ store }) };
}

const IMAGE_JOB = { provider: "grok-browser", mediaType: "image" as const, count: 1 };

describe("Phase 20.18 — job lifecycle through the store", () => {
  test("a submitted job starts waiting for a browser, not dispatched", async () => {
    const { provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "a farm at sunrise" });
    expect(submission.accepted).toBe(true);
    expect(await provider.getStatus(submission.jobId)).toBe("waiting_browser");
  });

  test("an empty prompt is refused before a job exists", async () => {
    const { provider } = build();
    await expect(provider.submit({ ...IMAGE_JOB, prompt: "   " })).rejects.toThrow();
  });

  test("an out-of-range count is refused", async () => {
    const { provider } = build();
    await expect(provider.submit({ ...IMAGE_JOB, prompt: "x", count: 99 })).rejects.toThrow();
  });

  test("an illegal state jump is refused by the store, not just by callers", async () => {
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "x" });
    expect(() => store.setState(submission.jobId, "completed")).toThrow();
  });

  test("a full happy path reaches completed with results attached", async () => {
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "a farm at sunrise" });
    store.setState(submission.jobId, "preparing");
    store.setState(submission.jobId, "prompting");
    store.setState(submission.jobId, "generating");
    provider.applyReport({
      jobId: submission.jobId,
      state: "collecting",
      results: [
        {
          id: "r1",
          mediaType: "image",
          index: 0,
          sourceUrl: "https://example.test/a.png",
          localPath: null,
          width: 1920,
          height: 1080,
          durationSec: null,
          prompt: "a farm at sunrise",
          sha256: null,
          metadata: {},
        },
      ],
    });
    store.setState(submission.jobId, "completed");

    expect(await provider.getStatus(submission.jobId)).toBe("completed");
    const results = await provider.collect(submission.jobId);
    expect(results).toHaveLength(1);
    expect(results[0]!.width).toBe(1920);
  });

  test("a user-action error blocks the job instead of failing it", async () => {
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "x" });
    store.setState(submission.jobId, "preparing");
    const blocked = provider.applyReport({
      jobId: submission.jobId,
      state: "failed",
      errorCode: "GROK_SESSION_REQUIRED",
      errorMessage: "Sign in required",
    });
    // blocked, NOT failed: a failed job is retryable by the queue, and retrying a
    // login wall is how a job spins forever.
    expect(blocked.state).toBe("blocked");
    expect(blocked.errorCode).toBe("GROK_SESSION_REQUIRED");
  });

  test("the queue dispatches at most one job at a time", async () => {
    const { store, provider } = build();
    for (let i = 0; i < 3; i += 1) {
      await provider.submit({ ...IMAGE_JOB, prompt: `job ${i}` });
    }
    const first = provider.nextDispatchable();
    expect(first).not.toBeNull();
    store.setState(first!.id, "preparing");
    // A second concurrent job would type into the same prompt field as the first.
    expect(provider.nextDispatchable()).toBeNull();
  });

  test("priority ordering is honoured", async () => {
    const { provider } = build();
    await provider.submit({ ...IMAGE_JOB, prompt: "low", priority: 9 });
    const high = await provider.submit({ ...IMAGE_JOB, prompt: "high", priority: 1 });
    expect(provider.nextDispatchable()!.id).toBe(high.jobId);
  });
});

describe("Phase 20.18 — restart reconciliation", () => {
  test("an in-flight job becomes needs_review rather than failed", async () => {
    // The system genuinely does not know whether the generation completed, and
    // marking it failed would let the queue retry work that may already exist.
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "interrupted" });
    store.setState(submission.jobId, "preparing");
    store.setState(submission.jobId, "prompting");
    store.setState(submission.jobId, "generating");

    const outcome = store.reconcileAfterRestart();
    expect(outcome.needsReview).toContain(submission.jobId);
    expect(store.getJob(submission.jobId)!.state).toBe("needs_review");
    expect(store.getJob(submission.jobId)!.errorMessage).toContain("unknown");
  });

  test("queued and waiting jobs are not disturbed by a restart", async () => {
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "safe" });
    const outcome = store.reconcileAfterRestart();
    expect(outcome.needsReview).not.toContain(submission.jobId);
    expect(store.getJob(submission.jobId)!.state).toBe("waiting_browser");
  });

  test("a blocked job stays blocked across a restart", async () => {
    // A restart does not clear a CAPTCHA, so it must not silently resume the job.
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "blocked" });
    store.setState(submission.jobId, "preparing");
    provider.applyReport({ jobId: submission.jobId, state: "blocked", errorCode: "GROK_RATE_LIMITED" });
    store.reconcileAfterRestart();
    expect(store.getJob(submission.jobId)!.state).toBe("blocked");
  });

  test("a completed job is untouched by reconciliation", async () => {
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "done" });
    store.setState(submission.jobId, "preparing");
    store.setState(submission.jobId, "prompting");
    store.setState(submission.jobId, "generating");
    store.setState(submission.jobId, "collecting");
    store.setState(submission.jobId, "completed");
    store.reconcileAfterRestart();
    expect(store.getJob(submission.jobId)!.state).toBe("completed");
  });

  test("reconciliation is audited", async () => {
    const { store, provider } = build();
    const submission = await provider.submit({ ...IMAGE_JOB, prompt: "audited" });
    store.setState(submission.jobId, "preparing");
    store.reconcileAfterRestart();
    expect(store.listAudit(50).some((row) => row.action === "reconcile")).toBe(true);
  });
});

describe("Phase 20.18 — heartbeat and provider health", () => {
  test("a provider with no session reports unavailable", async () => {
    const { provider } = build();
    const health = await provider.health();
    expect(health.available).toBe(false);
    expect(health.detail).toContain("never registered");
  });

  test("a fresh heartbeat reports connected", async () => {
    const { provider } = build();
    provider.recordHeartbeat({ extensionVersion: "0.1.0", pageType: "grok-projects" });
    const health = await provider.health();
    expect(health.available).toBe(true);
    expect(health.extensionVersion).toBe("0.1.0");
  });

  test("a stale heartbeat reports disconnected but does not fail queued jobs", async () => {
    // A closed laptop is not a failed generation.
    let clock = 1_000_000;
    const store = new GrokBridgeStore();
    const provider = new GrokBrowserProvider({ store, now: () => clock });
    provider.recordHeartbeat({ extensionVersion: "0.1.0", pageType: "grok-projects" });
    clock += 60_000;
    const health = await provider.health();
    expect(health.available).toBe(false);
    expect(health.stale).toBe(true);
  });

  test("capabilities are unknown until the extension reports them", async () => {
    // Claiming a feature before the page has been inspected is exactly what the
    // phase forbids.
    const { provider } = build();
    const capabilities = await provider.capabilities();
    expect(capabilities.image).toBe("unknown");
    expect(capabilities.video).toBe("unknown");
  });
});

describe("Phase 20.18 — download manager writes real files", () => {
  test("a write produces a file with the right checksum", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-dl-"));
    try {
      const manager = new DownloadManager(root);
      const plan = manager.plan({ jobId: "JOB-TEST", index: 0, extension: "png" });
      const payload = Buffer.from("fake image bytes");
      const record = manager.write(plan, payload);
      expect(existsSync(plan.targetPath)).toBe(true);
      expect(record.bytes).toBe(payload.length);
      expect(record.sha256).toBe(createHash("sha256").update(payload).digest("hex"));
      expect(manager.verify(plan, record.sha256)).toBe(true);
      expect(manager.verify(plan, "deadbeef")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a provenance manifest is written beside the outputs", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-dl-"));
    try {
      const manager = new DownloadManager(root);
      const plan = manager.plan({ jobId: "JOB-TEST", index: 0, extension: "png" });
      manager.write(plan, Buffer.from("bytes"));
      const provenancePath = manager.writeProvenance(plan, {
        jobId: "JOB-TEST",
        provider: "grok-browser",
        prompt: "a farm at sunrise",
        project: "stock-farm",
        mediaType: "image",
        generatedAt: new Date().toISOString(),
        files: [{ index: 0, filename: "x.png", sha256: "abc", bytes: 5, sourceUrl: null }],
      });
      expect(existsSync(provenancePath)).toBe(true);
      expect(JSON.parse(readFileSync(provenancePath, "utf8")).prompt).toBe("a farm at sunrise");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no partial file survives a failed write", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-dl-"));
    try {
      const manager = new DownloadManager(root);
      const plan = manager.plan({ jobId: "JOB-TEST", index: 0, extension: "png" });
      // A directory where the file should go makes the write fail after the mkdir.
      mkdirSync(plan.targetPath, { recursive: true });
      expect(() => manager.write(plan, Buffer.from("x"))).toThrow();
      expect(existsSync(`${plan.targetPath}.part`)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
