// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Policy Engine: Sandbox Profiles, Workspace Path Guard, Command Classification & Network Policy.

import { normalize, resolve, isAbsolute } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import type { CodexPolicyProfile, PolicyRuleSet, RiskClassification } from "./types";

export interface PathValidationResult {
  allowed: boolean;
  canonicalPath: string;
  reason?: string;
}

export interface CommandPolicyResult {
  risk: RiskClassification;
  requiresApproval: boolean;
  isDestructive: boolean;
  reason: string;
}

export class PolicyEngine {
  private currentProfile: CodexPolicyProfile = "NORMAL";
  private fullAccessUnlocked = false;
  private fullAccessExpiresAt: number | null = null;
  private fullAccessUnlockedBy: string | null = null;

  // Sensitive paths that must NEVER be accessed or mutated
  private static readonly BLOCKED_PATTERNS = [
    /\.ssh([\\/]|$)/i,
    /\.aws([\\/]|$)/i,
    /\.env(?:$|\.[a-zA-Z0-9]+)/i,
    /\.git[\\/]config$/i,
    /(?:system32|windows[\\/]system)/i,
    /^(?:\/etc|\/root|\/var[\\/]run)/i,
  ];

  // High-risk command patterns (regex or token checks)
  private static readonly DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|\/|\*)/i,
    /\bdel\s+(?:\/s|\/q|\*)/i,
    /\brmdir\s+\/s/i,
    /\bformat\s+[a-zA-Z]:/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // fork bomb
    /\bgit\s+push\b.*--force/i,
    /\bchmod\s+(?:-R\s+)?777\b/i,
    /\bnet\s+user\b/i,
    /\breg\s+(?:add|delete)\b/i,
  ];

  // Low-risk read-only commands
  private static readonly READ_ONLY_COMMANDS: string[] = [
    "git status",
    "git diff",
    "git log",
    "rg",
    "grep",
    "ls",
    "dir",
    "pwd",
    "cat",
    "type",
    "find",
    "echo",
  ];

  constructor(defaultProfile: CodexPolicyProfile = "NORMAL") {
    this.currentProfile = defaultProfile;
  }

  getProfile(): CodexPolicyProfile {
    // Check if full access has expired
    if (this.currentProfile === "FULL_ACCESS" && this.fullAccessExpiresAt) {
      if (Date.now() > this.fullAccessExpiresAt) {
        this.currentProfile = "NORMAL";
        this.fullAccessUnlocked = false;
        this.fullAccessExpiresAt = null;
        this.fullAccessUnlockedBy = null;
      }
    }
    return this.currentProfile;
  }

  setProfile(profile: CodexPolicyProfile): void {
    if (profile === "FULL_ACCESS") {
      throw new Error("FULL_ACCESS cannot be set directly; use unlockFullAccess() with operator approval");
    }
    this.currentProfile = profile;
    this.fullAccessUnlocked = false;
    this.fullAccessExpiresAt = null;
  }

  unlockFullAccess(operatorName: string, ttlSeconds = 900): { success: boolean; expiresAt: string } {
    if (!operatorName || typeof operatorName !== "string") {
      throw new Error("Operator identification is required to unlock FULL_ACCESS");
    }
    this.currentProfile = "FULL_ACCESS";
    this.fullAccessUnlocked = true;
    this.fullAccessUnlockedBy = operatorName;
    const expiresMs = Date.now() + ttlSeconds * 1000;
    this.fullAccessExpiresAt = expiresMs;

    return {
      success: true,
      expiresAt: new Date(expiresMs).toISOString(),
    };
  }

  getRuleSet(): PolicyRuleSet {
    const profile = this.getProfile();
    switch (profile) {
      case "SAFE":
        return {
          profile: "SAFE",
          sandboxMode: "read-only",
          writeScope: "none",
          networkAccess: "restricted",
          networkAllowlist: [],
          destructiveToolsRequireApproval: true,
        };
      case "NORMAL":
        return {
          profile: "NORMAL",
          sandboxMode: "workspace-write",
          writeScope: "workspace",
          networkAccess: "restricted",
          networkAllowlist: ["github.com", "registry.npmjs.org"],
          destructiveToolsRequireApproval: true,
        };
      case "AUTOMATION":
        return {
          profile: "AUTOMATION",
          sandboxMode: "workspace-write",
          writeScope: "workspace",
          networkAccess: "allowlist",
          networkAllowlist: ["github.com", "registry.npmjs.org", "pypi.org"],
          destructiveToolsRequireApproval: true,
        };
      case "FULL_ACCESS":
        return {
          profile: "FULL_ACCESS",
          sandboxMode: "full-access",
          writeScope: "unrestricted",
          networkAccess: "unrestricted",
          networkAllowlist: ["*"],
          destructiveToolsRequireApproval: false,
          ttlSeconds: this.fullAccessExpiresAt ? Math.max(0, Math.floor((this.fullAccessExpiresAt - Date.now()) / 1000)) : 0,
          unlockedAt: this.fullAccessUnlockedBy ? new Date().toISOString() : undefined,
          unlockedBy: this.fullAccessUnlockedBy ?? undefined,
        };
    }
  }

  // ── Workspace Path Guard ────────────────────────────────────────────
  validatePath(targetPath: string, workspaceRoot: string, isWrite = false): PathValidationResult {
    const profile = this.getProfile();

    if (!targetPath) {
      return { allowed: false, canonicalPath: "", reason: "Path cannot be empty" };
    }

    // 1. Resolve and normalize
    const rootNormalized = resolve(workspaceRoot);
    const resolvedPath = isAbsolute(targetPath) ? resolve(targetPath) : resolve(rootNormalized, targetPath);
    const canonical = normalize(resolvedPath);

    // 2. Block sensitive files regardless of profile
    for (const pattern of PolicyEngine.BLOCKED_PATTERNS) {
      if (pattern.test(canonical)) {
        return {
          allowed: false,
          canonicalPath: canonical,
          reason: `Access to protected path matching ${pattern} is denied`,
        };
      }
    }

    // 3. SAFE profile: Disallow all writes
    if (profile === "SAFE" && isWrite) {
      return {
        allowed: false,
        canonicalPath: canonical,
        reason: "Write operations are denied in SAFE profile",
      };
    }

    // 4. FULL_ACCESS: Allowed anywhere except blocked credentials
    if (profile === "FULL_ACCESS") {
      return { allowed: true, canonicalPath: canonical };
    }

    // 5. NORMAL / AUTOMATION: Enforce workspace containment
    const rootWithSep = rootNormalized.endsWith("\\") || rootNormalized.endsWith("/") ? rootNormalized : `${rootNormalized}\\`;
    const canonicalWithSep = canonical.endsWith("\\") || canonical.endsWith("/") ? canonical : `${canonical}\\`;

    const isInside = canonical.toLowerCase().startsWith(rootNormalized.toLowerCase()) ||
      canonicalWithSep.toLowerCase().startsWith(rootWithSep.toLowerCase());

    if (!isInside) {
      return {
        allowed: false,
        canonicalPath: canonical,
        reason: `Path traversal violation: ${canonical} is outside workspace root ${rootNormalized}`,
      };
    }

    // 6. Check realpath if path exists to prevent symlink/junction escapes
    if (existsSync(canonical)) {
      try {
        const real = realpathSync(canonical);
        const realInside = real.toLowerCase().startsWith(rootNormalized.toLowerCase());
        if (!realInside) {
          return {
            allowed: false,
            canonicalPath: canonical,
            reason: `Symlink escape violation: resolved target ${real} escapes workspace root`,
          };
        }
      } catch {
        // realpath failed
      }
    }

    return { allowed: true, canonicalPath: canonical };
  }

  // ── Command Classifier ──────────────────────────────────────────────
  classifyCommand(cmd: string): CommandPolicyResult {
    const trimmed = cmd.trim();
    const profile = this.getProfile();

    // Check destructive patterns
    for (const pattern of PolicyEngine.DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          risk: "high",
          requiresApproval: profile !== "FULL_ACCESS",
          isDestructive: true,
          reason: `Command matches destructive pattern: ${pattern}`,
        };
      }
    }

    // Check read-only commands
    const isReadOnly = PolicyEngine.READ_ONLY_COMMANDS.some(
      (ro) => trimmed.toLowerCase() === ro || trimmed.toLowerCase().startsWith(`${ro} `),
    );
    if (isReadOnly) {
      return {
        risk: "low",
        requiresApproval: false,
        isDestructive: false,
        reason: "Command is identified as read-only diagnostic/inspection",
      };
    }

    // SAFE profile requires approval for non-read-only commands
    if (profile === "SAFE") {
      return {
        risk: "medium",
        requiresApproval: true,
        isDestructive: false,
        reason: "SAFE profile requires approval for all state-changing commands",
      };
    }

    // General operational commands (e.g. npm test, cargo check)
    return {
      risk: "medium",
      requiresApproval: false,
      isDestructive: false,
      reason: "Standard operational command within workspace bounds",
    };
  }

  // ── Network Policy ──────────────────────────────────────────────────
  checkNetworkAccess(targetHost?: string): { allowed: boolean; reason: string } {
    const rules = this.getRuleSet();
    if (rules.networkAccess === "unrestricted") {
      return { allowed: true, reason: "Unrestricted network access allowed" };
    }

    if (!targetHost) {
      return { allowed: false, reason: "Network access restricted: no destination host specified" };
    }

    if (rules.networkAccess === "allowlist") {
      const isAllowed = rules.networkAllowlist.some(
        (allowed) => targetHost.toLowerCase() === allowed || targetHost.toLowerCase().endsWith(`.${allowed}`),
      );
      return {
        allowed: isAllowed,
        reason: isAllowed
          ? `Host ${targetHost} is on the network allowlist`
          : `Host ${targetHost} is not in allowed destinations: ${rules.networkAllowlist.join(", ")}`,
      };
    }

    return { allowed: false, reason: `Network access is restricted in profile ${rules.profile}` };
  }
}
