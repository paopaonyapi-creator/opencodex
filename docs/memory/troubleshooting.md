# Memory Troubleshooting (Phase 20.43)

| Symptom | Meaning / recovery |
|---|---|
| `MEMORY_DISABLED` | `PAO_MEMORY_ENABLED=false` — the plane is intentionally off; no-op results are safe. |
| Engine shows `pao-local-fallback` | PLUR CLI not on PATH (or `PLUR_PATH` store missing). Install upstream PLUR (`npx @plur-ai/cli` tooling) or accept the local fallback — results are labeled either way. |
| `MEMORY_ENGINE_UNAVAILABLE` on sync | Sync needs the real PLUR engine; the fallback engine cannot sync. Install PLUR, then re-run the preview → execute chain. |
| `MEMORY_POLICY_DENIED` | A policy rule denied the operation — the response and audit event name the matched rule (e.g. `deny_secrets`). |
| `MEMORY_SECRET_DETECTED` | Secret guard found credential material; nothing was stored. Redact the content and retry, or store a non-secret summary. |
| `MEMORY_SCOPE_INVALID` | Scope must be `family:id` from the taxonomy (local/global/user/project/workspace/agent/service/environment/group). |
| `MEMORY_SCOPE_FORBIDDEN` | Cross-project read/write denied — use scopes within your project/workspace. |
| `MEMORY_APPROVAL_REQUIRED` | Rescope-to-shared (or bulk forget) needs operator approval — see pending approvals in the dashboard. |
| Hybrid/embedding recall degraded | PLUR's embedding path is unavailable upstream; PLUR falls back to BM25/keyword. The control plane discloses `degraded`/`fallbackMode`. |
| Codex hooks not trusted | Upstream requires manual trust via Codex `/hooks` — doctor reports this as MANUAL by design. |
| Hermes plugin unavailable | Install `plur-hermes` explicitly (operator action); Pao never auto-installs. External Hermes writes reconcile as `external`/native. |
| Memory not recalled cross-project | Working as designed — scope isolation prevents unrelated-project leakage; rescope with approval if it truly belongs wider. |
| Sync blocked | Check the preview output: `local` scope, private visibility, and secret findings always block; unknown profiles fail closed. |
