// Phase 20.8 — Agent Markdown Parser
// Parses Agency Agent Markdown files into normalized AgencyAgent metadata objects.
// Enforces security invariants: path safety, size limits, prompt safety scans, and SHA-256 integrity hashes.

import { createHash } from "node:crypto";
import { parseAgentFrontmatter } from "./frontmatter";
import { parseAgentSections } from "./sections";
import { scanAgentPromptSafety } from "../security/prompt-injection-scanner";
import type { AgencyAgent, AgentDivision } from "../types";

export interface ParseAgentOptions {
  sourceId?: string;
  sourcePath: string;
  sourceCommit?: string;
  trustSource?: "upstream" | "local" | "cached" | "custom" | "bundled";
  includeBody?: boolean;
}

const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB

export function parseAgentMarkdown(
  rawContent: string,
  optionsOrTrust?: ParseAgentOptions | string,
  legacySourcePath?: string,
): AgencyAgent {
  const options: ParseAgentOptions =
    typeof optionsOrTrust === "object" && optionsOrTrust !== null
      ? optionsOrTrust
      : {
          trustSource: (optionsOrTrust as any) ?? "bundled",
          sourcePath: legacySourcePath ?? "agent.md",
        };

  if (Buffer.byteLength(rawContent, "utf8") > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Agent file exceeds 512KB maximum size limit (${options.sourcePath})`);
  }

  // 1. Compute body hash
  const bodyHash = createHash("sha256").update(rawContent).digest("hex");

  // 2. Extract YAML Frontmatter
  const { frontmatter, body } = parseAgentFrontmatter(rawContent);

  // 3. Extract Structured Sections
  const sections = parseAgentSections(body);

  // 4. Determine Division and Slug
  const derivedSlug = deriveSlug(options.sourcePath, frontmatter.name);
  const derivedDivision = deriveDivision(options.sourcePath, frontmatter.division);

  // 5. Run Security Prompt Scanner
  const safetyScan = scanAgentPromptSafety(rawContent);

  // 6. Aggregate Capabilities and Keywords
  const capabilities = Array.from(
    new Set([
      ...(frontmatter.capabilities ?? []),
      ...sections.capabilities,
      ...deriveCapabilitiesFromText(frontmatter.name ?? "", frontmatter.description ?? "", body),
    ]),
  );

  const keywords = Array.from(
    new Set([
      ...(frontmatter.keywords ?? []),
      ...sections.keywords,
      ...derivedSlug.split("-"),
    ]),
  ).filter((k) => k.length > 2);

  const name = frontmatter.name ?? formatNameFromSlug(derivedSlug);
  const description = frontmatter.description ?? (sections.coreMission[0] || "");

  // 7. Compute Metadata Hash
  const metadataPayload = JSON.stringify({
    slug: derivedSlug,
    name,
    division: derivedDivision,
    capabilities,
    keywords,
  });
  const metadataHash = createHash("sha256").update(metadataPayload).digest("hex");

  const agent: AgencyAgent = {
    id: `agent_${derivedSlug}`,
    slug: derivedSlug,
    name,
    description,
    division: derivedDivision,
    sourceId: options.sourceId,
    sourcePath: options.sourcePath || "bundled",
    sourceCommit: options.sourceCommit,
    capabilities,
    keywords,
    deliverables: sections.deliverables,
    criticalRules: sections.criticalRules,
    successMetrics: sections.successMetrics,
    parsedSections: {
      ...sections,
      identity: sections.identity.join("\n"),
      mission: [...sections.coreMission, ...sections.identity].join("\n"),
      workflow: sections.workflowProcess,
    },
    bodyLoaded: Boolean(options.includeBody),
    body: options.includeBody ? body : undefined,
    hashes: {
      metadata: metadataHash,
      body: bodyHash,
      metadataHash,
      bodyHash,
    },
    trust: {
      source: options.trustSource ?? "bundled",
      verified: safetyScan.status !== "blocked",
    },
    safety: {
      status: safetyScan.status,
      findings: safetyScan.findings,
    },
    enabled: safetyScan.status !== "blocked",
    isCustom: options.trustSource === "custom" || Boolean(frontmatter.customFields.custom),
    extendsSlug: frontmatter.extends,
    color: frontmatter.color,
    emoji: frontmatter.emoji,
    vibe: frontmatter.vibe,
  };

  return agent;
}

export function deriveSlug(filePath?: string, frontmatterName?: string): string {
  if (frontmatterName && frontmatterName.trim()) {
    return frontmatterName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  if (!filePath) {
    return "unknown-specialist";
  }

  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1].replace(/\.(md|markdown|toml)$/i, "");

  // If path is like: .../skills/agency-specialized-mcp-builder/SKILL.md
  if (lastPart.toUpperCase() === "SKILL" && parts.length >= 2) {
    const parent = parts[parts.length - 2];
    const match = parent.match(/^agency-([a-z0-9-]+)$/i);
    if (match) {
      // Strip common division prefixes if present: agency-engineering-backend-architect -> backend-architect
      const stripped = match[1].replace(/^(engineering|design|product|project-management|testing|security|research|specialized|marketing|support|finance|sales)-/, "");
      return stripped.toLowerCase();
    }
    return parent.toLowerCase();
  }

  // If path is like: .../engineering/software-architect.md
  if (lastPart && lastPart !== "index") {
    return lastPart.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  }

  return "unknown-specialist";
}

export function deriveDivision(filePath?: string, frontmatterDivision?: string): AgentDivision {
  if (frontmatterDivision && frontmatterDivision.trim()) {
    return frontmatterDivision.toLowerCase();
  }

  if (!filePath) {
    return "specialized";
  }

  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  const divisions: AgentDivision[] = [
    "engineering",
    "design",
    "product",
    "project-management",
    "testing",
    "security",
    "research",
    "specialized",
    "marketing",
    "support",
    "finance",
    "sales",
  ];

  for (const div of divisions) {
    if (
      normalized.includes(`/${div}/`) ||
      normalized.includes(`agency-${div}-`) ||
      normalized.includes(`agency-${div}/`)
    ) {
      return div;
    }
  }

  if (normalized.includes("mcp") || normalized.includes("protocol")) return "specialized";
  if (normalized.includes("architect") || normalized.includes("developer") || normalized.includes("engineer")) return "engineering";
  if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("test")) return "testing";

  return "engineering";
}

function deriveCapabilitiesFromText(name: string, description: string, body: string): string[] {
  const text = `${name} ${description} ${body.slice(0, 3000)}`.toLowerCase();
  const found: string[] = [];

  const capabilityKeywords: Record<string, string[]> = {
    mcp: ["mcp", "model context protocol", "mcp server", "mcp tool"],
    "backend-architecture": ["backend", "api", "database", "microservices", "server-side"],
    "frontend-architecture": ["frontend", "react", "ui", "ux", "css", "web app"],
    "security-architecture": ["security", "auth", "permission", "rbac", "credential", "vulnerability"],
    "code-review": ["code review", "code quality", "refactoring", "best practices"],
    "reality-validation": ["reality check", "evidence", "claim verification", "ground truth"],
    "test-automation": ["testing", "unit test", "integration test", "e2e", "qa"],
    "prompt-engineering": ["prompt", "llm", "ai agent", "instruction design"],
    "image-generation": ["image", "diffusion", "comfyui", "midjourney", "photoshop"],
    "video-production": ["video", "motion", "mpt", "animation", "footage"],
    "workflow-optimization": ["workflow", "automation", "pipeline", "ci/cd", "devops"],
    "market-research": ["market research", "trend research", "competitive analysis"],
    seo: ["seo", "search engine", "ranking", "keywords"],
  };

  for (const [capability, triggers] of Object.entries(capabilityKeywords)) {
    if (triggers.some((trigger) => text.includes(trigger))) {
      found.push(capability);
    }
  }

  return found;
}

function formatNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
