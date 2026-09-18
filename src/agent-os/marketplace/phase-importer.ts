// Phase 20.89 — Phase Importer: converts the accumulated Pao-hubPro blueprint
// corpus (Phase 20.61 → 20.90) into registry drafts.
//
// The importer is the bridge between "phases as markdown" and "phases as
// governed capabilities". It deliberately separates BLUEPRINT status from
// RUNTIME status: a phase whose markdown exists is DISCOVERED/IMPORTED in the
// registry — never INSTALLED (mission §18: Phase Complete ≠ Runtime Healthy).
//
// Phase-id resolution is canonical-table-first (canonical-phases.ts, the
// user's Canonical Phase Lock), with H1/frontmatter parsing as fallback.
// The mission's collision-regression requirement (20.88/20.90, 20.65/20.65.1)
// is covered by tests against canonical-phases.ts and this importer.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getCapabilityRegistry } from "./registry";
import { reconcilePhaseId, getCanonicalPhaseByFile, listCanonicalPhases, assertNoCanonicalCollisions, getCanonicalPhase } from "./canonical-phases";
import { parseCapabilityManifest, type ManifestIssue } from "./manifest";
import type { CapabilityType, PhaseBlueprintStatus } from "./types";

export interface PhaseImportRecord {
  sourcePath: string;
  detectedPhaseId: string | null;
  canonicalPhaseId: string | null;
  title: string;
  renumbered: boolean;
  capabilitySlug: string | null;
  action: "imported" | "updated" | "skipped_unmapped" | "skipped_duplicate";
  issues: ManifestIssue[];
}

export interface PhaseImportRun {
  runId: string;
  startedAt: string;
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  records: PhaseImportRecord[];
  collisions: Array<{ canonicalId: string; sources: string[] }>;
}

const BLUEPRINT_STATUS_BY_HINT: Array<{ hint: RegExp; status: PhaseBlueprintStatus }> = [
  { hint: /PRODUCTION[- ]READY|user verdict.*CLOSED|PRODUCTION-READY \/ CLOSED/i, status: "VALIDATED" },
  { hint: /implemented & verified|production-hardened|implemented \(in repository\)|implemented and verified/i, status: "IMPLEMENTED" },
  { hint: /implementation blueprint|implementation-ready|implementation specification/i, status: "SPEC_COMPLETE" },
];

function detectBlueprintStatus(content: string, phaseId: string): PhaseBlueprintStatus {
  // Authoritative runtime overrides (verified repository state, 2026-09-18).
  const implemented: Record<string, string> = {
    "20.55": "IMPLEMENTED",
    "20.74": "IMPLEMENTED",
    "20.81": "IMPLEMENTED",
    "20.82": "VALIDATED",
    "20.84": "IMPLEMENTED",
    "20.85": "IMPLEMENTED",
    "20.89": "IMPLEMENTING",
  };
  if (implemented[phaseId]) return implemented[phaseId] as PhaseBlueprintStatus;
  for (const { hint, status } of BLUEPRINT_STATUS_BY_HINT) {
    if (hint.test(content)) return status;
  }
  return "SPEC_COMPLETE";
}

function detectCapabilityType(content: string, phaseId: string): CapabilityType {
  const canonical = getCanonicalPhase(phaseId);
  if (canonical) return canonical.type;
  const lower = content.toLowerCase();
  if (lower.includes("mcp")) return "mcp-server";
  if (lower.includes("video") || lower.includes("remotion")) return "workflow";
  if (lower.includes("agent")) return "agent";
  if (lower.includes("skill")) return "skill";
  return "runtime-adapter";
}

function extractTitle(content: string, fileName: string): string {
  const h1 = content.match(/^#\s+Phase\s+\d[\d.]*\s*[—–-]\s*(.+)$/m);
  if (h1) return h1[1].trim();
  const generic = content.match(/^#\s+(.+)$/m);
  if (generic) return generic[1].trim();
  return fileName.replace(/\.md$/, "");
}

function extractPhaseIdFromContent(content: string): string | null {
  const fm = content.match(/^---[\s\S]*?^phase:\s*"?(\d[\d.]*)"?\s*$/m);
  if (fm) return fm[1];
  const h1 = content.match(/^#\s+Phase\s+(\d[\d.]*)/m);
  if (h1) return h1[1];
  return null;
}

function blueprintToManifest(input: { phaseId: string; title: string; blueprintPath: string; type: CapabilityType; blueprintStatus: PhaseBlueprintStatus; content: string }) {
  // Deterministic YAML-subset manifest, rendered from the canonical lock and
  // the blueprint facts. Rendered text is re-parsed through the manifest
  // pipeline so import and manifest validation share one code path.
  const slug = `phase-${input.phaseId.replace(/\./g, "-")}`;
  const sourceHint = input.content.match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)/i);
  const phaseRef = `blueprint/${input.blueprintPath}`;
  const manifestText = [
    "apiVersion: paohub.io/v1alpha1",
    "kind: Capability",
    "",
    "metadata:",
    `  id: ${slug}`,
    `  name: ${input.title.replace(/[:"]/g, "").slice(0, 120)}`,
    `  slug: ${slug}`,
    `  description: Pao-hubPro Phase ${input.phaseId} capability (blueprint-imported; runtime status NOT_INSTALLED until installed via the marketplace)`,
    `  sourceType: blueprint`,
    `  sourceUrl: ${sourceHint ? `https://github.com/${sourceHint[1]}` : `file://blueprint/${input.blueprintPath}`.replace(/\\/g, "/")}`,
    "  license: internal",
    "  authors:",
    "    - pao-hubpro",
    "  tags:",
    "    - phase-blueprint",
    `    - phase-${input.phaseId.replace(/\./g, "-")}`,
    "",
    "spec:",
    `  type: ${input.type}`,
    `  version: blueprint-${input.blueprintStatus.toLowerCase()}`,
    "  compatibility:",
    "    os:",
    "      - windows",
    "      - linux",
    "      - macos",
    "    arch:",
    "      - x64",
    "    runtimes:",
    "  capabilities:",
    "    provides:",
    `      - phase.${input.phaseId.replace(/\./g, "-")}`,
    "    consumes:",
    "      - policy.engine",
    "      - audit.store",
    "  permissions:",
    "    filesystem:",
    "      read:",
    "        - workspace/**",
    "      write: []",
    "    network:",
    "      outbound: []",
    "    shell:",
    "      allowed: false",
    "    secrets: []",
    "  dependencies:",
    "    required: []",
    "    optional: []",
    "  install:",
    "    strategy: registry",
    "    source:",
    `      repo: ${sourceHint ? `https://github.com/${sourceHint[1]}` : `file://blueprint`}`.replace(/\\/g, "/"),
    `      ref: ${JSON.stringify(phaseRef)}`,
    "    steps:",
    "      - type: register",
    "  health:",
    "    checks:",
    "      - type: process",
    "  lifecycle:",
    "    supportsDisable: true",
    "    supportsRollback: true",
    "    supportsUninstall: true",
    "",
  ].join("\n");
  return { manifestText, slug, phaseRef };
}

export class PhaseImporter {
  private blueprintRoot: string;

  constructor(blueprintRoot?: string) {
    // Default: the tracked repo blueprint corpus. Extra dirs (e.g. the
    // Downloads working folder) can be appended via env without hardcoding
    // user paths in source.
    const root = blueprintRoot ?? join(process.cwd(), "Blueprint");
    const extra = (process.env.PAOHUB_MARKETPLACE_EXTRA_BLUEPRINT_DIRS ?? "")
      .split(/[:;]/)
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && existsSync(d));
    this.blueprintRoot = root;
    this.extraDirs = extra;
  }

  private extraDirs: string[];

  scanDirectories(): Array<{ dir: string; files: string[] }> {
    const out: Array<{ dir: string; files: string[] }> = [];
    const collect = (dir: string) => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md"));
      out.push({ dir, files });
    };
    collect(this.blueprintRoot);
    for (const dir of this.extraDirs) collect(dir);
    return out;
  }

  /**
   * Runs a full import pass. Idempotent: re-imports update existing drafts.
   * Phase-id resolution is canonical-table-first; collisions are recorded.
   */
  importAll(actor = "phase-importer"): PhaseImportRun {
    assertNoCanonicalCollisions();
    const registry = getCapabilityRegistry();
    const runId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const run: PhaseImportRun = { runId, startedAt: new Date().toISOString(), scanned: 0, imported: 0, updated: 0, skipped: 0, records: [], collisions: [] };
    const seenCanonical = new Map<string, string[]>();

    for (const { dir, files } of this.scanDirectories()) {
      for (const fileName of files) {
        const sourcePath = join(dir, fileName);
        run.scanned++;
        let record: PhaseImportRecord = { sourcePath, detectedPhaseId: null, canonicalPhaseId: null, title: fileName, renumbered: false, capabilitySlug: null, action: "skipped_unmapped", issues: [] };
        try {
          const content = readFileSync(sourcePath, "utf8");
          const title = extractTitle(content, fileName);
          const detected = extractPhaseIdFromContent(content);
          record.detectedPhaseId = detected;

          // Canonical resolution: filename-known → content-parsed → title fallback.
          let phaseId: string | null = null;
          let renumbered = false;
          const byFile = getCanonicalPhaseByFile(fileName);
          if (byFile) {
            phaseId = byFile.phaseId;
            renumbered = detected !== null && detected !== byFile.phaseId;
          } else if (detected) {
            const resolved = reconcilePhaseId(detected, title);
            if (resolved) {
              phaseId = resolved.phaseId;
              renumbered = resolved.renumbered;
            }
          }
          if (!phaseId) {
            run.records.push(record);
            run.skipped++;
            continue;
          }
          record.canonicalPhaseId = phaseId;
          record.renumbered = renumbered;
          record.title = title;

          // Collision ledger: two sources mapping to one canonical id.
          const prior = seenCanonical.get(phaseId) ?? [];
          prior.push(fileName);
          seenCanonical.set(phaseId, prior);

          const type = detectCapabilityType(content, phaseId);
          const blueprintStatus = detectBlueprintStatus(content, phaseId);
          const { manifestText, slug } = blueprintToManifest({ phaseId, title, blueprintPath: fileName, type, blueprintStatus, content });
          const parsed = parseCapabilityManifest(manifestText);
          if (!parsed.ok) {
            record.issues = parsed.issues;
            run.records.push(record);
            run.skipped++;
            continue;
          }

          // Canonical lock metadata is attached so the registry row records
          // the renumbering provenance (e.g. Forge 20.88→20.90).
          const canonicalNote = getCanonicalPhase(phaseId)?.note;
          const upsert = registry.upsertFromManifest({
            manifest: parsed.manifest,
            phaseId,
            blueprintPath: fileName,
            blueprintStatus,
            manifestYamlText: manifestText,
            sourceRef: `blueprint/${fileName}`,
            checksumSha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
            actor,
          });
          registry.upsertPhaseBlueprint({ phaseId, title, blueprintPath: fileName, blueprintStatus, capabilityId: upsert.capabilityId, note: canonicalNote });
          record.capabilitySlug = slug;
          record.action = upsert.created ? "imported" : "updated";
          if (upsert.created) run.imported++;
          else run.updated++;
        } catch (err) {
          record.issues.push({ line: null, path: sourcePath, code: "MANIFEST_INVALID", message: err instanceof Error ? err.message : String(err) });
          run.skipped++;
        }
        run.records.push(record);
      }
    }

    // Canonical-lock collision report: any canonical id claimed by multiple
    // files after resolution is recorded (post-lock this must be empty).
    for (const [canonicalId, sources] of seenCanonical) {
      if (sources.length > 1) run.collisions.push({ canonicalId, sources });
    }

    try {
      openAgentOsDb().run("INSERT INTO mk_phase_imports (id, run_id, report_json, created_at) VALUES (?, ?, ?, ?)", [`impr_${randomUUID().replace(/-/g, "").slice(0, 20)}`, run.runId, JSON.stringify({ scanned: run.scanned, imported: run.imported, updated: run.updated, skipped: run.skipped, collisions: run.collisions }), new Date().toISOString()]);
    } catch {
      // import-run persistence is best-effort; the run result is returned regardless
    }
    return run;
  }
}

/** Generates the mission §28 reconciliation report rows from the registry. */
export function buildReconciliationRows(): Array<{
  phase: string;
  canonicalId: string;
  previousId: string | null;
  capability: string;
  blueprintStatus: string;
  runtimeStatus: string;
  registryStatus: string;
  manifestStatus: string;
  testStatus: string;
  healthStatus: string;
  migrationAction: string;
  remainingBlockers: string;
}> {
  const registry = getCapabilityRegistry();
  const rows: Array<{
    phase: string; canonicalId: string; previousId: string | null; capability: string;
    blueprintStatus: string; runtimeStatus: string; registryStatus: string; manifestStatus: string;
    testStatus: string; healthStatus: string; migrationAction: string; remainingBlockers: string;
  }> = [];
  for (const canonical of listCanonicalPhases()) {
    const blueprint = registry.listPhaseBlueprints().find((b) => b.phaseId === canonical.phaseId);
    const capability = blueprint?.capabilityId ? registry.getCapabilityById(blueprint.capabilityId) : null;
    const renumbered = canonical.note?.includes("Collision resolution") ?? false;
    rows.push({
      phase: canonical.phaseId,
      canonicalId: canonical.phaseId,
      previousId: renumbered ? canonical.phaseId.replace(/(\.\d+)$/, "").concat("*") : null,
      capability: canonical.title,
      blueprintStatus: blueprint?.blueprintStatus ?? "DRAFT",
      runtimeStatus: capability?.status ?? "NOT_INSTALLED",
      registryStatus: capability ? "REGISTERED" : "NOT_REGISTERED",
      manifestStatus: capability ? "VALID" : "NOT_GENERATED",
      testStatus: capability ? "PENDING" : "NOT_APPLICABLE",
      healthStatus: capability?.status === "HEALTHY" ? "HEALTHY" : capability ? "UNKNOWN" : "NOT_APPLICABLE",
      migrationAction: renumbered ? "renumbered per canonical lock" : capability ? "registered" : "awaiting import",
      remainingBlockers: capability?.status === "AVAILABLE" || capability?.status === "NORMALIZED" ? "runtime not installed" : "none recorded",
    });
  }
  return rows;
}

let defaultImporter: PhaseImporter | null = null;

export function getPhaseImporter(): PhaseImporter {
  if (!defaultImporter) defaultImporter = new PhaseImporter();
  return defaultImporter;
}
