// Phase 20.9 — Secret Redaction Layer
// Inspects and masks sensitive credentials, tokens, and database URLs
// from audit logs, model prompts, tool arguments, and execution outputs.

export interface RedactionResult {
  redacted: string;
  secretsDetectedCount: number;
  detectedTypes: string[];
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  placeholder: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // 1. Private Keys
  {
    name: "private_key",
    regex: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/gi,
    placeholder: "[REDACTED:PRIVATE_KEY]",
  },
  // 2. Anthropic API Keys (checked before generic sk-)
  {
    name: "anthropic_key",
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    placeholder: "[REDACTED:ANTHROPIC_KEY]",
  },
  // 3. OpenAI API Keys
  {
    name: "openai_key",
    regex: /\bsk-(?:proj-|admin-)?[a-zA-Z0-9_-]{20,}\b/g,
    placeholder: "[REDACTED:OPENAI_KEY]",
  },
  // 4. GitHub Tokens
  {
    name: "github_token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}\b|\bgithub_pat_[a-zA-Z0-9_]{60,}\b/g,
    placeholder: "[REDACTED:GITHUB_TOKEN]",
  },
  // 5. AWS Access Keys
  {
    name: "aws_access_key",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    placeholder: "[REDACTED:AWS_KEY]",
  },
  // 6. Database Connection URLs
  {
    name: "database_url",
    regex: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s]+:[^@\s]+@[^\s/]+/gi,
    placeholder: "[REDACTED:DATABASE_URL]",
  },
  // 7. Generic Bearer Tokens
  {
    name: "bearer_token",
    regex: /\bBearer\s+[a-zA-Z0-9._~+/-]{24,}\b/gi,
    placeholder: "Bearer [REDACTED:TOKEN]",
  },
  // 8. Key/Secret JSON or Assignment values
  {
    name: "assignment_secret",
    regex: /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"]([a-zA-Z0-9_-]{16,})['"]/gi,
    placeholder: "$1=\"[REDACTED:SECRET]\"",
  },
];

export class SecretRedactor {
  /**
   * Scans text and replaces detected secrets with safe placeholders.
   */
  redact(input: string): RedactionResult {
    if (!input || typeof input !== "string") {
      return { redacted: input ?? "", secretsDetectedCount: 0, detectedTypes: [] };
    }

    let result = input;
    let count = 0;
    const detected = new Set<string>();

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.name === "assignment_secret") {
        result = result.replace(pattern.regex, (match) => {
          count++;
          detected.add(pattern.name);
          const colonOrEquals = match.includes(":") ? ":" : "=";
          const keyName = match.split(/[:=]/)[0].trim();
          return `${keyName}${colonOrEquals} "[REDACTED:SECRET]"`;
        });
      } else {
        const matches = result.match(pattern.regex);
        if (matches && matches.length > 0) {
          count += matches.length;
          detected.add(pattern.name);
          result = result.replace(pattern.regex, pattern.placeholder);
        }
      }
    }

    return {
      redacted: result,
      secretsDetectedCount: count,
      detectedTypes: Array.from(detected),
    };
  }

  /**
   * Recursively redacts an arbitrary JSON object, string, or array.
   */
  redactJson<T>(data: T): T {
    if (data === null || data === undefined) return data;

    if (typeof data === "string") {
      return this.redact(data).redacted as unknown as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactJson(item)) as unknown as T;
    }

    if (typeof data === "object") {
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        // If key name itself indicates sensitive value, redact directly
        if (
          lowerKey.includes("password") ||
          lowerKey.includes("secret") ||
          lowerKey.includes("apikey") ||
          lowerKey.includes("api_key") ||
          lowerKey.includes("token") ||
          lowerKey.includes("private_key")
        ) {
          copy[key] = "[REDACTED]";
        } else {
          copy[key] = this.redactJson(value);
        }
      }
      return copy as T;
    }

    return data;
  }
}

let defaultSecretRedactor: SecretRedactor | null = null;
export function getSecretRedactor(): SecretRedactor {
  if (!defaultSecretRedactor) {
    defaultSecretRedactor = new SecretRedactor();
  }
  return defaultSecretRedactor;
}
