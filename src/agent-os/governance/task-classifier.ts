// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Task Classifier: Categorization & Risk Level Determination

import type { GovernanceRiskLevel, TaskType } from "./types";

export interface TaskClassification {
  taskType: TaskType;
  risk: GovernanceRiskLevel;
  triggersReviewerCouncil: boolean;
  sensitiveAreas: string[];
  reasons: string[];
}

export class TaskClassifier {
  /**
   * Deterministically classifies a task prompt into category, risk level, and council triggers.
   */
  classify(prompt: string, context?: { affectedFiles?: string[]; isDestructive?: boolean }): TaskClassification {
    const text = prompt.toLowerCase();
    const sensitiveAreas: string[] = [];
    const reasons: string[] = [];

    // 1. Detect Sensitive Areas
    if (/\b(auth|login|oauth|token|jwt|session|credential|password|secret|key)\b/i.test(text)) {
      sensitiveAreas.push("authentication_and_secrets");
    }
    if (/\b(permission|rbac|acl|policy|allowlist|whitelist|sandbox)\b/i.test(text)) {
      sensitiveAreas.push("permissions_and_policy");
    }
    if (/\b(migrate|migration|alter\s+table|drop\s+table|schema|ddl|sql)\b/i.test(text)) {
      sensitiveAreas.push("database_migration");
    }
    if (/\b(backup|restore|dump|wal|snapshot)\b/i.test(text)) {
      sensitiveAreas.push("backup_and_recovery");
    }
    if (/\b(rm\s+-rf|del\s+\/|delete\s+file|purge|wipe|format|truncate)\b/i.test(text) || context?.isDestructive) {
      sensitiveAreas.push("destructive_file_ops");
    }
    if (/\b(shell|exec|cmd|bash|powershell|spawn|subprocess|runpod|remote)\b/i.test(text)) {
      sensitiveAreas.push("process_and_remote_execution");
    }
    if (/\b(mcp|tool\s+call|write_file|delete_file)\b/i.test(text)) {
      sensitiveAreas.push("mcp_mutation_tools");
    }
    if (/\b(git\s+push|force\s+push|publish|deploy|release)\b/i.test(text)) {
      sensitiveAreas.push("deployment_and_publishing");
    }

    // Check affected files if provided
    if (context?.affectedFiles) {
      for (const file of context.affectedFiles) {
        const lowerFile = file.toLowerCase();
        if (lowerFile.includes("auth") || lowerFile.includes("token") || lowerFile.includes("secret")) {
          sensitiveAreas.push("auth_files");
        }
        if (lowerFile.includes("migration") || lowerFile.includes("schema") || lowerFile.endsWith(".sql")) {
          sensitiveAreas.push("migration_files");
        }
        if (lowerFile.includes("mcp") || lowerFile.includes("policy")) {
          sensitiveAreas.push("policy_files");
        }
      }
    }

    // 2. Determine Task Type
    let taskType: TaskType = "feature";
    if (/\b(research|investigate|explore|find|learn|understand|compare)\b/i.test(text)) {
      taskType = "research";
    } else if (/\b(plan|spec|design|roadmap|rfc|adr)\b/i.test(text)) {
      taskType = "planning";
    } else if (/\b(fix|bug|issue|defect|error|crash|regression|patch)\b/i.test(text)) {
      taskType = "bugfix";
    } else if (/\b(refactor|clean\s*up|simplify|dedup|modernize|reorganize)\b/i.test(text)) {
      taskType = "refactor";
    } else if (/\b(migrate|migration|upgrade\s+schema|v\d+\s+migration)\b/i.test(text)) {
      taskType = "migration";
    } else if (sensitiveAreas.includes("authentication_and_secrets") || sensitiveAreas.includes("permissions_and_policy")) {
      taskType = "security";
    } else if (/\b(docker|ci|workflow|action|k8s|devops|build\.gradle|deploy)\b/i.test(text)) {
      taskType = "infrastructure";
    } else if (/\b(mcp\s+server|mcp\s+tool|model\s+context\s+protocol)\b/i.test(text)) {
      taskType = "mcp-tool";
    } else if (/\b(agent|subagent|specialist|council)\b/i.test(text)) {
      taskType = "agent-definition";
    } else if (/\b(doc|readme|guide|documentation|api\s+spec|tutorial)\b/i.test(text)) {
      taskType = "documentation";
    } else if (/\b(test|spec|assert|coverage|benchmark)\b/i.test(text)) {
      taskType = "test-only";
    }

    // 3. Determine Risk Level
    let risk: GovernanceRiskLevel = "low";
    if (
      sensitiveAreas.includes("destructive_file_ops") ||
      text.includes("git push --force") ||
      text.includes("drop table") ||
      text.includes("rm -rf") ||
      text.includes("wipe") ||
      context?.isDestructive
    ) {
      risk = "critical";
      reasons.push("Operation involves potentially irreversible destructive action or force push");
    } else if (
      sensitiveAreas.includes("authentication_and_secrets") ||
      sensitiveAreas.includes("permissions_and_policy") ||
      sensitiveAreas.includes("database_migration") ||
      sensitiveAreas.includes("backup_and_recovery") ||
      sensitiveAreas.includes("process_and_remote_execution") ||
      sensitiveAreas.includes("deployment_and_publishing")
    ) {
      risk = "high";
      reasons.push(`Task touches sensitive boundaries: ${sensitiveAreas.join(", ")}`);
    } else if (taskType === "refactor" || taskType === "feature" || taskType === "mcp-tool") {
      risk = "medium";
      reasons.push("Modifies codebase logic or introduces functional extensions");
    } else {
      risk = "low";
      reasons.push("Read-only, documentation, test-only, or isolated non-destructive change");
    }

    const triggersReviewerCouncil = risk === "high" || risk === "critical" || sensitiveAreas.length > 0;

    return {
      taskType,
      risk,
      triggersReviewerCouncil,
      sensitiveAreas: Array.from(new Set(sensitiveAreas)),
      reasons,
    };
  }
}

let defaultTaskClassifier: TaskClassifier | null = null;
export function getTaskClassifier(): TaskClassifier {
  if (!defaultTaskClassifier) {
    defaultTaskClassifier = new TaskClassifier();
  }
  return defaultTaskClassifier;
}
