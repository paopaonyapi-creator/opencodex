// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Safe Tool Gateway: Strict 5-class risk classification, path containment, and shell guard

import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { ToolPolicyDecision, ToolRiskClass } from "./types";

export interface GatewayConfig {
  workspaceRoot: string;
  allowedHosts?: string[];
  deniedPathPrefixes?: string[];
  requireApprovalForClassC?: boolean;
}

const DESTRUCTIVE_SHELL_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+[\/\\]/i,
  /\brmdir\s+\/s\s+\/q\s+[c-z]:\\/i,
  /\bformat\s+[c-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bsudo\b/i,
  /\bchown\s+-R\b/i,
  /\b>\s*\/dev\/sd[a-z]\b/i,
  /\b(shutdown|reboot|init\s+0)\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
];

const PROTECTED_PATH_PATTERNS = [
  /\.ssh/i,
  /\.gnupg/i,
  /\.aws/i,
  /\.env(\.|$)/i,
  /id_rsa/i,
  /credentials/i,
  /windows[\\\/]system32/i,
];

export class SafeToolGateway {
  private readonly workspaceRoot: string;
  private readonly allowedHosts: string[];
  private readonly deniedPathPrefixes: string[];
  private readonly requireApprovalForClassC: boolean;

  constructor(config: GatewayConfig) {
    this.workspaceRoot = resolve(normalize(config.workspaceRoot));
    this.allowedHosts = config.allowedHosts ?? ["localhost", "127.0.0.1", "github.com", "registry.npmjs.org"];
    this.deniedPathPrefixes = config.deniedPathPrefixes ?? [];
    this.requireApprovalForClassC = config.requireApprovalForClassC ?? false;
  }

  /**
   * Evaluates a requested tool call against risk classes, path containment, and security guards.
   */
  evaluate(toolName: string, args: Record<string, unknown> = {}): ToolPolicyDecision {
    const riskClass = this.classifyTool(toolName, args);

    // 1. Check Class E: High-Impact
    if (riskClass === "E") {
      return {
        allowed: false,
        riskClass: "E",
        requiresApproval: true,
        reason: `Tool '${toolName}' is classified as Class E (High Impact) and is blocked by default without explicit human approval.`,
      };
    }

    // 2. Check Path Containment for file-based operations
    const targetPath = args.path ?? args.filePath ?? args.targetFile ?? args.AbsolutePath ?? args.directory ?? args.TargetFile;
    if (typeof targetPath === "string" && targetPath.trim() !== "") {
      const pathCheck = this.validatePath(targetPath);
      if (!pathCheck.allowed) {
        return {
          allowed: false,
          riskClass,
          requiresApproval: true,
          reason: pathCheck.reason,
          blockedPattern: pathCheck.blockedPattern,
        };
      }
    }

    // 3. Check Shell Commands for execution tools
    const commandLine = args.command ?? args.commandLine ?? args.CommandLine ?? args.cmd;
    if (typeof commandLine === "string" && commandLine.trim() !== "") {
      const shellCheck = this.validateShellCommand(commandLine);
      if (!shellCheck.allowed) {
        return {
          allowed: false,
          riskClass: "E", // Escalate to Class E when destructive pattern found
          requiresApproval: true,
          reason: shellCheck.reason,
          blockedPattern: shellCheck.blockedPattern,
        };
      }
    }

    // 4. Class D Network verification
    if (riskClass === "D") {
      const url = args.url ?? args.Url ?? args.uri;
      if (typeof url === "string") {
        const netCheck = this.validateNetworkUrl(url);
        if (!netCheck.allowed) {
          return {
            allowed: false,
            riskClass: "D",
            requiresApproval: true,
            reason: netCheck.reason,
          };
        }
      }
    }

    // 5. Class C Execution approval check if configured
    if (riskClass === "C" && this.requireApprovalForClassC) {
      return {
        allowed: true,
        riskClass: "C",
        requiresApproval: true,
        reason: "Execution command requires human confirmation under current policy.",
        sanitizedArgs: args,
      };
    }

    return {
      allowed: true,
      riskClass,
      requiresApproval: false,
      reason: `Action allowed under Safe Tool Gateway Class ${riskClass} policy.`,
      sanitizedArgs: args,
    };
  }

  /**
   * Classifies any tool into Risk Classes A, B, C, D, or E.
   */
  classifyTool(toolName: string, args: Record<string, unknown>): ToolRiskClass {
    const t = toolName.toLowerCase();

    // Explicit Class E triggers
    if (t.includes("sudo") || t.includes("destroy") || t.includes("drop_database") || t.includes("force_push")) {
      return "E";
    }

    // Class A: Read-only
    if (
      t === "read_file" ||
      t === "view_file" ||
      t === "list_dir" ||
      t === "list_directory" ||
      t === "search_code" ||
      t === "grep_search" ||
      t === "git_status" ||
      t === "git_diff" ||
      t === "git_log" ||
      t === "read_docs"
    ) {
      return "A";
    }

    // Class B: Workspace write
    if (
      t === "write_file" ||
      t === "write_to_file" ||
      t === "replace_file_content" ||
      t === "multi_replace_file_content" ||
      t === "patch_file" ||
      t === "create_file" ||
      t === "git_add" ||
      t === "git_commit"
    ) {
      return "B";
    }

    // Class C: Execution
    if (
      t === "run_command" ||
      t === "exec" ||
      t === "execute" ||
      t === "build" ||
      t === "test" ||
      t === "run_test" ||
      t === "run_lint"
    ) {
      return "C";
    }

    // Class D: Network / external
    if (
      t === "browser" ||
      t === "browser_subagent" ||
      t === "read_url_content" ||
      t === "search_web" ||
      t === "curl" ||
      t === "fetch" ||
      t === "fetch_url" ||
      t.includes("mcp_external")
    ) {
      return "D";
    }

    // Default unknown tools to Class C (policy checked execution)
    return "C";
  }

  /**
   * Enforces strict workspace containment and protects credentials/secrets.
   */
  validatePath(rawPath: string): { allowed: boolean; reason: string; blockedPattern?: string } {
    const normalized = normalize(rawPath);

    // Check protected sensitive files
    for (const pattern of PROTECTED_PATH_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          allowed: false,
          reason: `Access to protected sensitive path '${rawPath}' is denied by Safe Tool Gateway policy.`,
          blockedPattern: pattern.toString(),
        };
      }
    }

    // Resolve full path
    const resolved = isAbsolute(normalized)
      ? resolve(normalized)
      : resolve(this.workspaceRoot, normalized);

    // Verify it is inside workspaceRoot
    const rel = relative(this.workspaceRoot, resolved);
    const isOutside = rel.startsWith("..") || isAbsolute(rel);

    if (isOutside) {
      // Check explicit denied prefixes
      return {
        allowed: false,
        reason: `Path traversal violation: '${rawPath}' resolves outside workspace root ('${this.workspaceRoot}').`,
      };
    }

    return { allowed: true, reason: "Path within workspace containment." };
  }

  /**
   * Inspects command lines for destructive operations and privilege escalation.
   */
  validateShellCommand(cmd: string): { allowed: boolean; reason: string; blockedPattern?: string } {
    for (const pattern of DESTRUCTIVE_SHELL_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          allowed: false,
          reason: `Destructive shell pattern detected in '${cmd}'. Blocked by Class E safe policy.`,
          blockedPattern: pattern.toString(),
        };
      }
    }
    return { allowed: true, reason: "Command passed shell guard checks." };
  }

  /**
   * Validates external network URLs against allowed host list.
   */
  validateNetworkUrl(rawUrl: string): { allowed: boolean; reason: string } {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      const isAllowed = this.allowedHosts.some(h => host === h || host.endsWith(`.${h}`));
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Host '${host}' is not in the allowed network policy domains: [${this.allowedHosts.join(", ")}].`,
        };
      }
      return { allowed: true, reason: "Host approved." };
    } catch {
      return { allowed: false, reason: `Malformed URL: '${rawUrl}'.` };
    }
  }
}
