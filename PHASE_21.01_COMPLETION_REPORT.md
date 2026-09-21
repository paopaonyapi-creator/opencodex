# Phase 21.01 Completion Report — Pao-hubPro × Parley Multi-Agent Work Room

> **Date:** 2026-09-20  
> **Status:** PRODUCTION-READY / CLOSED  
> **Authority:** `docs/Phase_21.01_Pao-hubPro_Parley_Multi-Agent_Work_Room.md`  
> **Predecessors:** Phase 20.98 (OpenHermit), Phase 20.99 (Whip), Phase 21.00 (Unified Control Plane)

---

## 1. Executive Summary & Canonical Numbering Resolution

The source document was submitted under the working label `Phase 20.99 — Parley`. Following the explicit instruction in Section 0 of the canonical specification:
> *"หาก Phase Registry ของ Pao-hubPro มี 20.99 ใช้งานอยู่แล้ว ให้ระบบตรวจชนหมายเลขก่อน merge และเลื่อนไปหมายเลขถัดไปโดยอัตโนมัติ โดยห้าม overwrite Phase เดิม"*

Since `20.99` is already canonical and closed for **Whip — Mobile Agent Operations Console**, this work is canonically recorded and implemented as **Phase 21.01 — Pao-hubPro × Parley Multi-Agent Work Room** immediately succeeding **Phase 21.00 Unified Agent Operations Control Plane**.

---

## 2. Core Implemented Architecture

1. **Multi-Agent Work Room (`src/agent-os/parley/room-engine.ts`)**:
   - Shared coordination surface combining conversation, agent presence, shared workspace directory, and execution runs.
   - Modes: `TALK` (read-only), `WORK` (workspace mutation), `REVIEW` (read/diff/test only), `RESEARCH` (citations & web), `AUTOPILOT` (bounded turns).
   - Multi-agent addressing parser supporting `@codex`, `@claude`, `@both`, `@all`, `@reviewers`, and `@builders`.

2. **Runtime Metadata Authority (Never LLM Self-Reported)**:
   - Pao-hubPro Runtime is the sole source of truth for: `provider`, `actual_model_id`, `endpoint_profile`, `permission_profile`, `cost`, `tokens`, and `duration`.
   - Before dispatch, an immutable runtime snapshot is captured and stored in `parley_runs.runtime_snapshot_json`.

3. **4-Level Tool Execution Policy (§11)**:
   - **Level 0 (Safe)**: `git status`, `git diff`, `npm test` → allowed by policy.
   - **Level 1 (Workspace Mutation)**: `edit file`, `create file`, `npm run build` → allowed under `workspace-write` profile.
   - **Level 2 (External / Network)**: `npm install`, `pip install`, `curl`, `git push` → requires policy gate & approval.
   - **Level 3 (Dangerous)**: `rm -rf /`, `disk format`, `system shutdown`, `privilege escalation` → strictly **BLOCKED** by default.

4. **Run Inspector Transparency (§7, §39)**:
   - Per-run inspector aggregating:
     - Runtime snapshot and authoritative model metadata.
     - Tool call timeline with redacted arguments and duration.
     - File events with before/after diff patches.
     - Command execution events with exit codes and stdout/stderr summaries.
     - Multi-agent handoff chains (e.g. Codex builder → Claude reviewer).
     - Routing chain hops.

5. **Multi-Agent Handoff Chain (§18)**:
   - Structured handoff payloads transferring context, git diffs, and test results across personas without losing execution traceability.

6. **Transcript & Diff Exporters (§19, §51)**:
   - Deterministic export to Markdown with timestamped turns, agent roles, and execution summaries.

---

## 3. Database Schema (v71)

Added 8 SQLite tables in `src/agent-os/db.ts`:
- `parley_rooms`: Room definition, workspace path, mode, and budget tracking.
- `parley_room_agents`: Active agents in the room with authoritative model IDs.
- `parley_messages`: Room conversation timeline with explicit mention tags.
- `parley_runs`: Execution runs with token counts, costs, and runtime snapshots.
- `parley_tool_calls`: Logged tool executions with risk levels.
- `parley_file_events`: Granular file operations and diff patches.
- `parley_command_events`: Shell commands executed with exit codes and output.
- `parley_handoffs`: Inter-agent handoffs with transferred artifacts.

---

## 4. REST Endpoints & MCP Tools

### REST Endpoints (`src/server/management/parley-routes.ts`)
- `GET /api/agent-os/parley/rooms` & `POST /api/agent-os/parley/rooms`
- `GET /api/agent-os/parley/rooms/{id}`
- `GET /api/agent-os/parley/rooms/{id}/messages` & `POST /api/agent-os/parley/rooms/{id}/messages`
- `GET /api/agent-os/parley/rooms/{id}/agents` & `POST /api/agent-os/parley/rooms/{id}/agents`
- `GET /api/agent-os/parley/rooms/{id}/export`
- `GET /api/agent-os/parley/runs/{id}/inspector`

### MCP Tools (`src/agent-os/parley/mcp-tools.ts`)
- `pao.parley.rooms.list` (R0)
- `pao.parley.rooms.create` (R1)
- `pao.parley.message.send` (R1)
- `pao.parley.inspector.get` (R0)
- `pao.parley.transcript.export` (R0)

---

## 5. Verification & Test Results

```bash
$ bun x tsc --noEmit
# Output: Exit code 0 (Clean)

$ bun test tests/parley.test.ts tests/unified-security-invariants.test.ts tests/unified-control-plane.test.ts tests/whip.test.ts tests/openhermit.test.ts tests/openhermit-resilience.test.ts tests/management-route-registry.test.ts tests/core-lab-boundary.test.ts

# Test Results:
# tests/core-lab-boundary.test.ts: 17 pass, 0 fail
# tests/management-route-registry.test.ts: 13 pass, 0 fail
# tests/openhermit-resilience.test.ts: 8 pass, 0 fail
# tests/openhermit.test.ts: 28 pass, 0 fail
# tests/parley.test.ts: 8 pass, 0 fail
# tests/unified-control-plane.test.ts: 13 pass, 0 fail
# tests/unified-security-invariants.test.ts: 11 pass, 0 fail
# tests/whip.test.ts: 17 pass, 0 fail
# Total: 115 pass, 0 fail (350 expect calls)
```

---

## 6. Exit Gate Audit

| Item | Result | Evidence |
|---|:---:|---|
| Canonical Numbering Conflict Resolved | **YES** | Numbered canonically as 21.01; 20.99 preserved as Whip |
| Schema v71 Applied | **YES** | 8 `parley_*` tables created and verified |
| Authoritative Model Metadata | **YES** | Sourced from runtime snapshot, never LLM text |
| 4-Level Tool Execution Policy | **YES** | L0 Safe, L1 Workspace, L2 Network, L3 Dangerous |
| Run Inspector Transparency | **YES** | Timeline, file events, command events, handoffs |
| Zero Regressions in 20.98, 20.99, 21.00 | **YES** | All 115 test cases green |
| Static Typecheck Clean | **YES** | `bun x tsc --noEmit` exit 0 |
| Implementation Matrix Updated | **YES** | Marked VERIFIED in `PHASE_IMPLEMENTATION_MATRIX.md` |
| GOLD Status Updated | **YES** | Marked CLOSED in `GOLD_IMPLEMENTATION_STATUS.md` |
