// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Storage Layout & Safe Filename Handling

import { mkdirSync, existsSync, createReadStream } from "node:fs";
import { join, resolve, normalize, basename } from "node:path";
import { createHash } from "node:crypto";
import type { MediaStorageLayout } from "./types";
import { MediaError } from "./errors";

export function initMediaStorage(baseDir: string = "runtime/media"): MediaStorageLayout {
  const rootDir = resolve(process.cwd(), baseDir);
  const layout: MediaStorageLayout = {
    rootDir,
    incomingDir: join(rootDir, "incoming"),
    jobsDir: join(rootDir, "jobs"),
    cacheDir: join(rootDir, "cache"),
    tempDir: join(rootDir, "temp"),
    referencesDir: join(rootDir, "references"),
    transcriptsDir: join(rootDir, "transcripts"),
    thumbnailsDir: join(rootDir, "thumbnails"),
    processedDir: join(rootDir, "processed"),
  };

  for (const dir of Object.values(layout)) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return layout;
}

export function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // remove special chars
    .trim()
    .replace(/[\s_-]+/g, "-") // collapse spaces/underscores
    .slice(0, 50); // limit length
}

export function generateSafeMediaFilename(params: {
  platform: string;
  jobId: string;
  title: string;
  ext: string;
}): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const safePlatform = sanitizeSlug(params.platform) || "web";
  const safeJobId = params.jobId.replace(/[^\w-]/g, "");
  const safeSlug = sanitizeSlug(params.title) || "media";
  const cleanExt = params.ext.replace(/^\./, "").toLowerCase().slice(0, 5);

  return `${dateStr}_${safePlatform}_${safeJobId}_${safeSlug}.${cleanExt}`;
}

export function assertPathInsideRoot(filePath: string, rootDir: string): void {
  const normalizedFile = normalize(resolve(filePath));
  const normalizedRoot = normalize(resolve(rootDir));

  if (!normalizedFile.startsWith(normalizedRoot)) {
    throw new MediaError(
      "MEDIA_STORAGE_FAILED",
      `Security violation: Target file path '${filePath}' traverses outside storage root '${rootDir}'.`,
    );
  }
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => res(hash.digest("hex")));
    stream.on("error", (err) => rej(err));
  });
}
