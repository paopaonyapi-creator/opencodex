// Phase 20.32 — provenance manifests (doc §12). Every generated speech
// artifact gets a sidecar manifest recording the runtime/model/voice chain.
// Manifests never contain secret material — credentials are resolved from the
// environment at call time and are never persisted anywhere.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SpeechJobType, SpeechManifest } from "./types";

export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256HexText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256HexFile(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

export function buildSpeechManifest(input: {
  artifactId: string;
  projectId: string;
  provider: string;
  voicestudioVersion: string | null;
  operation: SpeechJobType;
  engine: string | null;
  modelId: string | null;
  modelVersion: string | null;
  voiceId: string | null;
  providerProfileId: string | null;
  language: string | null;
  scriptSha256: string | null;
  sourceReferenceSha256: string | null;
  consentStatus: string;
  licenseStatus: string;
  commercialUse: boolean;
  stockUse: boolean;
  outputPath: string;
  outputSha256: string | null;
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
}): SpeechManifest {
  return {
    artifactId: input.artifactId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    provider: input.provider,
    voicestudioVersion: input.voicestudioVersion,
    operation: input.operation,
    engine: input.engine,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    voiceId: input.voiceId,
    providerProfileId: input.providerProfileId,
    language: input.language,
    scriptSha256: input.scriptSha256,
    sourceReferenceSha256: input.sourceReferenceSha256,
    consentStatus: input.consentStatus,
    licenseStatus: input.licenseStatus,
    commercialUse: input.commercialUse,
    stockUse: input.stockUse,
    output: {
      path: input.outputPath,
      sha256: input.outputSha256,
      durationMs: input.durationMs,
      sampleRate: input.sampleRate,
      channels: input.channels,
    },
  };
}

const FORBIDDEN_MANIFEST_KEYS = ["apikey", "api_key", "authorization", "token", "secret", "password"];

/** Defensive final gate: refuses to persist a manifest that carries
 *  credential-shaped fields (doc §12, §26). */
export function assertManifestHasNoSecrets(manifest: SpeechManifest): void {
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_MANIFEST_KEYS.some((needle) => key.toLowerCase().includes(needle))) {
        throw new Error(`Manifest would embed a credential-shaped field at ${path}${key}`);
      }
      walk(value, `${path}${key}.`);
    }
  };
  walk(manifest, "");
}
