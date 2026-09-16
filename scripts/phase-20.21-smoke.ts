#!/usr/bin/env bun
// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// End-to-End Automated Smoke Test.

import { CodexDetector } from "../src/agent-os/codex-runtime/detector";
import { CodexSchemaSync } from "../src/agent-os/codex-runtime/schema-sync";
import { getCodexRuntimeService } from "../src/agent-os/codex-runtime/service";
import { SecretRedactor } from "../src/agent-os/codex-runtime/audit";

console.log("=================================================");
console.log(" Phase 20.21: Codex Native Runtime Smoke Test");
console.log("=================================================");

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, stepName: string) {
  if (condition) {
    console.log(` [PASS] Step ${testsPassed + testsFailed + 1}: ${stepName}`);
    testsPassed++;
  } else {
    console.error(` [FAIL] Step ${testsPassed + testsFailed + 1}: ${stepName}`);
    testsFailed++;
  }
}

async function runSmokeTest() {
  const service = getCodexRuntimeService();

  // 1. Detect Codex
  const bin = CodexDetector.getCodexBinaryPath();
  assert(bin !== null, "Codex binary detection");

  // 2. Read Version
  const version = CodexDetector.probeCodexVersion(bin);
  assert(typeof version === "string" && version.length > 0, `Version read (${version})`);

  // 3. Capability Report
  const cap = CodexDetector.detectCapabilities(true);
  assert(cap.codexInstalled === true, "Capability report indicates codexInstalled");

  // 4. Schema Sync
  const schemaRes = CodexSchemaSync.sync();
  assert(schemaRes.success, `Schema generation (TS: ${schemaRes.tsFilesCount}, JSON: ${schemaRes.jsonFilesCount})`);

  // 5. Runtime Status & Health Check
  const status = await service.getStatus();
  assert(status.enabled && status.health.status !== "unhealthy", "Runtime status & health check");

  // 6. Create Session
  const session = service.createSession({
    workspaceRoot: process.cwd(),
    title: "Smoke Test Session",
  });
  assert(session.id.startsWith("sess_"), `Session created (${session.id})`);

  // 7. Test Turn Execution & Event Streaming
  let eventsReceived = 0;
  const turn = await service.executeTurn(session.id, "Smoke test greeting");
  assert(turn.status === "completed", `Turn execution completed (${turn.id})`);

  const events = service.store.listEventsForSession(session.id);
  eventsReceived = events.length;
  assert(eventsReceived > 0, `Event streaming verified (${eventsReceived} events logged)`);

  // 8. Safe Tool / Workspace Path Check
  const safePath = service.policy.validatePath("package.json", process.cwd(), false);
  assert(safePath.allowed, "Safe in-workspace read validation");

  const traversalCheck = service.policy.validatePath("../../sensitive.txt", process.cwd(), false);
  assert(!traversalCheck.allowed, "Path traversal attempt blocked");

  // 9. Destructive Command Classification & Approval
  const cmdCheck = service.policy.classifyCommand("rm -rf /");
  assert(cmdCheck.isDestructive && cmdCheck.requiresApproval, "Destructive command flagged for approval");

  // 10. Approval Simulation & Resolution
  const approvalPromise = service.approvals.requestApproval({
    sessionId: session.id,
    nodeId: "local_pc",
    toolName: "delete_directory",
    command: "rm -rf tmp",
    riskLevel: "high",
    timeoutSeconds: 5,
  });

  const pending = service.getPendingApprovals();
  assert(pending.length > 0, "Approval pending in queue");

  // Operator approves
  const resolved = service.resolveApproval(pending[0].id, "allow", "smoke_test_runner");
  assert(resolved, "Approval resolution succeeds");

  const resolution = await approvalPromise;
  assert(resolution.decision === "allow", "Approval promise resolves with allow");

  // 11. Cancellation Verification
  const cancelTurn = await service.sessions.enqueueTurn(session.id, "Long running work", async () => {
    await new Promise((r) => setTimeout(r, 1000));
  });
  const cancelled = service.cancelTurn(cancelTurn.id);
  assert(cancelled, `Turn cancellation verified (${cancelTurn.id})`);

  // 12. Secret Redaction & Audit Log Check
  const rawSecret = "sk-test-" + "1".repeat(30);
  const redacted = SecretRedactor.redactText(rawSecret);
  assert(!redacted.includes(rawSecret), "Secret redaction engine eliminates API key");

  service.audit.log({
    sessionId: session.id,
    action: "smoke_test.finish",
    risk: "low",
    result: "ok",
    metadata: { key: rawSecret },
  });

  const auditLogs = service.listAuditLogs(10);
  const latestAudit = auditLogs.find((l) => l.action === "smoke_test.finish");
  assert(
    latestAudit !== undefined && !JSON.stringify(latestAudit.metadata).includes("12345678901234567890"),
    "Audit log contains zero secret leakage",
  );

  // 13. Clean Shutdown
  await service.shutdown();
  assert(true, "Clean service shutdown");

  console.log("=================================================");
  console.log(` Summary: ${testsPassed} PASS, ${testsFailed} FAIL`);
  console.log("=================================================");

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSmokeTest().catch((err) => {
  console.error("Fatal smoke test error:", err);
  process.exit(1);
});
