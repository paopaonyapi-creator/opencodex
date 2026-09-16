# Runbook: Codex Runtime Crash Recovery & Stale Session Reconciliation

## Failure Modes & Recovery Steps

### 1. Codex App Server Process Termination
- Detection: The `AppServerAdapter` detects child process exit or disconnect.
- Recovery: Reconnection and process respawn are automatically triggered on the next request.
- State: Active turns are marked failed with descriptive error context; no duplicate work is silently dispatched.

### 2. Host Machine Reboot or Power Loss
- Detection: Upon startup, `SessionManager.reconcileOnStartup()` queries the SQLite store for sessions left in `running` state.
- Action: Unfinished turns and orphaned sessions are transitioned to `stale` with an audit record.
- Resolution: Operators can review the session timeline in the dashboard and resume cleanly.

### 3. Immediate System Rollback
- If unexpected behavior occurs in production:
  ```env
  PAO_CODEX_NATIVE_RUNTIME=false
  ```
- Effect: Immediately routes execution away from the native Codex adapter back to previous stable paths.
