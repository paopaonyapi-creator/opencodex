# Phase 20.27 — Control Plane Architecture

```text
User / Dashboard / MCP / CLI(follow-up)
        │
/api/agent-os/cockpit/*
        │
AgentCockpitService (cockpit-facade.ts)
        │
 ┌──────┼────────────┬───────────────┬──────────────┐
 │      │            │               │              │
Agents  Access     Context        Gate            Evidence
(Adapters, modes    plane          Engine          Ledger
 sessions, (access- (.pao via      (rules →        (hashed,
 events)  policy)   context-       findings →      expiring)
 │        │         plane.ts)      verdict/exit)
 │        │                          │
 └────────┴──── Phase 20.16 policy engine (single gate) ──── Reviewer bridge
                                    │                        │
                          cockpit_* tables (shared Agent OS store)
                                    │
                        Release marks (human-only) · Providers (human attestation)
```

## Files (all under `src/agent-os/control-plane/` unless noted)

- `cockpit-types.ts` — canonical models (agents, sessions, events, approvals, snapshots, providers, evidence, gate, reviews, tasks) + R0–R5 ladder.
- `access-policy.ts` — ASK/APPROVE/FULL matrix, command classification (R levels), hard invariants; wraps Phase 20.16 `policy.ts` guards.
- `cockpit-agents.ts` — passive PATH detection, doctor probe, cockpit-local agent-CLI allowlist runner.
- `cockpit-gate.ts` — versioned conditional rules, verdict/profile/exit-code calculation, evidence TTLs, hashing.
- `cockpit-store.ts` — additive `cockpit_*` tables on the shared Agent OS handle.
- `context-plane.ts` — `.pao/` versioned artifacts with traversal guard.
- `cockpit-facade.ts` — service facade (sessions, approvals, providers, releases, reviews, gate, VibeRaven adapter, MCP names).
- `../management/cockpit-routes.ts` — REST surface.

## Request flow (doc §10)

identity (actor) → capability (adapter/action) → context (snapshot ref) →
risk (R0–R5 / command class) → policy (`evaluateCockpitAction`, mode-aware) →
human approval if required → safe execution (allowlisted runner) → evidence →
audit events → gate/review update.

## Milestones

- A (read-only cockpit): agents, health, git state, providers — shipped.
- B (safe sessions): sessions, modes, approvals, audit — shipped.
- C (evidence control plane): snapshots, evidence ledger, provider verification, gate findings, review evidence — shipped.
- D (release gate): strict profile + exit codes + release compare/marks — shipped; CI workflow wiring and deploy-consumption are the remaining integration step (existing CI calls `POST /gate {profile:"strict_production"}` and fails on exitCode 1).
