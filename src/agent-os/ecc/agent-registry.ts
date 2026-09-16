// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Standardized Agent Role Registry with ECC Role Mapping & Permission Boundaries

import type { AgentDescriptor, ToolRiskClass } from "./types";
import { EccStore } from "./store";

export const PAO_AGENT_ROLES: AgentDescriptor[] = [
  {
    id: "pao-planner",
    role: "planner",
    name: "Task Planner",
    source: "pao",
    description: "Formulates structured step-by-step implementation plans, analyzes dependencies, and estimates risk.",
    readOnly: true,
    allowedRiskClasses: ["A"],
    allowedTools: ["read_file", "search_code", "list_dir", "read_docs"],
    requiredSkills: ["pao-architecture-review"],
  },
  {
    id: "pao-explorer",
    role: "explorer",
    name: "Repository Explorer",
    source: "pao",
    description: "Deep codebase reconnaissance, file layout discovery, and call graph inspection. Strictly read-only.",
    readOnly: true,
    allowedRiskClasses: ["A"],
    allowedTools: ["read_file", "search_code", "list_dir", "git_status", "git_diff"],
    requiredSkills: [],
  },
  {
    id: "pao-architect",
    role: "architect",
    name: "System Architect",
    source: "pao",
    description: "Designs system abstractions, interfaces, data schemas, and verifies architectural integrity.",
    readOnly: true,
    allowedRiskClasses: ["A"],
    allowedTools: ["read_file", "search_code", "list_dir"],
    requiredSkills: ["pao-architecture-review"],
  },
  {
    id: "pao-builder",
    role: "builder",
    name: "Software Builder",
    source: "pao",
    description: "Implements source changes, applies focused code patches, and compiles artifacts within workspace.",
    readOnly: false,
    allowedRiskClasses: ["A", "B", "C"],
    allowedTools: ["read_file", "write_file", "patch_file", "run_command", "run_test", "run_lint"],
    requiredSkills: ["pao-safe-edit"],
  },
  {
    id: "pao-test-engineer",
    role: "test_engineer",
    name: "Test Engineer",
    source: "pao",
    description: "Executes unit, integration, and regression test suites, ensuring all verification gates pass.",
    readOnly: false,
    allowedRiskClasses: ["A", "C"],
    allowedTools: ["read_file", "search_code", "run_command", "run_test", "run_lint"],
    requiredSkills: ["pao-test-before-ship"],
  },
  {
    id: "pao-reviewer",
    role: "reviewer",
    name: "Code Reviewer",
    source: "pao",
    description: "Examines proposed diffs for correctness, maintainability, and regression risks. Does not edit code.",
    readOnly: true,
    allowedRiskClasses: ["A"],
    allowedTools: ["read_file", "git_diff", "search_code"],
    requiredSkills: [],
  },
  {
    id: "pao-security-reviewer",
    role: "security_reviewer",
    name: "Security Reviewer",
    source: "pao",
    description: "Performs zero-trust threat modeling, secret leakage detection, and permissions validation. Mandatory for auth/security.",
    readOnly: true,
    allowedRiskClasses: ["A"],
    allowedTools: ["read_file", "search_code", "git_diff"],
    requiredSkills: ["ecc-security-review"],
    isSecurityCritical: true,
  },
  {
    id: "pao-docs-researcher",
    role: "docs_researcher",
    name: "Docs & Upstream Researcher",
    source: "pao",
    description: "Researches public API docs, external library changes, and dependency compatibility.",
    readOnly: true,
    allowedRiskClasses: ["A", "D"],
    allowedTools: ["read_file", "search_code", "browser", "read_docs"],
    requiredSkills: ["ecc-docs-research"],
  },
  {
    id: "pao-release-reviewer",
    role: "release_reviewer",
    name: "Release Reviewer",
    source: "pao",
    description: "Inspects release readiness, semver bump accuracy, changelog integrity, and deployment safety.",
    readOnly: true,
    allowedRiskClasses: ["A"],
    allowedTools: ["read_file", "git_status", "git_diff"],
    requiredSkills: [],
  },
];

export class AgentRegistry {
  private readonly store: EccStore;
  private memoryCache = new Map<string, AgentDescriptor>();

  constructor(store?: EccStore) {
    this.store = store ?? new EccStore();
    this.seedAgents();
  }

  private seedAgents(): void {
    for (const agent of PAO_AGENT_ROLES) {
      this.store.upsertAgent(agent);
      this.memoryCache.set(agent.role, agent);
    }
  }

  getAgent(role: string): AgentDescriptor | null {
    // Direct lookup or mapped lookup
    const normalizedRole = this.mapEccRoleToPao(role);
    return this.memoryCache.get(normalizedRole) ?? null;
  }

  listAgents(): AgentDescriptor[] {
    return Array.from(this.memoryCache.values());
  }

  /**
   * Maps an ECC or third-party agent role name to the standardized Pao role.
   */
  mapEccRoleToPao(roleName: string): string {
    const r = roleName.toLowerCase().trim();
    if (r === "ecc-explorer" || r === "explorer") return "explorer";
    if (r === "ecc-reviewer" || r === "reviewer" || r === "code-reviewer") return "reviewer";
    if (r === "ecc-architect" || r === "architect") return "architect";
    if (r === "ecc-builder" || r === "builder" || r === "coder" || r === "ecc-coder") return "builder";
    if (r === "ecc-tester" || r === "test_engineer" || r === "tester") return "test_engineer";
    if (r === "ecc-security" || r === "security" || r === "security_reviewer") return "security_reviewer";
    if (r === "ecc-docs" || r === "docs" || r === "docs_researcher" || r === "researcher") return "docs_researcher";
    if (r === "ecc-release" || r === "release" || r === "release_reviewer") return "release_reviewer";
    if (r === "ecc-planner" || r === "planner") return "planner";
    return r;
  }

  /**
   * Selects the optimal agent roles for a given task description and risk profile.
   */
  routeAgentsForTask(task: {
    description: string;
    isSecurityTask?: boolean;
    isReleaseTask?: boolean;
    isWriteTask?: boolean;
  }): AgentDescriptor[] {
    const roles: string[] = ["planner", "explorer"];
    const lower = task.description.toLowerCase();

    if (task.isSecurityTask || lower.includes("auth") || lower.includes("secret") || lower.includes("permission")) {
      roles.push("security_reviewer");
    }

    if (lower.includes("research") || lower.includes("upgrade") || lower.includes("docs")) {
      roles.push("docs_researcher");
    }

    if (task.isWriteTask || lower.includes("fix") || lower.includes("implement") || lower.includes("refactor")) {
      roles.push("architect");
      roles.push("builder");
      roles.push("test_engineer");
    }

    roles.push("reviewer");

    if (task.isReleaseTask || lower.includes("release") || lower.includes("publish")) {
      roles.push("release_reviewer");
    }

    return roles
      .map(r => this.getAgent(r))
      .filter((a): a is AgentDescriptor => a !== null);
  }

  /**
   * Validates if a role is permitted to execute a tool with a given risk class.
   */
  canRoleExecute(role: string, riskClass: ToolRiskClass, toolName: string): boolean {
    const agent = this.getAgent(role);
    if (!agent) return false;

    // Read-only agents can NEVER run Class B (write) or Class E (high-impact) tools
    if (agent.readOnly && (riskClass === "B" || riskClass === "E")) {
      return false;
    }

    if (!agent.allowedRiskClasses.includes(riskClass)) {
      return false;
    }

    // Check allowedTools if specified
    if (agent.allowedTools.length > 0 && !agent.allowedTools.includes(toolName)) {
      return false;
    }

    return true;
  }
}
