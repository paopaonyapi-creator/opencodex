// Phase 21 — Knowledge Gateway Configuration (spec sections 19, 31, 33).

export interface KnowledgeProviderConfig {
  enabled: boolean;
  priority: number;
  timeoutMs: number;
}

export interface NotebookLMConfig extends KnowledgeProviderConfig {
  apiKey?: string;
  notebookId?: string;
}

export interface KnowledgeConfig {
  enabled: boolean;
  rootDirectories: string[];
  maxSearchResults: number;
  evidenceConfidenceThreshold: number;
  highRiskRequiresEvidence: boolean;
  providers: {
    local: KnowledgeProviderConfig;
    git: KnowledgeProviderConfig;
    notebooklm: NotebookLMConfig;
  };
}

export function getKnowledgeConfig(): KnowledgeConfig {
  return {
    enabled: process.env.PAO_KNOWLEDGE_ENABLED !== "false",
    rootDirectories: ["knowledge", "docs"],
    maxSearchResults: 20,
    evidenceConfidenceThreshold: 0.70,
    highRiskRequiresEvidence: true,
    providers: {
      local: {
        enabled: true,
        priority: 100,
        timeoutMs: 500,
      },
      git: {
        enabled: true,
        priority: 95,
        timeoutMs: 1000,
      },
      notebooklm: {
        enabled: process.env.PAO_NOTEBOOKLM_ENABLED === "true",
        priority: 70,
        timeoutMs: 5000,
        apiKey: process.env.NOTEBOOKLM_API_KEY,
        notebookId: process.env.NOTEBOOKLM_NOTEBOOK_ID,
      },
    },
  };
}
