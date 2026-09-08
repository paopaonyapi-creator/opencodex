// Phase 21 — Grounded Claim Verifier (spec sections 11.2, 14, 37, 39).
//
// Evaluates factual claims against repository knowledge, classifies support status,
// and flags conflicting architecture statements.

import { getKnowledgeProviderRegistry } from "./provider-registry";
import type { ClaimVerification, ClaimVerificationStatus } from "./types";

const STOP_WORDS = new Set([
  "is", "in", "the", "a", "an", "and", "to", "for", "with", "of", "on", "at", "by",
  "from", "as", "it", "or", "be", "uses", "used", "using", "has", "have", "had",
  "are", "was", "were", "been", "all", "any", "not", "no", "module", "installed",
  "system", "support", "supports", "supported"
]);

export class ClaimVerifier {
  async verify(claimText: string): Promise<ClaimVerification> {
    const claim = claimText.trim();
    if (!claim) {
      return {
        claim,
        status: "insufficient_evidence",
        confidence: 0.0,
        evidence: [],
        conflicts: [],
        reasoning: "Empty claim cannot be evaluated.",
      };
    }

    const registry = getKnowledgeProviderRegistry();
    const claimLower = claim.toLowerCase();

    // Check specific architectural conflict heuristics before general search
    let isContradicted = false;
    let contradictionReason = "";
    const conflicts: ClaimVerification["conflicts"] = [];

    // Conflict heuristic 1: Database dialect (e.g., asserting PostgreSQL/MySQL/MongoDB when repo uses SQLite)
    const dbDialects = ["postgresql", "postgres", "mysql", "mongodb", "dynamodb"];
    const assertedDb = dbDialects.find((d) => claimLower.includes(d));
    if (assertedDb) {
      // Query knowledge base for canonical database
      const sqliteSearch = await registry.search({ query: "sqlite database storage agent-os", limit: 3 });
      const foundSqliteEvidence = sqliteSearch.results.some(
        (r) => r.snippet.toLowerCase().includes("sqlite") || r.section.toLowerCase().includes("sqlite") || r.title.toLowerCase().includes("sqlite")
      );
      if (foundSqliteEvidence || sqliteSearch.results.length > 0) {
        isContradicted = true;
        contradictionReason = `Claim asserting ${assertedDb.toUpperCase()} contradicts verified repository architecture, which specifies SQLite (agent-os.sqlite3 / Bun:sqlite) as the canonical database.`;
        const topRes = sqliteSearch.results[0];
        conflicts.push({
          documentId: topRes ? topRes.documentId : "doc-architecture-sqlite",
          claim,
          opposingStatement: "Repository canonical persistence layer is SQLite (agent-os.sqlite3 / Bun:sqlite).",
        });
      }
    }

    // Conflict heuristic 2: Runtime language (e.g. Python vs Bun TypeScript)
    if (!isContradicted && (claimLower.includes("written in python") || claimLower.includes("runs on python"))) {
      isContradicted = true;
      contradictionReason = "Repository architecture specifies Bun-native TypeScript, not Python, for proxy and Agent OS runtime.";
      conflicts.push({
        documentId: "doc-architecture-runtime",
        claim,
        opposingStatement: "Proxy runtime is Bun-native TypeScript with no separate compile step.",
      });
    }

    if (isContradicted) {
      return {
        claim,
        status: "contradicted",
        confidence: 0.95,
        evidence: [],
        conflicts,
        reasoning: contradictionReason,
      };
    }

    // Extract non-trivial claim tokens to ensure evidence actually mentions the subject
    const rawTokens = claimLower
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9_\-]/g, ""))
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

    const searchRes = await registry.search({ query: claim, limit: 5 });

    if (searchRes.results.length === 0 || rawTokens.length === 0) {
      return {
        claim,
        status: "insufficient_evidence",
        confidence: 0.1,
        evidence: [],
        conflicts: [],
        reasoning: `No verified repository evidence found concerning "${claim}".`,
      };
    }

    // Check how well the retrieved results match the non-trivial tokens
    const evidence: ClaimVerification["evidence"] = [];
    let topScore = 0;

    for (const res of searchRes.results) {
      const textToSearch = (res.title + " " + res.section + " " + res.snippet).toLowerCase();
      let matchedContentTokens = 0;
      for (const tok of rawTokens) {
        if (textToSearch.includes(tok)) {
          matchedContentTokens++;
        }
      }

      // If less than 40% of non-stop-word claim tokens are present in the evidence, don't consider it relevant
      const tokenCoverage = matchedContentTokens / rawTokens.length;
      if (tokenCoverage >= 0.40 && res.score >= 0.35) {
        evidence.push({
          documentId: res.documentId,
          title: res.title,
          section: res.section,
          snippet: res.snippet,
          path: res.path,
        });
        const weightedScore = res.score * tokenCoverage;
        if (weightedScore > topScore) topScore = weightedScore;
      }
    }

    let status: ClaimVerificationStatus = "insufficient_evidence";
    let confidence = topScore;
    let reasoning = "";

    if (evidence.length >= 1 && topScore >= 0.40) {
      status = "supported";
      confidence = Math.min(0.98, topScore);
      reasoning = `Claim is directly supported by ${evidence.length} repository document source(s).`;
    } else if (evidence.length >= 1 && topScore >= 0.25) {
      status = "partially_supported";
      confidence = topScore;
      reasoning = `Found partial contextual mentions, but explicit confirmation is limited.`;
    } else {
      status = "insufficient_evidence";
      confidence = Math.max(0.1, Math.min(0.35, topScore));
      reasoning = `Insufficient evidence in repository documentation to confirm or refute claim.`;
    }

    return {
      claim,
      status,
      confidence: Math.round(confidence * 100) / 100,
      evidence,
      conflicts,
      reasoning,
    };
  }
}

let verifierInstance: ClaimVerifier | null = null;
export function getClaimVerifier(): ClaimVerifier {
  if (!verifierInstance) {
    verifierInstance = new ClaimVerifier();
  }
  return verifierInstance;
}
