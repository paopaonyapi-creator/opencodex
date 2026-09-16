# Phase 20.27 — Security

## Invariants (doc §183 — enforced in code, covered by tests)

- **No agent bypasses policy** — every cockpit action flows through
  `evaluateCockpitAction`; the Phase 20.16 policy engine guards remain the
  base layer.
- **No secret exposure** — agents see references (`vault://…`), never values;
  provider detection records credential NAMES only; no secret in logs, API
  output, MCP output, `.pao/` files, or review prompts.
- **No destructive self-approval** — approval resolution, release marks,
  provider attestation, and access-mode changes are human-only
  (`operator|dashboard|user|human|owner`); agent actors are refused.
- **No production claim without evidence** — strict gate refuses stale/missing
  test proof and unverified providers; LLM opinion alone cannot create a
  blocker.
- **No gate weakening by the judged agent** — `policy.manage` by an agent
  actor denies; agent-authored policy/gate changes raise a critical
  `policy.tamper` finding requiring enhanced human review (doc §128-§129).
- **No workspace escape** — lexical + sep-aware resolved-prefix containment on
  every fs resource; protected paths (.env/.ssh/keys/…) refuse even reads.

## Hard invariants (every mode)

`rm -rf /`, `git push --force`, `git reset --hard`, `git clean -f`,
`drop table/truncate`, `curl | sh`, fork bombs, disk formatting. Safe
false-positive escape exists only through explicit human approval.

## Process boundary

Cockpit-local allowlist (codex/claude/gemini/pao-agent) with fixed argv,
`shell: false`, timeouts, output caps; git read-only via the same shape.
Opaque shell constructs deny; shell-policy refusals escalate to R4 and the
mode matrix decides (APPROVE + push = approval, per spec §137).

## Prompt injection & MCP trust (doc §108-§110)

External repo text, package metadata, MCP output, and provider text are
untrusted data, never instructions. Every MCP tool passes normal
permission/audit. Unknown MCP servers default to restricted rights. VibeRaven
output is normalized conservatively (unknown severity → blocker) and never
trusted blindly.

## Session/stream safety (doc §83, §105)

Event streams are redacted (no secrets in summaries), size-capped, and bound
per session; cancelled sessions never report success. Mutating cockpit
endpoints inherit the existing management-API auth/session machinery
(§103-§104); re-auth for critical actions and short-lived approval tokens are
the hardening follow-ups.
