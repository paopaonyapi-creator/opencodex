/**
 * Phase 20.87 — Artifact Manifest Builder & Cryptographic Verifier
 * Computes root SHA-256 and chunk digests, sanitizes filenames, and detects classification.
 */

import { createHash } from "node:crypto";
import type { ArtifactChunk, ArtifactClassification, ArtifactManifest } from "./types";

export const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MiB logical chunk size

const EXTENSION_CLASSIFICATIONS: Record<string, ArtifactClassification> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", svg: "image",
  mp4: "video", mov: "video", mkv: "video", webm: "video",
  mp3: "audio", wav: "audio", flac: "audio",
  zip: "archive", tar: "archive", gz: "archive", "7z": "archive",
  ts: "source_code", js: "source_code", py: "source_code", rs: "source_code", go: "source_code",
  safetensors: "model", bin: "model", onnx: "model", gguf: "model",
  pt: "lora",
  csv: "dataset", json: "dataset", parquet: "dataset",
  pdf: "document", docx: "document", txt: "document", md: "document",
  exe: "executable", dll: "executable", so: "executable", dylib: "executable",
  sh: "script", ps1: "script", bat: "script", cmd: "script",
};

const FORBIDDEN_WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Sanitizes and validates a filename to prevent Path Traversal, Zip Slip, and reserved names.
 */
export function sanitizeFilename(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error("Invalid filename: empty or not a string");
  }

  // Reject NUL bytes
  if (raw.includes("\0")) {
    throw new Error("Invalid filename: NUL byte injection detected");
  }

  // Extract base filename only, removing any path components
  const base = raw.replace(/^.*[\\\/]/, "").trim();
  if (!base || base === "." || base === "..") {
    throw new Error(`Invalid filename: path traversal sequence in '${raw}'`);
  }

  // Check Windows reserved device names
  const nameWithoutExt = base.split(".")[0].toLowerCase();
  if (FORBIDDEN_WINDOWS_RESERVED.has(nameWithoutExt)) {
    throw new Error(`Invalid filename: '${base}' uses reserved device name`);
  }

  return base;
}

/**
 * Automatically infers artifact classification from filename and contents.
 */
export function detectClassification(filename: string, data?: Uint8Array): ArtifactClassification {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  // Check for secret-like filenames
  if (
    filename.startsWith(".env") ||
    filename.includes("id_rsa") ||
    filename.includes("id_ed25519") ||
    filename.includes("credentials.json") ||
    filename.includes("secret")
  ) {
    return "secret_like";
  }

  return EXTENSION_CLASSIFICATIONS[ext] || "unknown";
}

/**
 * Builds an authentic cryptographic ArtifactManifest for any binary or text payload.
 */
export function buildArtifactManifest(
  filename: string,
  rawPayload: Uint8Array | string,
  overrideClassification?: ArtifactClassification,
): ArtifactManifest {
  const cleanFilename = sanitizeFilename(filename);
  const bytes = typeof rawPayload === "string" ? Buffer.from(rawPayload, "utf8") : rawPayload;
  const sizeBytes = bytes.length;

  // Root SHA-256
  const rootSha256 = createHash("sha256").update(bytes).digest("hex");

  // Chunking
  const chunks: ArtifactChunk[] = [];
  const chunkCount = Math.max(1, Math.ceil(sizeBytes / CHUNK_SIZE_BYTES));

  for (let i = 0; i < chunkCount; i++) {
    const offset = i * CHUNK_SIZE_BYTES;
    const length = Math.min(CHUNK_SIZE_BYTES, sizeBytes - offset);
    const chunkSlice = bytes.subarray(offset, offset + length);
    const chunkSha256 = createHash("sha256").update(chunkSlice).digest("hex");

    chunks.push({
      index: i,
      offset,
      length,
      sha256: chunkSha256,
    });
  }

  const classification = overrideClassification || detectClassification(cleanFilename, bytes);
  const manifestId = `man_${Date.now().toString(36)}_${rootSha256.slice(0, 8)}`;

  return {
    manifestId,
    filename: cleanFilename,
    sizeBytes,
    mimeType: "application/octet-stream",
    sha256: rootSha256,
    classification,
    chunkSizeBytes: CHUNK_SIZE_BYTES,
    chunkCount,
    chunks,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Cryptographically verifies that received bytes strictly match the manifest.
 */
export function verifyArtifactIntegrity(
  manifest: ArtifactManifest,
  receivedBytes: Uint8Array,
): { valid: boolean; actualSha256: string; error?: string } {
  if (receivedBytes.length !== manifest.sizeBytes) {
    return {
      valid: false,
      actualSha256: "",
      error: `Size mismatch: expected ${manifest.sizeBytes} bytes, received ${receivedBytes.length} bytes`,
    };
  }

  const actualSha256 = createHash("sha256").update(receivedBytes).digest("hex");
  if (actualSha256 !== manifest.sha256) {
    return {
      valid: false,
      actualSha256,
      error: `SHA-256 hash mismatch: expected ${manifest.sha256}, got ${actualSha256}`,
    };
  }

  return {
    valid: true,
    actualSha256,
  };
}
