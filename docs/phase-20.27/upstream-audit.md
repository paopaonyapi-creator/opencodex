# Phase 20.27 — Upstream Audit: VibeRaven

Source: https://github.com/ohad6k/VibeRaven. Audited 2026-09-13 via public
repository page fetch. **No upstream code was executed, vendored, or copied.**

| Item | Finding |
|---|---|
| License | MIT (per spec + repo). No code reused, so no attribution obligations triggered; if code is ever reused, carry LICENSE + notices. |
| Commit SHA | **Not captured** from the page fetch — pin and record before enabling the adapter flag. |
| Public vs private | The spec itself warns that public artifacts may not include the full product source. Only README-documented concepts were used: access modes (ask/approve/full), readiness checks with file:line evidence, provider cards, `.viberaven` context, MCP server mode. |
| Concepts adopted (as inspiration) | Agent connection health, evidence-backed production gate, detected-vs-verified provider states, shared project context root, guarded fixes. |
| Concepts deliberately NOT adopted | None of the UI/branding; no `.viberaven/` root (Pao uses native `.pao/`); no bypass of Pao permission/policy. |
| Trust boundary | Upstream output = UNTRUSTED DATA. Normalizer maps unknown severity UP to blocker; the Pao gate re-evaluates applicability; adapter is flag-gated and degrades gracefully (doc §54, §110, §194). |

Integration decision: **A (reference-only) + C (optional MCP/CLI evidence
adapter, flag off)** — see `integration-decision.md`.
