import { describe, expect, test } from "bun:test";
import { FleetManager } from "../src/agent-os/operations/fleet-manager";
import { FailoverEngine } from "../src/agent-os/operations/failover-engine";

describe("Phase 23 — FailoverEngine", () => {
  test("enqueues and dispatches job to candidate node", () => {
    const fleetManager = new FleetManager();
    fleetManager.registerNode({
      id: "node-worker-a",
      name: "Worker A",
      nodeType: "remote_worker",
      capabilities: ["video_synthesis"],
      maxConcurrency: 5,
    });

    const engine = new FailoverEngine(fleetManager);
    const job = engine.enqueueJob({
      taskType: "video_render",
      priority: "P1",
      payload: { prompt: "city hyperlapse" },
      requiredCapabilities: ["video_synthesis"],
    });

    expect(job.status).toBe("queued");
    expect(job.taskType).toBe("video_render");

    const dispatchResult = engine.dispatchJob(job.id);
    expect(dispatchResult.dispatched).toBe(true);
    expect(dispatchResult.nodeId).toBe("node-worker-a");
    expect(engine.getJob(job.id)?.status).toBe("dispatched");
    expect(fleetManager.getNode("node-worker-a")?.activeJobs).toBe(1);
  });

  test("updates checkpoints and marks job running", () => {
    const fleetManager = new FleetManager();
    const engine = new FailoverEngine(fleetManager);
    const job = engine.enqueueJob({
      taskType: "data_indexing",
      payload: { docCount: 100 },
    });

    const updated = engine.updateCheckpoint(job.id, { processed: 45 });
    expect(updated.status).toBe("running");
    expect(updated.checkpointData).toEqual({ processed: 45 });
  });

  test("completes and fails jobs with proper active job decrements", () => {
    const fleetManager = new FleetManager();
    fleetManager.registerNode({
      id: "node-exec",
      name: "Exec Node",
      nodeType: "local_desktop",
      capabilities: ["exec"],
      maxConcurrency: 2,
    });
    const engine = new FailoverEngine(fleetManager);

    const j1 = engine.enqueueJob({ taskType: "t1", payload: {}, requiredCapabilities: ["exec"] });
    const j2 = engine.enqueueJob({ taskType: "t2", payload: {}, requiredCapabilities: ["exec"] });

    engine.dispatchJob(j1.id);
    engine.dispatchJob(j2.id);
    expect(fleetManager.getNode("node-exec")?.activeJobs).toBe(2);

    engine.completeJob(j1.id);
    expect(engine.getJob(j1.id)?.status).toBe("completed");
    expect(fleetManager.getNode("node-exec")?.activeJobs).toBe(1);

    engine.failJob(j2.id, "Syntax error in script");
    expect(engine.getJob(j2.id)?.status).toBe("failed");
    expect(engine.getJob(j2.id)?.error).toBe("Syntax error in script");
    expect(fleetManager.getNode("node-exec")?.activeJobs).toBe(0);
  });

  test("triggers automated failover and migrates jobs using checkpoints", () => {
    const fleetManager = new FleetManager();
    fleetManager.registerNode({
      id: "node-primary",
      name: "Primary Host",
      nodeType: "remote_worker",
      capabilities: ["code_exec"],
      maxConcurrency: 5,
    });
    fleetManager.registerNode({
      id: "node-standby",
      name: "Standby Host",
      nodeType: "cloud_vm",
      capabilities: ["code_exec"],
      maxConcurrency: 5,
    });

    const engine = new FailoverEngine(fleetManager);

    const job = engine.enqueueJob({
      taskType: "build_task",
      payload: { repo: "opencodex" },
      requiredCapabilities: ["code_exec"],
      maxRetries: 3,
    });

    engine.dispatchJob(job.id);
    engine.updateCheckpoint(job.id, { step: "bundling", percent: 80 });
    expect(job.assignedNodeId).toBe("node-primary");

    // Primary drops out - trigger failover
    const event = engine.triggerFailover("node-primary", "Heartbeat lost > 30s");

    expect(event.failedNodeId).toBe("node-primary");
    expect(event.migratedJobIds).toContain(job.id);
    expect(event.recoveredSuccessfully).toBe(true);

    const migratedJob = engine.getJob(job.id);
    expect(migratedJob?.assignedNodeId).toBe("node-standby");
    expect(migratedJob?.status).toBe("running");
    expect(migratedJob?.retryCount).toBe(1);
    expect(migratedJob?.checkpointData?.step).toBe("bundling");
  });

  test("marks job failed when failover exceeds maxRetries", () => {
    const fleetManager = new FleetManager();
    fleetManager.registerNode({
      id: "node-unstable",
      name: "Unstable Node",
      nodeType: "remote_worker",
      capabilities: ["scraping"],
    });

    const engine = new FailoverEngine(fleetManager);
    const job = engine.enqueueJob({
      taskType: "scrape",
      payload: {},
      requiredCapabilities: ["scraping"],
      maxRetries: 1,
    });

    engine.dispatchJob(job.id);
    job.retryCount = 1; // already retried once

    const event = engine.triggerFailover("node-unstable", "Repeated timeout");
    expect(event.recoveredSuccessfully).toBe(false);
    expect(engine.getJob(job.id)?.status).toBe("failed");
    expect(engine.getJob(job.id)?.error).toContain("exceeded max retries");
  });
});
