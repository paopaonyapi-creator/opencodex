/**
 * Phase 20.13 — Pao-hubPro Video Intelligence × Claude Watch
 * Security Validator: SSRF, Path Traversal & Subprocess Option Injection Defense
 */

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedUrl?: string;
}

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
  resolvedPath?: string;
}

const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export class VideoSecurityValidator {
  private allowPrivateNetwork: boolean;

  constructor(allowPrivateNetwork: boolean = false) {
    this.allowPrivateNetwork = allowPrivateNetwork;
  }

  /**
   * Validates video URLs to defend against SSRF and option injection.
   */
  public validateUrl(rawUrl: string): UrlValidationResult {
    if (!rawUrl || typeof rawUrl !== "string") {
      return { valid: false, reason: "Empty or invalid URL provided." };
    }

    const trimmed = rawUrl.trim();

    // Prevent CLI option injection: reject if URL starts with hyphens or dashes
    if (trimmed.startsWith("-")) {
      return { valid: false, reason: "Option injection attempt: URL cannot start with a hyphen." };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { valid: false, reason: "Malformed URL syntax." };
    }

    // Only allow http and https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        reason: `Unsupported protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
      };
    }

    // SSRF Private network check
    if (!this.allowPrivateNetwork) {
      const hostname = parsed.hostname.toLowerCase();
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
          return {
            valid: false,
            reason: `SSRF defense: access to internal/private host '${hostname}' is denied.`,
          };
        }
      }
    }

    return { valid: true, sanitizedUrl: parsed.toString() };
  }

  /**
   * Validates local file paths to defend against path traversal and dangerous file types.
   */
  public validateLocalPath(rawPath: string): PathValidationResult {
    if (!rawPath || typeof rawPath !== "string") {
      return { valid: false, reason: "Empty local path provided." };
    }

    const trimmed = rawPath.trim();

    // Check for path traversal sequences
    if (trimmed.includes("..") || trimmed.includes("\0")) {
      return { valid: false, reason: "Path traversal or null-byte detected in file path." };
    }

    // Verify extension
    const dotIndex = trimmed.lastIndexOf(".");
    if (dotIndex === -1) {
      return { valid: false, reason: "Missing file extension." };
    }

    const ext = trimmed.slice(dotIndex).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        valid: false,
        reason: `Unsupported media extension '${ext}'. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
      };
    }

    return { valid: true, resolvedPath: trimmed };
  }

  /**
   * Generates safe command line arguments inserting '--' boundary to prevent option injection in yt-dlp.
   */
  public makeSafeYtDlpArgs(url: string, extraArgs: string[] = []): string[] {
    return ["--no-call-home", "--no-warnings", ...extraArgs, "--", url];
  }
}
