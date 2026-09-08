// Phase 21 — Pao Knowledge Gateway (spec sections 10, 480).
//
// The central grounded gateway for Codex, Claude, ChatGPT, Local AI,
// and the Reviewer Council to query repository knowledge with verified evidence.

import { openAgentOsDb } from "../db";
import { getClaimVerifier } from "./claim-verifier";
import { getEvidencePackBuilder } from "./evidence-pack";
import { getPhaseGraphManager } from "./phase-graph";
import { getKnowledgeProviderRegistry } from "./provider-registry";
import { LocalKnowledgeProvider } from "./providers/local-provider";
import type {
  AgentTask,
  ClaimVerification,
  DependencyGraph,
  EvidencePack,
  GroundedSearchResult,
  KnowledgeDocument,
  KnowledgeQuery,
  PhaseComparison,
  ProviderHealth,
} from "./types";

export class PaoKnowledgeGateway {
  private registry = getKnowledgeProviderRegistry();
  private verifier = getClaimVerifier();
  private evidenceBuilder = getEvidencePackBuilder();
  private graphManager = getPhaseGraphManager();

  async search(query: KnowledgeQuery): Promise<GroundedSearchResult> {
    const res = await this.registry.search(query);
    this.recordAudit("search", query.query, res.results.map((r) => r.documentId), `Found ${res.totalFound} results`);
    return res;
  }

  async verifyClaim(claim: string): Promise<ClaimVerification> {
    const res = await this.verifier.verify(claim);
    this.recordAudit(
      "verify_claim",
      claim,
      res.evidence.map((e) => e.documentId),
      `Status: ${res.status} (confidence: ${res.confidence})`,
    );
    return res;
  }

  async getDocument(id: string): Promise<KnowledgeDocument | null> {
    const local = this.registry.getProvider("local") as LocalKnowledgeProvider | undefined;
    if (local) {
      const doc = await local.getDocument(id);
      if (doc) return doc;
    }
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM kg_documents WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;

    return {
      id: String(row.id),
      type: String(row.doc_type) as any,
      title: String(row.title),
      path: String(row.path),
      hash: String(row.hash),
      version: Number(row.version),
      status: String(row.status) as any,
      sourcePriority: Number(row.source_priority),
      tags: JSON.parse(String(row.tags_json || "[]")),
      metadata: JSON.parse(String(row.metadata_json || "{}")),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      indexedAt: String(row.indexed_at),
    };
  }

  async getPhase(phaseId: string): Promise<KnowledgeDocument | null> {
    const clean = phaseId.replace(/^phase\s*[-_]?/i, "").toLowerCase();
    const candidates = [`phase-${clean}`, `phase_${clean}`, clean];

    for (const cand of candidates) {
      const doc = await this.getDocument(cand);
      if (doc && doc.type === "phase") return doc;
    }

    // Search by title match if ID didn't match directly
    const searchRes = await this.search({ query: `Phase ${clean}`, types: ["phase"], limit: 1 });
    if (searchRes.results.length > 0) {
      return this.getDocument(searchRes.results[0].documentId);
    }

    return null;
  }

  async comparePhases(phaseA: string, phaseB: string): Promise<PhaseComparison> {
    return this.graphManager.comparePhases(phaseA, phaseB);
  }

  async getDependencies(targetPhase: string): Promise<DependencyGraph> {
    return this.graphManager.getDependencies(targetPhase);
  }

  async buildEvidencePack(task: AgentTask): Promise<EvidencePack> {
    const pack = await this.evidenceBuilder.build(task);
    this.recordAudit(
      "build_evidence_pack",
      task.title,
      pack.sources.map((s) => s.documentId),
      pack.allowedToProceed ? "ALLOWED" : "BLOCKED: " + (pack.blockReason || ""),
      pack.allowedToProceed ? undefined : "EVIDENCE_INSUFFICIENT",
    );
    return pack;
  }

  refreshKnowledge(workspaceRoot?: string): { indexed: number; skipped: number; sensitiveBlocked: number } {
    const local = this.registry.getProvider("local") as LocalKnowledgeProvider | undefined;
    if (!local) {
      return { indexed: 0, skipped: 0, sensitiveBlocked: 0 };
    }
    const res = local.refreshIndex(workspaceRoot);
    this.recordAudit("refresh", "all", [], `Indexed: ${res.indexed}, Skipped: ${res.skipped}, Blocked: ${res.sensitiveBlocked}`);
    return res;
  }

  async getHealth(): Promise<{
    status: "healthy" | "degraded" | "unavailable";
    providers: ProviderHealth[];
    stats: { documents: number; sections: number; phases: number; decisions: number };
  }> {
    const providers = await this.registry.healthCheck();
    const hasHealthy = providers.some((p) => p.status === "healthy");
    const allHealthy = providers.every((p) => p.status === "healthy");

    let status: "healthy" | "degraded" | "unavailable" = "healthy";
    if (!hasHealthy) status = "unavailable";
    else if (!allHealthy) status = "degraded";

    const db = openAgentOsDb();
    const docCount = (db.query("SELECT COUNT(*) as c FROM kg_documents").get() as { c: number })?.c || 0;
    const secCount = (db.query("SELECT COUNT(*) as c FROM kg_sections").get() as { c: number })?.c || 0;
    const phaseCount = (db.query("SELECT COUNT(*) as c FROM kg_documents WHERE doc_type = 'phase'").get() as { c: number })?.c || 0;
    const decisionCount = (db.query("SELECT COUNT(*) as c FROM kg_documents WHERE doc_type = 'decision'").get() as { c: number })?.c || 0;

    return {
      status,
      providers,
      stats: {
        documents: docCount,
        sections: secCount,
        phases: phaseCount,
        decisions: decisionCount,
      },
    };
  }

  private recordAudit(action: string, query: string, sources: string[], result: string, errorCode?: any): void {
    try {
      const db = openAgentOsDb();
      const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      db.query(`INSERT INTO kg_audit_events (
        id, agent, action, query, sources_json, result, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        "gateway",
        action,
        query,
        JSON.stringify(sources),
        result,
        errorCode || null,
        new Date().toISOString(),
      );
    } catch {
      // Non-fatal
    }
  }
}

let gatewayInstance: PaoKnowledgeGateway | null = null;
export function getKnowledgeGateway(): PaoKnowledgeGateway {
  if (!gatewayInstance) {
    gatewayInstance = new PaoKnowledgeGateway();
  }
  return gatewayInstance;
}
