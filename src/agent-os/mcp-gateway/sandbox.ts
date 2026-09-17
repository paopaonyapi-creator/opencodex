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
    // Short (-r/-rf/-fr) and long (--recursive) recursive deletion aimed at
    // absolute/parent/home paths.
    /\brm\s+(?:-{1,2}[a-zA-Z]*r[a-zA-Z]*\s+)(?:\/|~|\$HOME|\.\.)/i,
    /\b(sudo\s+|runas\s+\/|su\s+-)/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bcurl\b.*\|\s*(sh|bash|zsh)\b/i,
    /\bwget\b.*\|\s*(sh|bash|zsh)\b/i,
    /:[(][)]{ :[|]:& };:/, // Fork bomb
    /\bchmod\s+(-[a-zA-Z]*R\s+)?777\s+(\/|~)/i,
  ];

  // Phase 20.82 hardening. The sanctioned runner spawns argv WITHOUT a shell,
  // so metacharacters are inert per-argument — the bypass is to make the
  // target binary itself an interpreter that re-parses them. These guards are
  // structural: block nested shells outright, and block code/encoded-command
  // entry flags on interpreted runtimes so a chained or base64-encoded
  // destructive operation cannot slip past the pattern list.
  private static readonly SHELL_INTERPRETERS = new Set([
    "sh", "bash", "zsh", "dash", "fish", "csh", "tcsh", "ksh", "ksh93",
    "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
    "wscript", "wscript.exe", "cscript", "cscript.exe", "mshta", "mshta.exe",
    "eval", "exec", "source", "command",
  ]);

  // Interpreters that are legitimate dev tools but must never receive a
  // code-carrying flag (arguably "run this string as code"), because that
  // string is exactly where an encoded/obfuscated destructive operation hides.
  // Module flags like `python -m pytest` stay allowed — they name a module,
  // not an inline program.
  private static readonly INTERPRETED_RUNTIMES = new Set([
    "python", "python3", "python.exe", "node", "node.exe", "bun", "bun.exe",
    "deno", "perl", "ruby", "php", "lua", "tclsh", "awk", "gawk", "mawk",
    "rscript", "osascript", "jshell", "ghci",
  ]);

  private static readonly INTERPRETED_CODE_FLAGS = new Set([
    "-c", "--command", "-e", "--eval", "-p",
    "-enc", "-encodedcommand", "--encoded-command", "-encodedcommand",
    "-ec", "--exec", "-r",
  ]);

  private static readonly SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /ghp_[a-zA-Z0-9]{20,}/g,
    /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/gi,
    /AKIA[0-9A-Z]{16}/g,
    /xox[baprs]-[a-zA-Z0-9\-]+/g,
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

    // Command chaining / shell metacharacters. The runner spawns argv without a
    // shell, so these are inert in a single argument — but they are the payload
    // carrier the moment a shell interpreter is reachable, so they are rejected
    // outright as defense in depth.
    if (/[\n\r]/.test(command)) {
      throw new SandboxSecurityError("COMMAND_CHAINING_BLOCKED", "Newlines in commands are not permitted");
    }
    if (/`|\$\(|;\s|\s;|&&|\|\||\|\s|\s\|/.test(command)) {
      throw new SandboxSecurityError(
        "COMMAND_CHAINING_BLOCKED",
        `Command chaining / substitution metacharacters are not permitted: ${command}`,
      );
    }

    const tokens = command.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      throw new SandboxSecurityError("INVALID_COMMAND", "Command must contain at least one token");
    }
    const binaryName = tokens[0].replace(/^.*[/\\]/, "").toLowerCase().replace(/\.exe$/, "");

    // Nested shells: shell.exec is already the sanctioned shell surface, so a
    // target that is itself a shell only exists to re-parse unchecked input.
    if (this.SHELL_INTERPRETERS.has(binaryName)) {
      throw new SandboxSecurityError(
        "SHELL_INTERPRETER_BLOCKED",
        `Nested shell interpreter '${tokens[0]}' is not permitted; use shell.exec argv directly`,
      );
    }

    // Code-carrying flags on interpreted runtimes (obfuscated/encoded payloads).
    if (this.INTERPRETED_RUNTIMES.has(binaryName)) {
      for (const token of tokens.slice(1)) {
        const flag = token.toLowerCase();
        if (this.INTERPRETED_CODE_FLAGS.has(flag) || this.INTERPRETED_CODE_FLAGS.has(flag.replace(/\.exe$/, ""))) {
          throw new SandboxSecurityError(
            "ENCODED_EXECUTION_BLOCKED",
            `Code-carrying flag '${token}' on '${binaryName}' is not permitted; run a script file instead`,
          );
        }
      }
    }
  }

  /**
   * Scrubs API keys, passwords, and private tokens from arbitrary text
   * (error messages, stderr excerpts, audit details) before it is persisted
   * or returned to a caller.
   */
  public static redactSecrets(text: string): string {
    let redacted = text;
    for (const pattern of this.SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, "[REDACTED]");
    }
    return redacted;
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
