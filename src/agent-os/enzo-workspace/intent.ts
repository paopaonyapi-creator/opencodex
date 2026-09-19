// Phase 20.94 — intent / task compiler. Deterministic, no live model required.
// Live LLM classification is an optional upgrade behind OmniRoute, not a blocker.

import type { RiskClass, RunMode, TaskIntent } from "./types";

const MODE_HINTS: Array<{ mode: Exclude<RunMode, "auto">; keys: string[] }> = [
  { mode: "research", keys: ["research", "search", "trend", "evidence", "citat", "adobe stock", "opportunit", "market"] },
  { mode: "coding", keys: ["code", "repo", "implement", "refactor", "test", "diff", "typescript", "bug", "fix", "compile"] },
  { mode: "agent", keys: ["create an agent", "draft an agent", "agent that", "blueprint"] },
  { mode: "automation", keys: ["automat", "workflow", "schedule", "cron"] },
  { mode: "chat", keys: ["explain", "what is", "summarize", "hello"] },
];

export function classifyIntent(raw: string): TaskIntent {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  let mode: RunMode = "chat";
  let score = 0;
  for (const hint of MODE_HINTS) {
    const hits = hint.keys.filter((k) => lower.includes(k)).length;
    if (hits > score) {
      score = hits;
      mode = hint.mode;
      reasons.push("mode:" + hint.mode + " hits=" + hits);
    }
  }
  if (lower.includes("create an agent") || lower.includes("draft an agent")) {
    mode = "agent";
    reasons.push("explicit agent factory request");
  }
  if (mode === "chat" && score === 0 && text.length > 80) {
    mode = "research";
    reasons.push("long unstructured request defaults to research");
  }

  const domains: string[] = [];
  const capabilities: string[] = [];
  const skillIntents: string[] = [];
  const expectedArtifacts: string[] = [];

  if (/adobe stock|stock opportunit|commercial/i.test(text)) {
    domains.push("adobe-stock");
    capabilities.push("web_research", "image_reasoning", "metadata_generation", "commercial_review");
    skillIntents.push("stock-research", "adobe-stock-policy", "prompt-engineering", "metadata", "commercial-review");
    expectedArtifacts.push("markdown", "concept-pack");
  }
  if (/trend/i.test(text)) {
    domains.push("trends");
    capabilities.push("web_research", "evidence_extraction");
    skillIntents.push("trend-research");
    expectedArtifacts.push("research-report");
  }
  if (/repo|github|architect|phase spec|implement/i.test(text)) {
    domains.push("software");
    capabilities.push("code", "architecture", "document_generation");
    skillIntents.push("repository-analysis", "architecture-designer", "security-reviewer", "technical-writer");
    expectedArtifacts.push("markdown");
  }
  if (/mcp/i.test(text)) {
    domains.push("mcp");
    capabilities.push("code", "protocol-design", "testing");
    skillIntents.push("build-mcp", "debug-mcp");
  }
  if (/code|typescript|refactor|test/i.test(text) && !domains.includes("software")) {
    domains.push("software");
    capabilities.push("code");
    skillIntents.push("coding");
    expectedArtifacts.push("diff");
  }
  if (domains.length === 0) domains.push("general");
  if (capabilities.length === 0) capabilities.push("text.chat");

  let risk: RiskClass = "R0";
  if (mode === "research") risk = "R1";
  if (mode === "coding" || /write|edit|apply|implement/i.test(text)) risk = "R2";
  if (/send|publish|email|message|deploy|delete|secret|credential/i.test(text)) risk = "R3";
  if (/destroy|production deploy|rotate secret|rm -rf/i.test(text)) risk = "R4";

  const complexity: TaskIntent["complexity"] =
    text.length > 400 || skillIntents.length >= 4 ? "high" : skillIntents.length >= 2 ? "medium" : "low";

  return {
    raw: text,
    mode,
    domains: unique(domains),
    capabilities: unique(capabilities),
    skillIntents: unique(skillIntents),
    risk,
    expectedArtifacts: unique(expectedArtifacts),
    complexity,
    reasons,
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
