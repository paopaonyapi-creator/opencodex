# Pao-hubPro MCP Governance & Federated Tool Gateway

> **Phase 20.74 MCPProxy & Tool Supply Chain Security**  
> **Updated:** 2026-09-17

## 1. Governance Architecture

Pao-hubPro treats tools as privileged extensions that must be governed independently of inference models:

```text
Agent Prompt ---> MCP Tool Gateway ---> Tool Sandbox ---> Federated MCP Server
```

### Core Responsibilities
- **Tool Discovery:** Dynamic cataloging of tools from local stdio, SSE, and remote servers.
- **Trust Scoring:** Every tool receives a trust score (0–100) based on source verification, mutation class, and historical execution reliability.
- **Argument Sanitization:** Dual-pass scanning ensures secrets, tokens, and credentials are scrubbed before tool invocation.
- **Boundary Containment:** All file paths are strictly anchored to the workspace root; path traversal attempts are immediately blocked.
- **Destructive Operation Gates:** R4 destructive tools enforce mandatory human confirmation.

---

## 2. Core Tool Definitions

| Tool Name | Mutability | Risk Tier | Description | Approval Required |
| :--- | :--- | :--- | :--- | :--- |
| `pao.fs.read` | read_only | R0 | Safely reads files within workspace | No |
| `pao.fs.write` | idempotent_write | R2 | Safely writes files within workspace | No |
| `pao.fs.list` | read_only | R0 | Lists directory contents | No |
| `pao.exec.safe` | idempotent_write | R2 | Executes screened shell commands | No |
| `pao.admin.destroy` | destructive | R4 | Destructive system operations | **Yes (Mandatory)** |

---

## 3. Auditing & Forensics

Every tool invocation is recorded in SQLite table `core_tool_executions`:
- Request ID & Actor ID
- Tool Name & Server ID
- Arguments Hash & Sanitized JSON
- Execution Latency (ms)
- Approval Grantee
- Status (`success`, `denied`, `failed`)
