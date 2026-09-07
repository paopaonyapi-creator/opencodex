// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Dependency Guard: Prevents Cosmetic & Redundant Third-Party Dependencies

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DependencyDecision } from "./types";

export class DependencyGuard {
  private workspaceRoot: string;
  private installedDependencies = new Set<string>();

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.loadInstalledPackages();
  }

  private loadInstalledPackages(): void {
    const pkgPaths = [
      join(this.workspaceRoot, "package.json"),
      join(this.workspaceRoot, "gui", "package.json"),
    ];

    for (const pkgPath of pkgPaths) {
      if (existsSync(pkgPath)) {
        try {
          const content = JSON.parse(readFileSync(pkgPath, "utf8"));
          const allDeps = {
            ...(content.dependencies || {}),
            ...(content.devDependencies || {}),
          };
          for (const dep of Object.keys(allDeps)) {
            this.installedDependencies.add(dep);
          }
        } catch {
          // Best-effort
        }
      }
    }
  }

  isInstalled(packageName: string): boolean {
    return this.installedDependencies.has(packageName);
  }

  listInstalled(): string[] {
    return Array.from(this.installedDependencies);
  }

  /**
   * Evaluate a proposal to add a new third-party dependency.
   */
  evaluateProposal(params: {
    packageName: string;
    reason: string;
    isProtocolRequired?: boolean;
  }): DependencyDecision {
    const pkg = params.packageName.toLowerCase().trim();
    const reason = params.reason.toLowerCase();

    // 1. Check if already installed
    if (this.isInstalled(pkg)) {
      return {
        packageName: pkg,
        allowed: true,
        reason: "Package is already installed in repository dependencies",
        stdlibAvailable: false,
        nativeAvailable: false,
        existingDependencyAvailable: true,
        existingEquivalent: pkg,
        securityReviewNeeded: false,
      };
    }

    // 2. Check Standard Library & Native Bun equivalents
    let stdlibAvailable = false;
    let nativeAvailable = false;
    let existingEquivalent: string | undefined;

    // Common redundancies
    if (pkg === "uuid" || pkg === "nanoid") {
      stdlibAvailable = true;
      existingEquivalent = "node:crypto randomUUID()";
    } else if (pkg === "axios" || pkg === "node-fetch" || pkg === "got" || pkg === "request") {
      stdlibAvailable = true;
      existingEquivalent = "globalThis.fetch";
    } else if (pkg === "fs-extra" || pkg === "rimraf" || pkg === "mkdirp") {
      stdlibAvailable = true;
      existingEquivalent = "node:fs (mkdirSync recursive, rmSync recursive)";
    } else if (pkg === "dotenv") {
      nativeAvailable = true;
      existingEquivalent = "Bun built-in .env support";
    } else if (pkg === "better-sqlite3" || pkg === "sqlite3") {
      nativeAvailable = true;
      existingEquivalent = "bun:sqlite (native in runtime)";
    } else if (pkg === "lodash" || pkg === "underscore") {
      stdlibAvailable = true;
      existingEquivalent = "Native ES6+ Array/Object methods and Map/Set";
    } else if (pkg === "chalk" || pkg === "colors") {
      stdlibAvailable = true;
      existingEquivalent = "ANSI escape sequences";
    }

    if (stdlibAvailable || nativeAvailable) {
      return {
        packageName: pkg,
        allowed: false,
        reason: `Rejected: Native platform / Standard Library provides equivalent capability (${existingEquivalent})`,
        stdlibAvailable,
        nativeAvailable,
        existingDependencyAvailable: false,
        existingEquivalent,
        securityReviewNeeded: false,
      };
    }

    // 3. Reject Cosmetic LOC reduction reasons
    const isCosmeticReason =
      reason.includes("less code") ||
      reason.includes("cleaner syntax") ||
      reason.includes("popular") ||
      reason.includes("might need") ||
      reason.includes("convenience") ||
      reason.includes("shorter");

    if (isCosmeticReason && !params.isProtocolRequired) {
      return {
        packageName: pkg,
        allowed: false,
        reason: "Rejected: Dependency cannot be added solely for cosmetic line-of-code reduction or cleaner syntax",
        stdlibAvailable: false,
        nativeAvailable: false,
        existingDependencyAvailable: false,
        securityReviewNeeded: true,
      };
    }

    // 4. Allowed for required protocol / heavy functionality, but triggers Reviewer Council
    return {
      packageName: pkg,
      allowed: true,
      reason: `Provisionally allowed for technical requirement: ${params.reason}`,
      stdlibAvailable: false,
      nativeAvailable: false,
      existingDependencyAvailable: false,
      securityReviewNeeded: true,
    };
  }
}

let defaultDependencyGuard: DependencyGuard | null = null;
export function getDependencyGuard(workspaceRoot?: string): DependencyGuard {
  if (!defaultDependencyGuard || workspaceRoot) {
    defaultDependencyGuard = new DependencyGuard(workspaceRoot);
  }
  return defaultDependencyGuard;
}
