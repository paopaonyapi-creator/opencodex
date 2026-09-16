# Phase 20.27 — Provider Verification

See `git-release-intelligence.md` (§49-§52 combined there by design).

Summary of the enforced contract:

1. States: not_detected · detected · configured · verification_required ·
   verified · degraded · failed · unknown.
2. Detection = config/package evidence; **never** displayed with success
   semantics (doc §96, §171).
3. Runtime verification = explicit human attestation through the permission
   layer + a TTL'd `provider_verification` evidence record (24h default).
4. `verification_required`/`configured` providers produce gate warnings
   (blockers under strict profile); failed/degraded providers are blockers.
5. Verification failures and staleness are observable (`verification missing`
   evidence type) so the strict gate can fail with exit code 1 honestly.
