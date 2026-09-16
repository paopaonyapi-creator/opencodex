// Phase 20.26 — Secret redaction for Douyin provider surfaces (doc §23, §57).
//
// Cookies, session tokens, CSRF values, and authorization material must never
// reach logs, API responses, MCP output, or audit rows. All provider payloads
// and error bodies pass through redactDouyinSecrets before leaving the module.

const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERNS = [
  /^cookie$/i,
  /^cookies$/i,
  /^set-?cookie$/i,
  /^authorization$/i,
  /^msToken$/i,
  /^ttwid$/i,
  /^odin_tt$/i,
  /^passport_csrf_token$/i,
  /^csrf/i,
  /^sid_guard$/i,
  /^sessionid/i,
  /^secret$/i,
  /^token$/i,
  /password/i,
];

const SENSITIVE_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/msToken=["']?[\w%+/=.:-]{8,}/gi, `msToken=${REDACTED}`],
  [/ttwid=["']?[\w%+/=.:-]{8,}/gi, `ttwid=${REDACTED}`],
  [/odin_tt=["']?[\w%+/=.:-]{8,}/gi, `odin_tt=${REDACTED}`],
  [/passport_csrf_token=["']?[\w%+/=.:-]{8,}/gi, `passport_csrf_token=${REDACTED}`],
  [/sid_guard=["']?[\w%+/=.:-]{8,}/gi, `sid_guard=${REDACTED}`],
  [/sessionid(?:_ss)?=["']?[\w%+/=.:-]{8,}/gi, `sessionid=${REDACTED}`],
  [/sk-[a-zA-Z0-9]{20,}/g, `sk-${REDACTED}`],
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** Deep-redact an object tree: sensitive keys lose their values entirely. */
export function redactDouyinSecrets<T>(input: T, depth = 0): T {
  if (depth > 6) return input;
  if (typeof input === "string") {
    let text: string = input;
    for (const [pattern, replacement] of SENSITIVE_VALUE_PATTERNS) {
      text = text.replace(pattern, replacement);
    }
    return text as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactDouyinSecrets(item, depth + 1)) as unknown as T;
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactDouyinSecrets(value, depth + 1);
    }
    return out as unknown as T;
  }
  return input;
}

/** Redact a plain string (log/error bodies). */
export function redactSecretText(text: string): string {
  return redactDouyinSecrets(text);
}
