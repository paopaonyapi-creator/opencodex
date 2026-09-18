# Phase 20.89 — Pao-hubPro × Bubble — Capability Hub

**Status:** IMPLEMENTED (registry + manifest pipeline + phase importer + transactional installer + policy engine + health + audit + REST + MCP + dashboard) · Canonical phase: **20.89** (user lock 2026-09-18)
**Schema:** agent-os v57 (`mk_*` tables — the `cap_*` namespace belongs to the live Phase 20.56 Capability Lab and was left untouched)
**Surfaces:** REST `/api/agent-os/marketplace/*` · MCP `marketplace.*` · GUI `Marketplace.tsx` · CLI parity deferred to P3 (flagged)

---

## 1. What it is

The Capability Hub is Pao-hubPro's **registry-first capability supply chain**: every agent, skill, MCP server, API, model, provider, workflow, prompt, and tool becomes a governed registry entry with provenance, versions, dependencies, permissions, health, and policy state — discoverable, installable, updateable, rollbackable, and auditable from one place.

Core law: **Registry-first.** Nothing is installable without a Registry Entry + validated `pao-capability.yaml` manifest. One-Click means one user intent — never uncontrolled execution.

## 2. Architecture

```text
Blueprint corpus (20.61→20.90) + future sources
  → Phase Importer (canonical phase lock → registry drafts)
  → Capability Registry (mk_* tables, schema v57)
  → Manifest validation (strict YAML-subset, fail-closed → QUARANTINE)
  → Policy Gate (ALLOW / ALLOW_WITH_APPROVAL / DENY / QUARANTINE)
  → Install Planner (immutable plan + hash)
  → Approval Gate (R3: human approval for sensitive operations)
  → Transactional Installer (snapshot → apply → verify → register → commit | rollback)
  → Health Checks (UNKNOWN never mapped to HEALTHY)
  → Audit (append-only, secret-redacted)
```

Modules: `src/agent-os/marketplace/{types, canonical-phases, manifest, policy, registry, phase-importer, installer, service, mcp-tools, index}.ts`
Routes: `src/server/management/marketplace-routes.ts` (dispatched from `agent-os-routes.ts`, declared in `route-registry.ts` with `MARKETPLACE_VERB_DEFERRAL`).
GUI: `gui/src/pages/Marketplace.tsx` (gallery, detail, install, rollback — live registry data).

## 3. Canonical phase lock (user decision 2026-09-18)

| Phase | Capability |
| --- | --- |
| 20.65 | Context Mode |
| 20.65.1 | Litho / deepwiki-rs (renumbered from 20.65) |
| 20.83–20.87 | Apple Design Skill · TypeSafe Jev · OmniRoute · AI APIs You Can Ship Today · FileSync |
| 20.88 | Remotion AI Video Runtime |
| 20.89 | Bubble / Capability Hub (this phase) |
| 20.90 | Forge / Prompt Engineering Control Plane (renumbered from 20.88) |
| 20.91 | RESERVED: Business Opportunity / Revenue Intelligence |

The importer resolves every blueprint through `canonical-phases.ts` — the lock table is authoritative; H1/filename parsing is fallback. Collision regression tests cover 20.65/20.65.1 and 20.88/20.90 (mission §25). The corpus's one legacy duplicate file (`Phase 20.62.md` vs Graft) is DETECTED and reported — registered once, no registry collision.

## 4. Security model

1. **Manifest validation (8 layers):** schema, metadata, dependency, permission, policy, compatibility, source (SSRF guard: private ranges/metadata hosts/non-http rejected), checksum. Any failure → QUARANTINE.
2. **No pipe-to-shell:** `curl | sh` / `irm | iex` patterns are forbidden in install steps; the bounded YAML-subset grammar rejects flow maps/anchors/block scalars; unknown step types are invalid.
3. **Secrets:** manifests containing secret material are quarantined at parse time; registry stores `secretRef`-class requirements only; audit payloads are scrubbed (tested).
4. **Permission scopes:** 23-permission taxonomy with scope globs; traversal (`..`), Windows drive escapes, and shell metacharacters in scopes are rejected.
5. **Fail-closed defaults:** unverified provenance never reaches plain ALLOW; a floating source ref (no immutable commit/semver) forces approval; UNKNOWN compatibility is never safe.
6. **Approval gates:** `ALLOW_WITH_APPROVAL` plans require explicit operator approval before execution; execution without approval throws; double-execution of a plan is rejected (idempotency).
7. **Most-restrictive-wins:** DENY > QUARANTINE > ALLOW_WITH_APPROVAL > ALLOW; artifactType-scoped rules only match via their specific path.

## 5. Transactional installer

States: `PLANNED → APPROVED → PREPARING → SNAPSHOTTING → APPLYING → VERIFYING → REGISTERING → COMMITTED` with failure path `FAILED → ROLLBACK_PENDING → ROLLING_BACK → ROLLED_BACK`. Guarantees: immutable plan (hash-pinned, approved plan executed as-is — never silently regenerated), deterministic post-failure state, idempotent steps where practical, bounded redacted logs, snapshots persisted for rollback. **INSTALLING is never COMPLETE** — COMMIT requires verification.

Execution scope honesty: registry/runtime-registration steps run in this build; external fetch/clone/build steps are planned as `deferred_external` and require the Phase 20.86 source-adapter wave — never silently executed.

## 6. REST surface (`/api/agent-os/marketplace/*`)

| Endpoint | Purpose |
| --- | --- |
| `GET health` | registry counts + canonical invariant check |
| `GET capabilities` · `GET capabilities/{slug}` | list/detail with permissions, dependencies, policy, installation |
| `POST import-phases` | run the Phase Importer (blueprint corpus → registry drafts) |
| `POST capabilities/{slug}/plan-install` | immutable install plan + policy decision |
| `POST install-plans/{id}/approve` · `/execute` | R3 approval → transactional execution |
| `POST installations/{id}/rollback` | restore prior state |
| `GET reconciliation` | mission §28 report rows |
| `GET audit` | append-only trail |
| `POST capabilities/{slug}/favorite` | operator bookmark |

## 7. Phase Importer (mission §18)

Scans the tracked `Blueprint/` corpus (20.61 → 20.90, 34 files), resolves every file through the canonical lock, generates `pao-capability.yaml` manifests, upserts registry drafts, records phase blueprints with `blueprint_status` SEPARATE from runtime status, and emits this data for `docs/reports/PHASE_REGISTRY_RECONCILIATION.md`. Result (verified): **31/31 canonical phases registered, 0 not-registered, 1 detected legacy duplicate (20.62 file), 0 registry collisions.**

## 8. Configuration

See `.env.example` (Phase 20.89 section): `PAOHUB_MARKETPLACE_ENABLED`, `PAOHUB_MARKETPLACE_AUTO_SYNC`, `PAOHUB_MARKETPLACE_AUTO_VERIFY`, `PAOHUB_MARKETPLACE_ADAPTER_GEN`, `PAOHUB_MARKETPLACE_OMNIROUTE_PUBLISH`, `PAOHUB_MARKETPLACE_MCP_PUBLISH`, `PAOHUB_MARKETPLACE_EXTRA_BLUEPRINT_DIRS`. Defaults are safe: the Hub never blocks, executes, or publishes until explicitly enabled.

## 9. Operational runbook

1. **Seed the registry:** `POST /api/agent-os/marketplace/import-phases` (or the dashboard Import Phases button). Idempotent — re-imports update.
2. **Verify:** `GET .../health` (invariant `pass`) + `GET .../reconciliation` (31 rows).
3. **Install a capability:** `POST .../capabilities/{slug}/plan-install` → review the plan (policy decision, permissions, steps) → approve if `approvalRequired` → `POST .../install-plans/{id}/execute` → health surfaces on the card.
4. **Rollback:** `POST .../installations/{id}/rollback` with a reason — restores prior state, audited.
5. **Quarantine:** a policy `QUARANTINE` decision or drift flag flips the capability state; release requires re-verification + approval.

### Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `MANIFEST_INVALID` on import | blueprint/manifest outside the bounded grammar | fix the file; the issue names the path/line |
| `SOURCE_UNTRUSTED` | SSRF-guarded or non-http URL | use a permitted remote target |
| `POLICY_DENIED` | a DENY rule matched (e.g. ssh read, credential.use) | policy decision is final unless an R4-approved change is made |
| `APPROVAL_REQUIRED` | ALLOW_WITH_APPROVAL plan | approve via dashboard/CLI with an operator identity |
| `no such column` during migration | a pre-existing `cap_*` table from another subsystem | use the `mk_*` tables (v57 already does) — never ALTER the 20.56 tables |
| MCP tool surface changed post-install | contract drift | capability flagged DEGRADED + REQUIRE_REVIEW |

## 10. Production readiness checklist

- [x] Canonical phase lock: 31/31 registered, 0 collisions, regression-tested (20.65/20.65.1, 20.88/20.90)
- [x] Registry-first law enforced (installer refuses unregistered slugs)
- [x] Manifest pipeline: strict parser + 8-layer validation, fail-closed → QUARANTINE (tested)
- [x] Importer: real corpus 34 files → 31 capabilities (mission §18 blueprint≠runtime separation, tested)
- [x] Transactional installer: commit/rollback/failure paths + approval bypass refusal + double-execution guard (tested)
- [x] Policy gate: 4-state enum, most-restrictive-wins, fail-closed baselines (tested)
- [x] Security tests: injection, traversal, SSRF, secret leakage, escalation (mission §26, tested)
- [x] REST + MCP + GUI live against the real registry (no mock paths)
- [x] Documentation: this file + reconciliation report + `.env.example`
- [ ] Curated collections UI (schema + tables shipped; UI wave P1)
- [ ] Enable/disable lifecycle + additional source/runtime adapters (wave P3, flagged)

## 11. Exact limitations (honest)

1. **Installer execution scope:** registry/runtime-registration steps only. External fetch/clone/build steps are planned as `deferred_external` — real source-adapter execution is the Phase 20.86/P3 wave. Nothing is faked.
2. **Collections/favorites:** tables + service methods shipped; gallery UI for collections is the P1 wave.
3. **Enable/disable lifecycle:** REST returns 501 with the wave reference (P3) rather than a fake success.
4. **OmniRoute/MCPProxy auto-publish:** flags reserved (`PAOHUB_MARKETPLACE_OMNIROUTE_PUBLISH/MCP_PUBLISH`); MCP-proxy publication wiring lands with the runtime-adapter wave.
5. **Single-process installer transactions:** in-memory transaction records + DB installation state; multi-node distribution rides Phase 20.87 FileSync when that phase lands.

## 12. Verification evidence

- `bun test tests/marketplace-manifest.test.ts tests/marketplace-core.test.ts tests/marketplace-security.test.ts tests/marketplace-api.test.ts` → **50 pass / 0 fail**
- `bun run typecheck` · `bun run privacy:scan` · `bun run skill:surface:check` · `gui lint` · `gui build` → all green
- Registry: **31/31 canonical phases registered** via the importer from the tracked corpus (34 files scanned), 0 unexpected collisions
- Phase-collision regression tests: 20.65/20.65.1 and 20.88/20.90 canonical assignments locked
