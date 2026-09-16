// Phase 20.57 — naming and classification helpers for skill sources.

import type { SkillSourceType, TrustLevel } from "./types";
import { SkillGateHttpError } from "./types";

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug) {
    throw new SkillGateHttpError("VALIDATION_ERROR", 400, "cannot derive a slug from the given name");
  }
  return slug;
}

export function inferTrustLevel(sourceType: SkillSourceType): TrustLevel {
  if (sourceType === "generated" || sourceType === "bundled") return "organization";
  return "unknown";
}

export function nextPatchVersion(previous: string | null, commitShort: string | null): string {
  if (!previous) return commitShort ? `0.0.0+git.${commitShort}` : "0.0.0";
  const match = previous.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return previous;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function shortCommit(commit: string | null): string | null {
  if (!commit) return null;
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}
