/**
 * Phase 23 — Pao Autonomous Operations & Self-Healing Fleet (AOF) Module
 */

export * from "./types";
export * from "./fleet-manager";
export * from "./failover-engine";
export * from "./slo-governor";
export * from "./swarm-bus";

import { FleetManager } from "./fleet-manager";
import { FailoverEngine } from "./failover-engine";
import { SloGovernor } from "./slo-governor";
import { SwarmBus } from "./swarm-bus";

let globalFleetManager: FleetManager | null = null;
let globalFailoverEngine: FailoverEngine | null = null;
let globalSloGovernor: SloGovernor | null = null;
let globalSwarmBus: SwarmBus | null = null;

export function getFleetManager(): FleetManager {
  if (!globalFleetManager) {
    globalFleetManager = new FleetManager();

    // Register local host node by default
    globalFleetManager.registerNode({
      id: "node-local-primary",
      name: "Local Desktop Host",
      nodeType: "local_desktop",
      capabilities: ["desktop_vision", "code_edit", "shell_exec", "browser_control"],
      maxConcurrency: 8,
    });
  }
  return globalFleetManager;
}

export function getFailoverEngine(): FailoverEngine {
  if (!globalFailoverEngine) {
    globalFailoverEngine = new FailoverEngine(getFleetManager());
  }
  return globalFailoverEngine;
}

export function getSloGovernor(): SloGovernor {
  if (!globalSloGovernor) {
    globalSloGovernor = new SloGovernor();
  }
  return globalSloGovernor;
}

export function getSwarmBus(): SwarmBus {
  if (!globalSwarmBus) {
    globalSwarmBus = new SwarmBus();
  }
  return globalSwarmBus;
}
