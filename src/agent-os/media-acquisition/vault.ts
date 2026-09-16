// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Secrets Vault Integration & Secret Reference Handler

import type { SecretReference } from "./types";
import { MediaError } from "./errors";

export class MediaSecretsVault {
  private secretStore = new Map<string, { secret: string; meta: SecretReference }>();

  registerSecret(
    category: SecretReference["category"],
    label: string,
    secretValue: string,
    domain?: string,
  ): SecretReference {
    const refId = `vault://${category}/${encodeURIComponent(label.toLowerCase().replace(/\s+/g, "_"))}`;
    const meta: SecretReference = {
      refId,
      category,
      label,
      domain,
      createdAt: new Date().toISOString(),
    };

    this.secretStore.set(refId, { secret: secretValue, meta });
    return meta;
  }

  resolveSecret(refId: string): string {
    const entry = this.secretStore.get(refId);
    if (!entry) {
      throw new MediaError("MEDIA_AUTH_REQUIRED", `Secret reference '${refId}' not found in media vault.`);
    }
    return entry.secret;
  }

  listReferences(): SecretReference[] {
    return Array.from(this.secretStore.values()).map((e) => e.meta);
  }

  hasSecret(refId: string): boolean {
    return this.secretStore.has(refId);
  }
}

const REDACTION_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /(?:cookie|token|auth|key|secret)=([^\s;&]+)/gi,
  /https:\/\/[^:]+:([^@]+)@/g, // credentials in URL
];

export function redactMediaSecrets(input: string): string {
  if (!input || typeof input !== "string") return "";
  let redacted = input;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}
