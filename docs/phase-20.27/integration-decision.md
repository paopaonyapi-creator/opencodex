# Phase 20.27 — Integration Decision

Chosen per spec §195-§196: **A. Reference-only + C. Optional evidence adapter
(flag off) + native Pao-hubPro implementation.**

1. **Native control plane** — Phase 20.27 is implemented as an extension of
   the existing Phase 20.16 control-plane module (`src/agent-os/control-plane/`):
   task envelopes, the policy engine, and reviewer consensus were already there;
   the cockpit layer adds agents/sessions/access-modes/gate/evidence on top.
   No second control plane, no second registry, no second audit system.
2. **VibeRaven = reference + optional adapter.** The adapter is behind
   `VIBERAVEN_ADAPTER_ENABLED` (default off), requires `VIBERAVEN_HOME`,
   records upstream version, normalizes findings conservatively (unknown
   severity maps up), and can never bypass Pao permission/policy. Failure
   degrades to a status field — the cockpit works fully without it.
3. **No code reuse from upstream** was necessary; concepts only. If snippets
   are ever taken (MIT), LICENSE + notices must be carried and the pinned
   commit recorded here first.
