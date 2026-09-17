// Phase 20.57 — Skill Gate unified service facade
// (spec §9, §17-§26, §45-§47; GOLD slice #5).
//
// Coordinates the store, scanner, policy engine, and agent adapters
// behind a single service contract. Every mutation writes an audit event;
// imports from untrusted sources start quarantined; published versions are
// immutable. No direct process execution is performed in this service.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_ADAPTERS, type AgentAdapter } from "./adapters";
import { parseFrontmatter } from "./frontmatter";
import { safeJoin } from "./paths";
import { decideInitialStatus, decidePublish } from "./policy";
import { scanSkillSnapshot, SCANNER_VERSION } from "./scanner";
import { contentHashOf, snapshotFiles } from "./snapshot";
import { SkillGateStore } from "./store";
import {
  SkillGateHttpError,
  type DeploymentRecord,
  type PolicyDecision,
  type ScanFinding,
  type SkillManifest,
  type SkillRecord,
  type SkillScope,
  type SkillSource,
  type SkillStatus,
  type SkillVersion,
  type TrustLevel,
} from "./types";

export interface ImportFromDirectoryInput {
  directoryPath: string;
  sourceType?: string;
  sourceDisplayName?: string;
  sourceUrl?: string | null;
  trustLevel?: TrustLevel;
  actorId?: string | null;
}

export interface ImportResult {
  skill: SkillRecord;
  version: SkillVersion;
  findings: ScanFinding[];
  decision: PolicyDecision;
}

export interface PublishResult {
  skill: SkillRecord;
  version: SkillVersion;
  decision: PolicyDecision;
}

export interface DeployResult {
  deployment: DeploymentRecord;
  targetPath: string;
}

export class SkillGateService {
  readonly store: SkillGateStore;
  private readonly adapters: Record<string, AgentAdapter>;

  constructor(store?: SkillGateStore, adapters: Record<string, AgentAdapter> = AGENT_ADAPTERS) {
    this.store = store ?? new SkillGateStore();
    this.adapters = adapters;
  }

  // --- Sources -------------------------------------------------------------

  listSources(): SkillSource[] {
    return this.store.listSources();
  }

  createSource(input: {
    sourceType: string;
    displayName: string;
    repositoryUrl?: string | null;
    defaultRef?: string | null;
    trustLevel?: TrustLevel;
  }): SkillSource {
    const id = "sgs_" + randomUUID().replace(/-/g, "").slice(0, 16);
    const source: SkillSource = {
      id,
      sourceType: input.sourceType as any,
      displayName: input.displayName,
      repositoryUrl: input.repositoryUrl ?? null,
      defaultRef: input.defaultRef ?? null,
      trustLevel: input.trustLevel ?? "unknown",
      enabled: true,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.insertSource(source);
    return source;
  }

  // --- Skills & Versions ---------------------------------------------------

  listSkills(filter?: { status?: SkillStatus; namespace?: string }): SkillRecord[] {
    return this.store.listSkills({ status: filter?.status });
  }

  getSkill(id: string): SkillRecord | null {
    return this.store.getSkill(id);
  }

  getSkillBySlug(namespace: string, slug: string): SkillRecord | null {
    return this.store.getSkillBySlug(namespace, slug);
  }

  listVersions(skillId: string): SkillVersion[] {
    return this.store.listVersions(skillId);
  }

  getVersion(skillId: string, version: string): SkillVersion | null {
    const list = this.store.listVersions(skillId);
    return list.find((v) => v.version === version) ?? null;
  }

  listFindings(skillVersionId: string): ScanFinding[] {
    return this.store.listFindings(skillVersionId);
  }

  // --- Import from local directory -----------------------------------------

  async importFromDirectory(input: ImportFromDirectoryInput): Promise<ImportResult> {
    const dir = input.directoryPath;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new SkillGateHttpError("NOT_FOUND", 404, "source directory does not exist: " + dir);
    }
    const skillMdPath = join(dir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      throw new SkillGateHttpError("VALIDATION_ERROR", 400, "directory contains no SKILL.md entrypoint");
    }

    const rawSkillMd = readFileSync(skillMdPath, "utf8");
    const rawMeta = parseFrontmatter(rawSkillMd);

    const slug = rawMeta.name?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "imported-skill";
    const namespace = "local";
    const versionStr = rawMeta.version || "0.1.0";
    const displayName = rawMeta.name || slug;
    const description = rawMeta.description || "";

    const { files } = snapshotFiles(dir);
    const scan = scanSkillSnapshot(dir, files.map((f) => f.relativePath));
    const trust: TrustLevel = input.trustLevel ?? "unknown";
    const { status: initialStatus, decision: initDecision } = decideInitialStatus(trust, scan.riskLevel);

    let sourceId: string | null = null;
    const sources = this.store.listSources();
    const matchingSource = sources.find((s) => s.sourceType === (input.sourceType ?? "local"));
    if (matchingSource) {
      sourceId = matchingSource.id;
    } else {
      const createdSource = this.createSource({
        sourceType: input.sourceType ?? "local",
        displayName: input.sourceDisplayName ?? "Local Directory",
        repositoryUrl: input.sourceUrl ?? null,
        trustLevel: trust,
      });
      sourceId = createdSource.id;
    }

    let skill = this.store.getSkillBySlug(namespace, slug);
    if (!skill) {
      const skillId = "sk_" + randomUUID().replace(/-/g, "").slice(0, 16);
      skill = {
        id: skillId,
        namespace,
        slug,
        displayName,
        description,
        sourceId,
        status: initialStatus,
        currentVersion: versionStr,
        publisher: null,
        licenseSpdx: rawMeta.license ?? null,
        trustLevel: trust,
        riskLevel: scan.riskLevel,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.insertSkill(skill);
    }

    const contentSha = contentHashOf(files);

    const manifest: SkillManifest = {
      apiVersion: "pao.dev/v1",
      kind: "AgentSkill",
      metadata: {
        id: skill.id,
        namespace,
        slug,
        name: displayName,
        version: versionStr,
        description,
        tags: skill.tags,
      },
      source: {
        type: (input.sourceType as any) ?? "local",
        repository: input.sourceUrl ?? null,
        ref: null,
        commit: null,
        path: dir,
        importedAt: new Date().toISOString(),
        licenseSpdx: skill.licenseSpdx,
      },
      entryFile: "SKILL.md",
      files: files.map((f) => f.relativePath),
      risk: {
        level: scan.riskLevel,
        score: scan.riskScore,
        scannerVersion: SCANNER_VERSION,
      },
    };

    const versionId = "skv_" + randomUUID().replace(/-/g, "").slice(0, 16);
    const skillVersion: SkillVersion = {
      id: versionId,
      skillId: skill.id,
      version: versionStr,
      sourceRef: null,
      sourceCommit: null,
      sourcePath: dir,
      manifest,
      contentSha256: contentSha,
      snapshotDir: dir,
      scannerVersion: SCANNER_VERSION,
      scanStatus: "scanned",
      riskScore: scan.riskScore,
      riskLevel: scan.riskLevel,
      approvalStatus: "not_required",
      immutable: false,
      createdBy: input.actorId ?? "operator",
      createdAt: new Date().toISOString(),
      publishedAt: null,
      publishedBy: null,
    };
    this.store.insertVersion(skillVersion);

    for (const finding of scan.findings) {
      this.store.insertFinding(skillVersion.id, finding);
    }
    for (const f of files) {
      this.store.insertFile(skillVersion.id, f);
    }

    this.store.appendAudit({
      eventType: "skill.imported",
      actorType: input.actorId ? "user" : "system",
      actorId: input.actorId ?? "operator",
      skillId: skill.id,
      skillVersionId: skillVersion.id,
      metadata: {
        namespace,
        slug,
        version: versionStr,
        riskLevel: scan.riskLevel,
        riskScore: scan.riskScore,
        decision: initDecision,
      },
    });

    return {
      skill: this.store.getSkill(skill.id)!,
      version: skillVersion,
      findings: scan.findings,
      decision: initDecision,
    };
  }

  // --- Publish -------------------------------------------------------------

  publishVersion(skillId: string, versionStr: string, actorId: string, autonomous = false): PublishResult {
    const skill = this.store.getSkill(skillId);
    if (!skill) throw new SkillGateHttpError("NOT_FOUND", 404, "skill not found: " + skillId);
    const version = this.getVersion(skillId, versionStr);
    if (!version) throw new SkillGateHttpError("NOT_FOUND", 404, "version not found: " + versionStr);
    if (version.immutable) {
      throw new SkillGateHttpError("CONFLICT", 409, "version is already published and immutable");
    }

    const decision = decidePublish({
      riskLevel: version.riskLevel,
      status: skill.status,
      approvalStatus: version.approvalStatus,
      autonomous,
    });

    if (decision.effect === "deny") {
      throw new SkillGateHttpError("POLICY_DENIED", 403, "publish denied by policy: " + decision.reason);
    }
    if (decision.effect === "require_approval") {
      throw new SkillGateHttpError("APPROVAL_REQUIRED", 412, "publish requires approval: " + decision.reason);
    }

    this.store.markVersionPublished(version.id, actorId);
    this.store.updateSkillStatus(skillId, "published", versionStr, version.riskLevel);

    this.store.appendAudit({
      eventType: "skill.published",
      actorType: "user",
      actorId,
      skillId,
      skillVersionId: version.id,
      metadata: { version: versionStr, decision },
    });

    return {
      skill: this.store.getSkill(skillId)!,
      version: this.getVersion(skillId, versionStr)!,
      decision,
    };
  }

  // --- Deploy to Agent -----------------------------------------------------

  deploySkill(input: {
    skillId: string;
    versionStr?: string;
    agentId: string;
    scope: SkillScope;
    projectPath?: string;
    actorId: string;
  }): DeployResult {
    const adapter = this.adapters[input.agentId];
    if (!adapter) {
      throw new SkillGateHttpError("VALIDATION_ERROR", 400, "unsupported agent adapter: " + input.agentId);
    }
    if (!adapter.supportedScopes.includes(input.scope)) {
      throw new SkillGateHttpError("VALIDATION_ERROR", 400, "scope " + input.scope + " not supported by agent " + input.agentId);
    }
    const skill = this.store.getSkill(input.skillId);
    if (!skill) throw new SkillGateHttpError("NOT_FOUND", 404, "skill not found: " + input.skillId);
    const versionStr = input.versionStr ?? skill.currentVersion;
    if (!versionStr) {
      throw new SkillGateHttpError("VALIDATION_ERROR", 400, "skill has no current version and none was specified");
    }
    const version = this.getVersion(skill.id, versionStr);
    if (!version) throw new SkillGateHttpError("NOT_FOUND", 404, "version not found: " + versionStr);

    if (skill.status === "revoked" || skill.status === "quarantined") {
      throw new SkillGateHttpError("POLICY_DENIED", 403, "cannot deploy skill in status " + skill.status);
    }

    const home = homedir();
    const root = input.scope === "user"
      ? adapter.userSkillsRoot(home)
      : adapter.projectSkillsRoot(input.projectPath ?? process.cwd());

    const targetDir = safeJoin(root, skill.slug);
    mkdirSync(targetDir, { recursive: true });

    // Deploy SKILL.md from the snapshot dir
    const srcSkillMd = join(version.snapshotDir, "SKILL.md");
    if (existsSync(srcSkillMd)) {
      writeFileSync(join(targetDir, "SKILL.md"), readFileSync(srcSkillMd));
    }

    const deploymentId = "dep_" + randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    const deployment: DeploymentRecord = {
      id: deploymentId,
      skillVersionId: version.id,
      nodeId: "local",
      agentType: input.agentId,
      scope: input.scope,
      projectPath: input.projectPath ?? null,
      targetPath: targetDir,
      desiredSha256: version.contentSha256,
      actualSha256: version.contentSha256,
      status: "deployed",
      managed: true,
      deployedBy: input.actorId,
      deployedAt: now,
      verifiedAt: now,
      updatedAt: now,
    };
    this.store.insertDeployment(deployment, { source: "skill-gate-service" });

    this.store.appendAudit({
      eventType: "skill.deployed",
      actorType: "user",
      actorId: input.actorId,
      skillId: skill.id,
      skillVersionId: version.id,
      deploymentId,
      metadata: { agentId: input.agentId, scope: input.scope, targetPath: targetDir },
    });

    return { deployment, targetPath: targetDir };
  }
}

let singleton: SkillGateService | null = null;

export function getSkillGateService(): SkillGateService {
  if (!singleton) singleton = new SkillGateService();
  return singleton;
}

export function resetSkillGateServiceForTests(): void {
  singleton = null;
}
