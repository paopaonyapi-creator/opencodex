// Phase 20.9 — Tool Risk Classifier
// Categorizes actions into 5 discrete risk levels:
// 'read_only', 'low', 'medium', 'high', 'critical'

import type { ToolRisk } from "../types";

export class ToolRiskClassifier {
  /**
   * Classifies an operation based on tool name and command/target patterns.
   */
  classify(toolName: string, args: Record<string, unknown> = {}): ToolRisk {
    const name = toolName.toLowerCase();
    const stringifiedArgs = JSON.stringify(args).toLowerCase();

    // 1. Critical Tier: Destructive DB, Force Push, Credential Manipulation, Arbitrary Elevated Shell
    if (
      stringifiedArgs.includes("force") && stringifiedArgs.includes("push") ||
      stringifiedArgs.includes("drop table") ||
      stringifiedArgs.includes("drop database") ||
      stringifiedArgs.includes("truncate") ||
      stringifiedArgs.includes("rm -rf") ||
      stringifiedArgs.includes("format c:") ||
      stringifiedArgs.includes("del /s") ||
      name.includes("delete_database") ||
      name.includes("rotate_master_secret")
    ) {
      return "critical";
    }

    // 2. High Tier: File Deletions, Deployments, Git Push, External API Write, System Configuration
    if (
      name.includes("delete") ||
      name.includes("remove") ||
      name.includes("push") ||
      name.includes("deploy") ||
      name.includes("publish") ||
      stringifiedArgs.includes("git push")
    ) {
      return "high";
    }

    // 3. Medium Tier: File Edits, Project File Creation, Package Installs
    if (
      name.includes("write") ||
      name.includes("edit") ||
      name.includes("create") ||
      name.includes("patch") ||
      name.includes("install") ||
      name.includes("package")
    ) {
      return "medium";
    }

    // 4. Low Tier: Linting, Unit Testing, Temporary Artifact Generation
    if (
      name.includes("lint") ||
      name.includes("test") ||
      name.includes("typecheck") ||
      name.includes("temp")
    ) {
      return "low";
    }

    // 5. Read-Only Tier: Reads, Searches, Status, Directory Listings
    if (
      name.includes("read") ||
      name.includes("search") ||
      name.includes("list") ||
      name.includes("status") ||
      name.includes("inspect") ||
      name.includes("get")
    ) {
      return "read_only";
    }

    // Default to medium if ambiguous
    return "medium";
  }
}

let defaultRiskClassifier: ToolRiskClassifier | null = null;
export function getToolRiskClassifier(): ToolRiskClassifier {
  if (!defaultRiskClassifier) {
    defaultRiskClassifier = new ToolRiskClassifier();
  }
  return defaultRiskClassifier;
}
