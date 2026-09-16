# Phase 20.27 — Agent Adapter Contract

```ts
interface AgentAdapter {
  readonly type: AgentType;            // codex | claude | gemini | generic_cli
  readonly displayName: string;
  readonly defaultBinary: string;
  detect(): AgentDetection;            // passive PATH scan — never executes
  capabilities(): AgentCapabilities;   // chat/read/write/commands/git/review
  buildCommand(input: { prompt: string; workspaceScope: string }): CommandSpec;
  probeVersion?(): Promise<string | undefined>; // bounded --version for doctor
}
```

## Built-in adapters

| Type | Binary | Non-interactive shape | Override |
|---|---|---|---|
| codex | `codex` | `codex exec <prompt>` | `PAO_CODEX_BIN` |
| claude | `claude` | `claude -p <prompt>` | `PAO_CLAUDE_BIN` |
| gemini | `gemini` | `gemini -p <prompt>` | `PAO_GEMINI_BIN` |
| generic_cli | `pao-agent` | `pao-agent run <prompt>` | `PAO_GENERIC_CLI_BIN` |

## Execution boundary

`runAgentProcess` (cockpit-local allowlist: codex/claude/gemini/pao-agent —
deliberately NOT the media allowlist): fixed argv, `shell: false`, 300s cap,
512KB output caps, SIGKILL on timeout. The prompt travels as ONE argv element.

## Doctor (doc §121)

`POST /agents/doctor {agentType}` → detection, resolved binary, bounded
version probe, launchability. Never exposes credentials.

## Contract tests

`tests/control-plane-cockpit.test.ts` — passive detection for all four
adapters; session start degrades with a typed error when the binary is absent;
cancel never reports success.

## Future adapters

Grok/xAI, OpenCode, local OpenAI-compatible servers, remote workers,
containerized agents: implement `AgentAdapter`, register in
`builtinAgentAdapters()` (or inject via constructor) — cockpit UI is
type-agnostic.
