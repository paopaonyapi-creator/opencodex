// Phase 20.18 — Pao Grok Production Bridge: download manager.
//
// Three properties this module is responsible for, in order of importance:
//
//  1. A filename derived from remote input must never escape the downloads root.
//     The prompt and job id reach this code from an extension, and an extension is
//     an untrusted input source by the same reasoning the control plane uses for
//     agents. Every component is sanitized and the final path is asserted.
//  2. A partial download must never be presented as a complete one. Files are
//     written to a `.part` name and renamed on success, so a crash mid-write leaves
//     something obviously unfinished rather than a plausible-looking short file.
//  3. Every artifact carries a checksum and a provenance record, because the Adobe
//     Stock handoff downstream needs to prove where a file came from.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, normalize, relative, isAbsolute, resolve } from "node:path";

export interface DownloadPlan {
  readonly jobId: string;
  readonly index: number;
  readonly extension: string;
  readonly targetPath: string;
  readonly relativePath: string;
}

export interface DownloadRecord {
  readonly plan: DownloadPlan;
  readonly bytes: number;
  readonly sha256: string;
  readonly completedAt: string;
}

export interface ProvenanceManifest {
  readonly jobId: string;
  readonly provider: string;
  readonly prompt: string;
  readonly project: string | null;
  readonly mediaType: string;
  readonly generatedAt: string;
  readonly files: readonly {
    readonly index: number;
    readonly filename: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly sourceUrl: string | null;
  }[];
}

/**
 * Strip anything from a string that could change a path's meaning.
 *
 * Keeps only letters, digits, dot, dash, and underscore, then collapses runs. This
 * is a whitelist rather than a blacklist because a blacklist of path metacharacters
 * is a list that gets longer every time someone finds a new one.
 */
export function sanitizeSegment(input: string, fallback = "value"): string {
  const cleaned = String(input ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
  // A name of only dots would resolve to a parent directory.
  if (cleaned === "" || /^\.+$/.test(cleaned)) return fallback;
  return cleaned.slice(0, 120);
}

/**
 * Deterministic filename, per the phase's naming rule.
 *
 * `PAO-GROK_<JOBID>_<INDEX>_<YYYYMMDD-HHmmss>.<ext>`
 *
 * Collision resistance comes from the job id plus index rather than from a random
 * suffix, so a re-download of the same result overwrites its own file instead of
 * accumulating copies of it.
 */
export function buildFilename(input: {
  jobId: string;
  index: number;
  extension: string;
  timestamp: Date;
}): string {
  const job = sanitizeSegment(input.jobId, "JOB");
  const ext = sanitizeSegment(input.extension, "bin").toLowerCase();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const t = input.timestamp;
  const stamp = `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`;
  return `PAO-GROK_${job}_${String(input.index).padStart(2, "0")}_${stamp}.${ext}`;
}

export class DownloadManager {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  getRoot(): string {
    return this.root;
  }
  
  /**
   * Resolve where a result should be written.
   *
   * The date and job directories are both sanitized, and the final path is checked
   * against the root before it is returned. The check is not redundant with the
   * sanitizing: a sanitizer bug should not be able to write outside the root, so the
   * two protections are deliberately independent.
   */
  plan(input: {
    jobId: string;
    index: number;
    extension: string;
    date?: Date;
  }): DownloadPlan {
    const when = input.date ?? new Date();
    const day = when.toISOString().slice(0, 10);
    const jobDir = sanitizeSegment(input.jobId, "JOB");
    const filename = buildFilename({
      jobId: input.jobId,
      index: input.index,
      extension: input.extension,
      timestamp: when,
    });

    const target = normalize(join(this.root, "grok", day, jobDir, filename));
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Resolved download path escapes the downloads root: ${target}`);
    }
    return { jobId: input.jobId, index: input.index, extension: input.extension, targetPath: target, relativePath: rel };
  }

  /**
   * Write a downloaded payload.
   *
   * The `.part` dance is the incomplete-download protection: a reader that finds a
   * `.part` file knows the write did not finish, whereas a half-written file under
   * the final name is indistinguishable from a complete one.
   */
  write(plan: DownloadPlan, data: Uint8Array): DownloadRecord {
    mkdirSync(dirname(plan.targetPath), { recursive: true });
    const partPath = `${plan.targetPath}.part`;
    try {
      writeFileSync(partPath, data);
      renameSync(partPath, plan.targetPath);
    } catch (error) {
      // Leave no partial artefact behind under either name.
      try {
        if (existsSync(partPath)) unlinkSync(partPath);
      } catch {
        // Best-effort cleanup.
      }
      throw error;
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    const bytes = statSync(plan.targetPath).size;
    return { plan, bytes, sha256, completedAt: new Date().toISOString() };
  }

  /** Verify an existing file against a recorded checksum. */
  verify(plan: DownloadPlan, expectedSha256: string): boolean {
    if (!existsSync(plan.targetPath)) return false;
    const actual = createHash("sha256").update(readFileSync(plan.targetPath)).digest("hex");
    return actual === expectedSha256;
  }

  /**
   * Write the provenance manifest beside the outputs.
   *
   * The manifest is what makes the downstream Adobe Stock handoff checkable: it ties
   * every file to the prompt and job that produced it, which is the record the stock
   * pipeline's own provenance model expects.
   */
  writeProvenance(plan: DownloadPlan, manifest: ProvenanceManifest): string {
    const dir = dirname(plan.targetPath);
    mkdirSync(dir, { recursive: true });
    const provenancePath = join(dir, "provenance.json");
    writeFileSync(provenancePath, JSON.stringify(manifest, null, 2), "utf8");
    const jobPath = join(dir, "job.json");
    writeFileSync(
      jobPath,
      JSON.stringify(
        {
          jobId: manifest.jobId,
          provider: manifest.provider,
          prompt: manifest.prompt,
          project: manifest.project,
          mediaType: manifest.mediaType,
          generatedAt: manifest.generatedAt,
          fileCount: manifest.files.length,
        },
        null,
        2,
      ),
      "utf8",
    );
    return provenancePath;
  }
}

