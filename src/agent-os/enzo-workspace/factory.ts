// Phase 20.94 — self-drafting agent factory (two-pass).
// Canonical compiler ownership is Forge (Phase 20.90). No Forge runtime package
// exists in this checkout, so the composition layer implements the two-pass
// contract locally. A ForgeAdapter seam is kept for a future drop-in.

import { createHash } from "node:crypto";
import { classifyIntent } from "./intent";
import { defaultBudget, type AgentBlueprint, type DomainAnalysis, type TaskIntent } from "./types";

export interface ForgeCompiler {
  analyze(intent: TaskIntent): DomainAnalysis;
  compile(analysis: DomainAnalysis, intent: TaskIntent, slug?: string): AgentBlueprint;
}

export class LocalForgeCompiler implements ForgeCompiler {
  analyze(intent: TaskIntent): DomainAnalysis {
    const domain = intent.domains[0] ?? "general";
    const stages = stagesFor(intent);
    return {
      domain,
      requiredExpertise: intent.capabilities,
      tacitKnowledge: tacitFor(domain),
      stages,
      failureModes: [
        "unsupported claims without sources",
        "budget exhaustion before synthesis",
        "policy-denied side effects",
        "untrusted skill injection",
      ],
      edgeCases: ["conflicting evidence", "unconfigured provider", "expired credential lease"],
      verificationStrategy: verificationFor(intent),
      expectedArtifacts: intent.expectedArtifacts.length ? intent.expectedArtifacts : ["markdown"],
      requiredTools: toolsFor(intent),
      requiredMemories: ["L2 Project Memory", "L5 Evidence Store"],
      permissions: permissionsFor(intent.risk),
      budgetProfile: intent.complexity === "high" ? "high" : intent.complexity === "medium" ? "medium" : "low",
    };
  }

  compile(analysis: DomainAnalysis, intent: TaskIntent, slug?: string): AgentBlueprint {
    const name = nameFor(intent, analysis);
    const resolvedSlug = slug ?? slugify(name);
    const hash = createHash("sha256").update(intent.raw + "|" + analysis.domain).digest("hex").slice(0, 12);
    const budget = defaultBudget({
      maxQueries: analysis.budgetProfile === "high" ? 30 : analysis.budgetProfile === "medium" ? 16 : 8,
      maxCostUsd: analysis.budgetProfile === "high" ? 4 : analysis.budgetProfile === "medium" ? 2 : 1,
      maxTokens: analysis.budgetProfile === "high" ? 250000 : 120000,
    });
    return {
      id: "ag_" + hash,
      slug: resolvedSlug,
      name,
      version: 1,
      objective: intent.raw,
      role: analysis.domain + " specialist",
      instructions: [
        "Research evidence before committing to a conclusion.",
        "Separate observed evidence from inference.",
        "Reject outputs with unclear commercial or technical use.",
        "Run policy checks before irreversible actions.",
        "Preserve claim-to-source mapping.",
        "Stop when the hard budget is exhausted.",
      ],
      inputs: ["user_request", "policy_profile", "budget"],
      requiredCapabilities: unique([...intent.capabilities, ...analysis.requiredExpertise]),
      skillIntents: intent.skillIntents,
      tools: analysis.requiredTools,
      modelPolicy: {
        routeGroup: intent.mode === "coding" ? "coding-high" : "balanced",
        requiredCapabilities: intent.capabilities.includes("code") ? ["coding", "structured_output"] : ["text.chat"],
        localOnly: false,
        maxCostUsd: budget.maxCostUsd,
      },
      memoryPolicy: {
        layers: ["L0", "L1", "L3", "L5"],
        autoAcceptMinConfidence: 0.95,
      },
      executionBudget: budget,
      permissions: analysis.permissions,
      approvalRules: [
        "R3 external side effects require approval",
        "R4 destructive/credential/deploy require approval",
      ],
      outputContract: analysis.expectedArtifacts,
      retryPolicy: { maxAttempts: 3 },
      observabilityPolicy: { recordProvenance: true },
      draftedBy: "forge-local:two-pass",
      immutable: false,
    };
  }
}

export function draftAgent(raw: string, slug?: string): { intent: TaskIntent; analysis: DomainAnalysis; blueprint: AgentBlueprint } {
  const intent = classifyIntent(raw);
  const compiler = new LocalForgeCompiler();
  const analysis = compiler.analyze(intent);
  const blueprint = compiler.compile(analysis, intent, slug);
  return { intent, analysis, blueprint };
}

function stagesFor(intent: TaskIntent): string[] {
  if (intent.mode === "research" || intent.domains.includes("adobe-stock")) {
    return ["define-question", "plan", "search", "extract", "assess", "synthesize", "verify"];
  }
  if (intent.mode === "coding") {
    return ["scan", "plan", "edit", "build", "test", "review", "repair"];
  }
  return ["plan", "execute", "verify"];
}

function tacitFor(domain: string): string[] {
  if (domain === "adobe-stock") return ["commercial usefulness beats novelty", "policy-rejected concepts waste production"];
  if (domain === "software") return ["reuse existing Pao-hubPro seams", "do not duplicate subsystems"];
  return ["prefer evidence over guesses"];
}

function verificationFor(intent: TaskIntent): string[] {
  if (intent.mode === "coding") return ["typecheck", "focused tests", "review findings"];
  return ["claim-to-source mapping", "uncertainty representation"];
}

function toolsFor(intent: TaskIntent): string[] {
  const tools = ["memory.search"];
  if (intent.capabilities.includes("web_research")) tools.push("web.search", "web.fetch");
  if (intent.capabilities.includes("code")) tools.push("filesystem.read", "filesystem.write.scoped");
  return unique(tools);
}

function permissionsFor(risk: TaskIntent["risk"]): string[] {
  if (risk === "R4") return ["read", "scoped-write", "approval:destructive"];
  if (risk === "R3") return ["read", "scoped-write", "approval:external"];
  if (risk === "R2") return ["read", "scoped-write"];
  if (risk === "R1") return ["read", "retrieve"];
  return ["read"];
}

function nameFor(intent: TaskIntent, analysis: DomainAnalysis): string {
  if (intent.domains.includes("adobe-stock")) return "Adobe Stock Research Agent";
  if (intent.mode === "coding") return "Coding Workspace Agent";
  if (intent.mode === "research") return "Budget-Governed Research Agent";
  return analysis.domain.replace(/-/g, " ") + " agent";
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "agent";
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
