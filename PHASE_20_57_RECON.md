# PHASE_20_57_RECON.md — Repository Recon for the Skill Control Plane

Phase 20.57 — Pao-hubPro × SkillsGate: Universal Agent Skill Registry, Visual
Skill Marketplace, Cross-Agent Deployment, Remote Skill Sync & Policy-Governed
Skill Control Plane.

This recon follows the non-negotiable rule in the phase spec (§72.1: inspect the
real repository before creating architecture). It records what the working tree
actually contains today and which existing infrastructure this phase reuses
instead of duplicating.

## 1. What already exists

### 1.1 Prior skill-adjacent subsystems (must not be duplicated)

- `src/agent-os/skills.ts` (Phase 08) — a tiny skill *record store*: versioned
  operating-knowledge rows with health checks (`listSkills`, `checkSkillHealth`).
  It has no import pipeline, no scanner, no deployment, no policy. Phase 20.57
  does not modify it; the new subsystem uses its own `sg_*` tables and the
  `/api/agent-os/skill-gate` route prefix so the Phase 08 `skills` table and
  `/api/agent-os/...` namespace stay untouched.
- `src/agent-os/capability-lab/` (Phase 20.56, the bridge source) — publishes
  capability artifacts (`cap_artifacts` rows with `sha256`, `uri`) via
  `getCapabilityLab().publish(...)`. Its `CapabilityArtifact` shape
  (`{ id, runId, name, path, sha256, sizeBytes, mimeType }`) is what the
  Phase 20.57 generated-Skill bridge consumes.
- `src/agent-os/remote.ts` (Phase 12) — a track-only Remote Nodes registry,
  explicitly "no dispatch in this phase". Deny-by-default node tracking is the
  precedent for this phase's remote-node stance.
- `src/agent-os/universal-registry/`, `ecc/skills`, `orch/skills` route
  prefixes exist but do not collide with `/api/agent-os/skill-gate`.

### 1.2 Infrastructure this phase reuses (per spec §72.2)

| Need | Existing infrastructure |
|---|---|
| Database | `src/agent-os/db.ts`, additive `CREATE TABLE IF NOT EXISTS` groups, schema v46 → **47** |
| Management routes | full-literal guards in a new `src/server/management/skill-gate-routes.ts`, chain-linked from `agent-os-routes.ts`, registered in `route-registry.ts` with a verb-deferral exemption |
| MCP tools | shared `WebMcpToolDefinition` from `src/agent-os/video/mcp-tools.ts` (R0–R4 tiers, `execute`), per-module `mcp-tools.ts` |
| Audit | module `sg_audit` table (business-builder `appendAudit` precedent) + `recordAgentEvent({ kind: "skill-gate.*" })` |
| Reviews | module review records bound to exact version + content hash; separation of duties enforced in the service (reviewer ≠ requester) |
| Policy | module-local pure policy functions with `ruleId`s (capability-lab `decidePublish` precedent); shared `src/agent-os/policy.ts` engine stays for host capabilities |
| Storage | snapshots under `$OPENCODEX_HOME/skill-gate/` (capability-lab `snapshot_path` precedent) |
| GUI | `universal-registry.css` `ur-*` classes, `App.tsx` NAV + `PAGE_TKEY`, i18n nav key in 10 locales, `.oxlintrc.json` page override |

### 1.3 Conventions verified

- `db.ts` is a single `migrate()` with one additive `db.exec` template; new
  tables append a `-- vNN:` section before the version upsert
  (`db.ts:5957-5965` for v46).
- Routes use `req.method` + full-literal `pathname ===` guards, `jsonResponse`
  envelopes, `return null` fallthrough; the reconciliation scanner in
  `tests/helpers/management-route-scan.ts` resolves literal pairs, so every
  literal route must appear in `MANAGEMENT_ROUTES`.
- Tests isolate with `closeAgentOsDbForTests()` + `mkdtempSync` +
  `process.env.OPENCODEX_HOME`, construct the service directly, and
  (`agent-os-routes.test.ts`) drive `handleManagementAPI` with Host-only
  requests.
- **No SSH transport exists** (`package.json` has no ssh dependency; all `ssh`
  hits are policy deny-regexes). Remote-node dispatch must therefore fail
  closed behind an injectable transport seam, exactly like Phase 12 did.

## 2. Decisions for the vertical slice

1. **Module name** `src/agent-os/skill-gate/` (phase title "SkillsGate";
   internal name per spec §6 is the Pao Skill Control Plane). Routes
   `/api/agent-os/skill-gate/*`; MCP namespace `skill.*`; DB prefix `sg_*`.
2. **Import pipeline**: local-folder import (deterministic, snapshot + SHA-256),
   git import via subprocess `git clone --depth 1` (testable against a local
   fixture repo), generated-artifact bridge from Phase 20.56 (provenance
   retained as `source_type: generated`), skills.sh marketplace connector as
   *discovery metadata only* with an injectable fetch (never auto-trusted).
3. **Scanner**: deterministic regex rule set with evidence locations (file,
   line range, evidence hash); never executes content; produces a weighted
   risk score using the spec §23 weights.
4. **Deployment**: agent adapters for `codex`, `claude-code`, `opencode`,
   `universal`; plan → dry-run → snapshot → stage → atomic write → hash verify
   → deployment record; unmanaged-file conflicts refuse to overwrite; remove
   only touches managed deployments; drift detection compares stored hashes.
5. **Remote nodes**: registry CRUD + host-key fingerprint + allowed-roots data
   model now; actual SSH dispatch fails closed with a typed error behind a
   `RemoteTransport` injection seam (no transport ships this phase — honest
   scope accounting, Phase 12 precedent).
6. **Semantic analysis (spec §22)**: deferred behind `PAO_SKILL_SEMANTIC_ANALYSIS_ENABLED`
   (default false); deterministic scanners remain authoritative.
7. **Deferred with accounting**: built-in Markdown editor (spec §37), cross-agent
   transformation beyond per-adapter path/folder rules (§29), signed manifests
   (§35 future), marketplace popularity as trust (never — §5/§48).

## 3. Files this phase will touch

New: `src/agent-os/skill-gate/{types,sources,marketplace,scanner,policy,adapters,store,service,mcp-tools}.ts`,
`src/server/management/skill-gate-routes.ts`, `gui/src/pages/SkillGate.tsx`,
`tests/skill-gate.test.ts`, `PHASE_20_57_REPORT.md`,
`docs/Phase_20.57_…SkillsGate…md`.

Modified: `src/agent-os/db.ts` (v47), `src/server/management/agent-os-routes.ts`
(chain link), `src/server/management/route-registry.ts` (route entries +
`SKILL_GATE_VERB_DEFERRAL`), `gui/src/app-routing.ts`, `gui/src/App.tsx`,
`gui/src/i18n/*.ts` ×10, `gui/.oxlintrc.json`.
