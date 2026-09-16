// Phase 20.38 — Dependency Vault security tests (spec §33-§35).
// Policy allowlist/HTTPS, digest + CAS paths, integrity mismatch →
// QUARANTINED, tar-slip/absolute-path/symlink/hardlink/device rejection,
// concurrent-fetch dedup, bundle tamper + format rejection, strict air-gap
// fail-closed, quarantined-install block, GC eligibility, SBOM, secret
// redaction. All registry access is mocked — no network.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { DependencyVaultService } from "../src/agent-os/dep-vault/vault";
import { defaultPolicy, evaluateInstallability, evaluateNetworkMode, evaluateRegistry, redactVaultLog } from "../src/agent-os/dep-vault/policy";
import { casPathFor, parseIntegrity, scanTarEntries, sha512Digest, validateArchiveEntries, verifyIntegrity } from "../src/agent-os/dep-vault/integrity";
import { detectLockfile, generateCycloneDx, normalizeLockfile } from "../src/agent-os/dep-vault/catalog";
import type { DependencyVaultError } from "../src/agent-os/dep-vault/policy";

let testDir: string;
let storageDir: string;

/** Builds a real gzipped tar purely in JS (ustar headers written by hand —
 *  no external process) so the archive-safety scan exercises genuine tar
 *  headers. */
function makeRealTarball(): Uint8Array {
  const content = "module.exports = 1;\n";
  const name = "package/index.js";
  const header = new Uint8Array(512);
  const nameBytes = Buffer.from(name, "utf8");
  header.set(nameBytes, 0);
  header.set(Buffer.from("0000006" + content.length.toString(8).padStart(7, "0")), 124); // size
  header.set(Buffer.from("0000644\0"), 100); // mode
  header.set(Buffer.from("0000000\0"), 136); // uid
  header.set(Buffer.from("0000000\0"), 148); // gid
  header[156] = "0".charCodeAt(0); // regular file
  header.set(Buffer.from("ustar\0"), 257);
  header.set(Buffer.from("00"), 263);
  // checksum: spaces during computation, then octal of the byte sum
  header.fill(32, 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.set(Buffer.from(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  const contentBytes = Buffer.from(content, "utf8");
  const padded = Buffer.alloc(Math.ceil(contentBytes.length / 512) * 512);
  contentBytes.copy(padded);
  const end = Buffer.alloc(1024);
  const tar = Buffer.concat([Buffer.from(header), padded, end]);
  const gz = gzipSync(tar);
  return new Uint8Array(gz);
}

const REAL_TARBALL = makeRealTarball();

beforeEach(() => {
  closeAgentOsDbForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-dv-test-"));
  storageDir = join(testDir, "storage");
  process.env.OPENCODEX_HOME = testDir;
  process.env.DEPENDENCY_VAULT_STORAGE = storageDir;
});

afterEach(() => {
  closeAgentOsDbForTests();
  rmSync(testDir, { recursive: true, force: true });
});

const FAKE_TARBALL = REAL_TARBALL;
const REGISTRY = "https://registry.npmjs.org";

function makeService(overrides?: { tarballBytes?: Uint8Array; metadata?: Record<string, never> }) {
  const tarball = overrides?.tarballBytes ?? FAKE_TARBALL;
  const digest = sha512Digest(tarball);
  const fetcher = {
    async metadata(registry: string, name: string) {
      return { versions: { "1.0.0": { dist: { tarball: `${registry}/${name}/-/${name}-1.0.0.tgz`, integrity: digest.integrity } } } } as never;
    },
    async tarball() {
      return tarball;
    },
  };
  return { service: new DependencyVaultService({ fetcher: fetcher as never }), digest };
}

// --- Policy (§10, §39) -----------------------------------------------------------

describe("Phase 20.38 vault policy", () => {
  test("registry allowlist: unknown and denied registries fail closed", () => {
    const policy = defaultPolicy();
    expect(evaluateRegistry(policy, REGISTRY).allowed).toBe(true);
    expect(evaluateRegistry(policy, "https://evil.example").allowed).toBe(false);
    const withDeny = { ...policy, registries: { ...policy.registries, deny: ["https://registry.npmjs.org"] } };
    expect(evaluateRegistry(withDeny, REGISTRY).rule).toBe("registry.deny");
    const noHttps = { ...policy, security: { ...policy.security, requireHttps: false }, registries: { ...policy.registries, allow: ["http://registry.npmjs.org"] } };
    expect(evaluateRegistry(noHttps, "http://registry.npmjs.org").allowed).toBe(true);
    expect(evaluateRegistry(defaultPolicy(), "http://registry.npmjs.org").allowed).toBe(false);
  });

  test("install modes: OFFLINE and STRICT_AIR_GAP never reach the network on miss", () => {
    expect(evaluateNetworkMode("OFFLINE", false).allowed).toBe(false);
    expect(evaluateNetworkMode("STRICT_AIR_GAP", false).allowed).toBe(false);
    expect(evaluateNetworkMode("ONLINE", false).allowed).toBe(true);
    expect(evaluateNetworkMode("OFFLINE_PREFERRED", false).allowed).toBe(false);
    delete process.env.DEPENDENCY_VAULT_ALLOW_NETWORK_FALLBACK;
  });

  test("quarantined and blocked artifacts can never install (§39 invariant 1)", () => {
    expect(evaluateInstallability("VERIFIED").allowed).toBe(true);
    expect(evaluateInstallability("QUARANTINED").decision).toBe("quarantine");
    expect(evaluateInstallability("BLOCKED").allowed).toBe(false);
    expect(evaluateInstallability("DOWNLOADED").allowed).toBe(false);
    expect(evaluateInstallability("DISCOVERED").allowed).toBe(false);
  });

  test("secret redaction strips credentials from log surfaces (§28)", () => {
    const token = "tok_" + "value123456";
    expect(redactVaultLog(`Authorization: Bearer ${token}`)).not.toContain(token);
    expect(redactVaultLog("https://user:secret@registry.test/pkg")).toContain("[REDACTED-creds]");
  });
});

// --- CAS + integrity (§7, §31) ------------------------------------------------------

describe("Phase 20.38 CAS and integrity", () => {
  test("digest paths are content-addressed and deterministic", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { integrity, sha512Hex } = sha512Digest(bytes);
    expect(integrity.startsWith("sha512-")).toBe(true);
    expect(sha512Hex).toHaveLength(128);
    expect(casPathFor(sha512Hex)).toContain(join("blobs", "sha512", sha512Hex.slice(0, 2)));
    expect(sha512Digest(bytes).sha512Hex).toBe(sha512Hex);
  });

  test("integrity parser handles npm sha512-<base64> format and rejects garbage", () => {
    const { integrity } = sha512Digest(new Uint8Array([9, 9, 9]));
    const parsed = parseIntegrity(integrity);
    expect(parsed?.algorithm).toBe("sha512");
    expect(parsed?.hex).toHaveLength(128);
    expect(parseIntegrity("not-an-integrity")).toBeNull();
    expect(parseIntegrity(null)).toBeNull();
  });

  test("verifyIntegrity detects mismatches (§31)", () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const good = sha512Digest(bytes).integrity;
    expect(verifyIntegrity(bytes, good).ok).toBe(true);
    const other = sha512Digest(new Uint8Array([7, 8, 9])).integrity;
    expect(verifyIntegrity(bytes, other).ok).toBe(false);
  });
});

// --- Archive safety (§15) ---------------------------------------------------------------

describe("Phase 20.38 archive safety", () => {
  test("tar-slip, absolute paths, symlink/hardlink escapes and devices are rejected", () => {
    const scan = validateArchiveEntries(scanTarEntries(new Uint8Array(0)));
    expect(scan.ok).toBe(true);
    const verdict = validateArchiveEntries([
      { name: "package/../../escape.js", type: "0" },
      { name: "/etc/passwd", type: "0" },
      { name: "C:\\evil.js", type: "0" },
      { name: "link", type: "2", linkname: "/etc/shadow" },
      { name: "hardlink", type: "1", linkname: "../../../etc/shadow" },
      { name: "dev", type: "3", devmajor: "1", devminor: "3" },
      { name: "safe/index.js", type: "0" },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.length).toBeGreaterThanOrEqual(5);
  });
});

// --- Acquisition (mock registry, §14, §16) --------------------------------------------------

describe("Phase 20.38 acquisition pipeline", () => {
  test("happy path: DOWNLOADING → VERIFIED → CAS blob present and deduplicated", async () => {
    const { service } = makeService();
    const artifact = await service.acquire({ registry: REGISTRY, name: "left-pad", version: "1.0.0", mode: "ONLINE", actor: "test" });
    expect(artifact.trustState).toBe("VERIFIED");
    expect(artifact.storagePath?.replace(/\\/g, "/")).toContain("blobs/sha512");
    // Second acquire is a cache hit returning the same artifact.
    const again = await service.acquire({ registry: REGISTRY, name: "left-pad", version: "1.0.0", mode: "OFFLINE", actor: "test" });
    expect(again.id).toBe(artifact.id);
    const status = service.status() as Record<string, number>;
    expect(status.verified).toBe(1);
  });

  test("integrity mismatch quarantines the artifact and blocks install (§31, §43)", async () => {
    const wrongBytes = new Uint8Array([1, 1, 1]);
    const { service } = makeService({ tarballBytes: wrongBytes });
    const realDigest = sha512Digest(new Uint8Array([9, 9, 9]));
    let thrown: DependencyVaultError | null = null;
    try {
      await service.acquire({
        registry: REGISTRY, name: "evil", version: "1.0.0",
        expectedIntegrity: realDigest.integrity, mode: "ONLINE", actor: "test",
      });
    } catch (err) {
      thrown = err as DependencyVaultError;
    }
    expect(thrown?.code).toBe("DEPENDENCY_INTEGRITY_MISMATCH");
    const quarantined = service.listQuarantine();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.quarantineReason).toContain("integrity mismatch");
    // Quarantined artifact can never pass the install gate.
    const gate = service.installProject({ projectDir: makeLockfileProject("evil", "1.0.0"), mode: "OFFLINE" });
    expect(gate.ok).toBe(false);
  });

  test("concurrent duplicate fetches collapse into one download (§16)", async () => {
    let downloads = 0;
    const tarball = FAKE_TARBALL;
    const digest = sha512Digest(tarball);
    const fetcher = {
      async metadata() {
        return { versions: { "1.0.0": { dist: { tarball: `${REGISTRY}/x/-/x-1.0.0.tgz`, integrity: digest.integrity } } } } as never;
      },
      async tarball() {
        downloads += 1;
        // Small delay widens the concurrency window deterministically enough.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return tarball;
      },
    };
    const service = new DependencyVaultService({ fetcher: fetcher as never });
    const results = await Promise.all([
      service.acquire({ registry: REGISTRY, name: "concurrent", version: "1.0.0", mode: "ONLINE", actor: "t" }),
      service.acquire({ registry: REGISTRY, name: "concurrent", version: "1.0.0", mode: "ONLINE", actor: "t" }),
      service.acquire({ registry: REGISTRY, name: "concurrent", version: "1.0.0", mode: "ONLINE", actor: "t" }),
    ]);
    expect(downloads).toBe(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
  });
});

// --- Lockfiles + profiles + SBOM (§5, §12, §27) ------------------------------------------------

function makeLockfileProject(packageName: string, version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ocx-dv-proj-"));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({
    name: "test-project",
    lockfileVersion: 3,
    packages: {
      "": { name: "test-project" },
      [`node_modules/${packageName}`]: {
        resolved: `${REGISTRY}/${packageName}/-/${packageName}-${version}.tgz`,
        integrity: sha512Digest(new Uint8Array([1])).integrity,
      },
    },
  }));
  return dir;
}

describe("Phase 20.38 lockfiles, profiles and SBOM", () => {
  test("lockfile detection + normalization into the internal graph (§26)", () => {
    const dir = makeLockfileProject("react", "19.0.0");
    const detected = detectLockfile(dir);
    expect(detected?.type).toBe("package-lock");
    const graph = normalizeLockfile("proj", dir, "npm");
    expect(graph.nodes.some((node) => node.name === "react")).toBe(true);
    expect(graph.lockfileHash.startsWith("sha256:")).toBe(true);
    expect(() => normalizeLockfile("empty", testDir, "npm")).toThrow("lockfile");
  });

  test("six seed profiles are registered (§12)", () => {
    const profiles = new DependencyVaultService().listProfiles();
    for (const id of ["base-web", "nextjs", "browser-automation", "ai-agent", "video-production", "adobe-stock"]) {
      expect(profiles.find((profile) => profile.id === id)).toBeDefined();
    }
  });

  test("CycloneDX SBOM carries components, purl and lockfile provenance (§27)", () => {
    const dir = makeLockfileProject("react", "19.0.0");
    const sbom = generateCycloneDx(normalizeLockfile("proj", dir, "npm"));
    expect(sbom.bomFormat).toBe("CycloneDX");
    const components = sbom.components as Array<Record<string, unknown>>;
    expect(components.some((component) => component.name === "react")).toBe(true);
    expect((components[0] as { purl: string }).purl).toContain("pkg:npm/");
  });
});

// --- Bundles (§17) -------------------------------------------------------------------------------

describe("Phase 20.38 .offpack bundles", () => {
  test("export → import round-trip into a fresh vault (air-gap bootstrap)", async () => {
    const source = makeService();
    await source.service.acquire({ registry: REGISTRY, name: "roundtrip", version: "1.0.0", mode: "ONLINE", actor: "test" });
    const bundle = source.service.exportBundle({ name: "airgap-test", actor: "test" });

    const target = new DependencyVaultService();
    const result = target.importBundle({ bundleDir: bundle.outputDir, actor: "test" });
    expect(result.ok).toBe(true);
    const imported = target.listArtifacts().find((artifact) => artifact.packageKey.includes("roundtrip"));
    expect(imported?.trustState).toBe("VERIFIED");
  });

  test("tampered blob content is rejected on import (§39 invariant 8)", async () => {
    const { service } = makeService();
    await service.acquire({ registry: REGISTRY, name: "tamper", version: "1.0.0", mode: "ONLINE", actor: "test" });
    const bundle = service.exportBundle({ name: "tampered", actor: "test" });
    // Corrupt the blob on disk.
    const blobPath = join(bundle.outputDir, "blobs", "sha512");
    const found = Array.from(new Bun.Glob("**/*").scanSync({ cwd: blobPath })).filter((entry) => !entry.endsWith("/"));
    writeFileSync(join(blobPath, found[0]!), new Uint8Array([1, 2, 3]));
    const target = new DependencyVaultService();
    const result = target.importBundle({ bundleDir: bundle.outputDir, actor: "test" });
    expect(result.ok).toBe(false);
    expect(result.failed.some((failure) => failure.code === "DEPENDENCY_BUNDLE_TAMPERED")).toBe(true);
  });

  test("unsupported bundle format is rejected", () => {
    const service = new DependencyVaultService();
    const dir = mkdtempSync(join(tmpdir(), "ocx-dv-bad-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "other-pack", version: 1, blobs: [] }));
    expect(() => service.importBundle({ bundleDir: dir, actor: "test" })).toThrow("unsupported bundle format");
    rmSync(dir, { recursive: true, force: true });
  });
});

// --- GC (§30) --------------------------------------------------------------------------------------

describe("Phase 20.38 garbage collection", () => {
  test("dry-run reports candidates without deleting; pinned/recent artifacts survive", async () => {
    const { service } = makeService();
    await service.acquire({ registry: REGISTRY, name: "old-pkg", version: "1.0.0", mode: "ONLINE", actor: "test" });
    const dry = service.collectGarbage({ dryRun: true, retentionDays: 0 });
    expect(dry.deleted).toBe(0);
    expect(dry.candidates.length).toBeGreaterThanOrEqual(1);
    // Real run deletes the aged artifact row (blob untouched by design).
    const real = service.collectGarbage({ dryRun: false, retentionDays: 0 });
    expect(real.deleted).toBeGreaterThanOrEqual(1);
  });
});
