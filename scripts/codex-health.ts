#!/usr/bin/env bun
// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Codex Runtime Health Diagnostic.

import { getCodexRuntimeService } from "../src/agent-os/codex-runtime";

const service = getCodexRuntimeService();
const status = await service.getStatus();

console.log("=================================================");
console.log(" Codex Runtime Health & Operational Status");
console.log("=================================================");
console.log(`Native Runtime Enabled:  ${status.enabled}`);
console.log(`Overall Health:          ${status.health.status.toUpperCase()}`);
console.log(`Active Runtime Mode:     ${status.runtimeMode}`);
console.log(`Current Policy Profile:  ${status.policyProfile}`);
console.log(`Active Sessions:         ${status.activeSessions}`);
console.log(`Active Turns:            ${status.activeTurns}`);
console.log(`Pending Approvals:       ${status.pendingApprovals}`);
console.log(`Codex Installed:         ${status.capabilities.codexInstalled} (${status.capabilities.codexVersion || "N/A"})`);
console.log(`App Server Ready:        ${status.health.appServer.available}`);
console.log(`MCP Healthy:             ${status.health.mcp.healthy} (${status.health.mcp.toolCount} tools)`);
console.log("=================================================");
