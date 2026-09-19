# Phase 20.95 Threat Model

## Assets

- Browser session cookies and OmniGet MCP tokens
- Acquired binaries and transcripts
- Agent context / logs / audit events
- Local filesystem under `runtime/acquisition`

## Threats and controls

| Threat | Control |
| --- | --- |
| SSRF (localhost, RFC1918, 169.254.169.254) | Reuse 20.24 URL policy; http/https only |
| Shell injection | argv spawn in 20.24 process-runner; CAG never concatenates shell strings |
| Path traversal | `resolveAcquisitionPath` rejects `..` |
| Cookie leakage to LLM | `SECRET_IN_REQUEST`; `pao.acquire` / `acquire_content` reject cookies |
| Cross-domain session reuse | Domain-scoped opaque refs, TTL, revoke |
| DRM bypass | `BLOCKED_OR_DRM` deny; no bypass adapter |
| Prompt injection in subtitles/PDFs | `trust: untrusted_external_content` on artifacts and research notes |
| Batch disk exhaustion | `maxItems` default 100, deny over limit |
| High-risk OmniGet tools | Not auto-exposed; agents see `pao.acquire` only |
| GPL contamination | Process/protocol boundary only |

## Residual risk

A process running as the operator can still read local secrets outside this process. The boundary is policy + redaction, not a kernel sandbox.
