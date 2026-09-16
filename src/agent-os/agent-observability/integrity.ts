// Phase 20.40 — Integrity verification (spec §30). Regular polls NEVER hash;
// SHA-256 is computed on demand, cached by source revision, and a forced
// check bypasses the cache. A changed hash is reported as "content changed
// since the previous verified revision" — never as tampering.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { IntegrityResult, SessionObservationError } from "./types";

export class IntegrityEngine {
  private hashByRevision = new Map<string, string>();
  private cacheLimit = 2000;

  /** Stream-hash the source file. Fails soft with a structured error. */
  async hashFile(sourcePath: string): Promise<{ digest: string | null; error: SessionObservationError | null }> {
    return new Promise((resolveHash) => {
      const hash = createHash("sha256");
      let stream;
      try {
        stream = createReadStream(sourcePath);
      } catch (error) {
        resolveHash({
          digest: null,
          error: { code: "HASH_FAILED", message: error instanceof Error ? error.message : String(error), recoverable: true, observedAt: new Date().toISOString() },
        });
        return;
      }
      stream.on("data", (chunk: Buffer) => hash.update(chunk));
      stream.on("end", () => resolveHash({ digest: hash.digest("hex"), error: null }));
      stream.on("error", (error: Error) => {
        resolveHash({
          digest: null,
          error: { code: "HASH_FAILED", message: error.message, recoverable: true, observedAt: new Date().toISOString() },
        });
      });
    });
  }

  async verify(sourcePath: string, revision: string | null, previousDigest: string | null, options: { force: boolean }): Promise<IntegrityResult> {
    const checkedAt = new Date().toISOString();
    if (!revision) {
      return { algorithm: "sha256", digest: null, sourceRevision: null, previousDigest, status: "unavailable", checkedAt, error: { code: "UNSUPPORTED", message: "source has no revision token", recoverable: true, observedAt: checkedAt } };
    }
    if (!options.force) {
      const cached = this.hashByRevision.get(revision);
      if (cached) {
        return this.buildResult(cached, revision, previousDigest, checkedAt, null);
      }
    }
    const { digest, error } = await this.hashFile(sourcePath);
    if (!digest) {
      return { algorithm: "sha256", digest: null, sourceRevision: revision, previousDigest, status: "error", checkedAt, error };
    }
    if (this.hashByRevision.size >= this.cacheLimit) {
      const oldest = this.hashByRevision.keys().next().value;
      if (oldest) this.hashByRevision.delete(oldest);
    }
    this.hashByRevision.set(revision, digest);
    return this.buildResult(digest, revision, previousDigest, checkedAt, null);
  }

  private buildResult(digest: string, revision: string, previousDigest: string | null, checkedAt: string, error: SessionObservationError | null): IntegrityResult {
    const status: IntegrityResult["status"] = previousDigest === null ? "verified" : previousDigest === digest ? "verified" : "changed";
    return { algorithm: "sha256", digest, sourceRevision: revision, previousDigest, status, checkedAt, error };
  }

  cachedDigest(revision: string | null): string | null {
    if (!revision) return null;
    return this.hashByRevision.get(revision) ?? null;
  }
}
