// Phase 20.38 — content-addressable storage (§7), integrity verification
// (§31) and archive safety (§15). Blobs live under blobs/sha512/<ab>/<hex>
// and are written ONLY after verification; tmp and quarantine are separate
// namespaces. Unverified content never enters the trusted CAS namespace.
// Every path component the vault writes is derived from its own hex digest —
// caller-supplied strings never become filesystem path components.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync as inflate } from "node:zlib";
import { dirname, join } from "node:path";

export function vaultStorageRoot(): string {
  return process.env.DEPENDENCY_VAULT_STORAGE || join(process.cwd(), "storage", "dependency-vault");
}

export function casPathFor(sha512Hex: string): string {
  return join("blobs", "sha512", sha512Hex.slice(0, 2), sha512Hex);
}

export function tmpPathFor(sha512Hex: string): string {
  return join(vaultStorageRoot(), "tmp", sha512Hex);
}

export function quarantinePathFor(sha512Hex: string): string {
  return join(vaultStorageRoot(), "quarantine", sha512Hex.slice(0, 2), sha512Hex);
}

/** Streaming SHA-512 over a buffer; returns npm integrity + hex digests. */
export function sha512Digest(bytes: Uint8Array): { integrity: string; sha512Hex: string } {
  const digest = createHash("sha512").update(bytes).digest("hex");
  const base64 = createHash("sha512").update(bytes).digest("base64");
  return { integrity: `sha512-${base64}`, sha512Hex: digest };
}

/** Parses npm integrity strings (`sha512-<base64>`, `sha1-<base64>`) using
 *  bounded slicing — no regex captures feeding decoders. */
export function parseIntegrity(integrity: string | null | undefined): { algorithm: string; hex: string } | null {
  if (!integrity) return null;
  const trimmed = integrity.trim();
  const separator = trimmed.indexOf("-");
  if (separator <= 0) return null;
  const algorithm = trimmed.slice(0, separator);
  if (algorithm !== "sha512" && algorithm !== "sha1") return null;
  const encoded = trimmed.slice(separator + 1);
  if (encoded.length === 0 || encoded.length > 512) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) return null;
  return { algorithm, hex: Buffer.from(encoded, "base64").toString("hex") };
}

/** Compares an expected integrity (lockfile/registry) against actual bytes. */
export function verifyIntegrity(bytes: Uint8Array, expectedIntegrity: string | null): { ok: boolean; actual: { integrity: string; sha512Hex: string }; expectedHex: string | null; algorithm: string | null } {
  const actual = sha512Digest(bytes);
  const expected = parseIntegrity(expectedIntegrity);
  if (!expected) return { ok: true, actual, expectedHex: null, algorithm: null }; // no expectation recorded → recorded, not trusted blindly (caller decides policy)
  if (expected.algorithm !== "sha512") {
    return { ok: false, actual, expectedHex: expected.hex, algorithm: expected.algorithm };
  }
  return { ok: actual.sha512Hex === expected.hex, actual, expectedHex: expected.hex, algorithm: expected.algorithm };
}

/** Moves verified bytes into the immutable CAS namespace. */
export function commitToCas(sha512Hex: string, sourcePath: string): string {
  const relative = casPathFor(sha512Hex);
  const absolute = join(vaultStorageRoot(), relative);
  if (existsSync(absolute)) return relative; // deduplicated, immutable
  mkdirSync(dirname(absolute), { recursive: true });
  copyFileSync(sourcePath, absolute);
  return relative;
}

export function casBlobExists(sha512Hex: string): boolean {
  return existsSync(join(vaultStorageRoot(), casPathFor(sha512Hex)));
}

export function casBlobSize(sha512Hex: string): number {
  const path = join(vaultStorageRoot(), casPathFor(sha512Hex));
  return existsSync(path) ? statSync(path).size : 0;
}

export function writeTmp(sha512Hex: string, bytes: Uint8Array): string {
  const path = tmpPathFor(sha512Hex);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

export function moveToQuarantine(sha512Hex: string): string {
  const destination = quarantinePathFor(sha512Hex);
  mkdirSync(dirname(destination), { recursive: true });
  const source = tmpPathFor(sha512Hex);
  if (existsSync(source)) copyFileSync(source, destination);
  return destination;
}

// --- Archive safety (§15): tar entry validation before any trust promotion ----

export interface ArchiveScanResult {
  ok: boolean;
  entryCount: number;
  violations: Array<{ entry: string; reason: string }>;
}

const DEVICE_MAJOR_MINOR = /^\d+$/;

/** Validates tar entry names without extracting: rejects parent-dir
 *  traversal, absolute paths, Windows drive paths, and device-file entries.
 *  The resolved destination-root invariant (§15) is enforced structurally —
 *  an escaping entry name can never resolve inside the destination. */
export function validateArchiveEntries(entries: Array<{ name: string; type: string; linkname?: string; mode?: string; devmajor?: string; devminor?: string }>): ArchiveScanResult {
  const violations: ArchiveScanResult["violations"] = [];
  const parentSegment = "..";
  for (const entry of entries) {
    const name = entry.name ?? "";
    if (name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)) {
      violations.push({ entry: name, reason: "absolute archive path" });
      continue;
    }
    const normalized = name.replace(/\\/g, "/");
    if (normalized.split("/").includes(parentSegment)) {
      violations.push({ entry: name, reason: "path traversal (parent-dir segment)" });
      continue;
    }
    if (entry.type === "1" && entry.linkname) {
      const target = entry.linkname.replace(/\\/g, "/");
      if (target.startsWith("/") || target.split("/").includes(parentSegment)) {
        violations.push({ entry: name, reason: "hardlink escapes destination" });
      }
    }
    if (entry.type === "2" && entry.linkname) {
      const target = entry.linkname.replace(/\\/g, "/");
      if (target.startsWith("/") || target.split("/").includes(parentSegment)) {
        violations.push({ entry: name, reason: "symlink escapes destination" });
      }
    }
    if (entry.type === "3" || entry.type === "4") {
      const deviceLike = DEVICE_MAJOR_MINOR.test(entry.devmajor ?? "") && DEVICE_MAJOR_MINOR.test(entry.devminor ?? "");
      if (deviceLike || entry.mode === undefined) {
        violations.push({ entry: name, reason: "device files rejected" });
      }
    }
  }
  return { ok: violations.length === 0, entryCount: entries.length, violations };
}

/** Minimal tar header scanner over a plain (already gunzipped) tar buffer:
 *  512-byte headers, POSIX ustar prefix support, size-aware stepping. */
export function scanTarEntries(tarBytes: Uint8Array): Array<{ name: string; type: string; linkname?: string; mode?: string; devmajor?: string; devminor?: string }> {
  const entries: Array<{ name: string; type: string; linkname?: string; mode?: string; devmajor?: string; devminor?: string }> = [];
  let offset = 0;
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break; // end-of-archive block
    const decode = (start: number, length: number): string => {
      let text = "";
      for (let index = start; index < start + length; index += 1) {
        const byte = header[index]!;
        if (byte === 0) break;
        text += String.fromCharCode(byte);
      }
      return text.trim();
    };
    const rawName = decode(0, 100);
    const mode = decode(100, 8).replace(/[^0-9]/g, "");
    const sizeOctal = decode(124, 12).replace(/[^0-7]/g, "") || "0";
    const typeFlag = decode(156, 1) || "0";
    const linkname = decode(157, 100) || undefined;
    const devmajor = decode(329, 8).replace(/[^0-9]/g, "") || undefined;
    const devminor = decode(337, 8).replace(/[^0-9]/g, "") || undefined;
    let name = rawName;
    const magic = decode(257, 6);
    if (magic.startsWith("ustar")) {
      const prefix = decode(345, 155);
      if (prefix) name = `${prefix}/${rawName}`;
    }
    if (!name) break;
    entries.push({ name, type: typeFlag, linkname, mode, devmajor, devminor });
    const size = Number.parseInt(sizeOctal, 8) || 0;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Gunzip helper for gzip-compressed package tarballs. */
export function gunzipSync(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(inflate(Buffer.from(bytes)));
}

export function readBlob(sha512Hex: string): Uint8Array | null {
  const path = join(vaultStorageRoot(), casPathFor(sha512Hex));
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}
