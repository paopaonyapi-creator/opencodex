# Memory Architecture (Phase 20.43 — PLUR Shared Agent Memory Runtime)

## Control-plane diagram

```text
                    Pao-hubPro
                        |
     +------------------+------------------+
     |                                   |
 Agent / MCP Plane                 Governance Plane
     |                                   |
 Codex      Hermes      MCP      Policy  Secret  Audit
     |         |         |        Engine   Guard    Log
     +----+----+---------+
          |
    Pao Memory API  (PaoMemoryService — engine-neutral)
          |
    Pao Memory Control Plane
          |
    Memory Engine (selectEngine)
     /                \
 PLUR CLI adapter   Local fallback engine
 (capability-          (Pao-owned, disclosed)
  detected)
```

**PLUR is the memory engine; the Pao control plane is the governance
layer.** Internal callers use the stable Pao interface (`learn`, `recall`,
`inject`, `feedback`, `forget`, `rescope`, `captureEpisode`, `timeline`,
`status`, `sync`, `doctor`) — never raw PLUR.

## Engine selection & honesty

- On every operation the control plane probes the PLUR CLI (literal
  `plur` binary, argv-only, 30s capability cache). When detected, PLUR is
  the engine; when absent, the Pao local fallback engine (SQLite-backed,
  deterministic term recall) serves — and **every result discloses
  `engine: "pao-local-fallback"` with `fallbackMode`** so nothing pretends
  PLUR answered.
- PLUR absence never blocks Pao-hubPro boot (`PAO_MEMORY_REQUIRED` is not
  implemented; absence is a WARN in doctor).

## Data flow (learn)

validate → secret scan (block on findings) → scope resolution (spec §4
precedence) → policy evaluation → dedupe (content hash + scope) →
candidate-or-active (auto-learn OFF stores candidates for approval) →
engine learn → Pao registry metadata row → redacted audit event.

## Data flow (inject)

authorize read scopes → recall (scope-filtered) → policy filter → secret
filter → dedupe → token budget (default 1800, never the whole window) →
persisted receipt (query HASH only) → structured injected text.

## PLUR boundary

Pao-specific metadata (scope, visibility, sensitivity, source, policy
decision, feedback counts, audit) lives in Pao-owned `memory_*` tables;
PLUR owns engram bodies/episodes when present. External/native PLUR
writes are reconciled into the registry as `external` (policy-assessed,
never deleted — spec §21).

## Routing guidance (spec §32)

learned rule/preference/decision → **memory**; source symbols → code
intelligence; document paragraphs → RAG; exact change history → Git;
execution state → workflow/runtime tables. Memory is never an AST index,
transcript store, or secrets vault.
