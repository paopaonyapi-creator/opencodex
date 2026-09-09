/**
 * Pao AI Gateway — Guardrail engine.
 *
 * Modular guardrail pipeline. Input guardrails run before provider routing.
 * Output guardrails run before returning response to caller.
 *
 * Blocked input never reaches provider routing.
 * Blocked output is not partially streamed to caller.
 * Error responses never echo detected secret text.
 */

import type {
  GuardrailDecision,
  IdentityGuardrailPolicy,
  NormalizedChatRequest,
  NormalizedChatResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Secret scanner
// ---------------------------------------------------------------------------

/**
 * Patterns that detect common secret/API key formats.
 * These must never appear in error messages.
 */
const SECRET_PATTERNS = [
  // OpenAI
  /sk-[a-zA-Z0-9]{20,}/,
  // Anthropic
  /sk-ant-[a-zA-Z0-9\-_]{20,}/,
  // Generic API keys
  /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9\-_]{16,}/i,
  // AWS
  /AKIA[0-9A-Z]{16}/,
  // GitHub
  /gh[ps]_[A-Za-z0-9_]{36,}/,
  /github_pat_[a-zA-Z0-9_]{22,}/,
  // Bearer tokens (long ones)
  /Bearer\s+[a-zA-Z0-9\-_.]{40,}/,
  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  // Generic hex/base64 secrets (high-entropy long strings in key contexts)
  /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]?[^\s'"]{12,}/i,
];

/**
 * Scan text for secret/API key leakage.
 * Returns a block decision if secrets are found.
 * Never includes the detected secret in the response.
 */
export function scanForSecrets(text: string): GuardrailDecision {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return {
        action: "block",
        code: "secret_leakage",
        safeMessage: "Request blocked: potential secret or API key detected in content.",
      };
    }
  }
  return { action: "allow" };
}

// ---------------------------------------------------------------------------
// Prompt injection detection
// ---------------------------------------------------------------------------

/**
 * Basic prompt injection detection.
 * This is a hook/interface — a more sophisticated implementation can be
 * plugged in later without changing the guardrail pipeline.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+(instructions|rules|safety|guardrails)/i,
  /disregard\s+(all\s+)?(prior|previous)\s+(instructions|rules)/i,
  /forget\s+(all\s+)?(previous\s+)?(rules|instructions)/i,
  /you\s+are\s+now\s+(a\s+)?DAN/i,
  /\bDAN\s+mode\b/i,
  /system\s+override\s*:/i,
  /\bsystem\s*:\s*you\s+are/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
];

export function scanForPromptInjection(text: string): GuardrailDecision {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        action: "block",
        code: "prompt_injection",
        safeMessage: "Request blocked: potential prompt injection detected.",
      };
    }
  }
  return { action: "allow" };
}

// ---------------------------------------------------------------------------
// PII detection (hook interface)
// ---------------------------------------------------------------------------

/**
 * Basic PII detection hook.
 * This is a placeholder interface — real PII detection requires NLP.
 */
export function scanForPII(_text: string): GuardrailDecision {
  // PII detection is a hook — v1 allows all, real implementation comes later
  return { action: "allow" };
}

// ---------------------------------------------------------------------------
// Guardrail pipeline
// ---------------------------------------------------------------------------

/**
 * Run input guardrails on a request.
 * Must complete BEFORE provider routing.
 */
export function runInputGuardrails(
  request: NormalizedChatRequest,
  policy: IdentityGuardrailPolicy | undefined,
): GuardrailDecision {
  // Extract all text content from messages
  const allText = request.messages
    .map(m => m.content ?? "")
    .join("\n");

  if (!allText) return { action: "allow" };

  // Secret leakage check
  if (!policy || policy.input.secret_leakage !== "allow") {
    const secretResult = scanForSecrets(allText);
    if (secretResult.action === "block") {
      return secretResult;
    }
  }

  // Prompt injection check
  if (!policy || policy.input.prompt_injection !== "allow") {
    const injectionResult = scanForPromptInjection(allText);
    if (injectionResult.action === "block") {
      return injectionResult;
    }
  }

  // PII check
  if (policy?.input.pii === "block") {
    const piiResult = scanForPII(allText);
    if (piiResult.action === "block") {
      return piiResult;
    }
  }

  return { action: "allow" };
}

/**
 * Run output guardrails on a response.
 * Must complete BEFORE returning response to caller.
 * If output is blocked, do not leak partial blocked content.
 */
export function runOutputGuardrails(
  response: NormalizedChatResponse,
  policy: IdentityGuardrailPolicy | undefined,
): GuardrailDecision {
  // Extract all text content from response
  const allText = response.choices
    .map(c => c.message.content ?? "")
    .join("\n");

  if (!allText) return { action: "allow" };

  // Secret leakage check on output
  if (!policy || policy.output.secret_leakage !== "allow") {
    const secretResult = scanForSecrets(allText);
    if (secretResult.action === "block") {
      return {
        action: "block",
        code: "output_secret_leakage",
        safeMessage: "Response blocked: potential secret detected in model output.",
      };
    }
  }

  return { action: "allow" };
}
