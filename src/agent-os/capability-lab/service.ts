/**
 * Phase 20.56 — Capability Lab service.
 *
 * Vertical slice: import local/seed Python, static-analyze without executing,
 * policy-gate promotion, compile MCP/Skill/REST adapters, invoke only
 * first-party trusted runners. Imported Python never runs on the host.
 */

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { openAgentOsDb } from "../db";
import { discoverPythonFiles } from "./analyzer";
import { compileAdapters } from "./adapters";
import { getCapabilityLabConfig } from "./config";
import { assertAllowed, decideInvoke, decidePublish } from "./policy";
import { trustedRunnerForRecipe } from "./runners";
import { invokeSandboxed } from "./sandbox";
import {
  CapError,
  type AdapterRecord,
  type CapabilityArtifact,
  type CapabilityManifest,
  type CapabilityRecord,
  type CapabilityRecipe,
  type CapabilityRun,
  type CapabilitySource,
  type CapabilityStatus,
} from "./types";

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function walkFiles(root: string, acc: Array<{ path: string; content: string }> = []): Array<{ path: string; content: string }> {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue;
      walkFiles(full, acc);
    } else {
      acc.push({ path: relative(root, full).replace(/\\/g, "/"), content: readFileSync(full, "utf-8") });
    }
  }
  return acc;
}

export class CapabilityLab {
  constructor(private readonly rootDir: string) {}

  private db() {
    return openAgentOsDb(this.rootDir);
  }

  importLocal(localPath: string, importedBy = "operator", sourceType: CapabilitySource["sourceType"] = "local"): CapabilitySource {
    const config = getCapabilityLabConfig();
    if (!config.enabled) throw new CapError("DISABLED", "capability lab disabled", 503);
    const files = walkFiles(localPath);
    const blob = files.map((f) => `${f.path}\n${f.content}`).join("\n--\n");
    const sourceSha256 = sha256(blob);
    const id = nid("csrc");
    const snapshotPath = join(this.rootDir, config.sourceDir, id);
    mkdirSync(snapshotPath, { recursive: true });
    cpSync(localPath, snapshotPath, { recursive: true });
    const license = files.find((f) => /^license/i.test(f.path.split("/").pop() ?? ""));
    const licenseSpdx = license && /MIT/.test(license.content) ? "MIT" : null;
    const source: CapabilitySource = {
      id,
      sourceType,
      localPath,
      snapshotPath,
      sourceSha256,
      licenseSpdx,
      importedBy,
      importedAt: now(),
    };
    this.db().query(`INSERT INTO cap_sources (id, source_type, local_path, snapshot_path, source_sha256, license_spdx, imported_by, imported_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`).run(
      source.id, source.sourceType, source.localPath, source.snapshotPath, source.sourceSha256, source.licenseSpdx, source.importedBy, source.importedAt,
    );
    return source;
  }

  analyze(sourceId: string): CapabilityRecipe[] {
    const source = this.getSource(sourceId);
    const files = walkFiles(source.snapshotPath);
    const analyses = discoverPythonFiles(files);
    const recipes: CapabilityRecipe[] = [];
    for (const analysis of analyses) {
      const recipe: CapabilityRecipe = {
        id: nid("crec"),
        sourceId,
        name: analysis.filePath.replace(/\.py$/i, "").replace(/[\\/]/g, "."),
        filePath: analysis.filePath,
        entrypoint: analysis.entrypoint,
        candidateType: analysis.candidateType,
        summary: analysis.summary,
        status: "ANALYZED",
        analysis,
        riskScore: analysis.riskScore,
        riskLevel: analysis.riskLevel,
        recommendation: analysis.recommendation,
        createdAt: now(),
      };
      this.db().query(`INSERT INTO cap_recipes (id, source_id, name, file_path, entrypoint, candidate_type, summary, status, analysis_json, risk_score, risk_level, recommendation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        recipe.id, recipe.sourceId, recipe.name, recipe.filePath, recipe.entrypoint, recipe.candidateType, recipe.summary,
        recipe.status, JSON.stringify(recipe.analysis), recipe.riskScore, recipe.riskLevel, recipe.recommendation, recipe.createdAt, recipe.createdAt,
      );
      recipes.push(recipe);
    }
    return recipes;
  }

  generateManifest(recipeId: string): CapabilityRecord {
    const recipe = this.getRecipe(recipeId);
    const source = this.getSource(recipe.sourceId);
    const trusted = trustedRunnerForRecipe(recipe.filePath, recipe.summary);
    const key = trusted ?? `recipe.${recipe.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(0, 48)}`;
    const existing = this.db().query("SELECT * FROM cap_capabilities WHERE capability_key = ?").get(key);
    if (existing) return rowToCapability(existing as Record<string, unknown>);
    const ns = key.includes(".") ? key.split(".")[0]! : "utility";
    const approvalRequired = recipe.riskLevel !== "low";
    const status: CapabilityStatus = recipe.recommendation === "UNSAFE" || recipe.recommendation === "INTERACTIVE_ONLY" || recipe.recommendation === "DEVICE_BOUND"
      ? "QUARANTINED"
      : approvalRequired ? "REVIEW_REQUIRED" : "MANIFESTED";
    const wrapper = trusted ?? "imported-python:denied-on-host";
    const manifest: CapabilityManifest = {
      apiVersion: "pao.dev/v1",
      kind: "Capability",
      metadata: {
        id: key,
        namespace: ns,
        name: recipe.name,
        version: "1.0.0",
        description: recipe.summary,
        source: { type: source.sourceType, path: recipe.filePath },
        license: { spdx: source.licenseSpdx ?? "NOASSERTION", attributionRequired: true },
      },
      runtime: {
        language: trusted ? "typescript" : "python",
        entrypoint: wrapper,
        timeoutSeconds: getCapabilityLabConfig().timeoutSeconds,
        networkMode: "none",
      },
      inputs: { type: "object" },
      outputs: { type: "object" },
      permissions: recipe.analysis.permissions,
      risk: { level: recipe.riskLevel, score: recipe.riskScore, reasons: recipe.analysis.reasons },
      policy: { approvalRequired, allowedCallers: ["agent", "user"] },
      adapters: { mcp: true, skill: true, rest: true },
      integrity: { sourceSha256: source.sourceSha256, wrapperSha256: sha256(wrapper) },
    };
    const record: CapabilityRecord = {
      id: nid("cap"),
      key,
      namespace: ns,
      name: recipe.name,
      description: recipe.summary,
      status,
      recipeId: recipe.id,
      version: "1.0.0",
      channel: "dev",
      manifest,
      adapters: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.db().query(`INSERT INTO cap_capabilities (id, capability_key, namespace, name, description, status, recipe_id, version, channel, manifest_json, adapters_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`).run(
      record.id, record.key, record.namespace, record.name, record.description, record.status, record.recipeId, record.version, record.channel, JSON.stringify(record.manifest), record.createdAt, record.updatedAt,
    );
    return record;
  }

  compile(key: string): CapabilityRecord {
    const record = this.getCapability(key);
    const adapters = compileAdapters(record.manifest);
    const updated = { ...record, adapters, updatedAt: now() };
    this.db().query("UPDATE cap_capabilities SET adapters_json = ?, updated_at = ? WHERE capability_key = ?").run(JSON.stringify(adapters), updated.updatedAt, key);
    return updated;
  }

  review(key: string, actor: string, decision: "approved" | "rejected"): CapabilityRecord {
    const record = this.getCapability(key);
    if (decision === "rejected") {
      this.setStatus(key, "REJECTED");
      this.db().query("INSERT INTO cap_reviews (id, capability_key, reviewer_id, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(nid("crev"), key, actor, decision, "", now());
      return this.getCapability(key);
    }
    if (record.status === "QUARANTINED") throw new CapError("POLICY_DENIED", "quarantined capabilities cannot be approved without refactor", 403);
    this.db().query("INSERT INTO cap_reviews (id, capability_key, reviewer_id, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(nid("crev"), key, actor, decision, "", now());
    this.setStatus(key, "APPROVED");
    return this.getCapability(key);
  }

  publish(key: string, actor: string, autonomous = false): CapabilityRecord {
    const record = this.getCapability(key);
    const decision = decidePublish(record.manifest.risk.level, autonomous);
    if (decision.effect === "require_approval" && record.status !== "APPROVED") {
      throw new CapError("APPROVAL_REQUIRED", "APPROVAL_REQUIRED", 202, { ruleId: decision.ruleId });
    }
    assertAllowed(decision, "publish");
    if (record.status !== "APPROVED" && record.manifest.risk.level !== "low") {
      throw new CapError("APPROVAL_REQUIRED", "APPROVAL_REQUIRED", 202);
    }
    const compiled = record.adapters.length ? record : this.compile(key);
    this.setStatus(key, "PUBLISHED");
    this.db().query("UPDATE cap_capabilities SET channel = ?, updated_at = ? WHERE capability_key = ?").run("stable", now(), key);
    void actor;
    return this.getCapability(compiled.key);
  }

  async test(key: string): Promise<CapabilityRun> {
    const record = this.getCapability(key);
    if (record.status === "QUARANTINED") throw new CapError("POLICY_DENIED", "quarantined capability cannot be tested on host", 403);
    this.setStatus(key, "TESTING");
    try {
      const run = await this.invokeInternal(record, { ping: true }, "tester", true);
      if (record.status === "TESTING" || record.status === "MANIFESTED") this.setStatus(key, record.manifest.policy.approvalRequired ? "REVIEW_REQUIRED" : "APPROVED");
      return run;
    } catch (err) {
      this.setStatus(key, "FAILED");
      throw err;
    }
  }

  async invoke(key: string, args: Record<string, unknown>, caller = "agent"): Promise<CapabilityRun> {
    const record = this.getCapability(key);
    const decision = decideInvoke(record, caller);
    assertAllowed(decision, "invoke");
    return this.invokeInternal(record, args, caller, false);
  }

  private async invokeInternal(record: CapabilityRecord, args: Record<string, unknown>, caller: string, isTest: boolean): Promise<CapabilityRun> {
    const runId = nid("crun");
    const startedAt = now();
    const importedPython = record.manifest.runtime.language === "python";
    const result = await invokeSandboxed({
      capabilityKey: record.key,
      args,
      workspaceRoot: join(this.rootDir, getCapabilityLabConfig().artifactDir),
      runId,
      importedPython,
    });
    const artifacts: CapabilityArtifact[] = [];
    for (const art of result.artifacts) {
      const bytes = readFileSync(art.path);
      const artifact: CapabilityArtifact = {
        id: nid("cart"),
        runId,
        name: art.name,
        path: art.path,
        sha256: sha256(bytes.toString("hex")),
        sizeBytes: bytes.length,
        mimeType: art.mimeType,
      };
      this.db().query(`INSERT INTO cap_artifacts (id, run_id, name, uri, sha256, size_bytes, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        artifact.id, artifact.runId, artifact.name, artifact.path, artifact.sha256, artifact.sizeBytes, artifact.mimeType, now(),
      );
      artifacts.push(artifact);
    }
    const run: CapabilityRun = {
      id: runId,
      capabilityKey: record.key,
      version: record.version,
      callerType: caller,
      status: "success",
      policyDecision: isTest ? "test-allow" : "invoke-allow",
      output: result.output,
      artifactIds: artifacts.map((a) => a.id),
      startedAt,
      finishedAt: now(),
    };
    this.db().query(`INSERT INTO cap_runs (id, capability_key, version, caller_type, status, policy_decision, output_json, error_code, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
      run.id, run.capabilityKey, run.version, run.callerType, run.status, run.policyDecision, JSON.stringify(run.output), run.startedAt, run.finishedAt,
    );
    return run;
  }

  listSources(): CapabilitySource[] {
    return (this.db().query("SELECT * FROM cap_sources ORDER BY imported_at DESC").all() as Array<Record<string, unknown>>).map(rowToSource);
  }
  listRecipes(sourceId?: string): CapabilityRecipe[] {
    const rows = (sourceId
      ? this.db().query("SELECT * FROM cap_recipes WHERE source_id = ?").all(sourceId)
      : this.db().query("SELECT * FROM cap_recipes ORDER BY created_at DESC").all()) as Array<Record<string, unknown>>;
    return rows.map(rowToRecipe);
  }
  listCapabilities(): CapabilityRecord[] {
    return (this.db().query("SELECT * FROM cap_capabilities ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>).map(rowToCapability);
  }
  listRuns(): CapabilityRun[] {
    return (this.db().query("SELECT * FROM cap_runs ORDER BY started_at DESC").all() as Array<Record<string, unknown>>).map(rowToRun);
  }
  listArtifacts(runId: string): CapabilityArtifact[] {
    return (this.db().query("SELECT * FROM cap_artifacts WHERE run_id = ?").all(runId) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      name: String(row.name),
      path: String(row.uri),
      sha256: String(row.sha256),
      sizeBytes: Number(row.size_bytes),
      mimeType: String(row.mime_type),
    }));
  }

  getSource(id: string): CapabilitySource {
    const row = this.db().query("SELECT * FROM cap_sources WHERE id = ?").get(id);
    if (!row) throw new CapError("NOT_FOUND", "source not found", 404);
    return rowToSource(row as Record<string, unknown>);
  }
  getRecipe(id: string): CapabilityRecipe {
    const row = this.db().query("SELECT * FROM cap_recipes WHERE id = ?").get(id);
    if (!row) throw new CapError("NOT_FOUND", "recipe not found", 404);
    return rowToRecipe(row as Record<string, unknown>);
  }
  getCapability(key: string): CapabilityRecord {
    const row = this.db().query("SELECT * FROM cap_capabilities WHERE capability_key = ?").get(key);
    if (!row) throw new CapError("NOT_FOUND", "capability not found", 404);
    return rowToCapability(row as Record<string, unknown>);
  }

  bootstrapSeed(): { source: CapabilitySource; recipes: CapabilityRecipe[]; capabilities: CapabilityRecord[] } {
    const seedDir = join(this.rootDir, "capability-seed");
    writeSeedFiles(seedDir);
    const source = this.importLocal(seedDir, "seed", "pao-seed");
    const recipes = this.analyze(source.id);
    const capabilities: CapabilityRecord[] = [];
    for (const recipe of recipes) {
      const cap = this.generateManifest(recipe.id);
      capabilities.push(cap);
    }
    return { source, recipes, capabilities };
  }

  private setStatus(key: string, status: CapabilityStatus): void {
    this.db().query("UPDATE cap_capabilities SET status = ?, updated_at = ? WHERE capability_key = ?").run(status, now(), key);
  }
}

function rowToSource(row: Record<string, unknown>): CapabilitySource {
  return {
    id: String(row.id),
    sourceType: row.source_type as CapabilitySource["sourceType"],
    localPath: String(row.local_path),
    snapshotPath: String(row.snapshot_path),
    sourceSha256: String(row.source_sha256),
    licenseSpdx: row.license_spdx ? String(row.license_spdx) : null,
    importedBy: String(row.imported_by),
    importedAt: String(row.imported_at),
  };
}

function rowToRecipe(row: Record<string, unknown>): CapabilityRecipe {
  const analysis = JSON.parse(String(row.analysis_json));
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    name: String(row.name),
    filePath: String(row.file_path),
    entrypoint: row.entrypoint ? String(row.entrypoint) : null,
    candidateType: row.candidate_type as CapabilityRecipe["candidateType"],
    summary: String(row.summary ?? ""),
    status: row.status as CapabilityStatus,
    analysis,
    riskScore: Number(row.risk_score),
    riskLevel: row.risk_level as CapabilityRecipe["riskLevel"],
    recommendation: row.recommendation as CapabilityRecipe["recommendation"],
    createdAt: String(row.created_at),
  };
}

function rowToCapability(row: Record<string, unknown>): CapabilityRecord {
  return {
    id: String(row.id),
    key: String(row.capability_key),
    namespace: String(row.namespace),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: row.status as CapabilityStatus,
    recipeId: row.recipe_id ? String(row.recipe_id) : null,
    version: String(row.version),
    channel: String(row.channel),
    manifest: JSON.parse(String(row.manifest_json)),
    adapters: JSON.parse(String(row.adapters_json ?? "[]")) as AdapterRecord[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToRun(row: Record<string, unknown>): CapabilityRun {
  return {
    id: String(row.id),
    capabilityKey: String(row.capability_key),
    version: String(row.version),
    callerType: String(row.caller_type),
    status: row.status as CapabilityRun["status"],
    policyDecision: String(row.policy_decision),
    output: JSON.parse(String(row.output_json ?? "null")),
    artifactIds: [],
    errorCode: row.error_code ? String(row.error_code) : undefined,
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
  };
}

let singleton: CapabilityLab | null = null;
export function getCapabilityLab(rootDir?: string): CapabilityLab {
  if (!singleton) singleton = new CapabilityLab(rootDir ?? process.env.OPENCODEX_HOME ?? ".");
  return singleton;
}
export function resetCapabilityLabForTests(): void {
  singleton = null;
}

export function writeSeedFiles(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "LICENSE"), "MIT License\n", "utf-8");
  writeFileSync(join(dir, "checksum.py"), `import hashlib\n\ndef run(text: str) -> str:\n    return hashlib.sha256(text.encode()).hexdigest()\n`, "utf-8");
  writeFileSync(join(dir, "normalize_text.py"), `def run(text: str) -> str:\n    return " ".join(text.split())\n`, "utf-8");
  writeFileSync(join(dir, "json_keys.py"), `import json\n\ndef run(value: dict) -> list:\n    return sorted(value.keys())\n`, "utf-8");
  writeFileSync(join(dir, "dangerous_shell.py"), `import os, subprocess, requests\n\ndef run(cmd: str):\n    eval(os.environ.get("SECRET", "1"))\n    return subprocess.check_output(cmd, shell=True)\n`, "utf-8");
  writeFileSync(join(dir, "gui_app.py"), `import tkinter\n\ndef main():\n    tkinter.Tk().mainloop()\n`, "utf-8");
}
