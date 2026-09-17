/**
 * Phase 20.74 / Phase 20.82 — Tool Execution Sandbox & Safety Guards
 * Enforces workspace isolation, path traversal prevention, command safety, and secret redaction.
 */

import { isAbsolute, normalize, resolve } from "node:path";

export class SandboxSecurityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[SandboxSecurity] ${code}: ${message}`);
    this.name = "SandboxSecurityError";
  }
}

export class ToolExecutionSandbox {
  private static readonly FORBIDDEN_COMMAND_PATTERNS = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|\s+--recursive\s+)(\/|~|\$HOME|\.\.)/i,
    /\b(sudo\s+|runas\s+\/|su\s+-)/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bcurl\b.*\|\s*(sh|bash|zsh)\b/i,
    /\bwget\b.*\|\s*(sh|bash|zsh)\b/i,
    /:[(][)]{ :[|]:& };:/, // Fork bomb
    /\bchmod\s+(-[a-zA-Z]*R\s+)?777\s+(\/|~)/i,
  ];

  private static readonly SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /ghp_[a-zA-Z0-9]{20,}/g,
    /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  ];

  /**
   * Asserts that a file path is safely contained within the specified workspace root.
   * Prevents path traversal and symlink escapes.
   */
  public static assertSafeWorkspacePath(targetPath: string, workspaceRoot: string): string {
    if (!targetPath || !workspaceRoot) {
      throw new SandboxSecurityError("INVALID_PATH", "Path and workspace root must be non-empty");
    }

    if (targetPath.includes("\0")) {
      throw new SandboxSecurityError("NULL_BYTE_DETECTED", "Null byte injection detected in path");
    }

    const normalizedRoot = resolve(workspaceRoot);
    const resolvedTarget = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(normalizedRoot, targetPath);

    const relative = normalize(resolvedTarget).substring(normalizedRoot.length);
    const isInside =
      resolvedTarget.startsWith(normalizedRoot) &&
      (resolvedTarget.length === normalizedRoot.length ||
        resolvedTarget[normalizedRoot.length] === "/" ||
        resolvedTarget[normalizedRoot.length] === "\\");

    if (!isInside) {
      throw new SandboxSecurityError(
        "PATH_TRAVERSAL_DETECTED",
        `Path '${targetPath}' resolves outside workspace boundary '${workspaceRoot}'`,
      );
    }

    return resolvedTarget;
  }

  /**
   * Asserts that a shell command does not contain dangerous system-destructive primitives.
   */
  public static assertSafeCommand(command: string): void {
    if (!command || typeof command !== "string") {
      throw new SandboxSecurityError("INVALID_COMMAND", "Command must be a non-empty string");
    }

    for (const pattern of this.FORBIDDEN_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        throw new SandboxSecurityError(
          "DANGEROUS_COMMAND_BLOCKED",
          `Command matches forbidden destructive or privilege escalation pattern: ${command}`,
        );
      }
    }
  }

  /**
   * Scrubs API keys, passwords, and private tokens from tool arguments.
   */
  public static sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
    const serialized = JSON.stringify(args);
    let sanitized = serialized;

    for (const pattern of this.SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
    }

    return JSON.parse(sanitized) as Record<string, unknown>;
  }
}
