# Phase 20.27 — Agent Cockpit & Production Readiness Control Plane

Native Pao-hubPro cockpit: agents, sessions, access modes as real policy,
approvals, `.pao/` context, git/release intelligence, providers
(detected ≠ verified), evidence-backed readiness gate with strict exit codes,
reviewer bridge, MCP tools, dashboard. VibeRaven = reference inspiration +
optional flag-off evidence adapter.

## Quick start

1. Dashboard → **Agent Cockpit**: overview shows git state, readiness verdict,
   blockers, agents, pending approvals, provider health.
2. `POST /api/agent-os/cockpit/agents/access-mode {agentType:"codex",
   mode:"approve"}` (human actor) → Codex sessions now run with bounded
   autonomy; risky steps land in the approval inbox.
3. `POST /api/agent-os/cockpit/gate {profile:"strict_production"}` →
   evidence-backed verdict + exit code (1 = blocked) consumable by CI.

## Docs

- `current-architecture.md` · `upstream-audit.md` · `integration-decision.md`
- `control-plane-architecture.md` · `agent-adapter-contract.md`
- `permission-model.md` · `context-plane.md` · `architecture-intelligence.md`
- `git-release-intelligence.md` · `provider-verification.md`
- `readiness-gate.md` · `evidence-ledger.md` · `reviewer-council.md`
- `security.md` · `migration-notes.md` · `test-report.md` · `rollback.md`
- Main doc: `docs/Phase%2020.27%20—%20Pao-hubPro%20×%20VibeRaven%20Agent%20Cockpit%20&%20Production%20Readiness%20Control%20Plane.md`
