// Phase 20.9 — MCP Security Gateway
// Inspects and validates MCP server configurations BEFORE spawning stdio or connecting remote transports.
// Enforces executable allowlists, argument guards, environment filtering, and blocked destructive patterns.

import { isAbsolute, normalize, resolve } from "node:path";
import type { MCPServerConfig } from "../types";

export interface MCPValidationResult {
  allowed: boolean;
  blockedReason?: string;
  sanitizedConfig?: MCPServerConfig;
  violations: string[];
}

const ALLOWED_EXECUTABLES = new Set([
  "node",
  "node.exe",
  "bun",
  "bun.exe",
  "python",
  "python.exe",
  "python3",
  "npx",
  "npx.cmd",
  "uvx",
  "uvx.exe",
  "deno",
  "deno.exe",
]);

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+[\/\\]/i,
  /del\s+\/[sfa-z]*\s+c:[\/\\]/i,
  /format\s+[a-z]:/i,
  /mkfs/i,
  /shutdown/i,
  /reboot/i,
  /git\s+push\s+.*--force/i,
  /powershell\s+.*-(?:e|enc|encodedcommand)\b/i,
  /curl\s+.*\|\s*(?:bash|sh|powershell)/i,
  /wget\s+.*\|\s*(?:bash|sh|powershell)/i,
  /:(){:|:&};:/, // fork bomb
];

const SENSITIVE_ENV_VARS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GITHUB_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "DATABASE_URL",
  "PRIVATE_KEY",
  "SECRET_KEY",
  "TOKEN",
  "PASSWD",
  "PASSWORD",
]);

export class MCPSecurityGateway {
  /**
   * Validates an MCP server config before allowing it to connect or spawn.
   */
  validateConfig(config: MCPServerConfig, workspaceRoot: string = process.cwd()): MCPValidationResult {
    const violations: string[] = [];

    // 1. Basic schema check
    if (!config.name || typeof config.name !== "string") {
      violations.push("Server name is required");
    }

    if (config.transport !== "stdio" && config.transport !== "http" && config.transport !== "sse") {
      violations.push(`Unsupported transport '${config.transport}' (must be stdio, http, or sse)`);
    }

    // 2. Transport-specific checks
    if (config.transport === "http" || config.transport === "sse") {
      if (!config.url) {
        violations.push("Remote URL is required for http/sse transports");
      } else {
        try {
          const parsedUrl = new URL(config.url);
          // Require HTTPS unless localhost
          if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
            violations.push(`Remote MCP endpoint must use HTTPS (${config.url})`);
          }
        } catch {
          violations.push(`Invalid remote MCP URL: ${config.url}`);
        }
      }
    }

    if (config.transport === "stdio") {
      if (!config.command) {
        violations.push("Executable command is required for stdio transport");
      } else {
        const cmd = config.command.trim();
        const baseCmd = cmd.split(/[\/\\]/).pop()?.toLowerCase() || "";

        // Check against executable allowlist
        if (!ALLOWED_EXECUTABLES.has(baseCmd)) {
          violations.push(`Command '${config.command}' is not in the approved MCP runtime allowlist (${Array.from(ALLOWED_EXECUTABLES).join(", ")})`);
        }

        // Check command string itself against blocked destructive patterns
        for (const pattern of BLOCKED_COMMAND_PATTERNS) {
          if (pattern.test(cmd)) {
            violations.push(`Dangerous destructive pattern detected in command: ${pattern}`);
          }
        }

        // Check args
        if (config.args && Array.isArray(config.args)) {
          for (const arg of config.args) {
            if (arg === "-e" || arg === "--eval" || arg === "-c") {
              violations.push(`Arbitrary evaluation flag '${arg}' is prohibited in MCP arguments`);
            }
          }
          const combinedArgs = config.args.join(" ");
          for (const pattern of BLOCKED_COMMAND_PATTERNS) {
            if (pattern.test(combinedArgs)) {
              violations.push(`Dangerous destructive pattern detected in arguments: ${pattern}`);
            }
          }
        }

        // Check working directory containment
        if (config.cwd) {
          const resolvedCwd = normalize(resolve(workspaceRoot, config.cwd));
          const rootNorm = normalize(resolve(workspaceRoot));
          if (!resolvedCwd.startsWith(rootNorm)) {
            violations.push(`Working directory '${config.cwd}' resolves outside workspace boundary`);
          }
        }
      }
    }

    // 3. Environment variable safety
    const sanitizedEnvWhitelist: string[] = [];
    if (config.envWhitelist && Array.isArray(config.envWhitelist)) {
      for (const envKey of config.envWhitelist) {
        if (SENSITIVE_ENV_VARS.has(envKey.toUpperCase())) {
          violations.push(`Environment variable '${envKey}' is protected and cannot be exposed to MCP server`);
        } else {
          sanitizedEnvWhitelist.push(envKey);
        }
      }
    }

    const allowed = violations.length === 0;

    return {
      allowed,
      blockedReason: allowed ? undefined : violations.join("; "),
      violations,
      sanitizedConfig: allowed
        ? {
            ...config,
            envWhitelist: sanitizedEnvWhitelist,
          }
        : undefined,
    };
  }
}

let defaultSecurityGateway: MCPSecurityGateway | null = null;
export function getMCPSecurityGateway(): MCPSecurityGateway {
  if (!defaultSecurityGateway) {
    defaultSecurityGateway = new MCPSecurityGateway();
  }
  return defaultSecurityGateway;
}
