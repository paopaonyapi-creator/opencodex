# Tool Policy — pao.* MCP Gateway (Phase 20.33)

How tool calls from Open WebUI (or any MCP client) are authorized in
Pao-hubPro. Implementation: `src/agent-os/ai-workspace/`, policy engine:
Phase 20.28 governance gateway (`src/agent-os/governance-gateway/`).

## Risk model (spec §7 mapped onto governance effects)

| Risk class | Governance effect | Baseline behavior | Examples |
| --- | --- | --- | --- |
| `read` | read | allow + audit | `pao.files.read`, `pao.system.health`, `pao.review.council` |
| `write-low` | write | allow in-scope + audit | `pao.files.write` |
| `write-high` / `execute` | execute | **human approval** | `pao.shell.execute` |
| `network` | external_write | **human approval** | stock export preparation (when promoted to governed) |
| `deploy` | admin | **human approval** | `pao.runpod.start` (surface until promoted) |
| `delete` | destructive | **human approval** | `pao.files.delete` |
| `credential` | credential | **approval + hard path denial** | `.env`, `id_rsa`, `.ssh`, `.aws` are refused before policy even runs |

Effects are **declared per catalog entry** — never inferred from tool names — so a
renamed tool cannot smuggle a weaker effect past classification.

## The pipeline (every governed call)

```text
tools/call (pao.*)
  → catalog entry must exist                 else unknown_tool
  → capability grant must exist and cover
    provider + capability + effect ceiling   else GOVERNANCE_GRANT_DENIED (fail-closed)
  → kill switch (paused / read_only)         else GOVERNANCE_GLOBAL_PAUSED / _READ_ONLY
  → hard invariants: protected credential
    paths, workspace containment, sensitive
    hosts                                    else GOVERNANCE_CREDENTIAL_DENIED / _OUT_OF_SCOPE
  → deny-first policy (baseline pack)        else GOVERNANCE_POLICY_DENIED
  → risk ≥ high or side-effect               else GOVERNANCE_APPROVAL_REQUIRED (+ approvalId, 15 min TTL)
  → pre-action audit → provider executes → post-action audit
```

## Approval contract (doc §8)

- Decisions: **allow once** (approval consumed by one execution), **deny**, or the
  standing policy set — there is no global "always allow" production default.
- The approval is created with a **redacted argument preview**; the re-call must
  present the **same arguments** and the **same approval id** while the approval is
  still valid, or it is refused (`approval_invalid`).
- Only humans resolve approvals (dashboard / governance REST with a dashboard
  session). Agents and MCP clients can request, never resolve.

## Command security (pao.shell.execute)

- **argv only**: arguments must be a JSON-encoded string array — no shell
  interpolation, ever.
- Shell interpreters (`sh`, `bash`, `zsh`, `fish`, `cmd`, `powershell`, `pwsh`) are
  hard-banned regardless of grants or approvals.
- The binary must be in the process allowlist (fixed dev/media binaries).
- `cwd` must resolve inside `PAO_ALLOWED_WORKSPACE_ROOTS` (realpath-checked);
  timeouts are clamped; output is size-capped; the environment is sanitized to an
  allowlist; every execution is audited before and after.

## File security (pao.files.*)

- Workspace roots from `PAO_ALLOWED_WORKSPACE_ROOTS` (default: the process cwd),
  resolved-prefix + realpath containment, symlink-escape refusal.
- Protected paths (credential stores, `.env` outside approved scope, `.ssh`,
  `.aws`, key material) are denied before policy evaluation.

## Audit

Every dispatch writes: `action.requested`, `grant.allowed|denied`, `policy.*`,
`approval.requested`, `action.prepared`, `action.started`,
`action.succeeded|failed` — hash-chained in the governance store with redacted
metadata. Raw arguments are never persisted in clear; secret-shaped values are
redacted at every boundary.
