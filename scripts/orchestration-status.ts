#!/usr/bin/env bun
// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// CLI Operational Diagnostics & Status Tool

import { getOrchestrationService } from "../src/agent-os/orchestration";

async function main() {
  console.log("================================================================================");
  console.log("    PAO-HUBPRO × LANGCHAIN AGENT ORCHESTRATION & MCP RUNTIME STATUS           ");
  console.log("================================================================================");

  try {
    const service = getOrchestrationService();
    const status = await service.getStatus();

    console.log(`\n[Runtime Engine]`);
    console.log(`  Enabled:             ${status.enabled ? "YES" : "NO"}`);
    console.log(`  Active Runtime:      ${status.activeRuntimeType.toUpperCase()}`);
    console.log(`  Registered Runtimes: ${status.registeredRuntimes.join(", ")}`);
    console.log(`  Rollback Toggled:    ${status.rollbackConfigured ? "YES (PAO_LANGCHAIN_ENABLED=0)" : "NO"}`);

    console.log(`\n[Execution & Queues]`);
    console.log(`  Total Lifetime Runs: ${status.totalRuns}`);
    console.log(`  Active / Paused:     ${status.activeRuns}`);
    console.log(`  Pending Approvals:   ${status.pendingApprovals}`);

    console.log(`\n[Model Context Protocol (MCP)]`);
    console.log(`  Registered Servers:  ${status.mcpServerCount}`);
    console.log(`  Cataloged Tools:     ${status.mcpToolCount}`);

    const servers = service.listMcpServers();
    if (servers.length > 0) {
      console.log(`\n  Active Servers:`);
      for (const s of servers) {
        console.log(`    - ${s.serverName.padEnd(20)} [${s.trustLevel}] status: ${s.status} (${s.toolCount} tools)`);
      }
    }

    const pending = service.listApprovals("pending");
    if (pending.length > 0) {
      console.log(`\n  Pending Approvals Queue:`);
      for (const p of pending) {
        console.log(`    - [${p.id}] ${p.toolName} (Risk: ${p.riskLevel}) - ${p.actionSummary}`);
      }
    }

    console.log("\n================================================================================");
    console.log("Status check completed successfully.");
  } catch (err) {
    console.error("\n[Error checking status]:", err);
    process.exit(1);
  }
}

void main();
