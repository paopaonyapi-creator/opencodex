# Memory Scopes (Phase 20.43)

## Scope taxonomy

```text
local                      machine-only; never syncs
global                     policy-gated cross-project
user:<id-or-slug>          per-user memories
project:<slug>             project-scoped (default family)
workspace:<slug>           workspace-scoped
agent:<slug>               per-agent memories
service:<slug>             per-service memories
environment:<dev|staging|prod>
group:<org>/<team>         shared team scope (rescoping INTO this family requires approval)
```

Scope strings are strictly validated (`family:id`, id `[A-Za-z0-9._/-]`);
prompt text can never mint a scope outside these families, and prompt
text can never create filesystem paths (scopes never touch the disk).

## Write precedence (deterministic, spec §4)

1. explicit approved operation scope
2. project policy (`project:<projectId>`)
3. workspace policy (`workspace:<workspaceId>`)
4. agent adapter default
5. session scope (→ `local`)
6. `PAO_MEMORY_DEFAULT_SCOPE`
7. **safe local fallback**

Ambiguous inference NEVER falls back to global — it lands on `local` or
is denied by policy.

## Read expansion

`project:<id>` + explicit workspace + agent scope + configured default +
`local`; `global` only when policy permits. **Never unrelated project
scopes** — `ScopeResolver.canReadScope` denies `project:beta` reads to
actors bound to `project:alpha` (test-proven).

## Examples

- "Pao-hubPro uses bun; do not run npm install." → `project_convention`,
  scope `project:pao-hubpro`.
- "Production database migrations require backup verification." →
  `deployment_rule`, scope `project:<slug>`, policy may force approval.
- "This machine's ffmpeg lives at D:\tools" → `temporary_context` /
  machine quirk → policy forces `local`, never syncs.
