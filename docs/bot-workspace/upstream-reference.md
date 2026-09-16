# Upstream Reference (Phase 20.42 licensing guardrail)

| Field | Value |
|---|---|
| Upstream URL | https://github.com/nat-build-with-oracle/idea-9sep-wed2026-grok-clone (BotWorkspace) |
| Secondary | https://openai.com/index/unlocking-the-codex-harness/ (Codex App Server concept) |
| Date checked | 2026-09-13 |
| License detected | Not verified as compatible at implementation time |
| Implementation decision | **Clean-room re-implementation.** Product patterns only (named teammates, ordered group rounds, consent, Stop/Retry, routines, safe export). No Swift/macOS code, no upstream source, fixtures, UI implementation, or distinctive comments copied. |

## Concept mapping

| Upstream pattern | Pao-hubPro Phase 20.42 equivalent |
|---|---|
| Named AI Bots | `bw_agents` + AgentRegistry (id = identity; name editable) |
| Direct / group chats | `bw_conversations` (kind direct/group) + `bw_messages` with typed blocks |
| Ordered multi-Bot rounds | `GroupRoundOrchestrator` + `bw_group_rounds` (backend state machine, consent gate) |
| Mentions / replies | `bw_message_mentions` + stable-ID resolver (longest-prefix match) |
| Streamed output, Stop/Retry | `bw_execution_events` (UNIQUE per sequence) + cancellation/retry coordination |
| Consent before dispatch | `awaiting_consent` round state + aggregate confirmation UI |
| Approval gates | `bw_approvals` (fingerprint-bound, single-use, human-only) |
| Routines | `bw_routines` + `bw_routine_runs` (idempotent, concurrency policy) |
| Safe export | versioned `pao-hubpro-workspace` JSON, `credential_included: false` |
| Codex integration | `CodexAppServerAdapter` over the Phase 20.21 native runtime (per spec rule 8) |

## Deliberate divergences

- macOS/Swift host replaced by the existing Bun/React stack (spec rule 2).
- Stopped rounds with outputs end `cancelled` (outputs preserved as
  messages) rather than `partial` — a stricter, truthful terminal state.
- Interval routines use polled due-checks with an explicit "requires
  active Pao-hubPro worker" wake limitation instead of advertising 24/7.
