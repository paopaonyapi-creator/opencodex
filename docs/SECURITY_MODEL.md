# Pao-hubPro Security Model & Risk Governance

> **Enterprise Zero-Trust Policy & Execution Safety**  
> **Updated:** 2026-09-17

## 1. R0–R4 Risk Classification Hierarchy

Pao-hubPro evaluates every agent action against a strict 5-tier risk taxonomy:

| Risk Tier | Label | Permitted Scope | Authority & Gate | Examples |
| :--- | :--- | :--- | :--- | :--- |
| **R0** | Read-Only Reasoning | Local process memory & read-only introspection | Autonomous | Model routing, intent classification, metric reads |
| **R1** | Scoped External Reads | Read-only access to declared file paths & public APIs | Autonomous within boundary | Reading repo files, public API requests, tool metadata |
| **R2** | Reversible Writes | Sandboxed mutations within workspace root | Autonomous with rollback | Workspace file writes, local unit tests, review caching |
| **R3** | Supervised / External | External network calls, builds, multi-agent runs | Supervised / Advisory | Cloud inference dispatch, Reviewer Council, build runs |
| **R4** | Destructive / Privileged | Shell escalation, mass deletion, credential export | **Mandatory Human Gate** | `sudo`, `rm -rf`, modifying DB schema, cloud export |

### Non-Bypassable Invariant:
**No algorithmic confidence score (even 0.999), model probability, or feature flag can authorize an R4 action autonomously.** Explicit, authenticated human confirmation is structurally required.

---

## 2. Tool Sandbox & Command Shield

All tool executions flow through `ToolExecutionSandbox`:
1. **Path Traversal Protection:** Every file path is checked via `assertSafeWorkspacePath(target, workspaceRoot)`. Null bytes (`\0`), parent references (`..`), and external symlinks are denied with `PATH_TRAVERSAL_DETECTED`.
2. **Command Shield:** Shell commands are screened against dangerous system-destructive regexes:
   - `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`
   - `sudo`, `runas /`, `su -`
   - `mkfs`, `dd if=`
   - `curl | sh`, `wget | sh`
   - Fork bombs `:(){ :|:& };:`
   - Broad chmod/chown mutations
3. **Dual-Pass Secret Redactor:** All tool arguments and prompt contexts are scanned for API keys (`sk-...`, `ghp_...`, Bearer tokens, private keys) and scrubbed before dispatch.

---

## 3. Data Classification & Local-Only Invariant

Workloads are classified into four privacy levels:

1. **`public`:** Non-sensitive data; external cloud inference permitted.
2. **`internal`:** Enterprise internal code; allowlisted enterprise cloud providers permitted.
3. **`confidential`:** Sensitive proprietary logic; restricted enterprise providers with audit tracking.
4. **`restricted`:** Secrets, PII, financial, or air-gapped code; **automatically forces `localOnly = true`**.

### Local-Only Structural Guarantee
Requests marked `localOnly: true` or `restricted` are validated against the physical network endpoint classification. If no approved local model (e.g. Ollama or vLLM) is available, the gateway raises `LocalOnlyViolationError` and **aborts immediately**. Cloud failover is mathematically impossible in this code path.

---

## 4. Credential Isolation

- Master API keys live exclusively in the encrypted vault (`AesGcmVault`) using AES-256-GCM.
- Coding agents and frontends never receive raw plaintext credentials.
- Credentials are dynamically injected as ephemeral HTTP authorization headers at the perimeter by the Secret Broker.
