// Phase 20.41 — Deterministic content hashing, query hashing, and the
// preview-confirmation receipt signer (spec §3.2, §16, §19, §31).
// contentHash covers canonical SOURCE fields only — never mutable
// operational metadata. Receipts are HMAC-signed opaque values; the signing
// secret fails closed: it is read from MEMORY_SIGNING_SECRET or a
// machine-local file under OPENCODEX_HOME (canonicalized with resolve(),
// constant filename — never committed), and a missing secret disables
// destructive confirmation entirely.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupersedeRequest } from "./types";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface CanonicalSourceFields {
  workspaceId: string;
  projectId: string | null;
  title: string;
  content: string;
  kind: string;
  sourcePath: string | null;
}

export function contentHashOf(fields: CanonicalSourceFields): string {
  const canonical = JSON.stringify({
    workspaceId: fields.workspaceId,
    projectId: fields.projectId,
    title: fields.title,
    content: fields.content,
    kind: fields.kind,
    sourcePath: fields.sourcePath,
  });
  return "sha256:" + sha256Hex(canonical);
}

/** Query hash for traces. NOTE: a hash is correlation, NOT anonymization —
 *  low-entropy queries remain linkable (documented, spec §31.5). */
export function queryHashOf(query: string, purpose: "trace" | "idempotency" = "trace"): string {
  return purpose + ":" + sha256Hex(query);
}

const SECRET_FILE_NAME = "memory-signing-secret";

function machineSecretPath(): string | null {
  const rawHome = process.env.OPENCODEX_HOME ?? join(process.cwd(), ".opencodex-home");
  const home = resolve(rawHome);
  if (home.length === 0) return null;
  return join(home, SECRET_FILE_NAME);
}

let signingSecretCache: string | null = null;

/** Fail-closed signing secret: env var or machine-local file. Returns null
 *  when neither exists; destructive confirmations then refuse to operate. */
export function signingSecret(): string | null {
  if (signingSecretCache) return signingSecretCache;
  const env = process.env.MEMORY_SIGNING_SECRET;
  if (env && env.length >= 16 && !/^change-me/i.test(env)) {
    signingSecretCache = env;
    return signingSecretCache;
  }
  try {
    const secretPath = machineSecretPath();
    if (!secretPath) return null;
    if (existsSync(secretPath)) {
      const stored = readFileSync(secretPath, "utf8").trim();
      if (stored.length >= 16) {
        signingSecretCache = stored;
        return signingSecretCache;
      }
    }
    mkdirSync(resolve(process.env.OPENCODEX_HOME ?? join(process.cwd(), ".opencodex-home")), { recursive: true });
    const generated = randomBytes(32).toString("hex");
    writeFileSync(secretPath, generated + "\n", { encoding: "utf8" });
    signingSecretCache = generated;
    return signingSecretCache;
  } catch {
    return null;
  }
}

export function resetSigningSecretForTests(): void {
  signingSecretCache = null;
}

export interface ReceiptPayload {
  previewId: string;
  action: string;
  targetId: string;
  expectedRevision: number | null;
  expectedSourceHash: string | null;
  snapshotHash: string;
  expiresAtMs: number;
}

/** Signed opaque receipt: base64url(payload).base64url(hmac). */
export function signReceipt(payload: ReceiptPayload): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return body + "." + mac;
}

export function verifyReceipt(receipt: string): ReceiptPayload | null {
  const secret = signingSecret();
  if (!secret || typeof receipt !== "string" || receipt.length > 4096) return null;
  const dotIndex = receipt.indexOf(".");
  if (dotIndex <= 0) return null;
  const body = receipt.slice(0, dotIndex);
  const mac = receipt.slice(dotIndex + 1);
  const expectedMac = createHmac("sha256", secret).update(body).digest("base64url");
  if (mac.length !== expectedMac.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedMac.length; i += 1) {
    diff |= mac.charCodeAt(i) ^ expectedMac.charCodeAt(i);
  }
  if (diff !== 0) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ReceiptPayload;
  } catch {
    return null;
  }
}

/** OAuth token hashing: only hashes are persisted, never raw tokens. */
export function oauthTokenHash(token: string): string {
  return "sha256:" + sha256Hex("oauth:" + token);
}

export function randomOpaqueToken(prefix: string, bytes = 24): string {
  return prefix + randomBytes(bytes).toString("base64url");
}

/** PKCE S256: challenge = base64url(sha256(verifier)). Plain is rejected. */
export function pkceS256Challenge(verifier: string): string {
  return Buffer.from(createHash("sha256").update(verifier).digest()).toString("base64url");
}

export function supersessionSnapshotFields(request: SupersedeRequest): { supersedesMemoryId: string; expectedRevision: number | undefined; expectedHash: string | undefined } {
  return { supersedesMemoryId: request.supersedesMemoryId, expectedRevision: request.expectedRevision, expectedHash: request.expectedHash };
}
