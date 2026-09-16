# Runbook: Codex Authentication & Credential Governance

## Authentication Workflow
Pao-hubPro delegates identity and authentication directly to Codex:
- OpenAI API Key: Set `OPENAI_API_KEY` in your environment or execute `codex login`.
- Token Persistence: Handled securely inside `~/.codex/`. Pao-hubPro never duplicates raw tokens or sensitive authentication files into application databases.
- UI Visibility: The dashboard displays authentication status, active plan, and expiration timestamps without exposing raw API keys or bearer tokens.
- Secret Scrubbing: All credentials passing through logs, turn streams, or audit trails are scrubbed via `SecretRedactor`.
