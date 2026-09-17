/**
 * Phase 20.84 — Decision Contract Registry
 * Declares all machine-evaluable contracts, choices, risk tiers, and threshold profiles.
 */

import type { DecisionContractDefinition } from "./types";

export class DecisionContractRegistry {
  private contracts = new Map<string, DecisionContractDefinition>();

  constructor() {
    this.seedDefaultContracts();
  }

  public register<TState, TDecision>(
    contract: DecisionContractDefinition<TState, TDecision>,
  ): void {
    this.contracts.set(contract.id, contract as unknown as DecisionContractDefinition);
  }

  public get(contractId: string): DecisionContractDefinition | undefined {
    return this.contracts.get(contractId);
  }

  public list(): DecisionContractDefinition[] {
    return Array.from(this.contracts.values());
  }

  private seedDefaultContracts(): void {
    this.register({
      id: "agent.route",
      version: "1.0.0",
      category: "routing",
      riskTier: "low",
      allowedChoices: [
        "codex",
        "reasoning_llm",
        "local_model",
        "reviewer_council",
        "direct_tool",
        "human",
      ],
      requiresHardPolicy: false,
      humanApprovalBypass: true,
      thresholdProfile: "low_risk_router",
      fallbackChoice: "reasoning_llm",
    });

    this.register({
      id: "mcp.tool.risk",
      version: "1.0.0",
      category: "tools",
      riskTier: "normal",
      allowedChoices: [
        "safe_read",
        "bounded_write",
        "network_outbound",
        "destructive",
        "privilege_escalation",
        "unknown",
      ],
      requiresHardPolicy: true,
      humanApprovalBypass: false,
      thresholdProfile: "normal_tool_use",
      fallbackChoice: "unknown",
    });

    this.register({
      id: "shell.command.risk",
      version: "1.0.0",
      category: "execution",
      riskTier: "critical",
      allowedChoices: [
        "safe_read_only",
        "bounded_mutation",
        "network_side_effect",
        "destructive",
        "privilege_escalation",
        "secret_access",
        "unknown",
      ],
      requiresHardPolicy: true,
      humanApprovalBypass: false,
      thresholdProfile: "privileged_tool_use",
      fallbackChoice: "unknown",
    });

    this.register({
      id: "code.diff.review_depth",
      version: "1.0.0",
      category: "review",
      riskTier: "normal",
      allowedChoices: [
        "standard",
        "deep_opencode",
        "council_multi_agent",
        "human_approval_block",
      ],
      requiresHardPolicy: true,
      humanApprovalBypass: false,
      thresholdProfile: "normal_tool_use",
      fallbackChoice: "deep_opencode",
    });

    this.register({
      id: "model.escalation",
      version: "1.0.0",
      category: "routing",
      riskTier: "low",
      allowedChoices: ["stay_fast", "escalate_reasoning", "escalate_human"],
      requiresHardPolicy: false,
      humanApprovalBypass: true,
      thresholdProfile: "low_risk_router",
      fallbackChoice: "escalate_reasoning",
    });
  }
}
