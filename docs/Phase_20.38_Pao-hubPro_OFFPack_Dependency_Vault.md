# Phase 20.38 — Pao-hubPro × OFFPack-inspired Dependency Vault

> **Status:** Implemented (working vertical slice; clean-room — OFFPack is an architectural reference only)
> **Reference:** `Assemou007/OFFPack` — "fetch once → local cache → install offline" pattern adapted (§0-§1)
> **Operations doc:** [`docs/dependency-vault/README.md`](./dependency-vault/README.md)
> **Validated:** 2026-09-13

---

## 0. The architecture decision

Per spec §2/§4/§47, the Vault does **not** replace npm/pnpm/bun resolution. Package
managers stay the authoritative installers; the Vault owns secure acquisition,
content-addressable storage, integrity verification, policy, offline availability,
profiles, bundles, SBOM, and audit. Everything rides the existing Pao-hubPro runtime:
shared SQLite (additive v38), Phase 20.24 URL policy (registry SSRF/HTTPS), Phase
20.33 allowlisted process runner, Phase 20.35 redaction, established MCP/route/GUI
patterns.

## 1. Reuse map

| Spec component | Verdict | Notes |
| --- | --- | --- |
| DB layer, migrations, auth, RBAC, logging, UI, MCP framework | **REUSED** | shared store + established conventions (spec §6: "adapt to the existing repository") |
| Registry URL validation | **REUSED** | Phase 20.24 `validateAndNormalizeUrl` in the HTTP fetcher |
| Secret redaction | **REUSED + EXTENDED** | Phase 20.35 `redactSecrets` + registry-credential scrubbing |
| CAS, integrity, archive safety, trust machine, policy, lockfile graph, profiles, bundles, SBOM, quarantine, GC | **NEW** | `src/agent-os/dep-vault/` |

## 2. Net-new module (`src/agent-os/dep-vault/`)

| File | Role (spec §) |
| --- | --- |
| `types.ts` | trust states, entities, install modes, policy shape (§8, §24) |
| `policy.ts` | error taxonomy (§38), registry allowlist/HTTPS gate, install-mode network enforcement, installability gate, log redaction (§39) |
| `integrity.ts` | SHA-512 digests, npm integrity parsing, CAS commit (immutable, deduplicated), tmp/quarantine namespaces, tar header scanner + entry validation (§7, §15, §31) |
| `catalog.ts` | lockfile detection + normalization (package-lock v2/v3, npm-shrinkwrap, pnpm-lock v6+; `bun.lock` documented unsupported), 6 seed profiles, CycloneDX SBOM (§5, §12, §26, §27) |
| `vault.ts` | acquisition pipeline (policy → metadata → download → hash → verify → archive scan → CAS), in-flight dedup (§16), project scan/ensure, profile prewarm, bundle export/import with tamper rejection (§17), install gate (§24), quarantine reverify (human-only, §43), GC with dry-run (§30) |
| `store.ts` | 7 `dv_*` tables (packages, artifacts w/ unique sha512, projects, project items, bundles, policy decisions, audit events) |
| `service.ts` | stable public import boundary |
| `mcp-tools.ts` | 13 `dependency_vault_*` tools with READ/SAFE_WRITE/NETWORK permission classes (§20-§21) |

Database: `AGENT_OS_SCHEMA_VERSION` 37 → **38**, additive migration only.

## 3. REST surface (14 routes, `/api/agent-os/dep-vault/*`)

`GET status` · `GET packages` · `POST scan` · `POST ensure` · `POST install` ·
`GET profiles` + `POST profiles/prewarm` · `POST bundles/export` + `bundles/import` ·
`GET quarantine` + `POST quarantine/reverify` (human) · `POST sbom` · `GET audit` ·
`GET policy/decisions`. Registered under `DEP_VAULT_VERB_DEFERRAL`.

## 4. Security verification (spec §33 tests — all green)

Integrity mismatch → QUARANTINED + install blocked · tar parent-dir traversal /
absolute paths / Windows drive paths / symlink + hardlink escapes / device entries
rejected · unknown + HTTP registries fail closed · oversized packages refused ·
concurrent duplicate fetches collapse into one download (§16) · bundle format and
version validated · tampered blob rejected on import · strict air-gap fails on cache
miss · credentials stripped from all log surfaces · GC dry-run first, only unpinned
aged artifacts · CycloneDX SBOM with purls and lockfile provenance.

## 5. Honest accounting

- `.offpack` is a directory tree + manifest + SHA512SUMS (single-file tar wrapper
  deferred); tamper enforcement is complete at the file level.
- `bun.lock` parsing unsupported (documented); package-lock/pnpm-lock/shrinkwrap work.
- The §36 full Next.js network E2E is represented by the gate-level tests; live
  registry E2E requires network and stays out of CI (spec §35: mocked tests for CI).
- Lifecycle-script execution remains disabled with no execution path implemented
  (§2 non-goal); the policy flag exists for a future audited runner.
- No GUI prewarm progress streaming (jobs are synchronous; async worker is a
  follow-up).
