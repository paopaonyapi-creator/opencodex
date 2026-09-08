// Phase 21 — Evidence Pack Engine & Risk Classifier (spec sections 6, 12, 13).
//
// Classifies task risk (LOW, MEDIUM, HIGH), gathers grounding evidence,
// maps architecture decisions, and enforces the Knowledge-First guardrail.

import { openAgentOsDb } from "../db";
import { getKnowledgeProviderRegistry } from "./provider-registry";
import type { AgentTask, EvidencePack, TaskRiskLevel } from "./types";

export function classifyTaskRisk(task: AgentTask): TaskRiskLevel {
  if (task.riskLevel) return task.riskLevel;

  const text = [task.title, task.description || "", ...(task.targetComponents || [])].join(" ").toLowerCase();

  const highKeywords = [
    "architecture", "authentication", "auth", "token", "secret", "permission",
    "migration", "deploy", "reviewer council", "remote execution", "credentials",
    "circuit breaker", "system restart", "security",
  ];
  for (const kw of highKeywords) {
    if (text.includes(kw)) return "HIGH";
  }

  const mediumKeywords = [
    "endpoint", "mcp tool", "provider", "worker", "table", "schema",
    "config", "database", "queue", "batch", "route",
  ];
  for (const kw of mediumKeywords) {
    if (text.includes(kw)) return "MEDIUM";
  }

  return "LOW";
}

export class EvidencePackBuilder {
  async build(task: AgentTask): Promise<EvidencePack> {
    const taskId = task.id || `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const riskLevel = classifyTaskRisk(task);

    const registry = getKnowledgeProviderRegistry();
    const searchRes = await registry.search({
      query: task.title + (task.targetComponents ? " " + task.targetComponents.join(" ") : ""),
      limit: 6,
    });

    const sources = searchRes.results.map((r) => ({
      documentId: r.documentId,
      path: r.path,
      section: r.section,
      confidence: r.score,
    }));

    // Find ADRs and Architecture specs
    const architectureDecisions: string[] = [];
    const relatedComponents: string[] = task.targetComponents ? [...task.targetComponents] : [];

    for (const res of searchRes.results) {
      if (res.type === "decision") {
        architectureDecisions.push(res.title);
      }
      if (res.type === "architecture" && !relatedComponents.includes(res.title)) {
        relatedComponents.push(res.title);
      }
    }

    const conflicts: string[] = [];
    const unknowns: string[] = [];

    // Evaluate Knowledge-First Policy (spec section 13):
    // For HIGH risk: NO EVIDENCE = NO ARCHITECTURE CHANGE
    let allowedToProceed = true;
    let blockReason: string | undefined = undefined;
    let recommendation = "";

    if (riskLevel === "HIGH") {
      const topConfidence = sources.length > 0 ? sources[0].confidence : 0;
      if (sources.length === 0 || topConfidence < 0.60) {
        allowedToProceed = false;
        blockReason = "EVIDENCE_INSUFFICIENT: High-risk task lacks verified repository evidence.";
        recommendation = "BLOCKED: Provide supporting ADR or verified architecture document before proceeding.";
        unknowns.push("No grounding repository evidence found for requested high-risk task.");
      } else {
        allowedToProceed = true;
        recommendation = `Proceed with high-risk change grounded in ${sources.length} verified evidence source(s).`;
      }
    } else {
      allowedToProceed = true;
      recommendation = `Proceed with ${riskLevel.toLowerCase()} risk task.`;
    }

    const evidencePack: EvidencePack = {
      taskId,
      task: task.title,
      riskLevel,
      sources,
      relatedComponents,
      architectureDecisions,
      conflicts,
      unknowns,
      recommendation,
      allowedToProceed,
      blockReason,
    };

    // Persist to database
    try {
      const db = openAgentOsDb();
      const id = `evp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      db.query(`INSERT INTO kg_evidence_packs (
        id, task_id, task, risk_level, recommendation, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        taskId,
        task.title,
        riskLevel,
        recommendation,
        JSON.stringify(evidencePack),
        new Date().toISOString(),
      );
    } catch {
      // Non-fatal if db is in memory or testing
    }

    return evidencePack;
  }
}

let evidenceBuilderInstance: EvidencePackBuilder | null = null;
export function getEvidencePackBuilder(): EvidencePackBuilder {
  if (!evidenceBuilderInstance) {
    evidenceBuilderInstance = new EvidencePackBuilder();
  }
  return evidenceBuilderInstance;
}
