// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Diff Guard: Git Change Scope Analysis & Overengineering Detection

import { execSync } from "node:child_process";
import type { DiffScopeSummary, TaskType } from "./types";

export class DiffGuard {
  private workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Inspects current Git working tree diff against HEAD.
   */
  inspectDiff(): DiffScopeSummary {
    let statusOutput = "";
    let numstatOutput = "";

    try {
      statusOutput = execSync("git status --short", {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        timeout: 5000,
      });
    } catch {
      statusOutput = "";
    }

    try {
      numstatOutput = execSync("git diff --numstat HEAD", {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        timeout: 5000,
      });
    } catch {
      numstatOutput = "";
    }

    const modifiedFiles: string[] = [];
    const newFiles: string[] = [];
    const deletedFiles: string[] = [];
    const warnings: string[] = [];

    // Parse status
    const statusLines = statusOutput.split("\n").filter((l) => l.trim().length > 0);
    for (const line of statusLines) {
      const statusTag = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim();
      if (statusTag === "??" || statusTag === "A") {
        newFiles.push(filePath);
      } else if (statusTag === "D") {
        deletedFiles.push(filePath);
      } else {
        modifiedFiles.push(filePath);
      }
    }

    // Parse numstat
    let insertions = 0;
    let deletions = 0;
    const numstatLines = numstatOutput.split("\n").filter((l) => l.trim().length > 0);
    for (const line of numstatLines) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const ins = parseInt(parts[0], 10) || 0;
        const del = parseInt(parts[1], 10) || 0;
        insertions += ins;
        deletions += del;
      }
    }

    const allChangedFiles = Array.from(new Set([...modifiedFiles, ...newFiles, ...deletedFiles]));
    const filesChanged = allChangedFiles.length;

    // Check for public contract or guard alterations
    let publicContractChanged = false;
    let securityGuardsAltered = false;

    for (const file of allChangedFiles) {
      const lower = file.toLowerCase();
      if (lower.includes("routes.ts") || lower.includes("api.ts") || lower.includes("schema.ts")) {
        publicContractChanged = true;
      }
      if (lower.includes("guard") || lower.includes("auth") || lower.includes("policy") || lower.includes("security")) {
        securityGuardsAltered = true;
      }
    }

    return {
      filesChanged,
      insertions,
      deletions,
      newFiles,
      deletedFiles,
      modifiedFiles,
      publicContractChanged,
      securityGuardsAltered,
      passed: true,
      warnings,
    };
  }

  /**
   * Evaluate whether the diff is reasonable given the task type.
   */
  evaluateScope(diff: DiffScopeSummary, taskType: TaskType): { passed: boolean; warnings: string[] } {
    const warnings: string[] = [];
    let passed = true;

    // Rule: Small bugfix touching > 8 files -> warn
    if (taskType === "bugfix" && diff.filesChanged > 8) {
      warnings.push(`Warning: Bugfix touches ${diff.filesChanged} files (exceeds recommended 8 files threshold)`);
    }

    // Rule: High additions for a bugfix -> warn
    if (taskType === "bugfix" && diff.insertions > 300) {
      warnings.push(`Warning: Large diff for bugfix (+${diff.insertions} lines). Verify if rewrite can be a minimal patch.`);
    }

    // Rule: Security guard altered without explicit security task -> warn
    if (diff.securityGuardsAltered && taskType !== "security") {
      warnings.push("Notice: Security guards or policy files were touched during a non-security task. Mandatory Reviewer Council review required.");
    }

    return { passed, warnings };
  }
}

let defaultDiffGuard: DiffGuard | null = null;
export function getDiffGuard(workspaceRoot?: string): DiffGuard {
  if (!defaultDiffGuard || workspaceRoot) {
    defaultDiffGuard = new DiffGuard(workspaceRoot);
  }
  return defaultDiffGuard;
}
