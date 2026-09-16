// Phase 30.36 — playbook source adapter (spec §7.1, §6, §30-§32).
// External repository content is UNTRUSTED reference data: the parser
// whitelists keys, strips markup and control characters, extracts factual
// structure only, and never yields shell/command/code-execution fields.
// Provenance (repo/path/commit/imported_at/content_hash/license) is mandatory
// on every imported record; imports are dry-run capable and incremental with
// duplicate detection.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BusinessOpportunity, DeliveryModel, OpportunitySource } from "./types";

export class BusinessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "BusinessError";
    this.code = code;
  }
}

// --- Sanitization (§31-§32): imported text is data, never instructions -------

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeImportedText(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, " ")
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "[removed script block]")
    .replace(/<\s*\/?\s*[a-z][a-z0-9-]*[^>]*>/gi, " ") // strip all HTML tags
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Whitelisted playbook fields — anything else in the file is ignored, which
 *  is the structural prompt-injection defense (§32): instruction-shaped lines
 *  can never become an executable or prompt-bearing field. */
const PARSEABLE_FIELDS = new Set([
  "name", "summary", "market", "category", "customer_segments", "buyer_roles",
  "pain_points", "value_proposition", "value_prop", "solution", "business_model",
  "pricing_model", "suggested_price", "currency", "delivery_model", "required_apis",
  "required_capabilities", "required_tools", "required_models", "required_data_sources",
  "difficulty", "estimated_build_hours", "estimated_time_to_mvp_days", "revenue_potential",
  "recurring_revenue_potential", "speed_to_cash", "automation_potential", "market_demand",
  "competition_level", "compliance_risk", "api_cost_level", "gtm_channels",
  "sales_motion", "validation_plan", "tags",
]);

const LIST_FIELDS = new Set([
  "customer_segments", "buyer_roles", "pain_points", "required_apis",
  "required_capabilities", "required_tools", "required_models",
  "required_data_sources", "gtm_channels", "tags",
]);

const DELIVERY_MODELS: DeliveryModel[] = [
  "manual", "productized_service", "monitoring", "dashboard", "micro_saas", "api", "marketplace",
];

export interface ParsedPlaybook {
  fields: Record<string, string | string[] | number>;
  warnings: string[];
}

/** Extracts factual structure from one Markdown playbook document. Markdown
 *  headings and fences are treated as layout; only whitelisted `key: value`
 *  pairs and their bullet lists are kept, sanitized. */
export function parsePlaybookMarkdown(raw: string, warnings: string[] = []): ParsedPlaybook {
  const fields: Record<string, string | string[] | number> = {};
  const sanitized = sanitizeImportedText(raw);
  let currentListKey: string | null = null;

  for (const rawLine of sanitized.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) { currentListKey = null; continue; }
    if (line.startsWith("```") || line.startsWith("---")) { currentListKey = null; continue; }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const current = currentListKey ? fields[currentListKey] : undefined;
      if (currentListKey && Array.isArray(current) && current.length < 12) {
        current.push(line.slice(2).trim().slice(0, 200));
      }
      continue;
    }

    const colon = line.indexOf(":");
    if (colon <= 0 || colon > 40) { currentListKey = null; continue; }
    const key = line.slice(0, colon).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!PARSEABLE_FIELDS.has(key)) { currentListKey = null; continue; }
    const value = line.slice(colon + 1).trim();
    if (LIST_FIELDS.has(key)) {
      fields[key] = value ? [value.slice(0, 200)] : [];
      currentListKey = key;
      continue;
    }
    if (key === "suggested_price" || key === "estimated_build_hours" || key === "estimated_time_to_mvp_days"
      || key === "revenue_potential" || key === "recurring_revenue_potential" || key === "speed_to_cash"
      || key === "automation_potential" || key === "market_demand" || key === "competition_level"
      || key === "compliance_risk" || key === "api_cost_level") {
      const numeric = Number.parseFloat(value.replace(/[^\d.]/g, ""));
      if (Number.isFinite(numeric)) fields[key] = numeric;
      continue;
    }
    fields[key] = value.slice(0, 400);
    currentListKey = null;
  }
  if (!fields.name) warnings.push("playbook document lacks a name field");
  return { fields, warnings };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "opportunity";
}

/** Normalizes a parsed playbook into a BusinessOpportunity draft (§7.2). */
export function normalizePlaybook(
  parsed: ParsedPlaybook,
  source: Omit<OpportunitySource, "contentHash" | "importedAt">,
  rawContentHash: string,
): BusinessOpportunity {
  const f = parsed.fields;
  const now = new Date().toISOString();
  const str = (key: string, fallback = ""): string => (typeof f[key] === "string" ? (f[key] as string) : fallback);
  const list = (key: string): string[] => (Array.isArray(f[key]) ? (f[key] as string[]) : []);
  const num = (key: string, fallback: number): number => (typeof f[key] === "number" ? (f[key] as number) : fallback);
  const name = str("name", "Unnamed Opportunity");
  const deliveryRaw = str("delivery_model", "productized_service").toLowerCase().replace(/[\s-]+/g, "_");
  const delivery = (DELIVERY_MODELS.includes(deliveryRaw as DeliveryModel) ? deliveryRaw : "productized_service") as DeliveryModel;
  const difficultyRaw = str("difficulty", "medium").toLowerCase();
  return {
    id: "bopp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    slug: slugify(name),
    name,
    summary: str("summary"),
    market: str("market"),
    category: str("category"),
    customerSegments: list("customer_segments"),
    buyerRoles: list("buyer_roles"),
    painPoints: list("pain_points"),
    valueProposition: str("value_proposition") || str("value_prop"),
    solution: str("solution"),
    businessModel: str("business_model", "productized_service"),
    pricingModel: str("pricing_model", "one_time"),
    suggestedPrice: typeof f.suggested_price === "number" ? (f.suggested_price as number) : null,
    currency: str("currency", "USD"),
    deliveryModel: delivery,
    requiredApis: list("required_apis"),
    requiredCapabilities: list("required_capabilities").length > 0 ? list("required_capabilities") : list("required_tools"),
    requiredModels: list("required_models"),
    requiredDataSources: list("required_data_sources"),
    difficulty: difficultyRaw === "low" || difficultyRaw === "high" ? difficultyRaw : "medium",
    estimatedBuildHours: num("estimated_build_hours", 40),
    estimatedTimeToMvpDays: num("estimated_time_to_mvp_days", 7),
    revenuePotential: clamp(num("revenue_potential", 50)),
    recurringRevenuePotential: clamp(num("recurring_revenue_potential", 40)),
    speedToCash: clamp(num("speed_to_cash", 50)),
    automationPotential: clamp(num("automation_potential", 50)),
    marketDemand: clamp(num("market_demand", 50)),
    competitionLevel: clamp(num("competition_level", 50)),
    complianceRisk: clamp(num("compliance_risk", 40)),
    apiCostLevel: clamp(num("api_cost_level", 40)),
    paoFitScore: null,
    opportunityScore: null,
    scoreConfidence: null,
    scoreEvidence: [],
    gtmChannels: list("gtm_channels"),
    salesMotion: str("sales_motion"),
    validationPlan: str("validation_plan"),
    source: { ...source, importedAt: now, contentHash: rawContentHash },
    editedManually: false,
    status: "imported",
    tags: list("tags"),
    createdAt: now,
    updatedAt: now,
  };
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 50)));
}

export function contentHash(raw: string): string {
  return "sha256:" + createHash("sha256").update(raw, "utf8").digest("hex");
}

// --- Local source directory adapter (spec §7.1) --------------------------------

export interface SourceScanResult {
  rootDir: string;
  license: string;
  commit: string | null;
  files: Array<{ path: string; markdown: string; hash: string }>;
}

/** Scans a locally prepared source directory (git clone performed explicitly
 *  by the operator — cloning is never automatic). License metadata is detected
 *  from LICENSE* files; anything unrecognized becomes LICENSE_UNKNOWN (§30). */
export function scanSourceDirectory(rootDir: string): SourceScanResult {
  if (!existsSync(rootDir)) {
    throw new BusinessError("SOURCE_NOT_FOUND", `source directory does not exist: ${rootDir}`);
  }
  let license = "LICENSE_UNKNOWN";
  for (const candidate of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"]) {
    const licensePath = join(rootDir, candidate);
    if (existsSync(licensePath)) {
      const firstLine = readFileSync(licensePath, "utf8").split("\n")[0]?.trim() ?? "";
      license = firstLine.length > 0 && firstLine.length < 120 ? firstLine : "LICENSE_UNKNOWN";
      break;
    }
  }
  const commitPath = join(rootDir, ".commit");
  const commit = existsSync(commitPath) ? readFileSync(commitPath, "utf8").trim().slice(0, 40) : null;

  const files: SourceScanResult["files"] = [];
  const scan = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { scan(fullPath, relPath); continue; }
      if (!entry.name.endsWith(".md")) continue;
      const raw = readFileSync(fullPath, "utf8");
      files.push({ path: relPath, markdown: raw, hash: contentHash(raw) });
    }
  };
  scan(rootDir, "");
  return { rootDir, license, commit, files };
}

/** Default source root: a locally prepared clone location, overridable. */
export function playbookSourceRoot(): string {
  return process.env.BUSINESS_PLAYBOOKS_DIR || join(process.cwd(), ".tmp", "playbooks", "software-income-playbooks");
}
