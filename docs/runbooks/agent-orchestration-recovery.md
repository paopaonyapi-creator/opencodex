# Runbook: Agent Orchestration Layer Operations & Recovery

## 1. System Health & Diagnostics

Run the operational status CLI:
```bash
bun scripts/orchestration-status.ts
```
Expected output displays:
- Active Runtime: `LANGCHAIN` (or `NATIVE` if toggled)
- Pending Approvals count
- Cataloged MCP servers and tools

---

## 2. Emergency Rollback: Disable LangChain Runtime

If an upstream issue occurs in LangChain graph execution, toggle back to the native zero-dependency runtime instantly:

### On Windows (PowerShell):
```powershell
$env:PAO_LANGCHAIN_ENABLED = "0"
bun scripts/orchestration-status.ts
```

### On Linux / macOS (Bash):
```bash
export PAO_LANGCHAIN_ENABLED=0
bun scripts/orchestration-status.ts
```

To re-enable LangChain:
```bash
unset PAO_LANGCHAIN_ENABLED  # or export PAO_LANGCHAIN_ENABLED=1
```

---

## 3. Unblocking Pending Approvals Queue

When an automated run is waiting for approval:
1. View pending approvals via CLI or REST:
   ```bash
   curl -H "Authorization: Bearer <TOKEN>" http://localhost:4040/api/agent-os/orchestration/approvals?status=pending
   ```
2. Approve or Reject:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"id": "appr_12345", "approved": true, "decidedBy": "operator"}' \
     http://localhost:4040/api/agent-os/orchestration/approvals/resolve
   ```
3. Resume the paused run:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"runId": "run_12345"}' \
     http://localhost:4040/api/agent-os/orchestration/runs/resume
   ```

---

## 4. MCP Server Management & Re-registration

To register or reconnect an MCP server:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"serverName": "browser_tools", "trustLevel": "trusted_local", "endpointOrCommand": "builtin:browser"}' \
  http://localhost:4040/api/agent-os/orchestration/mcp/servers
```

---

## 5. Verification Suite

Run smoke tests and unit test suites:
```bash
bun scripts/phase-20.22-smoke.ts
bun test tests/agent-orchestrator.test.ts
```
