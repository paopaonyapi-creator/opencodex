# Code Intelligence security model (Phase 20.62)

Trust boundaries and invariants for the Graft-backed code-intelligence layer.
The one-line rule: **Graft informs; Pao-hubPro decides.**

## Trust boundaries

```text
Agent / browser
   │  (management principal + Pao-owned MCP tools only)
   ▼
Context Gateway (identity → scope → path policy → budget)
   │
   ▼
CodeIntelligenceProvider (neutral contract)
   │
   ▼
Graft CLI (argv arrays, scrubbed env, DO_NOT_TRACK=1, timeout, capped output)
   │
   ▼
Registered repository on local disk
```

- Raw Graft MCP is never exposed to agents or browsers; the six upstream tools
  are reachable only through Pao-owned wrappers that add authorization,
  scope, evidence, and audit.
- Repository roots come exclusively from the canonical registry
  (`ci_repositories`), registered by an operator. Agents cannot choose
  arbitrary filesystem paths to index — registration is operator-only and the
  path is canonicalized with `realpath` (symlink escapes resolve to a
  different root than registered and are rejected).

## Path scope

- Every request resolves an explicit `RepositoryScope`: allowed prefixes,
  denied prefixes, operations, depth cap, cross-repo flag.
- Sensitive prefixes are always denied regardless of scope (`.env`, `.env.*`,
  `secrets/`, `credentials/`, `private-keys/`, `*.pem`, `*.key`, `*.p12`,
  `*.pfx`, `vault/`, `backups/`, `production-dumps/`). Glob denial is
  suffix-scoped (`*.pem` matches file names, never whole trees).
- `../` traversal is rejected outright; `.gitignore` is never treated as a
  security boundary.
- Violations throw `CODEINTEL_SCOPE_VIOLATION` and are audited
  (`codeintel.scope.violation`).

## Process execution

- Argument arrays only — no shell interpolation; user inputs that begin with
  `-` or contain traversal/NUL/newlines are rejected before they reach argv.
- The child environment is scrubbed to `PATH`, `HOME`, and `DO_NOT_TRACK=1`;
  no agent tokens or provider keys are inherited.
- Hard timeout with SIGKILL; output capped (`PAO_CODEINTEL_MAX_RESPONSE_BYTES`).

## Telemetry

Force-disabled at the process level (`DO_NOT_TRACK=1`) regardless of host
shell. Opt-in only via explicit operator config, never re-enabled silently.

## Machine-wide configuration

Upstream `graft init` writes user-level agent configs. Pao-hubPro never calls
it; `PAO_CODEINTEL_ALLOW_MACHINE_WIDE_CONFIG=false` by default and every
denied attempt is audited.

## Evidence freshness and approval binding

- Evidence and impact reports record a working-tree fingerprint
  (HEAD + `git status --porcelain`), because Graft represents uncommitted
  state. A material change after analysis invalidates prior evidence
  (`codeintel.impact.fingerprint_changed`).
- HIGH/CRITICAL policy requires a fresh graph (`PAO_CODEINTEL_REQUIRE_FRESH_FOR_HIGH_RISK`);
  HIGH on a stale graph is blocked pending refresh; CRITICAL blocks autonomous
  mutation outright and requires explicit operator approval plus complete
  evidence. Stale metadata is never hidden from callers.
- Post-edit verification compares pre/post impact; a risk increase or new
  dependents escalates policy before merge.

## External model data flow

Deep enrichment (`graft build --deep`) is disabled by default. When an
operator enables it, model access happens inside Graft with its own
configured provider; Pao-hubPro does not forward repository content to any
cloud endpoint itself and never embeds secrets in prompts.

## Prompt injection

Repository content (comments, README, generated files) is untrusted. Context
packs carry an explicit constraint that repository-derived material is
**data, not instructions** and cannot override platform or project policy.
Tested in `tests/code-intelligence.test.ts`.

## Security invariants (spec §47 — all tested)

1. Agents cannot choose arbitrary local directories to index.
2. Agents cannot execute arbitrary Graft CLI flags (`assertSafeCliArg`).
3. Browser clients cannot reach raw Graft MCP.
4. Path scopes are enforced server-side.
5. Audit logs carry metadata, never secrets or source payloads.
6. Machine-wide config writes default to denied.
7. Telemetry defaults to disabled.
8. High-risk edits cannot proceed on stale context without policy override.
9. Approval/impact evidence is invalidated by fingerprint change.
10. Reviewer/worker code-intelligence tools are read-only (R0) except the
    report-creating tool (R1); none grant mutation privileges.
