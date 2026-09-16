# Observability Adapter Contract (Phase 20.40)

Every adapter implements `ObservabilityAdapter` (see
`src/agent-os/agent-observability/types.ts`) and is independently
enabled/disabled through configuration.

```ts
interface ObservabilityAdapter {
  id: string;                       // stable, unique
  runtime: AgentRuntime;            // canonical runtime label
  capabilities: AdapterCapabilities; // honest capability reporting
  enabled(config): boolean;
  discover(context): Promise<DiscoveredSource[]>;
  inspectSession(source, context): Promise<AdapterSessionObservation>;
  readEvents(source, options, context): Promise<AdapterEventBatch>;
  collectProcessHints?(context): Promise<ProcessHint[]>;
  verifyIntegrity?(source, options, context): Promise<IntegrityResult>;
}
```

## Rules

1. **Capability honesty.** If a feature cannot be verified on the current
   machine, its capability is `false` and the adapter reports
   `UNSUPPORTED` — it never fabricates state.
2. **Complete records only.** JSONL adapters surface only
   newline-terminated records; an unfinished suffix is invisible until
   complete; malformed complete records produce `MALFORMED_RECORD`
   evidence; an older record is never substituted as "latest".
3. **Bounded I/O.** stat-first revision tokens; tail reads bounded;
   discovery capped; no full-file hashing during polls.
4. **Source safety.** Discovery rejects anything resolving outside the
   configured root; directory symlinks are not followed; vanishing files
   are tolerated.
5. **Evidence, not verdicts.** Adapters return evidence
   (timestamps, revisions, tool events, end markers); the normalizer owns
   every state derivation.
6. **Isolation.** One failing adapter/source never breaks the scan; errors
   become structured `SessionObservationError`s.

## Shipped adapters

| id | runtime | Source | discovery | events | process | explicitCompletion | integrity |
|---|---|---|---|---|---|---|---|
| `claude_jsonl` | claude_code | `~/.claude/projects/**/*.jsonl` | ✓ | ✓ (tail window) | registry | ✓ (result records) | via engine |
| `codex_db` | openai_codex | 20.21 `codex_runtime_sessions/events` | ✓ | ✓ | registry | ✓ (session status) | n/a (no file) |
| `pao_native` | pao_native | 20.39 `cc_sessions/cc_session_events` | ✓ | ✓ | registry | ✓ (session status) | n/a |
| `generic_<id>` | generic_jsonl | user-configured roots | ✓ | minimal | registry | config | via engine |

## Adding one

Implement the interface in `src/agent-os/agent-observability/`, register
it in the `ObservabilityEngine` constructor, add capabilities honestly,
and cover it with a synthetic-fixture test (see
`tests/agent-observability.test.ts`).
