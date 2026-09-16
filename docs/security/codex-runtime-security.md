# Security Model: Pao-hubPro x OpenAI Codex Native Runtime

## 1. Threat Model & Security Boundaries
The Codex runtime runs with host operating system privileges within the context of the user process. To maintain system integrity, Pao-hubPro enforces strict multi-layered security barriers:

```text
User / Web Dashboard
         │
         ▼
[Authentication & Authorization]
         │
         ▼
[Policy Engine Guard]  ──> Workspace Containment / Sensitive Path Blacklist
         │
         ▼
[Command Classifier]   ──> Destructive Command Trap
         │
         ▼
[Approval Broker]      ──> Bounded Timeout / Headless Anti-Hang Protection
         │
         ▼
[Secret Redaction]     ──> Strip Credentials & Keys Before Persistence
         │
         ▼
[Codex Runtime]
```

## 2. Security Safeguards

### 2.1 Workspace Path Guard
- Paths are canonicalized using `normalize` and `realpathSync` to defeat `../` path traversal and symlink/junction escapes.
- Access to credentials and system directories (`.ssh`, `.aws`, `.env`, `System32`, `/etc`, `/root`) is unconditionally blocked across all policy profiles.

### 2.2 Headless Approval Timeout Safety
- Bounded timeout ensures no tool call hangs indefinitely waiting for input.
- On timeout expiration, requests automatically resolve to `denied` / `timed_out`, and the turn aborts safely.

### 2.3 Policy Profiles & Controlled Elevation
- Defaults: `SAFE` (read-only) and `NORMAL` (workspace-contained write).
- `FULL_ACCESS` is disabled by default. Enabling it requires explicit operator confirmation, enforces a time-to-live (TTL) countdown, and generates high-severity audit events.
