/**
 * Phase 23 — Pao Autonomous Operations: Fleet Manager
 * Manages node registration, heartbeats, capacity balancing, and health thresholding.
 */

import type { FleetNode, NodeHeartbeatInput, NodeStatus, NodeType } from "./types";

export interface RegisterNodeInput {
  id?: string;
  name: string;
  nodeType: NodeType;
  capabilities: string[];
  endpointUrl?: string;
  maxConcurrency?: number;
  metadata?: Record<string, unknown>;
}

export class FleetManager {
  private nodes: Map<string, FleetNode> = new Map();
  private degradedThresholdMs: number;
  private offlineThresholdMs: number;

  constructor(degradedThresholdMs = 15000, offlineThresholdMs = 30000) {
    this.degradedThresholdMs = degradedThresholdMs;
    this.offlineThresholdMs = offlineThresholdMs;
  }

  /**
   * Register or update a fleet node
   */
  public registerNode(input: RegisterNodeInput): FleetNode {
    const id = input.id ?? `node-${input.nodeType}-${Date.now().toString(36)}`;
    const now = Date.now();

    const node: FleetNode = {
      id,
      name: input.name,
      nodeType: input.nodeType,
      status: "online",
      capabilities: [...input.capabilities],
      endpointUrl: input.endpointUrl,
      activeJobs: 0,
      maxConcurrency: input.maxConcurrency ?? 5,
      lastHeartbeat: now,
      latencyMs: 15,
      cpuLoadPercent: 10,
      memoryUsageMb: 256,
      metadata: input.metadata,
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * Record a heartbeat from a node
   */
  public recordHeartbeat(id: string, input: NodeHeartbeatInput = {}): FleetNode {
    const node = this.mustGetNode(id);
    node.lastHeartbeat = Date.now();
    if (input.latencyMs !== undefined) node.latencyMs = input.latencyMs;
    if (input.cpuLoadPercent !== undefined) node.cpuLoadPercent = input.cpuLoadPercent;
    if (input.memoryUsageMb !== undefined) node.memoryUsageMb = input.memoryUsageMb;
    if (input.activeJobs !== undefined) node.activeJobs = input.activeJobs;

    // Heartbeat restores status from degraded/offline to online if not draining
    if (node.status !== "draining") {
      node.status = "online";
    }

    return node;
  }

  /**
   * Evaluate node health timeouts
   */
  public evaluateHealth(now = Date.now()): Map<string, NodeStatus> {
    const statusChanges = new Map<string, NodeStatus>();

    for (const [id, node] of this.nodes) {
      if (node.status === "draining") continue;

      const delta = now - node.lastHeartbeat;
      let targetStatus: NodeStatus = "online";

      if (delta >= this.offlineThresholdMs) {
        targetStatus = "offline";
      } else if (delta >= this.degradedThresholdMs) {
        targetStatus = "degraded";
      }

      if (node.status !== targetStatus) {
        node.status = targetStatus;
        statusChanges.set(id, targetStatus);
      }
    }

    return statusChanges;
  }

  /**
   * Mark node as draining (finishes current tasks, rejects new tasks)
   */
  public drainNode(id: string): FleetNode {
    const node = this.mustGetNode(id);
    node.status = "draining";
    return node;
  }

  /**
   * Deregister node
   */
  public deregisterNode(id: string): boolean {
    return this.nodes.delete(id);
  }

  /**
   * Find the best candidate node matching capabilities with lowest load
   */
  public selectBestNode(requiredCapabilities: string[] = []): FleetNode | null {
    const eligible = Array.from(this.nodes.values()).filter((n) => {
      if (n.status !== "online") return false;
      if (n.activeJobs >= n.maxConcurrency) return false;
      return requiredCapabilities.every((req) => n.capabilities.includes(req));
    });

    if (eligible.length === 0) return null;

    // Sort by load factor (active / max) then latency
    eligible.sort((a, b) => {
      const loadA = a.activeJobs / a.maxConcurrency;
      const loadB = b.activeJobs / b.maxConcurrency;
      if (Math.abs(loadA - loadB) > 0.1) return loadA - loadB;
      return a.latencyMs - b.latencyMs;
    });

    return eligible[0];
  }

  public getNode(id: string): FleetNode | undefined {
    return this.nodes.get(id);
  }

  public listNodes(statusFilter?: NodeStatus): FleetNode[] {
    const all = Array.from(this.nodes.values());
    if (statusFilter) {
      return all.filter((n) => n.status === statusFilter);
    }
    return all;
  }

  private mustGetNode(id: string): FleetNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`FleetNode '${id}' not found`);
    }
    return node;
  }
}
