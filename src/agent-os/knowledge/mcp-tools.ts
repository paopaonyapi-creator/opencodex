// Phase 21 — Knowledge Gateway MCP Tools (spec sections 11, 56(K)).
//
// 10 canonical Model Context Protocol tools exposing repository search,
// claim verification, phase comparison, evidence pack generation, and health checks.

import { getKnowledgeGateway } from "./gateway";
import type { KnowledgeDocType, TaskRiskLevel } from "./types";

export interface KnowledgeMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export const KNOWLEDGE_MCP_TOOLS: Record<string, KnowledgeMcpToolDefinition> = {
  pao_knowledge_search: {
    name: "pao_knowledge_search",
    description: "Search project knowledge, architecture specs, ADRs, and phase documents with source ranking and section snippets.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term or concept to find in repository knowledge" },
        types: {
          type: "array",
          items: { type: "string" },
          description: "Filter by document types (phase, architecture, decision, specification, research, operation)",
        },
        limit: { type: "number", description: "Maximum number of results to return (default 10)" },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const res = await gw.search({
        query: String(args.query),
        types: Array.isArray(args.types) ? (args.types as KnowledgeDocType[]) : undefined,
        limit: args.limit ? Number(args.limit) : 10,
      });
      return {
        query: res.query,
        results: res.results,
        total_found: res.totalFound,
        providers_used: res.providersUsed,
        duration_ms: res.durationMs,
      };
    },
  },

  pao_knowledge_get_document: {
    name: "pao_knowledge_get_document",
    description: "Retrieve a specific knowledge document by ID.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document identifier (e.g. adr-005, arch-knowledge-gateway)" },
      },
      required: ["document_id"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const doc = await gw.getDocument(String(args.document_id));
      if (!doc) return { found: false, document: null };
      return { found: true, document: doc };
    },
  },

  pao_knowledge_get_phase: {
    name: "pao_knowledge_get_phase",
    description: "Look up details and roadmap documentation for a specific Pao-hubPro phase.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        phase_id: { type: "string", description: "Phase number or ID (e.g. 21, 20.4, 20.10)" },
      },
      required: ["phase_id"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const phase = await gw.getPhase(String(args.phase_id));
      if (!phase) return { found: false, phase: null };
      return { found: true, phase };
    },
  },

  pao_knowledge_compare_phases: {
    name: "pao_knowledge_compare_phases",
    description: "Compare two Pao-hubPro phases, identifying shared components, dependency relations, and superseded items.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        phase_a: { type: "string", description: "First phase identifier (e.g. 20.4)" },
        phase_b: { type: "string", description: "Second phase identifier (e.g. 21)" },
      },
      required: ["phase_a", "phase_b"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const comparison = await gw.comparePhases(String(args.phase_a), String(args.phase_b));
      return comparison as any;
    },
  },

  pao_knowledge_get_dependencies: {
    name: "pao_knowledge_get_dependencies",
    description: "Get architectural phase dependencies and downstream dependents for a given phase.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        target_phase: { type: "string", description: "Phase identifier (e.g. 21, 20.1)" },
      },
      required: ["target_phase"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const deps = await gw.getDependencies(String(args.target_phase));
      return deps as any;
    },
  },

  pao_knowledge_get_decision: {
    name: "pao_knowledge_get_decision",
    description: "Retrieve an Architecture Decision Record (ADR) governing project structure.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "Decision ID or keyword (e.g. adr-005, knowledge-gateway)" },
      },
      required: ["decision_id"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const id = String(args.decision_id);
      let doc = await gw.getDocument(id);
      if (!doc) {
        const searchRes = await gw.search({ query: id, types: ["decision"], limit: 1 });
        if (searchRes.results.length > 0) {
          doc = await gw.getDocument(searchRes.results[0].documentId);
        }
      }
      return { found: Boolean(doc), decision: doc };
    },
  },

  pao_knowledge_verify_claim: {
    name: "pao_knowledge_verify_claim",
    description: "Verify whether an architectural claim or assumption is grounded in repository documentation.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        claim: { type: "string", description: "Factual claim to verify against project knowledge" },
      },
      required: ["claim"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const verification = await gw.verifyClaim(String(args.claim));
      return verification as any;
    },
  },

  pao_knowledge_build_evidence_pack: {
    name: "pao_knowledge_build_evidence_pack",
    description: "Build a verified Evidence Pack for an engineering task before planning or review. Blocks execution if high-risk evidence is insufficient.",
    riskTier: "MEDIUM",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task title or requested modification" },
        description: { type: "string", description: "Detailed description of planned change" },
        risk_level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "Declared or inferred risk level" },
        components: { type: "array", items: { type: "string" }, description: "Affected components" },
      },
      required: ["task"],
    },
    handler: async (args) => {
      const gw = getKnowledgeGateway();
      const pack = await gw.buildEvidencePack({
        title: String(args.task),
        description: args.description ? String(args.description) : undefined,
        riskLevel: args.risk_level ? (args.risk_level as TaskRiskLevel) : undefined,
        targetComponents: Array.isArray(args.components) ? args.components.map(String) : undefined,
      });
      return pack as any;
    },
  },

  pao_knowledge_refresh: {
    name: "pao_knowledge_refresh",
    description: "Perform incremental scan and re-indexing of repository markdown documents and ADRs.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: () => {
      const gw = getKnowledgeGateway();
      const result = gw.refreshKnowledge();
      return result;
    },
  },

  pao_knowledge_health: {
    name: "pao_knowledge_health",
    description: "Inspect Knowledge Gateway health, active providers, indexed document stats, and latencies.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const gw = getKnowledgeGateway();
      const health = await gw.getHealth();
      return health as any;
    },
  },
};
