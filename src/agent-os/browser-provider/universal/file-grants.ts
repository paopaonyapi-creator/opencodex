// Phase 20.19 — Pao Universal AI Browser Provider: one-time file grant broker.
//
// THE PROBLEM. An adapter needs to attach a file to a page. The obvious design hands it
// a filesystem path — and now every adapter holds a capability to name any path on the
// machine, including ones the job never mentioned. An adapter is the least trusted code
// in the system, and that would hand it the most trusted capability.
//
// THE FIX. A job declares its files; the broker mints a short-lived, single-job,
// single-file GRANT for each one. An adapter can only name a grant id. It cannot
// construct one, cannot guess one, and cannot use one outside the job it was minted for.
//
// Three properties, each closing a specific hole:
//   - Bound to a job. A grant leaked from job A cannot be spent by job B.
//   - Expiring. A grant captured in a log is worthless shortly after.
//   - Read-limited. A grant that could be redeemed indefinitely is a permanent path; a
//     read count makes a retry storm fail closed instead of looping.

import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';

export interface FileGrant {
  readonly grantId: string;
  readonly jobId: string;
  /** The real path. Held by the broker only; never handed to an adapter. */
  readonly path: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly expiresAt: number;
  readonly remainingReads: number;
}

/** What an adapter is allowed to learn about a granted file. */
export interface PublicFileGrant {
  readonly grantId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
}

export interface FileGrantBrokerOptions {
  readonly ttlMs?: number;
  readonly maxReads?: number;
  /** Maximum size a grant may cover. */
  readonly maxBytes?: number;
  readonly now?: () => number;
}

/**
 * MIME is derived from the extension, not from the caller.
 *
 * A caller-supplied type would let a job claim a PNG is a PNG while the bytes are
 * something else, and the point of the type is that the runtime can make a decision
 * about the file without opening it.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
};

export function mimeForPath(path: string): string {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface GrantRequest {
  readonly jobId: string;
  readonly path: string;
  readonly bytes: number;
  /** Caller-declared type. Checked against the extension-derived one, not trusted. */
  readonly declaredMimeType?: string;
}

export class FileGrantBroker {
  private grants = new Map<string, FileGrant>();
  private readonly ttlMs: number;
  private readonly maxReads: number;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: FileGrantBrokerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.maxReads = options.maxReads ?? 2;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Mint a grant for one file of one job.
   *
   * Returns null rather than throwing when the request is unacceptable, so a caller can
   * report the reason alongside whatever else it was doing.
   */
  mint(request: GrantRequest): { ok: true; grant: PublicFileGrant; expiresAt: number } | { ok: false; reason: string } {
    if (!request.jobId) return { ok: false, reason: 'A grant must name a job.' };
    if (!request.path) return { ok: false, reason: 'A grant must name a file.' };
    if (request.bytes > this.maxBytes) {
      return { ok: false, reason: 'File exceeds the ' + Math.round(this.maxBytes / 1024 / 1024) + 'MB grant limit.' };
    }

    const mimeType = mimeForPath(request.path);
    // A declaration that contradicts the extension is refused rather than corrected: it
    // signals a caller that is confused about what it is uploading, and guessing which
    // half is right is not the broker's job.
    if (request.declaredMimeType && request.declaredMimeType !== mimeType) {
      return {
        ok: false,
        reason: 'Declared type ' + request.declaredMimeType + ' does not match the file extension (' + mimeType + ').',
      };
    }

    const grantId = 'grant_' + randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    const grant: FileGrant = {
      grantId,
      jobId: request.jobId,
      path: request.path,
      name: basename(request.path),
      mimeType,
      bytes: request.bytes,
      expiresAt,
      remainingReads: this.maxReads,
    };
    this.grants.set(grantId, grant);
    return {
      ok: true,
      expiresAt,
      grant: { grantId, name: grant.name, mimeType, bytes: grant.bytes },
    };
  }

  /**
   * Redeem a grant for a specific job.
   *
   * Expiry and read count are consumed HERE rather than checked by the caller, so no
   * caller can forget. A spent grant is deleted, which makes a double-spend impossible
   * rather than merely detected.
   */
  redeem(grantId: string, jobId: string): { ok: true; path: string; mimeType: string } | { ok: false; reason: string } {
    const grant = this.grants.get(grantId);
    if (!grant) return { ok: false, reason: 'No such grant; it was never minted, was already spent, or was reset.' };
    if (grant.jobId !== jobId) {
      // Deliberately does NOT spend the grant: a cross-job attempt must not break the job
      // that legitimately owns it.
      return { ok: false, reason: 'Grant belongs to a different job.' };
    }
    if (this.now() > grant.expiresAt) {
      this.grants.delete(grantId);
      return { ok: false, reason: 'Grant expired.' };
    }
    if (grant.remainingReads <= 0) {
      this.grants.delete(grantId);
      return { ok: false, reason: 'Grant has no reads remaining.' };
    }

    const remaining = grant.remainingReads - 1;
    if (remaining <= 0) {
      this.grants.delete(grantId);
    } else {
      this.grants.set(grantId, { ...grant, remainingReads: remaining });
    }
    return { ok: true, path: grant.path, mimeType: grant.mimeType };
  }

  /** Non-consuming inspection, for dry run and diagnostics. */
  inspect(grantId: string): PublicFileGrant | null {
    const grant = this.grants.get(grantId);
    if (!grant) return null;
    return { grantId: grant.grantId, name: grant.name, mimeType: grant.mimeType, bytes: grant.bytes };
  }

  /** Grants minted for one job, for the dry-run plan and the audit trail. */
  listForJob(jobId: string): PublicFileGrant[] {
    return [...this.grants.values()]
      .filter((grant) => grant.jobId === jobId)
      .map((grant) => ({ grantId: grant.grantId, name: grant.name, mimeType: grant.mimeType, bytes: grant.bytes }));
  }

  revokeJob(jobId: string): number {
    let removed = 0;
    for (const [id, grant] of this.grants.entries()) {
      if (grant.jobId === jobId) {
        this.grants.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  prune(): number {
    let removed = 0;
    for (const [id, grant] of this.grants.entries()) {
      if (this.now() > grant.expiresAt) {
        this.grants.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  reset(): void {
    this.grants.clear();
  }
}

let defaultBroker: FileGrantBroker | null = null;

export function getFileGrantBroker(): FileGrantBroker {
  if (!defaultBroker) defaultBroker = new FileGrantBroker();
  return defaultBroker;
}

export function resetFileGrantBroker(): void {
  defaultBroker = null;
}
