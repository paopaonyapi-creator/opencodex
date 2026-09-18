// Phase 20.91b — Engineering Skill Runtime: Skill Pack Registry.
//
// Registry-first + quarantine-first: an imported pack lands QUARANTINED and only
// reaches ACTIVE through validate (integrity + malicious-content scan) → evals →
// promote. Upstream content is stored as data — never as permission grants, and
// never modified in place (sidecar metadata lives in this registry instead).
//
// Reuse (Ponytail ladder): frontmatter parsing reuses the Phase 20.57 SkillsGate
// reader; hashing uses node:crypto; persistence uses the shared agent-os SQLite
// layer. No new dependencies.

import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../db";
import { parseFrontmatter } from "../skill-gate/frontmatter";
import {
  EngineeringSkillsError,
  readEngineeringSkillsFlags,
  type EngineeringSkillsAuditEvent,
  type LifecycleStage,
  type NormalizedSkill,
  type PackLifecycleStatus,
  type PermissionClass,
  type PermissionTier,
  type RiskLevel,
} from "./types";

export interface PackRecord {
  id: string;
  name: string;
  sourceUrl: string | null;
  sourceType: string;
  version: string | null;
  resolvedCommit: string;
  license: string | null;
  trustStatus: string;
  lifecycleStatus: PackLifecycleStatus;
  manifestHash: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PackVersionRecord {
  id: string;
  packId: string;
  version: string;
  resolvedCommit: string;
  manifestHash: string;
  lifecycleStatus: string;
  createdAt: string;
}

/** Inline skill definition used when importing a pack without a filesystem scan. */
export interface SkillDefinitionInput {
  slug: string;
  name: string;
  description?: string;
  entrypoint?: string;
  content?: string;
  lifecycleStages: LifecycleStage[];
  triggers?: { intents?: string[]; keywords?: string[] };
  capabilities?: string[];
  permissions?: Partial<Record<PermissionClass, PermissionTier>>;
  riskLevel?: RiskLevel;
  references?: string[];
  compatibleProviders?: string[];
  verificationRules?: string[];
  reviewRequired?: boolean;
}

export interface PackImportInput {
  name: string;
  sourceUrl?: string;
  sourceType: "inline" | "local" | "git";
  version?: string;
  resolvedCommit?: string;
  license?: string;
  /** Inline skill definitions (used by the built-in pao-core seed and tests). */
  skills?: SkillDefinitionInput[];
  /** Local directory containing SKILL.md files (one per skill folder). */
  localPath?: string;
  note?: string;
}

export interface PackImportResult {
  pack: PackRecord;
  skills: NormalizedSkill[];
  quarantinedReasons: string[];
  /** Inferred-capability gains vs the pack's previous version (source §33). */
  capabilityExpansions: string[];
}

/** Instruction patterns that are data, not authority (source §34). Any hit quarantines. */
const MALICIOUS_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(platform\s+)?policy/i,
  /disable\s+(all\s+)?(safety|security)\s+checks/i,
  /read\s+(all\s+)?(credentials|secrets|\.env)/i,
  /upload\s+(all\s+)?(secrets|credentials)/i,
  /send\s+the\s+repository\s+to/i,
  /exfiltrate/i,
  /bypass\s+(the\s+)?(approval|permission|policy)/i,
];

const STAGE_ORDER: LifecycleStage[] = ["intake", "define", "plan", "build", "verify", "review", "ship", "observe"];

/**
 * Capability inference (source §34 defense 3): scan skill content for what it
 * would NEED if followed literally. Inferred capabilities are advisory — the
 * declared permissions still govern, and a diff between the two on update is a
 * quarantine trigger (capability-expansion detection).
 */
export function inferCapabilities(content: string): string[] {
  const caps = new Set<string>();
  if (/```(?:bash|sh|shell)|\bnpm\s+(?:run|install|test)|\bgit\s+(?:commit|push|checkout)\b/.test(content)) caps.add("shell.execute");
  if (/https?:\/\//.test(content)) caps.add("network.outbound");
  if (/\{\{secure\.[A-Za-z0-9_]+\}\}|process\.env\.[A-Z0-9_]+/.test(content)) caps.add("secrets.use");
  if (/\bwriteFile|fs\.write|>\s*\w+\.(?:ts|js|md)\b/.test(content)) caps.add("filesystem.write");
  if (/\bgit\s+push\b/.test(content)) caps.add("git.write");
  if (/\bdeploy|production\s+release\b/i.test(content)) caps.add("deployment.execute");
  return [...caps];
}

/** Static content scan (source §6.3 step 5). Returns reasons; empty = clean. */
export function scanSkillContent(content: string): string[] {
  const reasons: string[] = [];
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.test(content)) reasons.push(`malicious_instruction_pattern:${pattern.source}`);
  }
  return reasons;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Capability-expansion diff (source §33): skills gaining inferred capabilities. */
export function compareCapabilityProfiles(previous: NormalizedSkill[], next: NormalizedSkill[]): string[] {
  const expansions: string[] = [];
  for (const skill of next) {
    const before = previous.find((p) => p.slug === skill.slug);
    if (!before) continue;
    const gained = skill.inferredCapabilities.filter((c) => !before.inferredCapabilities.includes(c));
    if (gained.length > 0) expansions.push(`${skill.slug}:+${gained.join(",")}`);
  }
  return expansions;
}

/** Third-party deny-by-default profile (source §17.2). */
function thirdPartyDefaultPermissions(): Partial<Record<PermissionClass, PermissionTier>> {
  return {
    "filesystem.read": "project",
    "filesystem.write": "denied",
    "shell.execute": "denied",
    "network.outbound": "denied",
    "browser.control": "denied",
    "secrets.use": "denied",
    "git.write": "denied",
    "deployment.execute": "denied",
  };
}

export class SkillPackRegistry {
  private seeded = false;

  /**
   * Import a pack. Lands QUARANTINED unless it is the trusted built-in seed.
   * Importing an EXISTING pack name is the version-update flow (source §6.3):
   * the new version lands in quarantine, capability expansion is flagged, and
   * nothing is auto-promoted — validate (evals) → promote is required.
   */
  importPack(input: PackImportInput, actor = "operator"): PackImportResult {
    const flags = readEngineeringSkillsFlags();
    if (!flags.phaseEnabled) {
      throw new EngineeringSkillsError("ROUTE_FAILED", 409, "Phase 20.91 runtime is disabled by flag");
    }
    if (input.sourceType !== "inline" && !flags.externalPacksEnabled) {
      throw new EngineeringSkillsError("ROUTE_FAILED", 409, "External skill packs are disabled by flag");
    }
    if (!input.resolvedCommit && input.sourceType !== "inline") {
      throw new EngineeringSkillsError("COMMIT_PIN_REQUIRED", 422, "external pack installs must pin an immutable resolved_commit — floating refs are rejected");
    }

    const db = openAgentOsDb();
    const existing = db.query("SELECT id, name FROM esk_packs WHERE name = ? LIMIT 1").get(input.name) as { id: string; name: string } | undefined;

    const isTrustedSeed = input.sourceType === "inline" && input.name === "pao-core";
    const skillDefs: SkillDefinitionInput[] = input.skills ?? this.scanLocalSkills(input.localPath);
    if (skillDefs.length === 0) {
      throw new EngineeringSkillsError("PACK_NOT_FOUND", 422, "pack import carried no skills (inline definitions or localPath with SKILL.md files required)");
    }

    const { normalized, quarantinedReasons } = this.normalizeSkillDefs(skillDefs, isTrustedSeed);
    const manifestHash = hashContent(JSON.stringify(normalized.map((s) => s.sourceHash).sort()));
    const now = new Date().toISOString();

    if (existing) {
      // Version update: snapshot-diff → replace skills → QUARANTINED (never auto-active).
      const previousSkills = this.listSkills(existing.id);
      const expansions = compareCapabilityProfiles(previousSkills, normalized);
      for (const e of expansions) quarantinedReasons.push(`capability_expansion:${e}`);
      const packId = existing.id;
      db.run("DELETE FROM esk_skills WHERE pack_id = ?", [packId]);
      this.insertSkills(db, packId, normalized, now);
      db.run(
        "UPDATE esk_packs SET version = ?, resolved_commit = ?, manifest_hash = ?, lifecycle_status = 'QUARANTINED', enabled = 0, updated_at = ? WHERE id = ?",
        [input.version ?? "1.0.1", input.resolvedCommit ?? `inline-${manifestHash.slice(0, 12)}`, manifestHash, now, packId],
      );
      db.prepare(
        "INSERT INTO esk_pack_versions (id, pack_id, version, resolved_commit, manifest_hash, lifecycle_status, skills_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(`eskver_${randomUUID().slice(0, 16)}`, packId, input.version ?? "1.0.1", input.resolvedCommit ?? `inline-${manifestHash.slice(0, 12)}`, manifestHash, "QUARANTINED", JSON.stringify(normalized), input.note ?? "version update quarantined pending evals", now);
      this.audit("skill.pack.quarantined", actor, { packId, pack: input.name, version: input.version, expansions });
      return { pack: this.getPack(packId)!, skills: normalized, quarantinedReasons, capabilityExpansions: expansions };
    }

    const packId = `eskpack_${randomUUID().slice(0, 16)}`;
    const lifecycle: PackLifecycleStatus = isTrustedSeed && quarantinedReasons.length === 0 ? "ACTIVE" : "QUARANTINED";
    const pack: PackRecord = {
      id: packId,
      name: input.name,
      sourceUrl: input.sourceUrl ?? null,
      sourceType: input.sourceType,
      version: input.version ?? "1.0.0",
      resolvedCommit: input.resolvedCommit ?? `inline-${manifestHash.slice(0, 12)}`,
      license: input.license ?? null,
      trustStatus: isTrustedSeed ? "verified" : quarantinedReasons.length > 0 ? "quarantined" : "unverified",
      lifecycleStatus: lifecycle,
      manifestHash,
      enabled: lifecycle === "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    const insertPack = db.prepare(
      "INSERT INTO esk_packs (id, name, source_url, source_type, version, resolved_commit, license, trust_status, lifecycle_status, manifest_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertPack.run(pack.id, pack.name, pack.sourceUrl, pack.sourceType, pack.version, pack.resolvedCommit, pack.license, pack.trustStatus, pack.lifecycleStatus, pack.manifestHash, pack.enabled ? 1 : 0, now, now);

    this.insertSkills(db, packId, normalized, now);

    db.prepare(
      "INSERT INTO esk_pack_versions (id, pack_id, version, resolved_commit, manifest_hash, lifecycle_status, skills_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(`eskver_${randomUUID().slice(0, 16)}`, pack.id, pack.version, pack.resolvedCommit, manifestHash, lifecycle, JSON.stringify(normalized), input.note ?? null, now);

    this.audit(quarantinedReasons.length > 0 ? "skill.pack.quarantined" : "skill.pack.imported", actor, { packId: pack.id, pack: pack.name, skills: normalized.length, reasons: quarantinedReasons });
    return { pack, skills: normalized, quarantinedReasons, capabilityExpansions: [] };
  }

  private normalizeSkillDefs(skillDefs: SkillDefinitionInput[], isTrustedSeed: boolean): { normalized: NormalizedSkill[]; quarantinedReasons: string[] } {
    const quarantinedReasons: string[] = [];
    const normalized: NormalizedSkill[] = [];
    for (const def of skillDefs) {
      const content = def.content ?? `# ${def.name}\n\n${def.description ?? ""}\n`;
      const scan = scanSkillContent(content);
      if (scan.length > 0 && !isTrustedSeed) {
        quarantinedReasons.push(`${def.slug}: ${scan.join("; ")}`);
      }
      const frontmatter = parseFrontmatter(content);
      const declared = def.permissions ?? (isTrustedSeed ? safeCorePermissions() : thirdPartyDefaultPermissions());
      normalized.push({
        id: `esk_${randomUUID().slice(0, 16)}`,
        packId: "",
        slug: def.slug,
        name: frontmatter.name ?? def.name,
        description: frontmatter.description ?? def.description ?? "",
        lifecycleStages: def.lifecycleStages,
        triggers: { intents: def.triggers?.intents ?? [], keywords: def.triggers?.keywords ?? [] },
        declaredCapabilities: def.capabilities ?? [],
        inferredCapabilities: inferCapabilities(content),
        permissions: declared,
        riskLevel: def.riskLevel ?? "low",
        entrypoint: def.entrypoint ?? `skills/${def.slug}/SKILL.md`,
        references: def.references ?? [],
        compatibleProviders: def.compatibleProviders ?? ["codex", "claude", "gemini", "opencode"],
        verificationRules: def.verificationRules ?? ["artifact_exists"],
        reviewRequired: def.reviewRequired ?? false,
        sourceHash: hashContent(content),
        trusted: isTrustedSeed,
        enabled: true,
      });
    }
    return { normalized, quarantinedReasons };
  }

  private insertSkills(db: ReturnType<typeof openAgentOsDb>, packId: string, normalized: NormalizedSkill[], now: string): void {
    const insertSkill = db.prepare(
      "INSERT INTO esk_skills (id, pack_id, slug, name, description, entrypoint, lifecycle_stage_json, triggers_json, capabilities_json, permissions_json, meta_json, risk_level, source_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const skill of normalized) {
      skill.packId = packId;
      const meta = {
        references: skill.references,
        compatibleProviders: skill.compatibleProviders,
        verificationRules: skill.verificationRules,
        reviewRequired: skill.reviewRequired,
        trusted: skill.trusted,
      };
      insertSkill.run(
        skill.id, packId, skill.slug, skill.name, skill.description, skill.entrypoint,
        JSON.stringify(skill.lifecycleStages), JSON.stringify(skill.triggers),
        JSON.stringify({ declared: skill.declaredCapabilities, inferred: skill.inferredCapabilities }),
        JSON.stringify(skill.permissions), JSON.stringify(meta), skill.riskLevel, skill.sourceHash, skill.enabled ? 1 : 0, now, now,
      );
    }
  }

  /** Scan a local directory for `<dir>/SKILL.md` files (sidecar-free, read-only). */
  private scanLocalSkills(localPath: string | undefined): SkillDefinitionInput[] {
    if (!localPath) return [];
    let entries;
    try {
      entries = readdirSync(localPath, { withFileTypes: true });
    } catch {
      throw new EngineeringSkillsError("PACK_NOT_FOUND", 422, `localPath '${localPath}' is not readable`);
    }
    const defs: SkillDefinitionInput[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(localPath, entry.name, "SKILL.md");
      let content: string;
      try {
        if (!statSync(skillFile).isFile()) continue;
        content = readFileSync(skillFile, "utf8");
      } catch {
        continue;
      }
      const frontmatter = parseFrontmatter(content);
      defs.push({
        slug: entry.name,
        name: frontmatter.name ?? entry.name,
        description: frontmatter.description,
        content,
        // Directory-scan imports get conservative defaults; sidecar metadata can refine.
        lifecycleStages: ["build"],
      });
    }
    return defs;
  }

  /** Validate a quarantined/candidate pack: integrity + per-skill scan. */
  validatePack(packIdOrName: string, actor = "operator"): { pack: PackRecord; ok: boolean; issues: string[] } {
    const db = openAgentOsDb();
    const pack = this.getPack(packIdOrName);
    if (!pack) throw new EngineeringSkillsError("PACK_NOT_FOUND", 404, `pack '${packIdOrName}' is not registered`);
    const skills = this.listSkills(pack.id);
    const issues: string[] = [];
    if (skills.length === 0) issues.push("pack has no skills");
    const recomputed = hashContent(JSON.stringify(skills.map((s) => s.sourceHash).sort()));
    if (recomputed !== pack.manifestHash) issues.push("INTEGRITY_MISMATCH: manifest hash does not match skill content");
    for (const skill of skills) {
      const scan = scanSkillContent(`${skill.name}\n${skill.description}`);
      if (scan.length > 0) issues.push(`${skill.slug}: ${scan.join("; ")}`);
    }
    if (issues.length === 0 && pack.lifecycleStatus === "QUARANTINED") {
      this.setPackStatus(pack.id, "CANDIDATE", actor, "validated: integrity + content scan clean");
    }
    this.audit("skill.pack.validated", actor, { packId: pack.id, ok: issues.length === 0, issues });
    return { pack: this.getPack(pack.id)!, ok: issues.length === 0, issues };
  }

  /** Promote CANDIDATE → ACTIVE. Eval gating is the caller's contract (must run evals first). */
  promotePack(packIdOrName: string, actor = "operator", note?: string): PackRecord {
    const pack = this.getPack(packIdOrName);
    if (!pack) throw new EngineeringSkillsError("PACK_NOT_FOUND", 404, `pack '${packIdOrName}' is not registered`);
    if (pack.lifecycleStatus === "QUARANTINED") {
      throw new EngineeringSkillsError("PACK_QUARANTINED", 409, "quarantined packs cannot be promoted — run validate (and evals) first");
    }
    if (pack.lifecycleStatus !== "CANDIDATE") {
      throw new EngineeringSkillsError("INVALID_TRANSITION", 409, `pack lifecycle ${pack.lifecycleStatus} cannot promote — only CANDIDATE can`);
    }
    this.setPackStatus(pack.id, "ACTIVE", actor, note ?? "promoted to active after validation");
    return this.getPack(pack.id)!;
  }

  /** Roll back to the previous ACTIVE version snapshot, if one exists. */
  rollbackPack(packIdOrName: string, actor = "operator", reason = "manual rollback"): PackRecord {
    const db = openAgentOsDb();
    const pack = this.getPack(packIdOrName);
    if (!pack) throw new EngineeringSkillsError("PACK_NOT_FOUND", 404, `pack '${packIdOrName}' is not registered`);
    const versions = db
      .query("SELECT * FROM esk_pack_versions WHERE pack_id = ? ORDER BY created_at DESC")
      .all(pack.id) as Array<{ id: string; version: string; lifecycle_status: string; skills_json: string; resolved_commit: string; manifest_hash: string; created_at: string }>;
    const previousActive = versions.find((v) => v.lifecycle_status === "ACTIVE" && v.manifest_hash !== pack.manifestHash);
    this.setPackStatus(pack.id, "ROLLED_BACK", actor, `rollback: ${reason}`);
    if (previousActive) {
      // Restore the previous version's skill set from its immutable snapshot.
      const snapshot = JSON.parse(previousActive.skills_json) as Array<Record<string, unknown>>;
      db.run("DELETE FROM esk_skills WHERE pack_id = ?", [pack.id]);
      const now = new Date().toISOString();
      const insertSkill = db.prepare(
        "INSERT INTO esk_skills (id, pack_id, slug, name, description, entrypoint, lifecycle_stage_json, triggers_json, capabilities_json, permissions_json, meta_json, risk_level, source_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const s of snapshot) {
        insertSkill.run(
          String(s.id), pack.id, String(s.slug), String(s.name), String(s.description ?? ""), String(s.entrypoint),
          JSON.stringify(s.lifecycleStages ?? []), JSON.stringify(s.triggers ?? {}),
          JSON.stringify({ declared: s.declaredCapabilities ?? [], inferred: [] }),
          JSON.stringify(s.permissions ?? {}),
          JSON.stringify({
            references: s.references ?? [],
            compatibleProviders: s.compatibleProviders ?? [],
            verificationRules: s.verificationRules ?? ["artifact_exists"],
            reviewRequired: s.reviewRequired ?? false,
            trusted: s.trusted ?? false,
          }),
          String(s.riskLevel ?? "low"), String(s.sourceHash), 1, now, now,
        );
      }
      this.setPackStatus(pack.id, "ACTIVE", actor, `restored version ${previousActive.version} (${previousActive.resolved_commit.slice(0, 12)})`);
      db.prepare("INSERT INTO esk_pack_versions (id, pack_id, version, resolved_commit, manifest_hash, lifecycle_status, skills_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(`eskver_${randomUUID().slice(0, 16)}`, pack.id, pack.version, pack.resolvedCommit, previousActive.manifest_hash, "ROLLED_BACK", "[]", `rollback to ${previousActive.version}: ${reason}`, new Date().toISOString());
    }
    this.audit("skill.pack.rollback", actor, { packId: pack.id, reason, restored: previousActive?.version ?? null });
    return this.getPack(pack.id)!;
  }

  setPackEnabled(packIdOrName: string, enabled: boolean, actor = "operator"): PackRecord {
    const pack = this.getPack(packIdOrName);
    if (!pack) throw new EngineeringSkillsError("PACK_NOT_FOUND", 404, `pack '${packIdOrName}' is not registered`);
    const db = openAgentOsDb();
    db.run("UPDATE esk_packs SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, new Date().toISOString(), pack.id]);
    this.audit(enabled ? "skill.pack.promoted" : "skill.pack.disabled", actor, { packId: pack.id, enabled });
    return this.getPack(pack.id)!;
  }

  setSkillEnabled(skillId: string, enabled: boolean, actor = "operator"): NormalizedSkill {
    const db = openAgentOsDb();
    const row = db.query("SELECT id FROM esk_skills WHERE id = ? LIMIT 1").get(skillId) as { id: string } | undefined;
    if (!row) throw new EngineeringSkillsError("SKILL_NOT_FOUND", 404, `skill '${skillId}' is not registered`);
    db.run("UPDATE esk_skills SET enabled = ?, updated_at = ? WHERE id = ?", [enabled ? 1 : 0, new Date().toISOString(), skillId]);
    const skill = this.getSkill(skillId);
    if (!skill) throw new EngineeringSkillsError("SKILL_NOT_FOUND", 404, `skill '${skillId}' vanished during update`);
    return skill;
  }

  getPack(idOrName: string): PackRecord | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM esk_packs WHERE id = ? OR name = ? ORDER BY created_at DESC LIMIT 1").get(idOrName, idOrName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToPack(row);
  }

  listPacks(filter?: { lifecycleStatus?: string; enabled?: boolean }): PackRecord[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM esk_packs ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    let packs = rows.map((r) => this.rowToPack(r));
    if (filter?.lifecycleStatus) packs = packs.filter((p) => p.lifecycleStatus === filter.lifecycleStatus);
    if (filter?.enabled !== undefined) packs = packs.filter((p) => p.enabled === filter.enabled);
    return packs;
  }

  listPackVersions(packId: string): PackVersionRecord[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT id, pack_id, version, resolved_commit, manifest_hash, lifecycle_status, created_at FROM esk_pack_versions WHERE pack_id = ? ORDER BY created_at DESC").all(packId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      packId: String(r.pack_id),
      version: String(r.version),
      resolvedCommit: String(r.resolved_commit),
      manifestHash: String(r.manifest_hash),
      lifecycleStatus: String(r.lifecycle_status),
      createdAt: String(r.created_at),
    }));
  }

  listSkills(packId?: string, filter?: { enabledOnly?: boolean }): NormalizedSkill[] {
    const db = openAgentOsDb();
    const rows = (packId
      ? db.query("SELECT * FROM esk_skills WHERE pack_id = ? ORDER BY slug").all(packId)
      : db.query("SELECT * FROM esk_skills ORDER BY pack_id, slug").all()) as Array<Record<string, unknown>>;
    const skills = rows.map((r) => this.rowToSkill(r));
    return filter?.enabledOnly ? skills.filter((s) => s.enabled) : skills;
  }

  getSkill(idOrSlug: string): NormalizedSkill | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM esk_skills WHERE id = ? OR slug = ? ORDER BY created_at DESC LIMIT 1").get(idOrSlug, idOrSlug) as Record<string, unknown> | undefined;
    return row ? this.rowToSkill(row) : null;
  }

  /** Capability-expansion detection (source §33): compare inferred vs previous snapshot. */
  detectCapabilityExpansion(packId: string, previousSnapshotJson: string | null): string[] {
    if (!previousSnapshotJson) return [];
    const previous = JSON.parse(previousSnapshotJson) as NormalizedSkill[];
    return compareCapabilityProfiles(previous, this.listSkills(packId));
  }

  private setPackStatus(packId: string, status: PackLifecycleStatus, actor: string, note: string): void {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    db.run("UPDATE esk_packs SET lifecycle_status = ?, enabled = ?, updated_at = ? WHERE id = ?", [status, status === "ACTIVE" ? 1 : 0, now, packId]);
    const pack = this.getPack(packId);
    if (pack) {
      const skills = this.listSkills(packId);
      db.prepare("INSERT INTO esk_pack_versions (id, pack_id, version, resolved_commit, manifest_hash, lifecycle_status, skills_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(`eskver_${randomUUID().slice(0, 16)}`, packId, pack.version, pack.resolvedCommit, pack.manifestHash, status, JSON.stringify(skills), note, now);
    }
    void actor;
  }

  private rowToPack(row: Record<string, unknown>): PackRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      sourceUrl: row.source_url === null ? null : String(row.source_url),
      sourceType: String(row.source_type),
      version: row.version === null ? null : String(row.version),
      resolvedCommit: String(row.resolved_commit),
      license: row.license === null ? null : String(row.license),
      trustStatus: String(row.trust_status),
      lifecycleStatus: String(row.lifecycle_status) as PackLifecycleStatus,
      manifestHash: String(row.manifest_hash),
      enabled: Number(row.enabled) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToSkill(row: Record<string, unknown>): NormalizedSkill {
    const caps = JSON.parse(String(row.capabilities_json ?? "{}")) as { declared?: string[]; inferred?: string[] };
    const meta = JSON.parse(String(row.meta_json ?? "{}")) as {
      references?: string[]; compatibleProviders?: string[]; verificationRules?: string[]; reviewRequired?: boolean; trusted?: boolean;
    };
    return {
      id: String(row.id),
      packId: String(row.pack_id),
      slug: String(row.slug),
      name: String(row.name),
      description: String(row.description ?? ""),
      lifecycleStages: JSON.parse(String(row.lifecycle_stage_json ?? "[]")) as LifecycleStage[],
      triggers: JSON.parse(String(row.triggers_json ?? "{}")) as NormalizedSkill["triggers"],
      declaredCapabilities: caps.declared ?? [],
      inferredCapabilities: caps.inferred ?? [],
      permissions: JSON.parse(String(row.permissions_json ?? "{}")) as NormalizedSkill["permissions"],
      riskLevel: String(row.risk_level) as RiskLevel,
      entrypoint: String(row.entrypoint),
      references: meta.references ?? [],
      compatibleProviders: meta.compatibleProviders ?? [],
      verificationRules: meta.verificationRules ?? ["artifact_exists"],
      reviewRequired: meta.reviewRequired ?? false,
      sourceHash: String(row.source_hash),
      trusted: meta.trusted ?? false,
      enabled: Number(row.enabled) === 1,
    };
  }

  audit(event: EngineeringSkillsAuditEvent, actor: string, details: Record<string, unknown>): void {
    try {
      const db = openAgentOsDb();
      db.run(
        "INSERT INTO esk_audit (id, event_type, actor, pack_id, skill_id, workflow_id, operation, result, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`eska_${randomUUID().slice(0, 16)}`, event, actor, null, null, null, event, "ok", JSON.stringify(details), new Date().toISOString()],
      );
    } catch {
      // Audit persistence is best-effort at seed time; runtime paths rethrow via callers.
    }
  }

  /** Seed the built-in pao-core pack (idempotent). Our own content — not vendored upstream. */
  ensureSeeded(): void {
    if (this.seeded) return;
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM esk_packs WHERE name = 'pao-core' LIMIT 1").get();
    if (existing) {
      this.seeded = true;
      return;
    }
    this.importPack({ name: "pao-core", sourceType: "inline", version: "1.0.0", license: "MIT", skills: PAO_CORE_SKILLS, note: "built-in Pao engineering lifecycle seed" }, "system");
    this.seeded = true;
  }
}

/** Trusted-seed permission profile: safe allowlists for the built-in pack. */
function safeCorePermissions(): Partial<Record<PermissionClass, PermissionTier>> {
  return {
    "filesystem.read": "project",
    "filesystem.write": "selected",
    "shell.execute": "safe_allowlist",
    "network.outbound": "allowlist",
    "browser.control": "isolated",
    "secrets.use": "denied",
    "git.write": "branch_write",
    "deployment.execute": "denied",
  };
}

/**
 * Built-in pao-core seed (Phase 20.91b §11.5 default lifecycle mapping, condensed).
 * Triggers/permissions are OUR metadata — the router's deterministic matching inputs.
 */
export const PAO_CORE_SKILLS: SkillDefinitionInput[] = [
  { slug: "spec-driven-development", name: "Spec-Driven Development", description: "Produce a spec with objective, scope, non-goals, acceptance criteria before any code.", lifecycleStages: ["define"], triggers: { intents: ["new_feature", "new_project", "significant_change"], keywords: ["spec", "prd", "requirements", "feature"] }, permissions: { "filesystem.write": "docs_only", "shell.execute": "denied" }, riskLevel: "low", verificationRules: ["artifact_exists", "acceptance_criteria_present"], capabilities: ["read_repository", "write_document"] },
  { slug: "planning-and-task-breakdown", name: "Planning and Task Breakdown", description: "Break the spec into atomic ordered tasks with identified risky operations and rollback strategy.", lifecycleStages: ["plan"], triggers: { intents: ["implement"], keywords: ["plan", "breakdown", "tasks", "implement"] }, permissions: { "filesystem.write": "docs_only", "shell.execute": "denied" }, riskLevel: "low", verificationRules: ["artifact_exists"] },
  { slug: "api-and-interface-design", name: "API and Interface Design", description: "Design endpoints/contracts before implementation.", lifecycleStages: ["build"], triggers: { intents: ["implement"], keywords: ["api", "endpoint", "interface", "contract", "login", "auth"] }, permissions: safeCorePermissions(), riskLevel: "medium" },
  { slug: "frontend-ui-engineering", name: "Frontend UI Engineering", description: "Implement UI changes with clean hierarchy and states.", lifecycleStages: ["build"], triggers: { intents: ["implement"], keywords: ["ui", "frontend", "button", "page", "label", "css", "dashboard"] }, permissions: safeCorePermissions(), riskLevel: "low" },
  { slug: "security-and-hardening", name: "Security and Hardening", description: "Threat-check authentication, secrets, input, and network surfaces.", lifecycleStages: ["build", "review"], triggers: { intents: ["implement", "review"], keywords: ["security", "auth", "authentication", "login", "oauth", "token", "secret", "permission"] }, permissions: { "filesystem.read": "project", "filesystem.write": "selected", "shell.execute": "denied", "secrets.use": "denied" }, riskLevel: "high", reviewRequired: true },
  { slug: "test-driven-development", name: "Test-Driven Development", description: "Write failing test first; implement until green; no done-claim without test evidence.", lifecycleStages: ["build", "verify"], triggers: { intents: ["implement", "fix"], keywords: ["test", "tdd", "fix", "bug", "regression"] }, permissions: safeCorePermissions(), riskLevel: "medium", verificationRules: ["test_result"] },
  { slug: "incremental-implementation", name: "Incremental Implementation", description: "Small verifiable slices; run checks after each slice.", lifecycleStages: ["build"], triggers: { intents: ["implement"], keywords: ["implement", "build", "change"] }, permissions: safeCorePermissions(), riskLevel: "medium" },
  { slug: "debugging-and-error-recovery", name: "Debugging and Error Recovery", description: "Reproduce, isolate, fix from evidence — never guess.", lifecycleStages: ["verify"], triggers: { intents: ["fix"], keywords: ["debug", "error", "failure", "broken", "crash"] }, permissions: safeCorePermissions(), riskLevel: "medium" },
  { slug: "browser-testing-with-devtools", name: "Browser Testing with DevTools", description: "Verify runtime behavior through the controlled browser plane.", lifecycleStages: ["verify"], triggers: { intents: ["verify"], keywords: ["browser", "e2e", "devtools", "screenshot", "runtime"] }, permissions: { "filesystem.read": "project", "browser.control": "isolated", "shell.execute": "denied" }, riskLevel: "medium", verificationRules: ["browser_runtime"] },
  { slug: "code-review-and-quality", name: "Code Review and Quality", description: "Independent review of diff against spec and constraints.", lifecycleStages: ["review"], triggers: { intents: ["review"], keywords: ["review", "quality", "refactor"] }, permissions: { "filesystem.read": "project", "shell.execute": "denied" }, riskLevel: "low", reviewRequired: true },
  { slug: "performance-optimization", name: "Performance Optimization", description: "Measured performance work — budgets before changes.", lifecycleStages: ["review"], triggers: { intents: ["review", "optimize"], keywords: ["performance", "perf", "webperf", "lighthouse", "bundle", "slow"] }, permissions: { "filesystem.read": "project", "shell.execute": "safe_allowlist" }, riskLevel: "medium" },
  { slug: "documentation-and-adrs", name: "Documentation and ADRs", description: "Update docs and record architecture decisions.", lifecycleStages: ["ship"], triggers: { intents: ["document"], keywords: ["readme", "docs", "documentation", "adr"] }, permissions: { "filesystem.write": "docs_only", "shell.execute": "denied" }, riskLevel: "low" },
  { slug: "shipping-and-launch", name: "Shipping and Launch", description: "Staged observable shipping with recorded rollback target; production needs human approval.", lifecycleStages: ["ship"], triggers: { intents: ["ship"], keywords: ["deploy", "release", "ship", "production", "launch"] }, permissions: { "filesystem.read": "project", "git.write": "commit", "deployment.execute": "production_with_approval", "shell.execute": "guarded" }, riskLevel: "critical", verificationRules: ["deployment_result", "health_check"], reviewRequired: true },
];

let singleton: SkillPackRegistry | null = null;

export function getEngineeringSkillRegistry(): SkillPackRegistry {
  if (!singleton) {
    singleton = new SkillPackRegistry();
    singleton.ensureSeeded();
  }
  return singleton;
}

export { STAGE_ORDER };
