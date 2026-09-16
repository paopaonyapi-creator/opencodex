# Architecture: Pao-hubPro x OpenAI Codex Native Runtime Integration

## 1. Overview
Phase 20.21 establishes OpenAI Codex as the native coding-agent execution runtime beneath Pao-hubPro's Control Plane. Pao-hubPro serves as the authoritative orchestrator, policy governor, and approval gatekeeper, while delegating raw coding and filesystem synthesis to the machine-readable Codex runtime.

```text
┌─────────────────────────────────────────────────────────────┐
│                       Pao-hubPro GUI                        │
│   Overview · Sessions · Live Turn · Approvals · Policies    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Pao Control Plane                      │
│   Policy Engine · Approval Broker · Session & Concurrency   │
│   Secret Redactor · Node Manager · Audit Service            │
└──────┬───────────────────────┼───────────────────────┬──────┘
       │                       │                       │
       ▼                       ▼                       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  App Server  │       │  Python SDK  │       │ CLI Fallback │
│   Adapter    │       │   Adapter    │       │   Adapter    │
└──────┬───────┘       └──────┬───────┘       └──────┬───────┘
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Codex Runtime                        │
│              codex app-server / exec-server                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Target Workspace Execution                  │
│               Windows PC / Linux VPS Nodes                  │
└─────────────────────────────────────────────────────────────┘
```

## 2. Core Architectural Invariants

### 2.1 Pao-hubPro as Control Plane, Codex as Runtime
- Pao-hubPro maintains ownership over project context, sessions, policies, permissions, and human approvals.
- Codex handles the low-level agent loop, tool execution, and diff synthesis.
- No direct coupling between UI components and raw Codex schemas: events and statuses are normalized into `PaoRuntimeEvent`.

### 2.2 Official Machine-Readable Protocol First
- Primary integration route: `codex app-server --stdio` utilizing bidirectional JSON-RPC.
- Python SDK (`openai_codex`) integrated dynamically when present.
- CLI fallback used exclusively for diagnostics, emergency recovery, and smoke tests.

### 2.3 Layered Defense & Workspace Containment
- **Path Guard**: Normalizes and canonicalizes target paths to guarantee operations remain strictly within `workspaceRoot`. Symlink/junction escapes and sensitive paths (`.ssh`, `.aws`, `.env`, system directories) are strictly blocked.
- **Command Classifier**: Classifies commands into low, medium, and high risk. Destructive commands (`rm -rf`, disk formatting, service modifications) always require explicit human operator approval.
- **Approval Broker with Bounded Timeouts**: Approvals expire after a configurable duration (`PAO_CODEX_APPROVAL_TIMEOUT_SECONDS`, default 120s). In headless mode, unhandled approvals automatically deny/cancel safely rather than hanging indefinitely.
- **Zero Secret Leakage**: `SecretRedactor` deeply scrubs API keys, PATs, database credentials, and private keys before logging or publishing events.

### 2.4 Reversible Rollback Switch
- Feature flag `PAO_CODEX_NATIVE_RUNTIME=false` instantly suspends native Codex dispatch and reverts execution to previous stable pipelines without data corruption or structural regression.
