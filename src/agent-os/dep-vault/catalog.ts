// Phase 20.38 — lockfile detection/normalization (§5, §26), dependency
// profiles (§12) and CycloneDX SBOM generation (§27). Lockfiles are the
// source of truth for exact versions; no custom semver resolver is implemented.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DependencyVaultError } from "./policy";
import type { DependencyGraph, DependencyNode, ProfileDefinition } from "./types";

export type LockfileType = DependencyGraph["lockfileType"];

export function detectLockfile(projectDir: string): { type: LockfileType; path: string } | null {
  const candidates: Array<{ type: LockfileType; file: string }> = [
    { type: "npm-shrinkwrap", file: "npm-shrinkwrap.json" },
    { type: "package-lock", file: "package-lock.json" },
    { type: "pnpm-lock", file: "pnpm-lock.yaml" },
    { type: "bun-lock", file: "bun.lock" },
  ];
  for (const candidate of candidates) {
    const path = join(projectDir, candidate.file);
    if (existsSync(path)) return { type: candidate.type, path };
  }
  return null;
}

export function lockfileHash(raw: string): string {
  return "sha256:" + createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

/** Normalizes a supported lockfile into the internal dependency graph (§26).
 *  npm package-lock v2/v3 `packages` format and pnpm-lock v6+ `packages`
 *  keys are normalized; unsupported shapes fail loudly. */
export function normalizeLockfile(projectKey: string, projectDir: string, packageManager: DependencyGraph["packageManager"]): DependencyGraph {
  const detected = detectLockfile(projectDir);
  if (!detected) {
    throw new DependencyVaultError("DEPENDENCY_LOCKFILE_NOT_FOUND", `no supported lockfile in ${projectDir}`);
  }
  const raw = readFileSync(detected.path, "utf8");
  let nodes: DependencyNode[];
  if (detected.type === "package-lock" || detected.type === "npm-shrinkwrap") {
    nodes = parseNpmPackageLock(raw);
  } else if (detected.type === "pnpm-lock") {
    nodes = parsePnpmLock(raw);
  } else {
    throw new DependencyVaultError("DEPENDENCY_UNSUPPORTED_LOCKFILE", "bun.lock binary/text parsing is documented as a follow-up; use package-lock or pnpm-lock");
  }
  if (nodes.length === 0) {
    throw new DependencyVaultError("DEPENDENCY_UNSUPPORTED_LOCKFILE", "lockfile contained no recognizable package entries");
  }
  return {
    projectKey,
    projectPath: projectDir,
    packageManager,
    lockfileType: detected.type,
    lockfileHash: lockfileHash(raw),
    nodes,
  };
}

interface NpmPackageEntry { resolved?: string; integrity?: string; dev?: boolean; optional?: boolean; devOptional?: boolean }

function parseNpmPackageLock(raw: string): DependencyNode[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new DependencyVaultError("DEPENDENCY_UNSUPPORTED_LOCKFILE", "package-lock is not valid JSON");
  }
  const packages = parsed.packages;
  if (!packages || typeof packages !== "object") {
    throw new DependencyVaultError("DEPENDENCY_UNSUPPORTED_LOCKFILE", "package-lock lacks the normalized `packages` map (v2/v3 required)");
  }
  const nodes: DependencyNode[] = [];
  for (const [key, value] of Object.entries(packages as Record<string, NpmPackageEntry>)) {
    if (!key.startsWith("node_modules/") || !value || typeof value !== "object") continue;
    const withoutPrefix = key.slice("node_modules/".length);
    // The direct root dependency is the entry with exactly one path segment
    // keyed as the package name at the top level.
    const name = withoutPrefix.split("node_modules/").pop()!;
    if (!name) continue;
    const version = typeof value.resolved === "string" && value.resolved ? versionFromResolved(value.resolved) : "";
    nodes.push({
      name,
      version,
      integrity: typeof value.integrity === "string" ? value.integrity : null,
      resolved: value.resolved ?? null,
      direct: !withoutPrefix.includes("node_modules/"),
      dev: value.dev === true,
      optional: value.optional === true || value.devOptional === true,
      peer: false,
    });
  }
  return nodes;
}

function versionFromResolved(resolved: string): string {
  const tail = resolved.split("/").pop() ?? "";
  return tail.replace(/^.*(?=-)/, "").replace(/^-/, "").replace(/\.tgz$/, "") || tail;
}

interface PnpmSection { [key: string]: { resolution?: { integrity?: string } } }

function parsePnpmLock(raw: string): DependencyNode[] {
  // Minimal v6/v9 `packages:` key parser: "name@version:" lines with
  // resolution.integrity. Structure-only; no YAML library dependency.
  const nodes: DependencyNode[] = [];
  const lines = raw.split("\n");
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
    if (inPackages && /^[A-Za-z_]/.test(line)) { inPackages = false; continue; }
    if (!inPackages) continue;
    const keyMatch = /^ {2}([^:\s]+):$/.exec(line);
    if (!keyMatch) continue;
    const key = keyMatch[1]!;
    const atIndex = key.lastIndexOf("@");
    if (atIndex <= 0) continue;
    const name = key.slice(0, atIndex).replace(/^\(/, "").replace(/\)$/, "");
    const version = key.slice(atIndex + 1).replace(/\(/, "").replace(/\).*$/, "");
    if (!name || !version) continue;
    nodes.push({
      name,
      version,
      integrity: null,
      resolved: null,
      direct: !name.includes("/"),
      dev: false,
      optional: false,
      peer: false,
    });
  }
  // Second pass: attach pnpm resolution integrity by re-scanning under keys.
  let currentKey: string | null = null;
  const integrityByKey = new Map<string, string>();
  for (const line of lines) {
    const keyMatch = /^ {2}([^:\s]+):\s*$/.exec(line);
    if (keyMatch) { currentKey = keyMatch[1]!; continue; }
    const integrityMatch = /^\s+resolution:\s*\{?\s*integrity:\s*(sha512-[A-Za-z0-9+/=]+)/.exec(line);
    if (integrityMatch && currentKey) integrityByKey.set(currentKey, integrityMatch[1]!);
  }
  for (const node of nodes) {
    const key = `${node.name}@${node.version}`;
    node.integrity = integrityByKey.get(key) ?? node.integrity;
  }
  return nodes;
}

// --- Profiles (§12): seeded as data, registered centrally ------------------------

export const SEED_PROFILES: ProfileDefinition[] = [
  { id: "base-web", name: "Base Web", version: 1, packageManager: "npm", packages: [{ name: "zod", version: "latest" }, { name: "typescript", version: "latest" }], capabilities: ["web"] },
  { id: "nextjs", name: "Next.js", version: 1, packageManager: "npm", packages: [{ name: "next", version: "latest" }, { name: "react", version: "latest" }, { name: "react-dom", version: "latest" }, { name: "zod", version: "latest" }], capabilities: ["web", "ssr"] },
  { id: "browser-automation", name: "Browser Automation", version: 1, packageManager: "pnpm", packages: [{ name: "playwright", version: "latest" }, { name: "zod", version: "latest" }], capabilities: ["browser", "scraping", "automation"] },
  { id: "ai-agent", name: "AI Agent", version: 1, packageManager: "npm", packages: [{ name: "zod", version: "latest" }, { name: "openai", version: "latest" }], capabilities: ["ai", "agents"] },
  { id: "video-production", name: "Video Production", version: 1, packageManager: "pnpm", packages: [{ name: "fluent-ffmpeg", version: "latest" }, { name: "zod", version: "latest" }], capabilities: ["video", "media"] },
  { id: "adobe-stock", name: "Adobe Stock Production", version: 1, packageManager: "pnpm", packages: [{ name: "sharp", version: "latest" }, { name: "exiftool-vendored", version: "latest" }, { name: "zod", version: "latest" }], capabilities: ["image-processing", "metadata", "export"] },
];

// --- SBOM (§27): CycloneDX JSON -----------------------------------------------------

export function generateCycloneDx(graph: DependencyGraph): Record<string, unknown> {
  const components = graph.nodes.map((node) => ({
    type: "library",
    name: node.name,
    version: node.version,
    purl: `pkg:npm/${node.name}@${node.version}`,
    hashes: node.integrity?.startsWith("sha512-") ? [{ alg: "SHA-512", content: Buffer.from(node.integrity.slice(7), "base64").toString("hex") }] : undefined,
    scope: node.optional ? "optional" : node.dev ? "excluded" : "required",
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: "urn:uuid:" + crypto.randomUUID(),
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "Pao-hubPro", name: "dependency-vault", version: "20.38" }],
      properties: [
        { name: "pao:lockfileType", value: graph.lockfileType },
        { name: "pao:lockfileHash", value: graph.lockfileHash },
        { name: "pao:packageManager", value: graph.packageManager },
      ],
    },
    components,
  };
}
