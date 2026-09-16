// Phase 30.36 — Idea-to-MVP Compiler + Codex Pack generator (spec §13-§14, §34-§35).
// Deterministic scope reduction FIRST (§14 anti-SaaS rules), then artifact
// generation. The compiler reads ONLY normalized registry fields — imported
// Markdown never reaches this layer, which is the structural prompt-injection
// defense (§32). Compilation is blocked when the compliance gate is RED or
// lacks the required human review.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import type { BusinessOpportunity, ComplianceCheck, CostEstimate, MvpSpec, OpportunityScore } from "./types";

/** Features explicitly EXCLUDED from the MVP (§14): the default path is the
 *  smallest sellable/validatable version, never a full SaaS. */
const EXCLUDED_SCOPE = [
  "multi-tenant", "stripe billing", "billing system", "team accounts", "enterprise rbac",
  "white label", "mobile app", "analytics warehouse", "oauth provider", "admin console",
];

export function mvpOutputRoot(): string {
  return process.env.BUSINESS_OUTPUT_DIR || join(getConfigDir(), "business-builder", "generated");
}

export function buildMvpFeatures(opportunity: BusinessOpportunity): string[] {
  // 1. Customer/problem extraction → 2. minimum value prop → 3. reduction.
  const declared = opportunity.solution
    .split(/[.;\n]| then | → |->/i)
    .map((step) => step.trim())
    .filter(Boolean);
  const features = declared.length > 0 ? declared : [
    `Collect ${opportunity.market || "target"} input data`,
    "Analyze with the existing AI runtime",
    "Generate a structured report",
    "Export/share the report",
  ];
  // 4. Reduction: drop anything matching the excluded SaaS scope, cap at 7.
  const reduced = features.filter((feature) => !EXCLUDED_SCOPE.some((needle) => feature.toLowerCase().includes(needle))).slice(0, 7);
  return reduced.length > 0 ? reduced : ["Minimal manual-service workflow with a report deliverable"];
}

export function compileMvp(input: {
  opportunity: BusinessOpportunity;
  score: OpportunityScore | null;
  compliance: ComplianceCheck | null;
  cost: CostEstimate | null;
  paoFit: { score: number; available: string[]; missing: string[] } | null;
}): MvpSpec {
  const { opportunity, score, compliance, cost, paoFit } = input;
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  if (compliance) {
    if (compliance.overall === "RED") blockedReasons.push("compliance gate RED — production generation blocked (§12)");
    if (compliance.overall === "UNKNOWN" && !compliance.reviewedBy) blockedReasons.push("compliance gate UNKNOWN — human review required before production generation");
    if (compliance.overall === "YELLOW") warnings.push("compliance YELLOW: prototype allowed with warnings; review before production");
  } else {
    blockedReasons.push("no compliance check recorded — run the compliance gate first");
  }
  if (score && score.confidence < 0.5) warnings.push(`score confidence is low (${score.confidence}) — treat the ranking as a hypothesis`);

  const features = buildMvpFeatures(opportunity);
  const slug = opportunity.slug;
  const outputDir = join(mvpOutputRoot(), slug);

  const artifacts: Record<string, string> = {
    "opportunity.json": JSON.stringify(opportunity, null, 2),
    "opportunity-score.json": JSON.stringify(score ?? { note: "not scored yet" }, null, 2),
    "pao-fit.json": JSON.stringify(paoFit ?? { note: "not evaluated" }, null, 2),
    "compliance-report.md": compliance ? renderCompliance(compliance) : "No compliance check recorded.\n",
    "mvp-spec.md": renderMvpSpec(opportunity, features),
    "architecture.md": renderArchitecture(opportunity, features),
    "database.md": renderDatabase(opportunity),
    "api-contract.md": renderApiContract(opportunity),
    "mcp-tools.md": renderMcpTools(opportunity),
    "ui-spec.md": renderUiSpec(opportunity, features),
    "test-plan.md": renderTestPlan(features),
    "deployment.md": renderDeployment(opportunity, warnings),
    "CODEX_IMPLEMENTATION.md": renderCodexImplementation(opportunity, features, blockedReasons, warnings),
  };

  if (blockedReasons.length === 0) {
    mkdirSync(outputDir, { recursive: true });
    for (const [name, content] of Object.entries(artifacts)) {
      writeFileSync(join(outputDir, name), content, "utf8");
    }
  }

  return {
    id: "bmvp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    opportunityId: opportunity.id,
    slug,
    outputDir: blockedReasons.length === 0 ? outputDir : "",
    artifacts,
    blocked: blockedReasons.length > 0,
    blockReasons: blockedReasons,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

function renderCompliance(compliance: ComplianceCheck): string {
  const lines = ["# Compliance Report", "", `Overall: **${compliance.overall}**`, ""];
  for (const dimension of compliance.dimensions) {
    lines.push(`- ${dimension.dimension}: **${dimension.status}** — ${dimension.reason}`);
  }
  lines.push("", "> Engineering/compliance review gate — not legal advice.", "");
  return lines.join("\n");
}

function renderMvpSpec(opportunity: BusinessOpportunity, features: string[]): string {
  const deliveryPath = [
    "Manual Audit / Report", "Productized Service", "Semi-Automated Service",
    "Recurring Monitoring", "Dashboard", "Micro SaaS", "Scale",
  ];
  return [
    `# MVP Spec — ${opportunity.name}`,
    "",
    "## Customer / Problem",
    `- Segments: ${opportunity.customerSegments.join(", ") || "TBD"}`,
    `- Pain points: ${opportunity.painPoints.join("; ") || "TBD"}`,
    "",
    "## Minimum Value Proposition",
    opportunity.valueProposition || "Deliver the smallest verifiable outcome manually first.",
    "",
    "## MVP Features (reduced scope — §14 anti-SaaS rules applied)",
    ...features.map((feature, index) => `${index + 1}. ${feature}`),
    "",
    "## Explicitly NOT in the MVP",
    ...EXCLUDED_SCOPE.map((item) => `- ${item}`),
    "",
    "## Business Path",
    deliveryPath.join(" → "),
    "",
    "## Validation Plan",
    opportunity.validationPlan || "Sell the manual version to 3–5 customers before building further.",
    "",
  ].join("\n");
}

function renderArchitecture(opportunity: BusinessOpportunity, features: string[]): string {
  return [
    `# Architecture — ${opportunity.name}`,
    "",
    "Reuse-first: build on the existing Pao-hubPro runtime rather than new infrastructure.",
    "",
    "## Components",
    "- Runtime: existing Pao-hubPro Bun/TypeScript process (no new service)",
    `- AI calls: existing multi-provider gateway (required models: ${opportunity.requiredModels.join(", ") || "default"})`,
    `- Data: ${opportunity.requiredDataSources.join(", ") || "operator-provided inputs"}`,
    "- Storage: shared agent-os SQLite via additive migration",
    "- UI: dashboard section over the existing glassmorphic design system",
    "",
    "## Flow",
    ...features.map((feature) => `- ${feature}`),
    "",
  ].join("\n");
}

function renderDatabase(opportunity: BusinessOpportunity): string {
  return [
    `# Database — ${opportunity.name}`,
    "",
    "Additive migration only; every table carries id/created_at/updated_at.",
    "",
    "```sql",
    `CREATE TABLE IF NOT EXISTS ${opportunity.slug.replace(/-/g, "_")}_records (`,
    "  id TEXT PRIMARY KEY,",
    "  payload_json TEXT NOT NULL,",
    "  status TEXT NOT NULL DEFAULT 'new',",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL",
    ");",
    "```",
    "",
  ].join("\n");
}

function renderApiContract(opportunity: BusinessOpportunity): string {
  const base = `/api/${opportunity.slug.replace(/[^a-z0-9]+/g, "-")}`;
  return [
    `# API Contract — ${opportunity.name}`,
    "",
    "Follow the repo management-route conventions (full-literal guards, ids in body).",
    "",
    `- \`POST ${base}/records\` — create a record (the MVP's main write)`,
    `- \`POST ${base}/records/detail\` — fetch one record`,
    `- \`POST ${base}/analyze\` — run the AI analysis step`,
    `- \`GET ${base}/reports\` — list generated reports`,
    "",
  ].join("\n");
}

function renderMcpTools(opportunity: BusinessOpportunity): string {
  const namespace = opportunity.slug.replace(/[^a-z0-9]+/g, "_");
  return [
    `# MCP Tools — ${opportunity.name}`,
    "",
    `- \`${namespace}.create_record\` (R2, mutates)`,
    `- \`${namespace}.analyze\` (R2, mutates — runs the AI step)`,
    `- \`${namespace}.get_report\` (R0, read-only)`,
    `- \`${namespace}.list_records\` (R0, read-only)`,
    "",
    "Metadata per repo convention: risk, mutates, requiresConfirmation, workspaceScoped.",
    "",
  ].join("\n");
}

function renderUiSpec(opportunity: BusinessOpportunity, features: string[]): string {
  return [
    `# UI Spec — ${opportunity.name}`,
    "",
    "Single dashboard tab using the existing `ur-*` design system; no new frontend stack.",
    "",
    "## Panels",
    `- Input form (the MVP's primary user action)`,
    "- Results/report view",
    "- History list",
    "",
    "## Feature coverage",
    ...features.map((feature) => `- ${feature}`),
    "",
  ].join("\n");
}

function renderTestPlan(features: string[]): string {
  return [
    "# Test Plan",
    "",
    "- Unit: normalization + core analysis functions (deterministic)",
    "- Integration: record → analyze → report with a mocked AI provider",
    "- Security: untrusted-input handling, no execution of external content",
    "- Regression: existing suites stay green",
    "",
    "## Feature checks",
    ...features.map((feature) => `- [ ] ${feature} covered by at least one test`),
    "",
  ].join("\n");
}

function renderDeployment(opportunity: BusinessOpportunity, warnings: string[]): string {
  return [
    `# Deployment — ${opportunity.name}`,
    "",
    "Deploy as part of the existing Pao-hubPro process (no new infrastructure).",
    "",
    "## Environment variables",
    `- Provider credentials via the existing secrets mechanism (never committed)`,
    "",
    ...(warnings.length > 0 ? ["## Warnings", ...warnings.map((warning) => `- ${warning}`)] : []),
    "",
  ].join("\n");
}

function renderCodexImplementation(opportunity: BusinessOpportunity, features: string[], blockedReasons: string[], warnings: string[]): string {
  return [
    `# CODEX_IMPLEMENTATION — ${opportunity.name}`,
    "",
    "## Context",
    opportunity.summary || opportunity.name,
    "",
    "## Goal",
    "Deliver the reduced MVP below using the existing Pao-hubPro architecture. Reuse, do not duplicate.",
    "",
    "## Existing architecture",
    "- Bun-native TypeScript, shared agent-os SQLite (additive migrations),",
    "  management routes with full-literal guards, WebMCP tool registries,",
    "  React dashboard with i18n ×10.",
    "",
    "## Files to inspect first",
    "- src/agent-os/db.ts (migration convention)",
    "- src/server/management/agent-os-routes.ts + route-registry.ts (route wiring)",
    "- tests/ (suite conventions)",
    "",
    "## Files allowed to modify",
    "- The new domain module + its store/routes/tests only.",
    "",
    "## Files to create",
    "- Domain module files per the repo layout convention.",
    "",
    "## Functional requirements",
    ...features.map((feature, index) => `${index + 1}. ${feature}`),
    "",
    "## Non-functional requirements",
    "- No secrets in code/logs; untrusted input never executed; additive migrations only.",
    "",
    "## Tests",
    "- Focused Bun tests for the new logic; existing suites remain green.",
    "",
    ...(blockedReasons.length > 0
      ? ["## BLOCKED", ...blockedReasons.map((reason) => `- ${reason}`), "", "Do not start production implementation while blocked."]
      : []),
    ...(warnings.length > 0 ? ["## Warnings", ...warnings.map((warning) => `- ${warning}`)] : []),
    "",
    "## Acceptance criteria",
    "- typecheck/lint/tests/build green; no regression in existing suites.",
    "",
    "## Rollback notes",
    "- Feature-flag the new module; additive migration can remain in place.",
    "",
  ].join("\n");
}
