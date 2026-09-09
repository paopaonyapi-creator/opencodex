import { describe, expect, test } from "bun:test";
import { FleetManager } from "../src/agent-os/operations/fleet-manager";

describe("Phase 23 — FleetManager", () => {
  test("registers a node and sets default properties", () => {
    const manager = new FleetManager();
    const node = manager.registerNode({
      id: "node-worker-01",
      name: "Remote Worker 01",
      nodeType: "remote_worker",
      capabilities: ["browser_control", "scraping"],
      maxConcurrency: 4,
    });

    expect(node.id).toBe("node-worker-01");
    expect(node.name).toBe("Remote Worker 01");
    expect(node.nodeType).toBe("remote_worker");
    expect(node.status).toBe("online");
    expect(node.capabilities).toContain("browser_control");
    expect(node.maxConcurrency).toBe(4);
    expect(node.activeJobs).toBe(0);
    expect(manager.getNode("node-worker-01")).toBeDefined();
  });

  test("records heartbeat and updates latency, CPU, and memory stats", () => {
    const manager = new FleetManager();
    manager.registerNode({
      id: "node-cloud-01",
      name: "Cloud VM",
      nodeType: "cloud_vm",
      capabilities: ["bulk_compute"],
    });

    const updated = manager.recordHeartbeat("node-cloud-01", {
      latencyMs: 22,
      cpuLoadPercent: 45,
      memoryUsageMb: 1024,
      activeJobs: 2,
    });

    expect(updated.latencyMs).toBe(22);
    expect(updated.cpuLoadPercent).toBe(45);
    expect(updated.memoryUsageMb).toBe(1024);
    expect(updated.activeJobs).toBe(2);
    expect(updated.status).toBe("online");
  });

  test("evaluates node health timeouts (degraded > 15s, offline > 30s)", () => {
    const manager = new FleetManager(15000, 30000);
    manager.registerNode({
      id: "node-degraded",
      name: "Degrading Node",
      nodeType: "remote_worker",
      capabilities: ["test"],
    });
    manager.registerNode({
      id: "node-offline",
      name: "Offline Node",
      nodeType: "remote_worker",
      capabilities: ["test"],
    });

    const baseTime = Date.now();
    // Simulate missed heartbeat of 18 seconds for node-degraded
    const changes1 = manager.evaluateHealth(baseTime + 18000);
    expect(changes1.get("node-degraded")).toBe("degraded");
    expect(manager.getNode("node-degraded")?.status).toBe("degraded");

    // Simulate missed heartbeat of 35 seconds for node-offline
    const changes2 = manager.evaluateHealth(baseTime + 35000);
    expect(changes2.get("node-offline")).toBe("offline");
    expect(manager.getNode("node-offline")?.status).toBe("offline");

    // Heartbeat restores status to online
    manager.recordHeartbeat("node-degraded");
    expect(manager.getNode("node-degraded")?.status).toBe("online");
  });

  test("drains node and prevents candidate selection", () => {
    const manager = new FleetManager();
    manager.registerNode({
      id: "node-drainable",
      name: "Drainable Worker",
      nodeType: "remote_worker",
      capabilities: ["render"],
    });

    expect(manager.selectBestNode(["render"])?.id).toBe("node-drainable");

    const drained = manager.drainNode("node-drainable");
    expect(drained.status).toBe("draining");

    // Once draining, it is not selected
    expect(manager.selectBestNode(["render"])).toBeNull();
  });

  test("selects best node based on capabilities and load factor", () => {
    const manager = new FleetManager();
    manager.registerNode({
      id: "node-heavy",
      name: "Heavy Worker",
      nodeType: "remote_worker",
      capabilities: ["compute"],
      maxConcurrency: 10,
    });
    manager.registerNode({
      id: "node-light",
      name: "Light Worker",
      nodeType: "remote_worker",
      capabilities: ["compute"],
      maxConcurrency: 10,
    });

    // Simulate heavy load on node-heavy
    manager.recordHeartbeat("node-heavy", { activeJobs: 8, latencyMs: 15 });
    // Light load on node-light
    manager.recordHeartbeat("node-light", { activeJobs: 1, latencyMs: 20 });

    const best = manager.selectBestNode(["compute"]);
    expect(best?.id).toBe("node-light");
  });

  test("deregisters node successfully", () => {
    const manager = new FleetManager();
    manager.registerNode({
      id: "node-temp",
      name: "Temporary Node",
      nodeType: "remote_worker",
      capabilities: [],
    });

    expect(manager.listNodes().length).toBe(1);
    const removed = manager.deregisterNode("node-temp");
    expect(removed).toBe(true);
    expect(manager.listNodes().length).toBe(0);
  });
});
