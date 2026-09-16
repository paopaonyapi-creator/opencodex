# Dependency Vault (Phase 20.38) — Operations Reference

OFFPack-inspired offline dependency supply chain: acquire once online, verify
with SHA-512, store immutably, install offline forever. Clean-room implementation
over the existing Pao-hubPro runtime (shared SQLite v38, Phase 20.24 URL policy,
Phase 20.33 allowlisted process runner, Phase 20.35 redaction).

## Architecture

```text
lockfile (source of truth) → dependency graph → policy gate (registry allowlist,
HTTPS, integrity required) → download to tmp → SHA-512 verify → archive scan
(§15) → immutable CAS (blobs/sha512/<ab>/<hex>) → VERIFIED
```

Trust states (§8): `DISCOVERED → DOWNLOADING → DOWNLOADED → VERIFYING →
VERIFIED | QUARANTINED | BLOCKED | DELETED`. **DOWNLOADED ≠ VERIFIED** — only
`VERIFIED` artifacts pass the install gate.

## Install modes (§24)

`ONLINE` · `OFFLINE` (no network, ever) · `OFFLINE_PREFERRED` (vault first;
fallback only with `DEPENDENCY_VAULT_ALLOW_NETWORK_FALLBACK=true`) ·
`STRICT_AIR_GAP` (fails on cache miss — never falls back).

## Security invariants (§39)

1. Unverified artifacts cannot install. 2. Integrity mismatch → QUARANTINED +
fail (never ignored). 3. Unknown registries fail closed (allowlist). 4. Offline
never touches the network. 5. Strict air-gap fails rather than falls back.
6. Archive entries with parent-dir segments, absolute paths, escaping
symlinks/hardlinks, or device files are rejected before trust promotion.
7. CAS blobs are immutable after verification. 8. Admin overrides are audited.
9. Destructive operations are human-only (invariant violations on agent calls).
10. Secrets never enter bundles, DB, or logs (`redactVaultLog` everywhere).

## Profiles (§12)

Seeded: `base-web`, `nextjs`, `browser-automation`, `ai-agent`,
`video-production`, `adobe-stock`. Prewarm acquires + verifies each package.

## Bundles (§17)

`.offpack` = directory tree: `manifest.json` (format/version/manifestHash) ·
`blobs/sha512/**` · `metadata/packages.json` · `sbom/cyclonedx.json` ·
`checksums/SHA512SUMS`. Import validates format + version + every checksum +
every blob digest before CAS insertion; tampered blobs are rejected.

## API

`/api/agent-os/dep-vault/*` — `GET status` · `GET packages` · `POST scan` ·
`POST ensure` · `POST install` · `GET profiles` + `POST profiles/prewarm` ·
`POST bundles/export|import` · `GET quarantine` + `POST quarantine/reverify`
(human) · `POST sbom` · `GET audit` · `GET policy/decisions`.

## MCP tools (§20-§21)

`dependency_vault_status`, `dependency_vault_scan_project`,
`dependency_vault_ensure_project` (NETWORK), `dependency_vault_install_project`
(SAFE_WRITE), `dependency_vault_cache_stats`, `dependency_vault_verify_cache`,
`dependency_vault_prewarm_profile` (NETWORK), `dependency_vault_list_profiles`,
`dependency_vault_export_bundle`, `dependency_vault_import_bundle`,
`dependency_vault_generate_sbom`, `dependency_vault_audit_project`,
`dependency_vault_inspect_package`. Destructive/admin tools (delete, clear
cache, force import, untrusted registry) are deliberately **not implemented** —
they require the human approval workflow first.

## Configuration

`DEPENDENCY_VAULT_STORAGE` (default `storage/dependency-vault`) ·
`DEPENDENCY_VAULT_REGISTRY` · `DEPENDENCY_VAULT_MAX_CONCURRENCY=8` ·
`DEPENDENCY_VAULT_MAX_PACKAGE_MB=512` · `DEPENDENCY_VAULT_ALLOW_SCRIPTS=false` ·
`DEPENDENCY_VAULT_ALLOW_NETWORK_FALLBACK=false` ·
`DEPENDENCY_VAULT_GC_RETENTION_DAYS=30`.

## Honest limitations

- Package managers (npm/pnpm/bun) remain the authoritative installers; the
  vault gates and verifies but does not replace their resolution (§2, §4).
- `bun.lock` parsing is documented as unsupported (binary format) — use
  package-lock or pnpm-lock (§5).
- `.offpack` is a directory tree + manifest (single-file tar wrapper is a
  follow-up); checksums and tamper rejection are fully enforced.
- The offline E2E (§36) is covered at the gate level (install gate blocks on
  missing/quarantined artifacts); a full Next.js build E2E requires network
  and is not runnable in CI.
- Quarantine reverify requires the original expected integrity; there is no
  "trust anyway" path by design.
