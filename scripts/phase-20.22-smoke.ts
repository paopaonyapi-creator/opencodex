#!/usr/bin/env bun
// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// End-to-End Smoke Verification Script

import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  getOrchestrationService,
  resetOrchestrationServiceForTests,
  runtimeRegistry,
  ModelRouter,
  McpToolProvider,
  ToolPolicyEngine,
  SafeguardMiddleware,
  CheckpointManager,
  ApprovalBridge,
  CodexDelegationBridge,
  ReviewerCouncilBridge,
  LangChainAgentRuntime,
  NativeAgentRuntime,
} from "../src/agent-os/orchestration";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

async function runSmokeTests() {
  console.log("================================================================================");
  console.log("    PAO-HUBPRO × LANGCHAIN AGENT ORCHESTRATION & MCP SMOKE TEST               ");
  console.log("================================================================================\n");

  // Gate 1: Database Schema v28
  console.log("[1/10] Database Schema v28 Verification");
  const db = openAgentOsDb();
  assert(AGENT_OS_SCHEMA_VERSION >= 28, `Schema version is at least 28 (current: ${AGENT_OS_SCHEMA_VERSION})`);

  const tables = [
    "orchestration_runs",
    "orchestration_events",
    "orchestration_checkpoints",
    "orchestration_approvals",
    "orchestration_tool_calls",
    "orchestration_mcp_servers",
  ];
  for (const table of tables) {
    const res = db.query(`SELECT count(*) as cnt FROM ${table}`).get() as { cnt: number };
    assert(typeof res.cnt === "number", `Table '${table}' exists and is queryable`);
  }

  // Gate 2: Runtime Contract & Registry
  console.log("\n[2/10] Runtime Contract & Pluggable Registry");
  const service = getOrchestrationService();
  const registered = runtimeRegistry.listRegisteredTypes();
  assert(registered.includes("langchain"), "LangChain runtime registered");
  assert(registered.includes("native"), "Native runtime registered");
  assert(service.isLangchainEnabled(), "LangChain enabled by default");

  // Gate 3: Model Router & Fallbacks
  console.log("\n[3/10] Model Router & Fallback Chain");
  const router = new ModelRouter();
  const chain = router.resolveModelChain("claude-3-7-sonnet");
  assert(chain.primary === "claude-3-7-sonnet", "Primary model resolved correctly");
  assert(chain.fallback === "gpt-4o-mini", "Fallback model resolved correctly");
  const cost = router.calculateCost("claude-3-7-sonnet", 1000, 500);
  assert(cost > 0, `Cost calculation produced non-zero USD ($${cost})`);

  // Gate 4: MCP Tool Provider
  console.log("\n[4/10] Multi-Server MCP Tool Catalog");
  const mcp = new McpToolProvider();
  const tools = mcp.listTools();
  assert(tools.length >= 4, `Catalog contains at least 4 built-in tools (found: ${tools.length})`);
  const safeTools = mcp.filterToolsForModel();
  assert(safeTools.length >= 4, "Filtered model tools populated");

  // Gate 5: Tool Policy & Containment
  console.log("\n[5/10] Tool Policy & Security Boundaries");
  const policy = new ToolPolicyEngine();
  const r0 = policy.classifyTool("read_file", { path: "README.md" });
  assert(r0 === "R0", `read_file classified as R0 (harmless read)`);
  const r2 = policy.classifyTool("write_file", { path: "test.txt", content: "data" });
  assert(r2 === "R2", `write_file classified as R2 (state mutation)`);
  const r3 = policy.classifyTool("run_shell_command", { command: "ls" });
  assert(r3 === "R3", `run_shell_command classified as R3 (execution)`);

  const escapeCheck = policy.verifyWorkspaceContainment("../../../etc/shadow", process.cwd());
  assert(!escapeCheck.allowed, "Directory traversal escape correctly blocked");

  const dangerousCommand = policy.evaluateTool({
    toolName: "run_shell_command",
    serverName: "terminal",
    args: { command: "rm -rf /" },
  });
  assert(dangerousCommand.decision === "DENY", "Dangerous command 'rm -rf /' denied by policy");

  // Secret redaction
  const fakeSmokeSk = "sk-" + "2".repeat(30);
  const fakeSmokeGhp = "ghp_" + "3".repeat(20);
  const redacted = policy.redactSecrets(`key is ${fakeSmokeSk} and token ${fakeSmokeGhp}`);
  assert(!redacted.includes(fakeSmokeSk), "OpenAI key redacted");
  assert(!redacted.includes(fakeSmokeGhp), "GitHub PAT redacted");

  // Gate 6: Safeguard Middleware & Oscillation
  console.log("\n[6/10] Safeguard Middleware & Loop Protection");
  const safeguards = new SafeguardMiddleware({ maxConsecutiveIdenticalTools: 3 });
  const tracker = safeguards.createStateTracker();
  safeguards.checkModelCallLimit(tracker);
  safeguards.checkToolCallLimit(tracker);
  assert(tracker.modelCallCount === 1 && tracker.toolCallCount === 1, "State tracker increments correctly");

  let loopDetected = false;
  try {
    safeguards.recordAndCheckToolOscillation(tracker, "ping", { target: "127.0.0.1" });
    safeguards.recordAndCheckToolOscillation(tracker, "ping", { target: "127.0.0.1" });
    safeguards.recordAndCheckToolOscillation(tracker, "ping", { target: "127.0.0.1" });
  } catch (err: unknown) {
    loopDetected = true;
  }
  assert(loopDetected, "Tool oscillation / infinite loop successfully detected and halted");

  // Gate 7: Checkpoint Manager
  console.log("\n[7/10] Checkpoint Snapshots & State Restore");
  const store = service.store;
  store.upsertRun({
    id: "smoke_run_1",
    runtimeType: "langchain",
    status: "running",
    prompt: "smoke run for checkpoint & approval test",
    primaryModel: "claude-3-7-sonnet",
    modelCallCount: 0,
    toolCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    maxModelCalls: 25,
    maxToolCalls: 50,
    timeoutMs: 300000,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const checkpoints = new CheckpointManager(store);
  const chk = checkpoints.saveStep("smoke_run_1", 1, { status: "step_one", data: "test" });
  assert(Boolean(chk.id && chk.stateHash), "Checkpoint created with sha256 hash");
  const restored = checkpoints.restoreStep("smoke_run_1", 1);
  assert(restored?.stateHash === chk.stateHash, "Checkpoint restored accurately");

  // Gate 8: Approval Bridge & Bounded Safety
  console.log("\n[8/10] Approval Bridge & Headless Safety");
  const approvals = new ApprovalBridge(store, 100); // 100ms TTL
  const approval = approvals.requestApproval("smoke_run_1", "run_shell_command", "R3", "Execute test", { cmd: "dir" });
  assert(approval.status === "pending", "Approval created in pending state");

  // Wait 120ms to verify TTL timeout
  await new Promise((r) => setTimeout(r, 120));
  const expired = approvals.checkPendingExpirations();
  assert(expired.some((a) => a.id === approval.id), "Pending approval expired via bounded TTL without hanging");

  // Gate 9: Reviewer Council & Codex Delegation
  console.log("\n[9/10] Reviewer Council & Codex Delegation Bridges");
  const council = new ReviewerCouncilBridge();
  const verdict = await council.evaluateAction({
    toolName: "modify_schema",
    args: { table: "users" },
    riskLevel: "R3",
    reason: "Safe schema change",
  });
  assert(verdict.approved, "Reviewer Council evaluated and approved safe action");

  const codex = new CodexDelegationBridge();
  assert(typeof codex.delegateCodingTask === "function", "Codex delegation bridge method available");

  // Gate 10: End-to-End Execution
  console.log("\n[10/10] End-to-End Agent Execution");
  const run = await service.executeRun("Analyze project structure and report findings", {
    primaryModel: "claude-3-7-sonnet",
  });
  assert(run.status === "completed", `Agent run finished with status: ${run.status}`);
  assert(Boolean(run.outputText), "Run produced valid outputText");
  assert(run.totalCostUsd > 0, `Run tracked cost: $${run.totalCostUsd.toFixed(4)}`);

  console.log("\n================================================================================");
  console.log(`SMOKE TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

void runSmokeTests();
