// Phase 20.8 — Capability Taxonomy & Synonym Expansion

export const CAPABILITY_TAXONOMY: Record<string, { synonyms: string[]; division: string }> = {
  architecture: {
    synonyms: ["software-architect", "system-design", "domain-driven-design", "architect", "patterns"],
    division: "engineering",
  },
  backend: {
    synonyms: ["backend-architect", "api", "rest", "server", "microservices", "database-optimizer", "sql"],
    division: "engineering",
  },
  frontend: {
    synonyms: ["frontend-developer", "ui", "react", "nextjs", "vite", "css", "tailwind", "responsive"],
    division: "engineering",
  },
  database: {
    synonyms: ["database-optimizer", "postgres", "sqlite", "indexing", "sql-best-practices", "schema"],
    division: "engineering",
  },
  mcp: {
    synonyms: ["mcp-builder", "model-context-protocol", "mcp-server", "tools", "protocol", "json-rpc"],
    division: "specialized",
  },
  "multi-agent": {
    synonyms: ["agents-orchestrator", "agent-task-handoff", "multi-agent-systems", "identity-graph-operator"],
    division: "specialized",
  },
  "ai-engineering": {
    synonyms: ["ai-engineer", "prompt-engineer", "llm", "embeddings", "rag", "evals"],
    division: "engineering",
  },
  "prompt-engineering": {
    synonyms: ["image-prompt-engineer", "prompt-crafter", "creative-prompts", "system-prompts"],
    division: "design",
  },
  devtools: {
    synonyms: ["developer-tooling-engineer", "lsp-index-engineer", "terminal-integration"],
    division: "engineering",
  },
  devops: {
    synonyms: ["devops-automator", "ci-cd", "docker", "cloud", "infra", "sre"],
    division: "engineering",
  },
  security: {
    synonyms: ["security-architect", "security-engineer", "threat-detection", "auth", "rbac", "secure-code-review"],
    division: "security",
  },
  "application-security": {
    synonyms: ["appsec", "vulnerability", "input-validation", "secrets-management", "firewall"],
    division: "security",
  },
  "identity-access": {
    synonyms: ["auth", "auth-and-authorization", "oauth", "jwt", "session", "rbac", "permissions"],
    division: "security",
  },
  testing: {
    synonyms: ["test-automation", "api-tester", "evidence-collector", "test-results-analyzer", "unit-tests"],
    division: "testing",
  },
  "code-review": {
    synonyms: ["code-reviewer", "pr-review", "refactor", "correctness", "code-quality"],
    division: "engineering",
  },
  "reality-validation": {
    synonyms: ["reality-checker", "ground-truth", "no-hallucination", "evidence-verifier"],
    division: "testing",
  },
  "workflow-optimization": {
    synonyms: ["workflow-optimizer", "process", "sprint-prioritizer", "jira-workflow"],
    division: "project-management",
  },
  research: {
    synonyms: ["trend-researcher", "market-research", "literature-search", "discovery"],
    division: "research",
  },
  "market-research": {
    synonyms: ["trend-research", "competitive-analysis", "audience-insights"],
    division: "marketing",
  },
  seo: {
    synonyms: ["seo-specialist", "search-engine-optimization", "keywords", "organic-growth"],
    division: "marketing",
  },
  content: {
    synonyms: ["content-creator", "technical-writer", "copywriter", "storyteller"],
    division: "marketing",
  },
  "image-generation": {
    synonyms: ["image-studio", "diffusion", "comfyui", "midjourney", "minimax-h3"],
    division: "design",
  },
  video: {
    synonyms: ["video-factory", "mpt", "moneyprinterturbo", "video-editor", "motion"],
    division: "specialized",
  },
  "stock-production": {
    synonyms: ["adobe-stock", "commercial-utility", "stock-reviewer", "metadata-tagger"],
    division: "design",
  },
};

export function expandSearchQueryCapabilities(query: string): string[] {
  const normalized = query.toLowerCase();
  const matchedCapabilities = new Set<string>();

  for (const [key, details] of Object.entries(CAPABILITY_TAXONOMY)) {
    if (normalized.includes(key)) {
      matchedCapabilities.add(key);
    }
    for (const syn of details.synonyms) {
      if (normalized.includes(syn.replace(/-/g, " ")) || normalized.includes(syn)) {
        matchedCapabilities.add(key);
      }
    }
  }

  return Array.from(matchedCapabilities);
}

export const expandCapabilityTerms = expandSearchQueryCapabilities;

