# Phase 20.99 — Pao-hubPro × Whip — Mobile Agent Operations Console, Secure SSH/Tailscale Host Fabric, Native Multi-Agent Supervision, Codex/OpenCode Transcript Projection, Remote Terminal & SFTP Workspace, Offline-Safe Command Queue, Biometric Credential Vault, QR Device Pairing & Policy-Governed Human Approval Control Plane

> **Project:** Pao-hubPro  
> **Phase:** 20.99  
> **Status:** Implementation-ready specification  
> **Primary objective:** Turn Pao-hubPro into a secure, mobile-first operations console for supervising and controlling distributed AI agents, terminals, files, approvals, and resumable work across trusted hosts without exposing the agent runtime directly to the public Internet.  
> **Reference project:** Whip — <https://github.com/kosumic/whip>  
> **Integration rule:** Reuse architecture patterns and protocol ideas; do **not** copy AGPL-covered source into Pao-hubPro unless the licensing implications are explicitly reviewed and accepted.

---

## 0. Executive Summary

Phase 20.99 adds a **Mobile Agent Operations Plane** to Pao-hubPro.

The target experience is simple:

```text
Phone / Tablet
    │
    │ SSH / Tailscale / trusted private route
    ▼
Pao-hubPro Host Bridge
    │
    ├── Agent Registry
    ├── Session / Transcript Adapters
    ├── Terminal Gateway
    ├── SFTP / File Workspace
    ├── Approval Engine
    ├── Policy Engine
    ├── Audit Log
    └── Notification / Event Stream
           │
           ├── Codex
           ├── OpenCode
           ├── Claude / Claude Code
           ├── Grok / routed providers
           ├── OpenHermit / Herdr-style fleets
           ├── Browser agents
           ├── MCP tools
           └── Local workers / automation jobs
```

The mobile app must not be a glorified SSH terminal. It must project structured agent state into a touch-friendly interface while preserving a full terminal fallback.

The phase introduces eight core capabilities:

1. **Secure Host Fabric** — SSH/Tailscale-first host connectivity with strict host-key verification.
2. **Unified Agent Fleet** — one queue showing all connected agents and their operational state.
3. **Native Agent Chat / Transcript Projection** — structured transcripts for Codex/OpenCode first, extensible to other runtimes.
4. **Remote Terminal Workspace** — durable terminal sessions with mobile key controls and independent reconnect behavior.
5. **SFTP File Workspace** — browse, preview, upload, download, edit, diff, and attach remote files.
6. **Offline-Safe Command Queue** — drafts and queued commands survive temporary network loss but never bypass policy gates.
7. **Biometric Credential Vault + QR Pairing** — secure device onboarding without exposing secrets in QR payloads.
8. **Policy-Governed Human Approval Control Plane** — every risky remote action is classified, reviewed, and auditable.

The most important design decision is:

> **Pao-hubPro Mobile is a presentation and approval surface. Host truth, execution truth, agent truth, and policy truth stay in the host/control-plane runtimes.**

---

# 1. Why This Phase Exists

Pao-hubPro already has or is building:

- multi-provider model routing;
- agent fleets;
- MCP tool execution;
- browser automation;
- local tools;
- coding agents;
- review councils;
- resumable workflows;
- safe execution gates;
- artifact pipelines;
- Adobe Stock production workflows;
- remote/VPS execution;
- OpenHermit-style durable agent operation.

The missing layer is **operational control from mobile**.

Without Phase 20.99, remote supervision tends to collapse into one of these weak patterns:

```text
Phone -> Termux -> ssh -> tmux -> find pane -> inspect logs -> type commands
```

or:

```text
Phone -> Public dashboard/API -> Internet-exposed agent runtime
```

Both are inferior to a dedicated secure operations console.

Phase 20.99 instead provides:

```text
Phone
  ↓
Trusted SSH transport
  ↓
Pao Host Bridge
  ↓
Structured agent state + terminal + files + approvals
```

This creates a usable **AI Operations Console** that is suitable for daily work.

---

# 2. Upstream Whip Concepts We Intentionally Adopt

Whip provides several useful architecture patterns that should influence this phase.

## 2.1 Three-plane separation

Use explicit separation between:

### Transport Plane

Responsibilities:

- host connection;
- SSH authentication;
- jump hosts;
- Tailscale/private routing;
- host-key verification;
- session reconnect;
- tunnels/forwards;
- connection health.

### Control Plane

Responsibilities:

- agent discovery;
- agent status;
- session topology;
- task actions;
- approvals;
- policy evaluation;
- transcript identity;
- event subscriptions;
- fleet aggregation.

### Terminal / Execution Plane

Responsibilities:

- PTY/terminal byte streams;
- input;
- resize;
- scroll;
- terminal reconnect;
- shell attachment;
- terminal lifecycle.

**Rule:** terminal bytes must never become the canonical source for agent state when structured state is available.

---

## 2.2 Native structured UI over server-owned truth

Do not render a remote management TUI inside a terminal and then place buttons around it.

Instead:

```text
Remote runtime truth
      ↓
Typed protocol / events
      ↓
Pao Host Bridge
      ↓
Versioned projection
      ↓
Mobile UI
```

Terminal view remains available for raw operational access.

---

## 2.3 Chat is a projection of the same live agent session

A mobile chat view must not silently create another agent.

Correct model:

```text
Same Agent Session
      ├── Terminal View
      └── Transcript View
```

Both views point to one underlying process/session identity.

---

## 2.4 Host runtime owns connection truth

React Native or the UI layer must not own critical SSH state machines.

The host/client core owns:

- connection generation;
- reconnect loops;
- stale callback suppression;
- stream lifecycle;
- terminal restoration;
- transcript resume offsets;
- authoritative remote state.

The UI renders projections and submits semantic intents.

---

## 2.5 Strict SSH trust

Required behavior:

- unknown host key -> explicit fingerprint approval;
- changed host key -> hard failure by default;
- every jump host receives the same verification treatment;
- trust records stored separately from credentials;
- first-use trust UI warns that TOFU alone cannot independently verify identity.

---

## 2.6 Remote operations are typed workflows

Avoid shell-string parsing where a typed operation can exist.

Example:

```text
BAD
ssh.exec("ls -lah ...") -> parse text

GOOD
remoteFs.list(path) -> RemoteDirectoryEntry[]
```

Use shell execution only when it is actually a shell action.

---

# 3. Important Licensing Boundary

The upstream Whip repository is licensed under **GNU AGPL-3.0-or-later**.

For Pao-hubPro:

## Default policy

Use a **clean-room architectural adaptation**:

- study behavior;
- study architecture;
- study interfaces;
- independently implement equivalent concepts;
- do not copy source files, code blocks, internal implementation, or derivative modules by default.

## If direct code reuse is ever considered

Create a licensing review issue first containing:

- exact files proposed for reuse;
- upstream copyright notices;
- dependency/license mapping;
- whether network interaction triggers AGPL source obligations;
- distribution model;
- internal-only vs hosted vs shipped client implications;
- decision and approver.

No code from Whip enters production Pao-hubPro until this review is explicitly resolved.

---

# 4. Phase Goals

## G1 — Mobile-first fleet supervision

The operator can open the mobile app and immediately answer:

- Which hosts are online?
- Which agents are working?
- Which agents are blocked?
- Which tasks are waiting for approval?
- Which agents finished?
- Which host has a problem?
- Which terminal/session produced the event?

---

## G2 — Secure private connectivity

Primary supported routes:

```text
1. Tailscale + SSH
2. Direct private LAN + SSH
3. VPN + SSH
4. SSH ProxyJump / bastion chain
5. Public SSH only when intentionally configured
```

Pao-hubPro agent APIs should not need direct Internet exposure for this phase.

---

## G3 — Unified agent transcript model

At minimum implement adapters for:

- Codex;
- OpenCode.

Architecture must support:

- Claude Code;
- OpenHermit;
- Herdr-managed sessions;
- generic JSONL agents;
- custom Pao Agent Runtime;
- future provider adapters.

---

## G4 — Full terminal fallback

Every supported live agent/process can expose:

- terminal attach when available;
- command input;
- mobile control keys;
- resize;
- copy/paste;
- reconnect state;
- session identity.

---

## G5 — Remote workspace

Operator can safely:

- list files;
- browse directories;
- preview common file types;
- upload;
- download;
- edit bounded text files;
- delete with approval rules;
- inspect Git status;
- view diffs;
- attach files to agent prompts.

---

## G6 — Offline-safe operator intent

Network loss must not destroy drafts.

However:

> **Queued intent is not pre-approved intent.**

Any action requiring approval at send time must be reevaluated after reconnect.

---

## G7 — Human-controlled risky execution

Remote power must be policy governed.

The app must clearly distinguish:

- read;
- reversible write;
- irreversible write;
- privileged action;
- external side effect;
- secret access;
- destructive action.

---

## G8 — Durable auditability

Every material action must answer:

- who requested it;
- from which device;
- on which host;
- against which agent/session;
- what policy classified it;
- whether approval was required;
- who approved;
- what exact semantic action was executed;
- resulting status;
- relevant correlation IDs.

---

# 5. Non-Goals

Phase 20.99 does **not** aim to:

- replace the full desktop Pao-hubPro dashboard;
- expose unrestricted shell access to arbitrary unpaired devices;
- bypass existing Pao-hubPro approval policies;
- make the phone the source of truth for agent state;
- duplicate agent sessions merely to show chat;
- automatically execute stale offline commands after reconnect without policy reevaluation;
- store raw private keys in plain mobile storage;
- infer successful execution from terminal text;
- turn the Pao mobile app into a general public SSH client marketplace product in this phase.

---

# 6. Target Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                       PAO MOBILE APP                         │
│                                                              │
│ Hosts | Fleet | Chat | Terminal | Files | Approvals | More   │
│                                                              │
│ UI Projection Layer                                          │
│ Device Auth / Credential References / Local SQLite Cache      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                    SSH / Tailscale / VPN
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                  PAO SECURE TRANSPORT CORE                   │
│                                                              │
│ Host verification | ProxyJump | reconnect | forwards         │
│ generation guard | channel lifecycle | diagnostics           │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                    PAO HOST BRIDGE                           │
│                                                              │
│ Host Runtime                                                  │
│ ├─ Fleet Registry                                             │
│ ├─ Agent Adapter Registry                                     │
│ ├─ Transcript Manager                                         │
│ ├─ Terminal Manager                                           │
│ ├─ File/SFTP Manager                                          │
│ ├─ Approval Gateway                                           │
│ ├─ Policy Client                                              │
│ ├─ Audit Publisher                                            │
│ └─ Event Multiplexer                                          │
└──────────────────────────────┬───────────────────────────────┘
                               │
          ┌────────────────────┼──────────────────────┐
          │                    │                      │
┌─────────▼────────┐  ┌────────▼─────────┐  ┌────────▼─────────┐
│ Agent Runtimes   │  │ Pao MCP Gateway │  │ Local OS / Files │
│ Codex/OpenCode   │  │ policy-wrapped  │  │ Git / SFTP / PTY │
│ Claude/etc.      │  │ tools/actions   │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

# 7. Component Architecture

## 7.1 Pao Mobile App

Recommended stack:

- React Native;
- Expo where compatible with native requirements;
- TypeScript;
- native secure credential integration;
- SQLite for local non-secret caches;
- xterm-compatible terminal renderer or equivalent;
- generated typed client bindings where practical.

Responsibilities:

- render host/fleet views;
- render versioned state projections;
- capture operator intent;
- biometric/app-lock gate;
- show host fingerprints;
- display approval sheets;
- queue drafts locally;
- display terminal;
- display normalized transcripts;
- file picker/camera/photo integration;
- notifications;
- local preferences.

Must **not** own:

- canonical remote agent state;
- canonical approval state;
- policy logic;
- terminal protocol parsing beyond presentation concerns;
- SSH reconnect correctness;
- agent transcript source offsets;
- secret plaintext persistence.

---

## 7.2 Secure Transport Core

Prefer a native core implementation, ideally Rust, for connection-critical behavior.

Interface examples:

```rust
connect_host(profile_id)
disconnect_host(host_id)
approve_host_key(challenge_id, fingerprint)
open_control_stream(host_id)
open_terminal_stream(host_id, target)
open_sftp(host_id)
open_forward(host_id, remote_target)
get_diagnostics(host_id)
```

Required behavior:

- stable host runtime object;
- connection generation/epoch counter;
- cancellation of stale streams;
- bounded retry;
- jittered exponential backoff;
- per-stream lifecycle isolation;
- strict host-key verification;
- jump-host verification;
- typed errors;
- no regex parsing of native error strings in JS;
- coarse diagnostics only — no secrets in logs.

---

## 7.3 Pao Host Bridge

Run on every controllable host.

Suggested process:

```text
pao-host-bridge
```

Characteristics:

- binds to loopback or Unix socket by default;
- never requires public TCP exposure;
- reachable through authenticated SSH forwarding/stream channels;
- validates mobile device identity/session;
- publishes typed snapshots + event stream;
- translates semantic requests to internal Pao services;
- enforces policy before execution;
- emits audit records.

Suggested local endpoints/protocol methods:

```text
host.ping
host.capabilities
host.snapshot
fleet.snapshot
fleet.subscribe
agent.list
agent.get
agent.send
agent.stop
agent.resume
agent.attach_terminal
agent.transcript.open
agent.transcript.resume
terminal.open
terminal.input
terminal.resize
terminal.close
files.list
files.stat
files.read_text
files.upload_begin
files.download_begin
files.delete
files.rename
git.status
git.diff
approval.list
approval.decide
policy.preview
audit.tail
```

Use a versioned typed protocol.

---

# 8. Unified Agent Model

Create an agent-neutral domain model.

```ts
type AgentStatus =
  | "blocked"
  | "waiting_approval"
  | "working"
  | "done"
  | "idle"
  | "error"
  | "offline"
  | "unknown";

interface AgentRef {
  agentId: string;
  provider: string;
  runtime: string;
  hostId: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
}

interface AgentSummary {
  ref: AgentRef;
  displayName: string;
  status: AgentStatus;
  task?: string;
  lastActivityAt?: string;
  attentionReason?: string;
  riskPending?: RiskClass;
  unreadCount?: number;
}
```

## Attention ordering

Default fleet order:

```text
1. waiting_approval
2. blocked
3. error
4. done with unread result
5. working
6. idle
7. offline
8. unknown
```

Allow filter by:

- host;
- project;
- workspace;
- runtime;
- provider;
- status;
- risk;
- assigned task.

---

# 9. Agent Adapter Registry

Introduce:

```text
AgentAdapter
```

Contract:

```ts
interface AgentAdapter {
  kind: string;
  discover(ctx): Promise<DiscoveredAgent[]>;
  getStatus(ref): Promise<AgentStatus>;
  getTranscriptSource(ref): Promise<TranscriptSource | null>;
  send(ref, input): Promise<SendResult>;
  stop?(ref): Promise<ActionResult>;
  resume?(ref): Promise<ActionResult>;
  attachTerminal?(ref): Promise<TerminalTarget | null>;
}
```

Initial adapters:

### Adapter A — Codex

Responsibilities:

- bind exact active session identity;
- locate authoritative rollout/session records through supported runtime metadata;
- parse incrementally;
- recover from truncation/replacement;
- normalize messages/tool calls/diffs/status;
- send through the same live underlying process/session.

### Adapter B — OpenCode

Responsibilities:

- cold snapshot from supported export/query mechanism;
- durable incremental events;
- sequence validation;
- fallback resync on divergence;
- send through existing session.

### Adapter C — Pao Native Agent Runtime

Canonical target adapter for future phases.

Should expose structured:

- session state;
- steps;
- tool calls;
- approvals;
- artifacts;
- checkpoints;
- budget state;
- resume token.

### Future adapters

- Claude Code;
- OpenHermit;
- Herdr;
- Gemini CLI;
- generic JSONL;
- MCP-managed task worker;
- browser automation worker.

---

# 10. Transcript Projection

## 10.1 Normalized transcript model

```ts
interface AgentTranscript {
  transcriptId: string;
  agent: AgentRef;
  revision: number;
  sourceState: "live" | "stale" | "reconnecting" | "closed" | "error";
  turns: TranscriptTurn[];
  checkpoint?: string;
}

type TranscriptItem =
  | UserMessage
  | AssistantMessage
  | ReasoningSummary
  | ToolActivity
  | PlanItem
  | FileDiff
  | Notice
  | ApprovalRequest
  | LifecycleEvent;
```

## 10.2 Required semantics

- transcript source remains authoritative;
- local cache is acceleration only;
- each projection has a monotonic revision;
- partial JSONL lines must not be treated as valid records;
- stale stream callbacks must be generation guarded;
- disconnect retains last known content and marks it stale;
- missed callback must be recoverable through full projection fetch;
- duplicate tool rows must be collapsed where source IDs permit;
- display reasoning only where the runtime explicitly exposes safe/visible summaries;
- never manufacture hidden model reasoning.

## 10.3 Chat composer

Composer supports:

- multiline prompt;
- file attachments;
- image attachments where adapter/runtime supports them;
- prompt history;
- drafts per session;
- speech-to-text from device keyboard/OS where available;
- send queue;
- risk preview before dispatch when tools/actions are requested.

---

# 11. Terminal Plane

## 11.1 Terminal identity

```ts
interface TerminalRef {
  terminalId: string;
  hostId: string;
  agentId?: string;
  paneId?: string;
  cwd?: string;
}
```

Each terminal is independent.

One terminal failure must not disconnect:

- host control stream;
- file operations;
- other terminals;
- transcript streams.

## 11.2 Mobile controls

Provide:

- Ctrl;
- Alt;
- Esc;
- Tab;
- arrows;
- Home/End;
- PgUp/PgDn;
- configurable key rail;
- clipboard;
- selection;
- paste confirmation for multiline/high-risk pasted commands;
- search;
- font size;
- scrollback limit.

## 11.3 Terminal execution safeguards

Interactive terminal access is powerful and must still respect policy.

Two modes:

### Raw terminal mode

For explicitly trusted operator sessions.

Requires:

- device unlock;
- host trust;
- operator authorization;
- visible “RAW SHELL” indicator;
- audit metadata.

### Policy-wrapped command mode

Preferred for common operations.

User submits a semantic command; host bridge evaluates risk before dispatch.

---

# 12. Remote File / SFTP Workspace

## 12.1 Supported actions

- list directory;
- stat;
- bounded text read;
- preview;
- upload;
- download;
- rename;
- mkdir;
- delete;
- Git status;
- Git diff;
- attach to agent prompt.

## 12.2 Atomic transfer behavior

Uploads:

```text
upload to temp sibling
       ↓
fsync/close where appropriate
       ↓
rename into destination
```

Replacement:

```text
existing destination
      ↓
preserve/backup temp
      ↓
finalize new file
      ↓
restore old file on failure when feasible
```

Downloads:

```text
stream -> temp local file -> finalize rename only on success
```

## 12.3 Limits

Configurable defaults:

```text
max concurrent transfers per host: 4
max inline text preview: 1 MiB
max diff preview: 2 MiB
max automatic media preview: policy/config dependent
```

## 12.4 Untrusted content

Treat remote content as untrusted.

- sandbox HTML;
- never auto-execute downloaded content;
- do not follow private/internal links without explicit user action;
- sanitize rendered Markdown;
- no script execution in Markdown;
- preview MIME from verified type/content where practical.

---

# 13. Offline-Safe Command Queue

## 13.1 Queue objectives

Preserve operator intent while avoiding unsafe stale execution.

States:

```text
DRAFT
  ↓
QUEUED_LOCAL
  ↓ reconnect
POLICY_RECHECK
  ├── SAFE_TO_SEND -> SENDING -> SENT -> ACKED
  ├── APPROVAL_REQUIRED -> WAITING_APPROVAL
  ├── CONTEXT_CHANGED -> NEEDS_REVIEW
  └── REJECTED -> FAILED_POLICY
```

## 13.2 Queue record

```ts
interface QueuedIntent {
  intentId: string;
  createdAt: string;
  hostId: string;
  target: AgentRef | TerminalRef | FileTarget;
  semanticAction: string;
  payloadHash: string;
  encryptedPayloadRef: string;
  creationContextRevision?: number;
  originalRisk?: RiskClass;
  state: QueueState;
}
```

## 13.3 Critical rule

Never auto-send after reconnect if any of these changed:

- host identity;
- session identity;
- target process;
- cwd/workspace;
- policy revision;
- agent lifecycle epoch;
- command risk class;
- approval requirements;
- destructive target existence/state.

Instead mark:

```text
NEEDS_REVIEW
```

## 13.4 Actions prohibited from silent offline replay

- destructive file deletion;
- git reset/clean/force push;
- package publication;
- deployment;
- secret rotation;
- privilege escalation;
- OS shutdown/reboot;
- account/permission changes;
- payment/purchase;
- outbound messaging;
- database destructive migration;
- external API writes classified high risk.

---

# 14. Policy-Governed Human Approval Plane

This is the key Pao-hubPro extension beyond a normal mobile SSH client.

## 14.1 Risk classes

```text
R0 — Observe
Read-only state, logs, safe metadata.

R1 — Low-risk reversible
Focus pane, resize, create local draft, non-destructive navigation.

R2 — Controlled write
Edit file, send prompt, start agent, run bounded normal command.

R3 — High-impact
Delete/overwrite, install system package, restart service, deploy, push, modify credentials/config.

R4 — Critical / privileged / external irreversible
Root/system destructive actions, secret export, destructive DB action, infrastructure deletion, external financial/publishing action, force operations.
```

## 14.2 Default policy

| Risk | Default mobile behavior |
|---|---|
| R0 | Allow after authenticated connection |
| R1 | Allow + audit |
| R2 | Allow or require compact confirmation depending on policy |
| R3 | Explicit approval sheet + context summary |
| R4 | Strong confirmation + biometric re-auth + optional second reviewer |

## 14.3 Approval request model

```ts
interface ApprovalRequest {
  approvalId: string;
  risk: "R0" | "R1" | "R2" | "R3" | "R4";
  hostId: string;
  actorDeviceId: string;
  target: string;
  action: string;
  humanSummary: string;
  exactPayloadHash: string;
  expiresAt: string;
  policyVersion: string;
  requiredApprovers: number;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
}
```

## 14.4 Approval sheet UI

Must show:

- action;
- host;
- project/workspace;
- target agent/process;
- risk class;
- files/resources touched;
- external side effects;
- command preview;
- diff preview where applicable;
- credential/secret scope if relevant;
- expiry;
- policy reason.

Buttons:

```text
DENY
EDIT / RETURN
APPROVE ONCE
APPROVE FOR SESSION   (only when policy explicitly allows)
```

No generic “Always allow” for R3/R4.

---

# 15. Biometric Credential Vault

## 15.1 Storage rules

Store separately:

### Non-secret profile metadata

Examples:

- display name;
- hostname/IP alias;
- port;
- username;
- route/jump-host IDs;
- last connected time;
- UI labels.

Can live in app database.

### Secrets

Examples:

- passwords;
- SSH private keys;
- key passphrases;
- recovery tokens;
- sensitive pairing credentials.

Must live in platform-protected credential storage.

The ordinary profile database stores only references.

## 15.2 Biometric/app lock

Use biometric/device authentication as a local access gate.

Do not treat it as a substitute for:

- strong device passcode;
- OS encryption;
- SSH authentication;
- host-key verification;
- server authorization;
- Pao policy engine.

## 15.3 Clipboard handling

- never auto-copy private keys;
- clear sensitive temporary clipboard content where platform capability permits and policy allows;
- warn before copying secrets;
- redact secrets in screenshots/log exports where possible.

---

# 16. QR Device Pairing

## 16.1 Objective

Add a mobile device without manually moving a private key or copying a long configuration.

## 16.2 Proposed pairing flow

On host:

```bash
pao pair mobile
```

Host bridge creates a short-lived pairing session.

Terminal displays:

```text
Pao-hubPro Mobile Pairing

Device enrollment expires in 5 minutes.
Scan QR from the Pao Mobile app.

[ QR ]

Verification words:
FROST-MANGO-RIVER-27
```

Mobile scans QR.

## 16.3 QR payload must contain only bootstrap material

Example payload:

```json
{
  "v": 1,
  "pairing_id": "...",
  "host_hint": "...",
  "port": 22,
  "ephemeral_public_key": "...",
  "nonce": "...",
  "expires_at": "..."
}
```

Do **not** embed:

- reusable private key;
- SSH password;
- permanent bearer token;
- unrestricted API key.

## 16.4 Pairing handshake

```text
Host creates ephemeral pairing state
        ↓
Mobile scans QR
        ↓
Mobile creates device key pair
        ↓
Mutual challenge / proof
        ↓
User compares verification phrase/fingerprint
        ↓
Host registers mobile public identity
        ↓
Mobile receives host trust material / profile metadata
        ↓
Pairing state destroyed
```

## 16.5 Revocation

Host command:

```bash
pao devices list
pao devices revoke <device-id>
```

Mobile:

```text
Host -> Security -> Paired devices -> Revoke local profile
```

Revocation event must invalidate future authenticated control sessions.

---

# 17. Host-Key Verification

Required states:

```text
KNOWN_GOOD
UNKNOWN
CHANGED
REVOKED
UNSUPPORTED
```

Unknown:

- show SHA-256 fingerprint;
- show host/port;
- show route/jump path;
- require explicit approval.

Changed:

- block connection;
- show old fingerprint + new fingerprint;
- do not provide a one-tap silent replacement;
- require a deliberate trust-reset workflow.

Each ProxyJump hop has separate trust state.

---

# 18. Network Topologies

## Mode A — Tailscale preferred

```text
Mobile ── Tailnet ── SSH ── Host Bridge
```

Recommended default when available.

## Mode B — Trusted LAN

```text
Mobile ── Wi-Fi LAN ── SSH ── Host Bridge
```

## Mode C — Jump host

```text
Mobile -> Bastion SSH -> Private Host SSH -> Pao Host Bridge
```

## Mode D — Explicit public SSH

Supported only when intentionally configured.

Recommend:

- keys only;
- disable password where practical;
- rate limiting/fail2ban equivalent;
- no root direct login;
- least-privileged dedicated account.

---

# 19. Device / Host Identity

Create stable identities:

```text
DeviceId
HostId
HostTrustId
ConnectionId
RuntimeGeneration
AgentId
AgentSessionId
TerminalId
ApprovalId
IntentId
AuditEventId
```

Never rely only on display names.

Example:

```text
"VPS Stock Server"
```

is presentation data, not an authority identifier.

---

# 20. Local Data Model

Use SQLite on mobile for non-secret durable state.

Suggested tables:

```sql
CREATE TABLE host_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  credential_ref TEXT,
  jump_route_json TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trusted_host_keys (
  id TEXT PRIMARY KEY,
  host_profile_id TEXT NOT NULL,
  hop_index INTEGER NOT NULL,
  algorithm TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  FOREIGN KEY(host_profile_id) REFERENCES host_profiles(id)
);

CREATE TABLE transcript_cache (
  cache_key TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  opaque_blob BLOB NOT NULL,
  checkpoint TEXT,
  schema_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE queued_intents (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  target_ref_json TEXT NOT NULL,
  semantic_action TEXT NOT NULL,
  encrypted_payload_ref TEXT NOT NULL,
  context_revision INTEGER,
  risk_class TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ui_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Secrets remain outside SQLite unless encrypted by a dedicated platform-secured design.

---

# 21. Host Bridge State Model

If Pao-hubPro already has PostgreSQL/control-plane persistence, reuse it rather than creating competing truth.

Add only the entities needed for this mobile phase.

Suggested logical tables/entities:

```text
mobile_devices
mobile_device_keys
mobile_pairing_sessions
mobile_sessions
host_connections
agent_runtime_bindings
approval_requests
approval_decisions
audit_events
policy_versions
```

Example fields for `mobile_devices`:

```text
id
label
public_key
platform
device_model_hint
created_at
last_seen_at
revoked_at
policy_scope
```

---

# 22. Event Model

Event envelope:

```ts
interface PaoEvent<T> {
  eventId: string;
  eventType: string;
  hostId: string;
  revision?: number;
  runtimeGeneration?: number;
  timestamp: string;
  correlationId?: string;
  payload: T;
}
```

Key event types:

```text
host.connection.changed
host.snapshot.updated
agent.discovered
agent.status.changed
agent.output.available
agent.transcript.updated
agent.completed
agent.blocked
agent.error
terminal.opened
terminal.disconnected
terminal.restored
file.transfer.progress
file.transfer.completed
approval.created
approval.updated
policy.denied
queue.needs_review
audit.event
```

---

# 23. Revision / Generation Rules

Every connection replacement increments:

```text
runtime_generation
```

Every authoritative host projection increments:

```text
state_revision
```

Callbacks containing older generation IDs are ignored.

Snapshot/event reconciliation:

```text
start snapshot request at revision context N
  ↓
continue applying incoming events
  ↓
snapshot returns
  ↓
if generation still valid:
    apply accepted snapshot
    replay buffered newer events
else:
    discard snapshot
```

Never let a slow stale snapshot overwrite newer observed state.

---

# 24. Mobile Information Architecture

Bottom navigation:

```text
Hosts | Fleet | Terminal | Approvals | More
```

Chat and Files are contextual surfaces reached from an agent/session/host.

## 24.1 Hosts

Show:

- host name;
- online/offline;
- latency;
- trust state;
- route;
- agent counts;
- pending approvals;
- reconnect status.

## 24.2 Fleet

Cards:

```text
[WAITING APPROVAL] Codex — pao-hubPro
Deploy requested
Host: VPS-01
Risk: R3
2 min ago
```

## 24.3 Agent detail

Tabs or segmented control:

```text
Chat | Activity | Terminal | Files | Info
```

## 24.4 Terminal

Full-screen renderer + thin session rail.

## 24.5 Approvals

Global approval inbox.

Scopes:

- pending;
- approved;
- denied;
- expired;
- high-risk only.

## 24.6 More

- security;
- paired devices;
- known hosts;
- notifications;
- voice;
- appearance;
- terminal preferences;
- diagnostics;
- logs export with redaction;
- about/protocol versions.

---

# 25. Notifications

Notification classes:

```text
Agent blocked
Approval requested
Agent completed
Agent error
Host disconnected
Transfer completed/failed
Policy denied
Critical security event
```

Default priority:

```text
Critical security > R4 approval > R3 approval > blocked/error > completed > informational
```

Notification tap should deep-link to the exact host/agent/approval.

Sensitive notification text should be configurable for lock-screen privacy.

---

# 26. Voice / Accessibility

Optional voice announcements can read safe summaries such as:

```text
"Codex on VPS-01 is waiting for approval."
```

Never read:

- secrets;
- full terminal output;
- raw credentials;
- hidden chain-of-thought;
- high-sensitivity payloads on lock screen.

Accessibility requirements:

- screen-reader labels;
- scalable text;
- large touch targets;
- status not conveyed by color alone;
- reduced motion;
- hardware keyboard support where practical;
- tablet layout later without breaking phone UX.

---

# 27. Security Threat Model

## Threat T1 — Stolen phone

Mitigations:

- device-level encryption dependency;
- app lock;
- biometric re-auth for critical actions;
- secrets stored in platform credential store;
- revocable device identity;
- no plaintext private keys in app DB.

## Threat T2 — MITM on first connection

Mitigations:

- show fingerprint;
- independent verification guidance;
- pairing verification phrase;
- Tailscale/private network recommendation.

## Threat T3 — Changed SSH host key

Mitigation:

- fail closed;
- deliberate trust reset.

## Threat T4 — Compromised remote host

Mitigations:

- least privilege account;
- restricted agent forwarding;
- policy separation;
- no unnecessary key material placement;
- per-host scopes.

## Threat T5 — Malicious remote content

Mitigations:

- sandbox previews;
- sanitize Markdown/HTML;
- no auto-open external/private URLs;
- bounded file reads.

## Threat T6 — Stale offline command executes in changed context

Mitigation:

- mandatory context/policy recheck;
- session identity comparison;
- high-risk replay prohibition.

## Threat T7 — Approval confused-deputy problem

Mitigations:

Approval is bound to:

- payload hash;
- target identity;
- policy version;
- host;
- session;
- expiry.

Changing any material field invalidates approval.

## Threat T8 — Secret leakage in logs

Mitigations:

- structured redaction;
- denylist + typed secret fields;
- no private keys/passwords/tokens in diagnostics;
- sanitized export.

---

# 28. Audit Model

Audit event example:

```json
{
  "event_id": "evt_...",
  "timestamp": "...",
  "actor": {
    "type": "mobile_device",
    "device_id": "dev_..."
  },
  "host_id": "host_...",
  "agent_id": "agent_...",
  "session_id": "session_...",
  "action": "files.delete",
  "risk": "R3",
  "approval_id": "apr_...",
  "policy_version": "2026-09-20.1",
  "payload_hash": "sha256:...",
  "result": "success",
  "correlation_id": "corr_..."
}
```

Audit logs must avoid raw secret values.

---

# 29. Suggested Repository Layout

Adapt to the current Pao-hubPro monorepo instead of forcing this layout if equivalents already exist.

```text
apps/
  mobile-ops/
    src/
      screens/
      components/
      features/
        hosts/
        fleet/
        chat/
        terminal/
        files/
        approvals/
        pairing/
      storage/
      notifications/
      navigation/

services/
  host-bridge/
    src/
      transport/
      protocol/
      fleet/
      adapters/
        codex/
        opencode/
        pao-native/
      transcripts/
      terminal/
      files/
      policy/
      approvals/
      audit/

crates/
  pao-mobile-core/
  pao-ssh/
  pao-terminal-protocol/
  pao-transcript/
  pao-remote-fs/

packages/
  mobile-protocol/
  domain-types/
  policy-types/
  ui-tokens/

docs/
  phases/
    20.99-mobile-agent-ops/
```

---

# 30. Protocol Versioning

Handshake:

```json
{
  "client": "pao-mobile",
  "client_version": "...",
  "protocol_min": 1,
  "protocol_max": 1,
  "capabilities": [
    "fleet",
    "transcript.codex",
    "transcript.opencode",
    "terminal",
    "sftp",
    "approvals"
  ]
}
```

Server response:

```json
{
  "server": "pao-host-bridge",
  "protocol": 1,
  "capabilities": [...]
}
```

Unsupported versions must fail with a typed incompatibility error.

---

# 31. Reliability Rules

Mandatory:

1. Stale state must visibly say **STALE / RECONNECTING**.
2. Failed read must never become successful empty data.
3. One failed terminal must not collapse the host session.
4. Reconnect must be serialized per host.
5. Old-generation callbacks must be ignored.
6. Known-good state may remain visible during reconnect, marked stale.
7. Transcript failure retains existing content.
8. File transfer cancellation cannot later report success.
9. Queue replay always reevaluates current policy.
10. Mobile backgrounding must not imply the remote agent stopped.
11. Connection state must be recoverable after normal app lifecycle suspension.
12. Destructive action success must come from execution result, not guessed terminal output.

---

# 32. Performance Targets

Initial targets on trusted network:

```text
Host list render from local cache: < 250 ms
Warm host state refresh: < 1 s typical
Fleet status event to UI: < 500 ms typical
Terminal keystroke interaction: subjectively real-time
Chat incremental update: < 750 ms typical after source event
Approval screen open: < 300 ms from local event availability
```

These are engineering targets, not hard guarantees.

Avoid premature optimization at the expense of state correctness.

---

# 33. Observability

Diagnostics should include:

- connect duration;
- SSH auth duration;
- round-trip latency;
- event stream reconnect count;
- terminal reconnect count;
- transcript lag;
- dropped/stale callback count;
- file transfer throughput;
- policy evaluation duration;
- approval duration;
- queue age;
- protocol mismatch.

Never include:

- private keys;
- passwords;
- access tokens;
- full secret-bearing commands;
- raw secure-store contents.

---

# 34. Implementation Work Packages

## WP0 — Recon / integration map

Before coding:

- inspect current Pao-hubPro repo;
- identify existing agent registry;
- identify policy engine;
- identify approvals;
- identify MCP gateway;
- identify audit system;
- identify existing WebSocket/event bus;
- identify existing PostgreSQL schema;
- identify shared TypeScript/Rust types;
- identify mobile app status, if any.

Output:

```text
INTEGRATION_MAP.md
```

No duplicate subsystem should be created if a suitable one already exists.

---

## WP1 — Domain types

Create canonical types for:

- Host;
- HostTrust;
- AgentRef;
- AgentStatus;
- AgentTranscript;
- TerminalRef;
- Transfer;
- QueuedIntent;
- ApprovalRequest;
- AuditEvent;
- protocol errors.

Add schema validation and versioning.

---

## WP2 — Host Bridge skeleton

Implement:

- loopback/Unix socket server;
- ping/capabilities;
- authenticated SSH-access path;
- snapshots;
- event subscription;
- generation IDs;
- health diagnostics.

---

## WP3 — Secure transport

Implement:

- host profiles;
- strict host-key checks;
- key/password credential refs;
- jump hosts;
- Tailscale-compatible addressing;
- reconnect state machine;
- typed errors.

---

## WP4 — Fleet registry

Implement aggregation from current Pao agent systems.

Output:

```text
fleet.snapshot
fleet.subscribe
```

Add attention sorting.

---

## WP5 — Codex transcript adapter

Implement:

- exact session binding;
- incremental source reader;
- normalization;
- checkpointing;
- stale/reconnect behavior;
- same-session send path.

Tests with:

- partial records;
- truncation;
- rotation;
- reconnect;
- duplicate events;
- session replacement.

---

## WP6 — OpenCode transcript adapter

Same standards as Codex.

Use supported authoritative source mechanisms.

---

## WP7 — Terminal gateway

Implement:

- open;
- input;
- resize;
- close;
- per-terminal isolation;
- reconnect;
- binary frames;
- mobile renderer bridge.

---

## WP8 — Remote files

Implement:

- SFTP session;
- typed directory entries;
- atomic upload/download;
- bounded previews;
- delete/rename;
- Git status/diff;
- attachment placement.

---

## WP9 — Approval integration

Wire every semantic action into Pao policy evaluation.

Add:

```text
policy.preview
approval.create
approval.decide
```

Bind approval to payload hash + context.

---

## WP10 — Offline queue

Implement local queue storage, context revision checks, and replay state machine.

High-risk actions must never silently replay.

---

## WP11 — QR pairing

Implement:

- `pao pair mobile`;
- expiring pairing state;
- QR payload;
- mobile scanner;
- mutual challenge;
- verification phrase;
- device registration;
- revoke command.

---

## WP12 — Mobile UI

Implement screens in this order:

```text
1. Hosts
2. Fleet
3. Agent detail / Chat
4. Terminal
5. Approvals
6. Files
7. Pairing
8. Security / More
```

Use Apple-like clean visual discipline without cloning Apple proprietary UI.

Prioritize operational clarity over decoration.

---

## WP13 — Notifications

Implement local/push-compatible notification abstraction for:

- approvals;
- blocked;
- complete;
- errors;
- security events.

If remote push infrastructure is not yet available, local/background-capable mechanisms can ship first where platform rules allow.

---

## WP14 — Security hardening

Perform:

- secret scan;
- log redaction test;
- threat-model verification;
- host-key replacement tests;
- pairing expiry tests;
- revoked-device tests;
- replay tests;
- approval tamper tests;
- SFTP traversal tests;
- malformed protocol fuzz/property tests where practical.

---

# 35. Test Matrix

## 35.1 Transport

- correct host key;
- unknown key;
- changed key;
- wrong username;
- wrong key;
- password auth;
- key auth;
- jump host;
- jump host changed key;
- network drop;
- rapid reconnect;
- app background/foreground;
- server reboot.

## 35.2 Fleet

- no agents;
- 1 agent;
- many agents;
- multi-host;
- blocked;
- waiting approval;
- completed;
- stale host;
- host disappears.

## 35.3 Transcript

- cold load;
- incremental event;
- partial JSONL;
- malformed record;
- source rotation;
- source truncation;
- reconnect;
- cache restore;
- duplicate ID;
- late callback from old generation.

## 35.4 Terminal

- open/close;
- resize;
- UTF-8;
- ANSI;
- alternate screen;
- Ctrl/Alt;
- paste;
- network loss;
- reconnect;
- multiple terminals;
- terminal failure isolation.

## 35.5 Files

- list;
- upload;
- cancel upload;
- overwrite;
- failure during overwrite;
- download;
- cancel download;
- rename;
- delete;
- symlink;
- permission denied;
- large file;
- untrusted HTML preview.

## 35.6 Approval

- R0;
- R1;
- R2;
- R3;
- R4;
- expired approval;
- changed payload after approval;
- changed target;
- revoked device;
- policy version changed.

## 35.7 Offline queue

- compose offline;
- reconnect same session;
- reconnect new session;
- target deleted;
- policy changed;
- host key changed;
- R3 replay attempt;
- duplicate send prevention.

---

# 36. Acceptance Criteria

Phase 20.99 is **DONE** only when all mandatory criteria below pass.

## Core connectivity

- [ ] Mobile can save a host profile.
- [ ] SSH host-key verification is strict.
- [ ] Changed key fails closed.
- [ ] At least one jump-host route works.
- [ ] Tailscale/private hostname works as a normal SSH target.
- [ ] Connection state survives ordinary navigation.
- [ ] Reconnect shows stale state explicitly.

## Fleet

- [ ] Agents from at least two runtimes can be represented in one fleet model.
- [ ] Fleet supports multi-host aggregation.
- [ ] Waiting approvals sort to the top by default.
- [ ] Agent detail deep-links correctly.

## Transcript

- [ ] Codex active session transcript works.
- [ ] OpenCode active session transcript works.
- [ ] Chat and Terminal point to the same agent session.
- [ ] Transcript reconnect does not erase history.
- [ ] Old generation events cannot overwrite new state.

## Terminal

- [ ] Multiple terminals can remain open.
- [ ] Terminal failure does not disconnect host control state.
- [ ] Mobile extra keys work.
- [ ] Resize works.
- [ ] Reconnect restores eligible terminals or clearly reports failure.

## Files

- [ ] Browse remote files.
- [ ] Upload/download with progress.
- [ ] Atomic finalization is used.
- [ ] Cancelled transfer cannot later appear successful.
- [ ] Text/code/Markdown/image/PDF preview path exists.
- [ ] Dangerous preview types are sandboxed or blocked.

## Offline queue

- [ ] Draft survives network loss.
- [ ] Reconnect triggers policy recheck.
- [ ] Changed session/context triggers NEEDS_REVIEW.
- [ ] High-risk queued actions never silently replay.

## Approval / policy

- [ ] R3/R4 actions require explicit approval under default policy.
- [ ] Approval binds to payload hash.
- [ ] Material payload change invalidates approval.
- [ ] Critical approval can require biometric re-auth.
- [ ] All material decisions generate audit records.

## Pairing / security

- [ ] QR pairing contains no reusable plaintext secret.
- [ ] Pairing expires.
- [ ] Device can be revoked.
- [ ] Revoked device cannot open a new authorized control session.
- [ ] Secret scan finds no committed credentials.
- [ ] Logs redact secrets.

## Quality

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Type checks pass.
- [ ] Lint passes.
- [ ] Mobile build passes for target platform(s).
- [ ] Existing Pao-hubPro regression suite remains green.
- [ ] Architecture documentation is updated.
- [ ] Threat model is documented.

---

# 37. Definition of “Production-Ready Enough” for This Phase

Do not mark this phase complete because screens exist.

It is complete when a real operator can:

```text
1. Open the mobile app.
2. Authenticate locally.
3. Connect to a trusted Pao host over SSH/Tailscale.
4. See all active agents.
5. Open a Codex/OpenCode transcript.
6. Send a message to that same session.
7. Switch to its live terminal.
8. Inspect/edit/upload a file.
9. Receive an approval request.
10. Approve or deny it with clear risk context.
11. Lose network temporarily.
12. Reconnect without corrupting session truth.
13. Review queued intent before unsafe replay.
14. Inspect a durable audit trail.
```

---

# 38. Rollout Strategy

## Stage A — Internal dev mode

- single Android test device;
- single host;
- key auth;
- Codex only;
- host/fleet/chat/terminal.

## Stage B — Secure daily-driver

- Tailscale;
- multiple hosts;
- OpenCode adapter;
- SFTP;
- approvals;
- biometric lock;
- QR pairing.

## Stage C — Fleet operations

- broader Pao agent adapters;
- resumable fleet tasks;
- richer notifications;
- audit dashboards;
- multi-device policy.

## Stage D — Optional iOS hardening

- signing/distribution;
- Keychain behavior;
- background lifecycle;
- notification parity;
- device-specific terminal QA.

---

# 39. Compatibility With Existing Pao-hubPro Phases

Phase 20.99 should **integrate**, not duplicate.

Expected integrations:

```text
OpenHermit / durable agent fleets
        ↓
Fleet Registry

OmniRoute / multi-provider routing
        ↓
Agent metadata + provider visibility

SkillsGate / policy systems
        ↓
Action policy evaluation

OpenCodeReview / Reviewer Council
        ↓
Approval context / code diff review

MCPProxy / MCP gateway
        ↓
Tool execution visibility + approval

BrowserSkill / browser runtimes
        ↓
Mobile agent status and takeover links

FileSync / artifact movement
        ↓
Remote file workflows where appropriate

Context / memory phases
        ↓
Read-only session context summaries
```

Do not hard-wire Phase 20.99 to one provider.

---

# 40. Architecture Decisions — ADR Set

Create ADRs during implementation.

Minimum:

```text
ADR-20.99-001 — Mobile is projection, not source of host truth
ADR-20.99-002 — SSH/Tailscale-first private transport
ADR-20.99-003 — Strict host-key verification
ADR-20.99-004 — Native/Rust-owned connection state machine
ADR-20.99-005 — Transcript and terminal share agent session identity
ADR-20.99-006 — Offline queue requires reconnect policy reevaluation
ADR-20.99-007 — Approval bound to payload hash/context
ADR-20.99-008 — Platform secure storage for secrets
ADR-20.99-009 — Clean-room Whip architecture adaptation because AGPL
ADR-20.99-010 — Typed semantic operations preferred over shell parsing
```

---

# 41. Engineering Guardrails

Codex must follow these rules while implementing this phase:

1. **Inspect before changing.** Map the existing architecture first.
2. **Reuse existing services.** Do not create duplicate policy, audit, registry, or DB systems.
3. **No secret shortcuts.** Never place keys/tokens/passwords in source or test fixtures.
4. **No public bridge by default.** Host bridge remains loopback/Unix-socket scoped unless explicitly configured.
5. **No silent host-key acceptance.** Ever.
6. **No stale callback wins.** Use generation guards.
7. **No chat session duplication.** Transcript and send path bind to the same actual session.
8. **No unsafe offline replay.** Reevaluate.
9. **No approval after payload mutation.** Reapprove.
10. **No destructive shell-string convenience path** when a typed protected action exists.
11. **No fake completion.** Execute tests and report actual results.
12. **No AGPL source copying from Whip** without explicit license review.
13. **Preserve current Pao-hubPro behavior** behind feature flags where migration risk exists.
14. **Keep all protocol additions versioned.**
15. **Document deviations** from this phase specification.

---

# 42. Suggested Feature Flags

```text
mobile_ops.enabled
mobile_ops.ssh_transport
mobile_ops.tailscale_hints
mobile_ops.fleet
mobile_ops.codex_transcript
mobile_ops.opencode_transcript
mobile_ops.terminal
mobile_ops.files
mobile_ops.offline_queue
mobile_ops.approvals
mobile_ops.biometric_gate
mobile_ops.qr_pairing
mobile_ops.notifications
mobile_ops.voice
```

Ship incrementally without breaking core runtime.

---

# 43. Deliverables

Codex must produce or update:

```text
1. Source implementation
2. Database migrations if required
3. Protocol schemas/types
4. Mobile screens
5. Host bridge
6. Agent adapters
7. Terminal integration
8. Remote file integration
9. Offline queue
10. Approval/policy integration
11. Pairing CLI
12. Security documentation
13. ADRs
14. Integration tests
15. E2E smoke tests
16. Phase completion report
```

Completion report:

```text
PHASE_20.99_COMPLETION_REPORT.md
```

Must include:

- implemented scope;
- skipped scope;
- changed files;
- DB migrations;
- test commands;
- test results;
- security checks;
- known limitations;
- screenshots/build artifacts where available;
- next recommended phase.

---

# 44. Required Build / Validation Commands

Codex must discover the actual repo commands first.

Then run the repository-equivalent of:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Plus mobile/native validation relevant to the detected stack.

If Rust exists:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

Do not invent scripts that do not exist. Use discovered equivalents and document them.

---

# 45. Exit Gate

Before reporting completion, Codex must answer **YES** to all:

```text
[ ] Did I inspect existing architecture first?
[ ] Did I avoid duplicate Pao-hubPro subsystems?
[ ] Is transport private-first?
[ ] Is SSH trust strict?
[ ] Are secrets protected?
[ ] Is the same agent session used for Chat and Terminal?
[ ] Are stale callbacks generation-guarded?
[ ] Does reconnect retain truth safely?
[ ] Are offline actions reevaluated?
[ ] Are R3/R4 actions approval gated?
[ ] Is approval bound to immutable context/payload hash?
[ ] Can a paired device be revoked?
[ ] Are audit records durable?
[ ] Are remote files treated as untrusted?
[ ] Did all relevant tests actually run?
[ ] Did existing Pao-hubPro tests remain green?
[ ] Did I avoid copying AGPL Whip code without review?
[ ] Did I write the completion report?
```

If any mandatory item is NO, Phase 20.99 remains incomplete.

---

# 46. `/goal` — One-Shot Codex Master Command

Use this as the high-level implementation command after placing this phase file inside the Pao-hubPro repository:

```text
/goal Implement Phase 20.99 — Pao-hubPro × Whip end-to-end from the phase specification in this repository. First inspect and map the existing Pao-hubPro architecture, current agent registry, policy/approval engine, audit system, MCP gateway, event transport, database schema, mobile/frontend stack, terminal/session abstractions, and existing security conventions. Reuse and extend existing subsystems instead of creating parallel implementations. Build a production-oriented Mobile Agent Operations Console using a private-first SSH/Tailscale host fabric with strict host-key verification, typed host/runtime generations, safe reconnect, multi-host agent fleet aggregation, Codex and OpenCode transcript projections bound to the exact same live agent sessions as their terminal views, isolated remote terminal sessions, typed SFTP/file operations with atomic transfers, Git status/diff visibility, an offline-safe intent queue that always rechecks current session/context/policy after reconnect, platform-secured credential references, QR-based short-lived device pairing with revocation, and policy-governed R0-R4 human approval gates with payload-hash/context binding and durable audit events. Treat mobile UI as a projection/approval surface rather than the source of host truth. Prefer typed semantic operations to shell-output parsing. Do not expose the Pao host bridge publicly by default. Do not silently accept changed SSH keys. Do not silently replay high-risk queued actions. Do not create duplicate chat sessions. Do not store plaintext credentials in app databases or logs. Do not copy source from the AGPL-licensed Whip repository unless an explicit licensing review is created and approved; use clean-room architectural adaptation by default. Add or update versioned protocol types, migrations, feature flags, ADRs, threat-model/security documentation, unit/integration/E2E tests, and PHASE_20.99_COMPLETION_REPORT.md. Run the actual discovered lint, typecheck, test, build, native/mobile, and Rust validation commands that exist in this repository, fix regressions, preserve existing behavior, and continue autonomously through implementation and validation until every mandatory Phase 20.99 acceptance criterion and exit-gate item is satisfied or a genuine external blocker makes completion impossible. When blocked, document the exact blocker, evidence, completed work, and the smallest safe next action; do not mark the phase complete while mandatory criteria remain unmet.
```

---

# 47. Recommended End State

When Phase 20.99 is complete, the operator should effectively have:

```text
┌───────────────────────────────┐
│       Pao-hubPro Mobile       │
├───────────────────────────────┤
│ Hosts                         │
│ Fleet                         │
│ Agent Chat                    │
│ Terminal                      │
│ Files                         │
│ Approvals                     │
│ Security                      │
└───────────────┬───────────────┘
                │
        SSH / Tailscale
                │
┌───────────────▼───────────────┐
│        Pao Host Bridge        │
├───────────────────────────────┤
│ Fleet Registry                │
│ Transcript Adapters           │
│ Terminal Manager              │
│ Remote FS                     │
│ Policy + Approval Gateway     │
│ Audit                         │
└───────────────┬───────────────┘
                │
  ┌─────────────┼─────────────┐
  ▼             ▼             ▼
Codex        OpenCode     Pao Agents
Claude       OpenHermit   MCP/Browser
```

The mobile device becomes a **secure operational cockpit**, not merely a terminal.

The final principle of this phase is:

> **Observe broadly, act precisely, require human approval when impact rises, preserve host truth, and make every remote action recoverable and auditable.**

---

# 48. Upstream Reference Notes

Primary reference:

- Whip repository: <https://github.com/kosumic/whip>
- Whip architecture: <https://github.com/kosumic/whip/blob/main/ARCHITECTURE.md>
- Whip security policy: <https://github.com/kosumic/whip/blob/main/SECURITY.md>
- Whip license: <https://github.com/kosumic/whip/blob/main/LICENSE>

Concepts verified from upstream during preparation of this specification include:

- mobile client over SSH rather than exposing the managed runtime directly;
- strict host-key verification;
- multi-host supervision;
- native Codex/OpenCode transcript projection;
- independent terminal channels;
- Rust-owned connection/runtime state;
- SFTP-backed remote operations;
- jump hosts;
- credential-store separation;
- AGPL-3.0-or-later licensing.

Pao-hubPro extends those concepts with its own multi-provider fleet, MCP gateway, policy engine, approval system, audit model, resumable workflows, and production governance.

