// Phase 20.35 — multimodal attachment engine (§26-§29): size caps, MIME
// sniffing vs extension mismatch, hashing/dedup, archive-bomb guards, safe
// staging inside the confined workspace, and HTTPS-only remote fetching
// through the shared Phase 20.24 SSRF policy.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import { speechWorkspaceRoot } from "../speech/workspace";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 500;

const ALLOWED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "webm", "mov", "mp3", "wav", "ogg",
  "pdf", "txt", "md", "json", "csv", "zip", "ts", "tsx", "js", "py", "go", "rs", "html", "css",
]);

const MIME_BY_EXTENSION: Record<string, string[]> = {
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], gif: ["image/gif"],
  webp: ["image/webp"], svg: ["image/svg+xml", "text/xml", "application/xml"],
  mp4: ["video/mp4"], webm: ["video/webm"], mov: ["video/quicktime"],
  mp3: ["audio/mpeg"], wav: ["audio/wav", "audio/x-wav"], ogg: ["audio/ogg"],
  pdf: ["application/pdf"], txt: ["text/plain"], md: ["text/plain", "text/markdown"],
  json: ["application/json", "text/plain"], csv: ["text/csv", "text/plain"],
  zip: ["application/zip", "application/x-zip-compressed"],
};

/** Magic-byte sniffing for the formats that have one (§28 MIME detection). */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return "application/zip";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "video/mp4";
  return null;
}

export interface AttachmentValidation {
  ok: boolean;
  name: string;
  mime: string | null;
  sniffedMime: string | null;
  sha256: string;
  sizeBytes: number;
  stagedPath?: string;
  reason?: string;
}

function extensionOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

function safeStagedName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "attachment";
  return `${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}_${base}`;
}

/** Local attachment validation + staging (never executed; never leaves the
 *  confined workspace root). */
export function stageLocalAttachment(name: string, bytes: Uint8Array): AttachmentValidation {
  const result: AttachmentValidation = { ok: false, name, mime: null, sniffedMime: null, sha256: "", sizeBytes: bytes.byteLength };
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return { ...result, reason: `attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit` };
  }
  const extension = extensionOf(name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { ...result, reason: `extension '${extension || "(none)"}' is not allowed` };
  }
  const sniffed = sniffMime(bytes);
  const allowedMimes = MIME_BY_EXTENSION[extension] ?? [];
  if (sniffed && allowedMimes.length > 0 && !allowedMimes.includes(sniffed)) {
    // Extension/mime mismatch (§28): refuse instead of trusting the client.
    return { ...result, sniffedMime: sniffed, reason: `extension '${extension}' does not match detected content type '${sniffed}'` };
  }
  if (extension === "zip" && sniffed === "application/zip") {
    const entryCount = countZipEntries(bytes);
    if (entryCount > MAX_ARCHIVE_ENTRIES) {
      return { ...result, sniffedMime: sniffed, reason: `archive holds ${entryCount} entries (limit ${MAX_ARCHIVE_ENTRIES}) — zip-bomb guard` };
    }
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const root = speechWorkspaceRoot(); // reuse the existing confined workspace root
  const staging = join(root, "attachments");
  mkdirSync(staging, { recursive: true });
  const stagedPath = join(staging, safeStagedName(name));
  writeFileSync(stagedPath, bytes);
  return { ok: true, name, mime: allowedMimes[0] ?? "application/octet-stream", sniffedMime: sniffed, sha256, sizeBytes: bytes.byteLength, stagedPath };
}

/** Counts local-file-header signatures in a zip; entries beyond the central
 *  directory cannot hide from this (each entry carries its own header). */
function countZipEntries(bytes: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < bytes.length - 3; index += 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x03 && bytes[index + 3] === 0x04) count += 1;
    if (count > MAX_ARCHIVE_ENTRIES) return count; // early-exit on bomb shapes
  }
  return count;
}

/** Remote attachment fetching (§29): HTTPS-only, SSRF-blocked, size-capped. */
export async function fetchRemoteAttachment(url: string, name?: string): Promise<AttachmentValidation> {
  let normalized: string;
  try {
    const policy = validateAndNormalizeUrl(url);
    normalized = policy.normalizedUrl;
    if (!normalized.startsWith("https://")) {
      return { ok: false, name: name ?? url, mime: null, sniffedMime: null, sha256: "", sizeBytes: 0, reason: "remote attachment fetch allows https:// only (§29)" };
    }
  } catch (err) {
    return { ok: false, name: name ?? url, mime: null, sniffedMime: null, sha256: "", sizeBytes: 0, reason: err instanceof Error ? err.message : "URL rejected by SSRF policy" };
  }
  try {
    const res = await fetch(normalized, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { ok: false, name: name ?? normalized, mime: null, sniffedMime: null, sha256: "", sizeBytes: 0, reason: `remote fetch returned HTTP ${res.status}` };
    }
    const buffer = new Uint8Array(await res.arrayBuffer());
    const validation = stageLocalAttachment(name ?? normalized.split("/").pop() ?? "remote", buffer);
    return { ...validation, reason: validation.reason ?? (validation.ok ? undefined : "validation failed") };
  } catch (err) {
    return { ok: false, name: name ?? normalized, mime: null, sniffedMime: null, sha256: "", sizeBytes: 0, reason: err instanceof Error ? err.message : "remote fetch failed" };
  }
}

export const ATTACHMENT_LIMITS = { maxBytes: MAX_ATTACHMENT_BYTES, maxArchiveBytes: MAX_ARCHIVE_BYTES, maxArchiveEntries: MAX_ARCHIVE_ENTRIES };

/** Batch pipeline entry (§27): local staged bytes, data URLs, or remote
 *  https URLs (remote fetches are awaited and SSRF-validated). */
export async function validateAttachments(input: Array<{ name: string; source: string; mimeHint?: string; bytes?: Uint8Array }>): Promise<AttachmentValidation[]> {
  const results: AttachmentValidation[] = [];
  for (const entry of input) {
    if (entry.bytes) {
      results.push(stageLocalAttachment(entry.name, entry.bytes));
      continue;
    }
    if (entry.source.startsWith("data:")) {
      const comma = entry.source.indexOf(",");
      if (comma === -1) {
        results.push({ ok: false, name: entry.name, mime: null, sniffedMime: null, sha256: "", sizeBytes: 0, reason: "malformed data URL" });
        continue;
      }
      try {
        const binary = atob(entry.source.slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        results.push(stageLocalAttachment(entry.name, bytes));
      } catch {
        results.push({ ok: false, name: entry.name, mime: null, sniffedMime: null, sha256: "", sizeBytes: 0, reason: "data URL is not valid base64" });
      }
      continue;
    }
    results.push(await fetchRemoteAttachment(entry.source, entry.name));
  }
  return results;
}
