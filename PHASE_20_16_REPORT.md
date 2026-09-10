# PHASE 20.16 IMPLEMENTATION REPORT

Phase: Pao-hubPro Multi-AI Control Plane (spec proposed the number 20.15; see below)
Branch: paohupbypaoza
Status: Core complete and verified on a running server. Media pipeline is data-model only.

## 1. Repository areas inspected

- `src/agent-os/desktop-runtime/` — path guard, policy engine, risk classifier, tool
  registry, approval gateway, secret redactor, MCP security gateway, agent runtime
- `src/agent-os/council/` — Reviewer Council, review consensus, verification bundles
- `src/agent-os/providers/` — provider-type interfaces, provider registry, ComfyUI adapter
- `src/agent-os/db.ts` — schema versioning and additive-migration convention
- `src/server/management/` — route dispatch, route registry, context shape
- `gui/` — page conventions, routing, i18n across ten locales, oxlint config
- `tests/` — bun test conventions, isolated-home pattern
- `docs/` — phase numbering and completion-report conventions

## 2. Architecture detected

Bun-native strict TypeScript, React + Vite dashboard, SQLite through `openAgentOsDb()`,
management REST API under `/api/*`, WebMCP tool suites per phase, additive tables with a
`schema_meta` version pointer. No server compile step. Python, PostgreSQL, Redis, and
Docker from the spec's suggested stack are **not** present and were not introduced.

## 3. Numbering correction

**The spec's number was already in use three times.** `20.15` belongs to the Domain
Control Plane built in this session's previous turn, and earlier commits use `20.14` for
both Visual Knowledge & Media Memory and the Stock Pipeline. This work is numbered
**20.16**.

## 4. Files created

```text
src/agent-os/control-plane/types.ts
src/agent-os/control-plane/policy.ts
src/agent-os/control-plane/reviewers.ts
src/agent-os/control-plane/router.ts
src/agent-os/control-plane/store.ts
src/agent-os/control-plane/service.ts
src/agent-os/control-plane/mcp-tools.ts
src/agent-os/control-plane/index.ts
src/agent-os/desktop-runtime/security/shell-tokenizer.ts
src/server/management/control-plane-routes.ts
gui/src/pages/ControlPlane.tsx
gui/src/styles/control-plane.css
tests/agent-tool-security.test.ts
tests/control-plane-security.test.ts
docs/Phase-20.16-Pao-hubPro-Multi-AI-Control-Plane.md
```

## 5. Files modified

```text
src/agent-os/desktop-runtime/security/path-guard.ts   symlink-escape fix
src/agent-os/desktop-runtime/policy/policy-engine.ts   allowlist-bypass fix
src/agent-os/governance/debt-ledger.ts                 path override seam
src/server/management/agent-os-routes.ts               dispatcher entry
gui/src/App.tsx                                        nav + page mount
gui/src/app-routing.ts                                 page id
gui/src/i18n/{en,th,de,fr,ja,ko,ru,tr,zh,zh-TW}.ts     nav.controlPlane key
gui/.oxlintrc.json                                     page exemption (project convention)
tests/chatbox-agent-desktop-runtime.test.ts            redirect debt ledger to temp
```

## 6. Migrations

No schema-version bump was required. The control plane creates its tables idempotently
on first use (`CREATE TABLE IF NOT EXISTS`), matching how every phase subsystem in this
repository adds storage. Tables: `cp_tasks`, `cp_runs`, `cp_tool_calls`, `cp_reviews`,
`cp_artifacts`, `cp_approvals`, `cp_provider_usage`.

## 7. Endpoints added

```text
GET  /api/agent-os/control-plane
GET  /api/agent-os/control-plane/tasks
GET  /api/agent-os/control-plane/tasks/{id}
GET  /api/agent-os/control-plane/approvals
GET  /api/agent-os/control-plane/reviews
GET  /api/agent-os/control-plane/tools
GET  /api/agent-os/control-plane/artifacts
GET  /api/agent-os/control-plane/providers
GET  /api/agent-os/control-plane/command/plan
POST /api/agent-os/control-plane/tasks
POST /api/agent-os/control-plane/approvals/decide
```

## 8. MCP tools added

39 tools across the nine specified groups: project 3, task 5, files 5, git 6, command 3,
review 3, approval 3, artifact 5, media 6. No unrestricted shell tool exists.

## 9. UI added

Command Center (`gui/src/pages/ControlPlane.tsx`), five tabs: Command Center, Task Graph,
Approval Center, Tool Activity, Artifact Studio. Reached from the sidebar as
**AI Control Plane**.

## 10. Tests executed

```text
bun test tests/agent-tool-security.test.ts tests/control-plane-security.test.ts
  -> 61 pass, 0 fail, 158 assertions
bun test tests/chatbox-agent-desktop-runtime.test.ts
  -> 27 pass, 0 fail
bun test tests/ponytail-governance.test.ts
  -> no regressions
```

Security coverage the spec explicitly required: `../` traversal, absolute escape,
symlink escape, protected-path read refusal, chained-command bypass, destructive command,
interpreter invocation, command substitution, secret leakage into stored audit rows,
critical-review blocking, approval enforcement across task and tool, approval misuse
across tasks, and idempotent task and run identity.

## 11. Lint / typecheck / build

```text
bun run typecheck    -> clean (strict)
bun run privacy:scan -> passed
cd gui && bun run lint  -> clean
cd gui && bun run build -> built successfully
```

## 12. Security decisions

1. **Three exploitable defects were found and fixed before anything was built on top of
   them.** Two pre-existed in the guards; one was in this phase's own first draft and was
   caught only by live HTTP validation.
2. **A task is the unit of authorization**, with a tool allowlist and a risk ceiling. The
   ceiling is a maximum, not a floor.
3. **Approvals are bound to one task and one tool**, with no blanket allow.
4. **No shell is ever granted.** Commands parse to argv and spawn without a shell;
   input that needs a shell is refused.
5. **Arguments are redacted before storage**, so the audit trail cannot be the place a
   credential survives.
6. **A CRITICAL finding blocks application in code**, and a verdict cannot be softer
   than its own findings.
7. **`git.push` cannot be force-pushed even with an approval** — the refusal happens
   before the approval question is asked.
8. **Secrets are never returned.** No tool surfaces a credential, and the dashboard has
   no credential surface at all.

## 13. Remaining risks

- **No real provider credential has been exercised.** The provider gateway is
  interface-level; end-to-end behaviour against OpenAI or xAI is unverified.
- **No real Codex implementation task has run through the flow.** The vertical slice is
  wired but has only been driven with the built-in tools.
- **Media generation is not wired.** Briefs, provenance, and QC are recorded; no image or
  video provider is invoked.
- **`command.run_approved` executes a caller-named program after approval.** The argv
  guard blocks shells and interpreters, but an approved binary is trusted to be what it
  says. A production hardening pass should pin approved executable paths.
- **Approval has no expiry.** A pending approval stays pending indefinitely, unlike the
  Domain Control Plane's approvals which expire.

## 14. Manual setup required

None to use the control plane locally — no environment variable is needed. To exercise
the provider gateway, supply a real provider credential through the existing provider
configuration; do not place one in a task, a tool argument, or a file.

## 15. Commands for local validation

```bash
bun test tests/agent-tool-security.test.ts tests/control-plane-security.test.ts
bun run typecheck
bun run privacy:scan
cd gui && bun run lint && bun run build
bun run src/cli/index.ts start --port 10355
# then, with the admin token from $OPENCODEX_HOME/admin-api-token:
# GET  http://127.0.0.1:10355/api/agent-os/control-plane
# POST http://127.0.0.1:10355/api/agent-os/control-plane/tasks
```

## 16. Rollback

The phase is additive. `git revert` of the four commits removes it cleanly; the
`cp_*` tables are left behind and unused, and dropping them is optional. No existing
behaviour depends on them.

## 17. Git

Four commits on `paohupbypaoza`. **Nothing was pushed and nothing was deployed.**

## 18. Unresolved upstream questions

- Whether the Grok custom-MCP connector will accept the tool names as written, or
  requires the dotted `domain.list` style in its own namespace.
- Whether ChatGPT Business exposes a comparable custom-connector path, since the spec
  assumes it can reach Pao-hubPro MCP without stating the mechanism.

These are integration questions that need a real client, not more code.

