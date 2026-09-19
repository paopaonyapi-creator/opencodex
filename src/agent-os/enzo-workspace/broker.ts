// Phase 20.94 — scoped credential broker with AES-256-GCM at rest.
// Uses the existing Phase 20.59 vault primitive. Secrets are never stored
// plaintext. HTTP/list APIs never return secret values.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { AesGcmVault, VaultIntegrityError, VaultUnavailableError, createVault, type VaultService } from "../../credentials/vault";
import type { EncryptedEnvelopeV1 } from "../../credentials/types";
import { EnzoWorkspaceError, redactSecrets, type CredentialLease } from "./types";

let vaultOverride: VaultService | null = null;

export function setWorkspaceVaultForTests(vault: VaultService | null): void {
  vaultOverride = vault;
}

export function workspaceVault(): VaultService {
  return vaultOverride ?? createVault();
}

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return prefix + randomUUID().replace(/-/g, "").slice(0, 12);
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function vaultStatus(): { state: "AVAILABLE" | "UNCONFIGURED"; keyId: string | null; detail: string } {
  try {
    const v = workspaceVault();
    return { state: "AVAILABLE", keyId: v.keyId(), detail: "AES-256-GCM vault ready" };
  } catch (err) {
    if (err instanceof VaultUnavailableError) {
      return { state: "UNCONFIGURED", keyId: null, detail: "CREDENTIAL_MASTER_KEY is not set; secret writes fail closed" };
    }
    return { state: "UNCONFIGURED", keyId: null, detail: err instanceof Error ? err.message : "vault unavailable" };
  }
}

export function putSecret(input: { secretRef: string; provider?: string; secret: string; scopes?: string[] }): { secretRef: string; hash: string; algorithm: "aes-256-gcm" } {
  let envelope: EncryptedEnvelopeV1;
  try {
    envelope = workspaceVault().write(input.secret);
  } catch (err) {
    if (err instanceof VaultUnavailableError) {
      throw new EnzoWorkspaceError("UNCONFIGURED", 503, "credential vault unavailable: set CREDENTIAL_MASTER_KEY", { feature: "CREDENTIAL_RUNTIME_ENABLED" });
    }
    throw err;
  }
  const hash = hashSecret(input.secret);
  const db = openAgentOsDb();
  db.run(
    "INSERT INTO enzo_secrets (id, secret_ref, provider, scopes_json, secret_hash, envelope_json, created_at, rotated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(secret_ref) DO UPDATE SET secret_hash = excluded.secret_hash, provider = excluded.provider, scopes_json = excluded.scopes_json, envelope_json = excluded.envelope_json, rotated_at = excluded.created_at",
    [newId("sec"), input.secretRef, input.provider ?? null, JSON.stringify(input.scopes ?? ["provider.call"]), hash, JSON.stringify(envelope), now()],
  );
  tryWrapRuntime(input);
  return { secretRef: input.secretRef, hash, algorithm: "aes-256-gcm" };
}

export function rotateSecret(secretRef: string, secret: string): { secretRef: string; hash: string } {
  const row = openAgentOsDb().query("SELECT envelope_json FROM enzo_secrets WHERE secret_ref = ?").get(secretRef) as { envelope_json: string } | undefined;
  if (!row?.envelope_json) throw new EnzoWorkspaceError("SECRET_NOT_FOUND", 404, "secret ref not registered: " + secretRef);
  const previous = JSON.parse(row.envelope_json) as EncryptedEnvelopeV1;
  const envelope = workspaceVault().replace(previous, secret);
  const hash = hashSecret(secret);
  openAgentOsDb().run(
    "UPDATE enzo_secrets SET secret_hash = ?, envelope_json = ?, rotated_at = ? WHERE secret_ref = ?",
    [hash, JSON.stringify(envelope), now(), secretRef],
  );
  return { secretRef, hash };
}

export function issueLease(input: {
  secretRef: string;
  runId: string;
  principal: string;
  scopes?: string[];
  ttlMs?: number;
  maxUses?: number;
  provider?: string;
}): CredentialLease {
  const db = openAgentOsDb();
  const secret = db.query("SELECT secret_ref, scopes_json FROM enzo_secrets WHERE secret_ref = ?").get(input.secretRef) as { secret_ref: string; scopes_json: string } | undefined;
  if (!secret) throw new EnzoWorkspaceError("SECRET_NOT_FOUND", 404, "secret ref not registered: " + input.secretRef);
  const storedScopes = JSON.parse(secret.scopes_json || "[]") as string[];
  const requested = input.scopes ?? ["provider.call"];
  for (const scope of requested) {
    if (storedScopes.length && !storedScopes.includes(scope) && !storedScopes.includes("*")) {
      throw new EnzoWorkspaceError("POLICY_DENIED", 403, "requested lease scope is not authorized: " + scope);
    }
  }
  const issuedAt = now();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? 15 * 60 * 1000)).toISOString();
  const lease: CredentialLease = {
    leaseId: newId("lease"),
    secretRef: input.secretRef,
    runId: input.runId,
    principal: input.principal,
    scopes: requested,
    issuedAt,
    expiresAt,
    maxUses: input.maxUses ?? 8,
    uses: 0,
    provider: input.provider,
    revoked: false,
  };
  db.run(
    "INSERT INTO enzo_leases (id, secret_ref, run_id, principal, scopes_json, issued_at, expires_at, max_uses, uses, provider, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)",
    [lease.leaseId, lease.secretRef, lease.runId, lease.principal, JSON.stringify(lease.scopes), lease.issuedAt, lease.expiresAt, lease.maxUses, lease.provider ?? null, issuedAt],
  );
  return lease;
}

export function consumeLease(leaseId: string): { ok: true; remaining: number } {
  const lease = getLease(leaseId);
  assertLeaseActive(lease);
  openAgentOsDb().run("UPDATE enzo_leases SET uses = uses + 1 WHERE id = ?", [leaseId]);
  return { ok: true, remaining: lease.maxUses - lease.uses - 1 };
}

export function revokeLease(leaseId: string): void {
  openAgentOsDb().run("UPDATE enzo_leases SET revoked = 1 WHERE id = ?", [leaseId]);
}

export function getLease(leaseId: string): CredentialLease {
  const row = openAgentOsDb().query("SELECT * FROM enzo_leases WHERE id = ?").get(leaseId) as Record<string, unknown> | undefined;
  if (!row) throw new EnzoWorkspaceError("LEASE_NOT_FOUND", 404, "lease not found: " + leaseId);
  return {
    leaseId: String(row.id),
    secretRef: String(row.secret_ref),
    runId: String(row.run_id),
    principal: String(row.principal),
    scopes: JSON.parse(String(row.scopes_json ?? "[]")) as string[],
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    maxUses: Number(row.max_uses),
    uses: Number(row.uses),
    provider: row.provider ? String(row.provider) : undefined,
    revoked: Number(row.revoked) === 1,
  };
}

/** Internal provider-call seam. Never expose via HTTP. */
export function revealForProviderCall(leaseId: string, requiredScope = "provider.call"): string {
  const lease = getLease(leaseId);
  assertLeaseActive(lease);
  if (!lease.scopes.includes(requiredScope) && !lease.scopes.includes("*")) {
    throw new EnzoWorkspaceError("POLICY_DENIED", 403, "lease scope does not permit " + requiredScope);
  }
  consumeLease(leaseId);
  const row = openAgentOsDb().query("SELECT envelope_json FROM enzo_secrets WHERE secret_ref = ?").get(lease.secretRef) as { envelope_json: string | null } | undefined;
  if (!row?.envelope_json) throw new EnzoWorkspaceError("SECRET_NOT_FOUND", 404, "encrypted envelope missing");
  try {
    const envelope = JSON.parse(row.envelope_json) as EncryptedEnvelopeV1;
    return workspaceVault().read(envelope);
  } catch (err) {
    if (err instanceof VaultIntegrityError) {
      throw new EnzoWorkspaceError("SCHEMA_INVALID", 409, "encrypted envelope failed integrity check");
    }
    throw err;
  }
}

export function publicLeaseView(lease: CredentialLease): CredentialLease & { secret: undefined } {
  return { ...lease, secret: undefined };
}

export function redactBrokerText(text: string): string {
  return redactSecrets(text);
}

function assertLeaseActive(lease: CredentialLease): void {
  if (lease.revoked) throw new EnzoWorkspaceError("LEASE_EXPIRED", 409, "lease revoked");
  if (Date.parse(lease.expiresAt) <= Date.now()) throw new EnzoWorkspaceError("LEASE_EXPIRED", 409, "lease expired");
  if (lease.uses >= lease.maxUses) throw new EnzoWorkspaceError("LEASE_EXHAUSTED", 409, "lease max uses exhausted");
}

function tryWrapRuntime(input: { secretRef: string; provider?: string; secret: string; scopes?: string[] }): void {
  try {
    const { getCredentialRuntimeService } = require("../../credentials/service") as typeof import("../../credentials/service");
    const svc = getCredentialRuntimeService();
    if (!svc.enabled()) return;
    void svc.importCredential({
      provider: input.provider ?? "workspace",
      name: input.secretRef,
      secret: input.secret,
      scopes: input.scopes,
      actor: "enzo-workspace",
      validate: false,
    });
  } catch {
    // 20.59 runtime is optional. Workspace AES vault remains canonical for 20.94.
  }
}

export { AesGcmVault };
