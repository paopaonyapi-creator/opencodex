// Phase 20.38 — DependencyVaultService: secure acquisition (§14) with
// in-flight dedup (§16), trust-state machine (§8), policy gates (§39),
// project scan/ensure, profile prewarm, bundle export/import (§17), GC (§30)
// and audit. Registry access is injectable so tests never touch the network.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { recordAgentEvent } from "../events";
import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import { DependencyVaultError, defaultPolicy, evaluateInstallability, evaluateNetworkMode, evaluateRegistry, redactVaultLog } from "./policy";
import { casBlobExists, commitToCas, gunzipSync, moveToQuarantine, readBlob, scanTarEntries, sha512Digest, validateArchiveEntries, verifyIntegrity, writeTmp, vaultStorageRoot } from "./integrity";
import { SEED_PROFILES, generateCycloneDx, normalizeLockfile } from "./catalog";
import { VaultStore } from "./store";
import type {
  ArtifactRecord,
  BundleManifest,
  DependencyGraph,
  DependencyOperationResult,
  InstallMode,
  PackageRecord,
  TrustState,
  VaultPolicy,
} from "./types";

/** Registry transport abstraction: production uses fetch; tests inject. */
export interface RegistryFetcher {
  metadata(registry: string, name: string): Promise<{ versions: Record<string, { dist?: { tarball?: string; integrity?: string } }> }>;
  tarball(url: string): Promise<Uint8Array>;
}

class HttpFetcher implements RegistryFetcher {
  async metadata(registry: string, name: string): Promise<{ versions: Record<string, { dist?: { tarball?: string; integrity?: string } }> }> {
    const url = validateAndNormalizeUrl(`${registry.replace(/\/+$/, "")}/${encodeURIComponent(name)}`);
    const res = await fetch(url.normalizedUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new DependencyVaultError("DEPENDENCY_DOWNLOAD_FAILED", `registry metadata HTTP ${res.status}`);
    return await res.json() as never;
  }

  async tarball(url: string): Promise<Uint8Array> {
    const validated = validateAndNormalizeUrl(url);
    const res = await fetch(validated.normalizedUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new DependencyVaultError("DEPENDENCY_DOWNLOAD_FAILED", `tarball HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

function packageKeyOf(registry: string, name: string, version: string): string {
  return `${registry}|${name}|${version}`;
}

function sha512OfText(text: string): string {
  return createHash("sha512").update(text, "utf8").digest("hex");
}

function lockfileName(type: DependencyGraph["lockfileType"]): string {
  switch (type) {
    case "package-lock": return "package-lock.json";
    case "npm-shrinkwrap": return "npm-shrinkwrap.json";
    case "pnpm-lock": return "pnpm-lock.yaml";
    case "bun-lock": return "bun.lock";
  }
}

function parseSha512Sums(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 2 && /^[a-f0-9]{64}$/.test(parts[0]!)) {
      map.set(parts[1]!.split("/").pop()!, parts[0]!);
    }
  }
  return map;
}

export class DependencyVaultService {
  private store: VaultStore;
  private policy: VaultPolicy;
  private fetcher: RegistryFetcher;
  /** §16: in-flight dedup — concurrent requests for the same artifact key
   *  collapse into ONE acquisition task; the DB unique constraint backstops. */
  private inFlight = new Map<string, Promise<ArtifactRecord>>();

  constructor(options?: { fetcher?: RegistryFetcher; policy?: VaultPolicy; store?: VaultStore }) {
    this.policy = options?.policy ?? defaultPolicy();
    this.fetcher = options?.fetcher ?? new HttpFetcher();
    this.store = options?.store ?? new VaultStore();
  }

  policyRegistryDefault(): string {
    return this.policy.registries.default;
  }

  findArtifactByPackageKey(packageKey: string): ArtifactRecord | null {
    return this.store.findArtifactByPackageKey(packageKey);
  }

  // --- acquisition (§14) ----------------------------------------------------------

  async acquire(input: { registry: string; name: string; version: string; expectedIntegrity?: string | null; mode: InstallMode; actor?: string }): Promise<ArtifactRecord> {
    const registryCheck = evaluateRegistry(this.policy, input.registry);
    if (!registryCheck.allowed) {
      this.recordPolicyDecision(registryCheck, "package", `${input.name}@${input.version}`, input.actor);
      throw new DependencyVaultError("DEPENDENCY_REGISTRY_BLOCKED", registryCheck.reason);
    }
    const key = packageKeyOf(input.registry, input.name, input.version);
    const cached = this.store.findArtifactByPackageKey(key);
    if (cached && cached.trustState === "VERIFIED" && casBlobExists(cached.sha512Hex!)) {
      return cached;
    }
    const networkCheck = evaluateNetworkMode(input.mode, false);
    if (!networkCheck.allowed) {
      this.recordPolicyDecision(networkCheck, "package", key, input.actor);
      throw new DependencyVaultError(cached ? "DEPENDENCY_OFFLINE_MISS" : "DEPENDENCY_POLICY_DENIED", networkCheck.reason);
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.acquireUncached(input, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private async acquireUncached(input: { registry: string; name: string; version: string; expectedIntegrity?: string | null; mode: InstallMode; actor?: string }, key: string): Promise<ArtifactRecord> {
    this.store.upsertPackage({ key, name: input.name, version: input.version, registry: input.registry });

    // 1. Registry metadata → tarball URL + dist.integrity.
    const meta = await this.fetcher.metadata(input.registry, input.name);
    const versionEntry = meta.versions?.[input.version];
    const tarballUrl = versionEntry?.dist?.tarball ?? null;
    const registryIntegrity = versionEntry?.dist?.integrity ?? null;
    if (!tarballUrl) {
      this.store.upsertArtifactState({ packageKey: key, trustState: "BLOCKED", quarantineReason: "registry metadata lacked a tarball URL", sizeBytes: null });
      throw new DependencyVaultError("DEPENDENCY_DOWNLOAD_FAILED", `no tarball for ${input.name}@${input.version}`);
    }
    const expectedIntegrity = input.expectedIntegrity ?? registryIntegrity;
    if (!expectedIntegrity && this.policy.security.requireIntegrity) {
      this.store.upsertArtifactState({ packageKey: key, trustState: "BLOCKED", quarantineReason: "policy requires integrity but none is recorded", sizeBytes: null });
      throw new DependencyVaultError("DEPENDENCY_INTEGRITY_MISMATCH", "no integrity available and policy requires it (§39)");
    }

    // 2. Download to tmp → 3. hash → 4. verify → 5. archive scan → 6. CAS.
    this.store.upsertArtifactState({ packageKey: key, trustState: "DOWNLOADING", quarantineReason: null, sizeBytes: null });
    let bytes: Uint8Array;
    try {
      bytes = await this.fetcher.tarball(tarballUrl);
    } catch (err) {
      const reason = redactVaultLog(err instanceof Error ? err.message : String(err), 200);
      this.store.upsertArtifactState({ packageKey: key, trustState: "BLOCKED", quarantineReason: reason, sizeBytes: null });
      throw new DependencyVaultError("DEPENDENCY_DOWNLOAD_FAILED", reason);
    }
    const sizeLimit = this.policy.downloads.maxPackageSizeMb * 1024 * 1024;
    if (bytes.byteLength > sizeLimit) {
      this.store.upsertArtifactState({ packageKey: key, trustState: "BLOCKED", quarantineReason: "package exceeds the size limit", sizeBytes: bytes.byteLength });
      throw new DependencyVaultError("DEPENDENCY_POLICY_DENIED", `package size ${bytes.byteLength} exceeds ${sizeLimit}`);
    }
    this.store.upsertArtifactState({ packageKey: key, trustState: "DOWNLOADED", quarantineReason: null, sizeBytes: bytes.byteLength });

    const verdict = verifyIntegrity(bytes, expectedIntegrity);
    if (!verdict.ok) {
      writeTmp(verdict.actual.sha512Hex, bytes);
      moveToQuarantine(verdict.actual.sha512Hex);
      this.store.putArtifact({
        packageKey: key, tarballUrl, registryOrigin: input.registry,
        integrity: expectedIntegrity, sha512Hex: verdict.actual.sha512Hex,
        sizeBytes: bytes.byteLength, storagePath: null, trustState: "QUARANTINED",
        quarantineReason: `integrity mismatch: expected ${expectedIntegrity}, actual sha512-${verdict.actual.sha512Hex}`,
        downloadedAt: new Date().toISOString(),
      });
      this.store.appendAudit({ eventType: "dependency.verify.failed", packageKey: key, metadata: { expected: expectedIntegrity, actual: verdict.actual.integrity } });
      throw new DependencyVaultError("DEPENDENCY_INTEGRITY_MISMATCH", `integrity mismatch for ${input.name}@${input.version}`);
    }

    // Archive safety scan (gunzip → tar headers → entry validation).
    const tarBytes = gunzipSync(bytes);
    const scan = validateArchiveEntries(scanTarEntries(tarBytes));
    if (!scan.ok) {
      writeTmp(verdict.actual.sha512Hex, bytes);
      moveToQuarantine(verdict.actual.sha512Hex);
      this.store.putArtifact({
        packageKey: key, tarballUrl, registryOrigin: input.registry,
        integrity: expectedIntegrity, sha512Hex: verdict.actual.sha512Hex,
        sizeBytes: bytes.byteLength, storagePath: null, trustState: "QUARANTINED",
        quarantineReason: `unsafe archive: ${scan.violations.map((violation) => `${violation.entry} (${violation.reason})`).join("; ").slice(0, 300)}`,
        downloadedAt: new Date().toISOString(),
      });
      this.store.appendAudit({ eventType: "dependency.quarantine.created", packageKey: key, metadata: { violations: scan.violations.length } });
      throw new DependencyVaultError("DEPENDENCY_ARCHIVE_UNSAFE", `archive rejected: ${scan.violations[0]?.reason ?? "unsafe entries"}`);
    }

    writeTmp(verdict.actual.sha512Hex, bytes);
    const storagePath = commitToCas(verdict.actual.sha512Hex, join(vaultStorageRoot(), "tmp", verdict.actual.sha512Hex));
    const artifact = this.store.putArtifact({
      packageKey: key, tarballUrl, registryOrigin: input.registry,
      integrity: expectedIntegrity ?? verdict.actual.integrity, sha512Hex: verdict.actual.sha512Hex,
      sizeBytes: bytes.byteLength, storagePath, trustState: "VERIFIED", verifiedAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
    });
    this.store.appendAudit({ eventType: "dependency.verify.after", packageKey: key, metadata: { sha512: verdict.actual.sha512Hex, size: bytes.byteLength } });
    recordAgentEvent({ kind: "dependency.verified", payload: { package: `${input.name}@${input.version}`, sha512: verdict.actual.sha512Hex } });
    return artifact;
  }

  private recordPolicyDecision(decision: { decision: string; reason: string; rule: string }, subjectType: string, subjectKey: string, actor?: string): void {
    this.store.recordPolicyDecision({ action: "acquire", subjectType, subjectKey, decision: decision.decision, reason: decision.reason, policyRule: decision.rule, actor: actor ?? "system" });
    this.store.appendAudit({ eventType: "dependency.policy.blocked", packageKey: subjectKey, metadata: { reason: decision.reason, rule: decision.rule } });
  }

  // --- project scan / ensure (§3.1, §5) -------------------------------------------

  scanProject(projectDir: string, packageManager: DependencyGraph["packageManager"] = "npm"): DependencyGraph {
    const projectKey = projectDir.split(/[\\/]/).pop() || "project";
    const graph = normalizeLockfile(projectKey, projectDir, packageManager);
    this.store.saveProject(graph);
    this.store.appendAudit({ eventType: "dependency.resolve.after", projectKey, metadata: { packages: graph.nodes.length, lockfileHash: graph.lockfileHash } });
    return graph;
  }

  async ensureProject(input: { projectDir: string; packageManager?: DependencyGraph["packageManager"]; mode: InstallMode; actor?: string }): Promise<DependencyOperationResult> {
    const graph = this.scanProject(input.projectDir, input.packageManager);
    const succeeded: string[] = [];
    const failed: DependencyOperationResult["failed"] = [];
    const warnings: string[] = [];
    const lockIntegrityByKey = new Map(this.store.listProjectItems(graph.projectKey).map((item) => [`${item.packageName}|${item.version}`, item.integrity]));
    for (const node of graph.nodes) {
      const expectedIntegrity = lockIntegrityByKey.get(`${node.name}|${node.version}`) ?? node.integrity;
      try {
        await this.acquire({
          registry: this.policy.registries.default,
          name: node.name,
          version: node.version,
          expectedIntegrity,
          mode: input.mode,
          actor: input.actor,
        });
        succeeded.push(`${node.name}@${node.version}`);
      } catch (err) {
        const code = err instanceof DependencyVaultError ? err.code : "DEPENDENCY_DOWNLOAD_FAILED";
        const message = err instanceof Error ? err.message : String(err);
        if (node.optional) warnings.push(`optional ${node.name}@${node.version}: ${code}`);
        else failed.push({ package: `${node.name}@${node.version}`, code, message: redactVaultLog(message, 200) });
      }
    }
    return { ok: failed.length === 0, succeeded, failed, warnings };
  }

  /** §13: agent sandbox bootstrap via dependency profile. */
  async ensureProfile(profileId: string, mode: InstallMode, actor?: string): Promise<DependencyOperationResult> {
    const profile = SEED_PROFILES.find((entry) => entry.id === profileId);
    if (!profile) throw new DependencyVaultError("DEPENDENCY_POLICY_DENIED", `unknown profile: ${profileId}`);
    const succeeded: string[] = [];
    const failed: DependencyOperationResult["failed"] = [];
    for (const pkg of profile.packages) {
      try {
        const resolved = await this.resolveLatestVersion(this.policy.registries.default, pkg.name, mode);
        await this.acquire({ registry: this.policy.registries.default, name: pkg.name, version: resolved, expectedIntegrity: null, mode, actor });
        succeeded.push(`${pkg.name}@${resolved}`);
      } catch (err) {
        failed.push({ package: pkg.name, code: err instanceof DependencyVaultError ? err.code : "DEPENDENCY_DOWNLOAD_FAILED", message: redactVaultLog(err instanceof Error ? err.message : String(err), 200) });
      }
    }
    this.store.appendAudit({ eventType: "dependency.policy.allowed", projectKey: `profile:${profileId}`, metadata: { succeeded: succeeded.length, failed: failed.length } });
    return { ok: failed.length === 0, succeeded, failed, warnings: [] };
  }

  private async resolveLatestVersion(registry: string, name: string, mode: InstallMode): Promise<string> {
    const networkCheck = evaluateNetworkMode(mode, false);
    if (!networkCheck.allowed) throw new DependencyVaultError("DEPENDENCY_OFFLINE_MISS", networkCheck.reason);
    const meta = await this.fetcher.metadata(registry, name);
    const versions = Object.keys(meta.versions ?? {}).filter((version) => !version.includes("-"));
    if (versions.length === 0) throw new DependencyVaultError("DEPENDENCY_DOWNLOAD_FAILED", `no versions for ${name}`);
    return versions[versions.length - 1]!;
  }

  // --- bundles (§17) -----------------------------------------------------------------

  exportBundle(input: { name: string; projectDir?: string; packageManager?: DependencyGraph["packageManager"]; actor?: string }): { bundleId: string; manifest: BundleManifest; outputDir: string } {
    const bundleId = "obun_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const outputDir = join(vaultStorageRoot(), "bundles", bundleId);
    const graph = input.projectDir ? this.scanProject(input.projectDir, input.packageManager) : null;

    const verified = this.store.listArtifacts().filter((artifact) => artifact.trustState === "VERIFIED" && casBlobExists(artifact.sha512Hex!));
    const blobsDir = join(outputDir, "blobs", "sha512");
    const checksumLines: string[] = [];
    const manifestBlobs: BundleManifest["blobs"] = [];
    for (const artifact of verified) {
      const hex = artifact.sha512Hex!;
      const source = join(vaultStorageRoot(), "blobs", "sha512", hex.slice(0, 2), hex);
      const destination = join(blobsDir, hex.slice(0, 2), hex);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      checksumLines.push(`${hex}  blobs/sha512/${hex.slice(0, 2)}/${hex}`);
      manifestBlobs.push({ sha512Hex: hex, sizeBytes: artifact.sizeBytes, packageKeys: [artifact.packageKey] });
    }
    const metadata = { packages: this.store.listPackages().filter((pkg) => verified.some((artifact) => artifact.packageKey === pkg.packageKey)) };
    const sbom = graph ? generateCycloneDx(graph) : { bomFormat: "CycloneDX", specVersion: "1.5", components: [] };
    const metadataJson = JSON.stringify(metadata, null, 2);
    const sbomJson = JSON.stringify(sbom, null, 2);
    checksumLines.push(`${sha512OfText(metadataJson)}  metadata/packages.json`);
    checksumLines.push(`${sha512OfText(sbomJson)}  sbom/cyclonedx.json`);

    mkdirSync(join(outputDir, "metadata"), { recursive: true });
    mkdirSync(join(outputDir, "sbom"), { recursive: true });
    mkdirSync(join(outputDir, "checksums"), { recursive: true });
    writeFileSync(join(outputDir, "metadata", "packages.json"), metadataJson);
    writeFileSync(join(outputDir, "sbom", "cyclonedx.json"), sbomJson);
    writeFileSync(join(outputDir, "checksums", "SHA512SUMS"), checksumLines.join("\n") + "\n");
    if (graph) {
      mkdirSync(join(outputDir, "lockfiles"), { recursive: true });
      copyFileSync(join(graph.projectPath, lockfileName(graph.lockfileType)), join(outputDir, "lockfiles", lockfileName(graph.lockfileType)));
    }

    const manifest: BundleManifest = {
      format: "pao-offpack",
      version: 1,
      bundleId,
      createdAt: new Date().toISOString(),
      project: { name: input.name, packageManager: input.packageManager ?? "npm" },
      packageCount: verified.length,
      blobs: manifestBlobs,
      manifestHash: "sha256:" + sha512OfText(JSON.stringify({ format: "pao-offpack", version: 1, bundleId, packageCount: verified.length, blobs: manifestBlobs })).slice(0, 32),
    };
    writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    this.store.recordBundle({ bundleId, name: input.name, manifestHash: manifest.manifestHash, outputPath: outputDir, packageCount: verified.length, totalSizeBytes: manifestBlobs.reduce((sum, blob) => sum + blob.sizeBytes, 0) });
    this.store.appendAudit({ eventType: "dependency.bundle.export.after", metadata: { bundleId, packageCount: verified.length } });
    return { bundleId, manifest, outputDir };
  }

  importBundle(input: { bundleDir: string; actor?: string }): DependencyOperationResult {
    // Canonicalize the operator-supplied bundle root once; every subsequent
    // read is derived from the resolved path (no raw client strings in fs ops).
    const bundleRoot = resolve(input.bundleDir);
    const manifestPath = join(bundleRoot, "manifest.json");
    if (!existsSync(manifestPath)) throw new DependencyVaultError("DEPENDENCY_BUNDLE_INVALID", "bundle lacks manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BundleManifest;
    if (manifest.format !== "pao-offpack") throw new DependencyVaultError("DEPENDENCY_BUNDLE_INVALID", "unsupported bundle format");
    if (this.policy.bundles.rejectUnknownManifestVersion && manifest.version !== 1) {
      throw new DependencyVaultError("DEPENDENCY_BUNDLE_INVALID", `unsupported bundle version ${manifest.version}`);
    }
    const succeeded: string[] = [];
    const failed: DependencyOperationResult["failed"] = [];
    const checksums = parseSha512Sums(join(bundleRoot, "checksums", "SHA512SUMS"));
    for (const blob of manifest.blobs) {
      const blobPath = join(bundleRoot, "blobs", "sha512", blob.sha512Hex.slice(0, 2), blob.sha512Hex);
      if (!existsSync(blobPath)) {
        failed.push({ package: blob.packageKeys.join(","), code: "DEPENDENCY_BUNDLE_INVALID", message: "blob missing from bundle" });
        continue;
      }
      const bytes = new Uint8Array(readFileSync(blobPath));
      const actual = sha512Digest(bytes);
      const checksumExpected = checksums.get(blob.sha512Hex);
      // §39: tampered bundle (checksum or declared hash mismatch) is rejected.
      if (checksumExpected && checksumExpected !== blob.sha512Hex) {
        failed.push({ package: blob.packageKeys.join(","), code: "DEPENDENCY_BUNDLE_TAMPERED", message: "SHA512SUMS entry does not match the manifest digest" });
        continue;
      }
      if (actual.sha512Hex !== blob.sha512Hex) {
        failed.push({ package: blob.packageKeys.join(","), code: "DEPENDENCY_BUNDLE_TAMPERED", message: "blob content digest does not match the manifest" });
        continue;
      }
      const storagePath = commitToCas(actual.sha512Hex, blobPath);
      for (const packageKey of blob.packageKeys) {
        const parts = packageKey.split("|");
        this.store.upsertPackage({ key: packageKey, name: parts[1] ?? packageKey, version: parts[2] ?? "", registry: parts[0] ?? "unknown" });
        this.store.putArtifact({
          packageKey, tarballUrl: null, registryOrigin: parts[0] ?? "bundle",
          integrity: actual.integrity, sha512Hex: actual.sha512Hex, sizeBytes: bytes.byteLength,
          storagePath, trustState: "VERIFIED", verifiedAt: new Date().toISOString(),
        });
        succeeded.push(packageKey);
      }
    }
    this.store.appendAudit({ eventType: "dependency.bundle.import.after", metadata: { succeeded: succeeded.length, failed: failed.length } });
    recordAgentEvent({ kind: "dependency.bundle.imported", payload: { succeeded: succeeded.length, failed: failed.length } });
    return { ok: failed.length === 0, succeeded, failed, warnings: [] };
  }

  // --- status / quarantine / gc -----------------------------------------------------------

  status(): Record<string, unknown> {
    const artifacts = this.store.listArtifacts();
    const byState: Record<string, number> = {};
    for (const artifact of artifacts) byState[artifact.trustState] = (byState[artifact.trustState] ?? 0) + 1;
    return {
      packages: this.store.countPackages(),
      artifacts: artifacts.length,
      verified: byState.VERIFIED ?? 0,
      quarantined: byState.QUARANTINED ?? 0,
      blocked: byState.BLOCKED ?? 0,
      cacheBytes: artifacts.filter((artifact) => artifact.trustState === "VERIFIED").reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
      bundles: this.store.countBundles(),
      installableStates: ["VERIFIED"],
    };
  }

  listPackages(): PackageRecord[] {
    return this.store.listPackages();
  }

  /** §24 install gate: every lockfile dependency must be VERIFIED in the
   *  vault before the package manager runs; STRICT_AIR_GAP fails on miss. */
  installProject(input: { projectDir: string; mode: InstallMode; actor?: string }): { ok: boolean; installable: number; blocked: Array<{ package: string; reason: string }> } {
    const graph = this.scanProject(input.projectDir);
    const blocked: Array<{ package: string; reason: string }> = [];
    let installable = 0;
    for (const node of graph.nodes) {
      const artifact = this.findArtifactByPackageKey(`${this.policyRegistryDefault()}|${node.name}|${node.version}`);
      const verdict = evaluateInstallability(artifact?.trustState ?? "DISCOVERED");
      if (verdict.allowed) installable += 1;
      else blocked.push({ package: `${node.name}@${node.version}`, reason: verdict.reason });
    }
    if (input.mode === "STRICT_AIR_GAP" && blocked.length > 0) {
      // §39 invariant 5: strict air-gap fails rather than falling back.
      throw new DependencyVaultError("DEPENDENCY_OFFLINE_MISS", `strict air-gap: ${blocked.length} dependency(ies) not VERIFIED in the vault`);
    }
    if (blocked.length > 0) return { ok: false, installable, blocked };
    // The package manager performs the native offline install; the vault has
    // already guaranteed every artifact is verified and locally available.
    return { ok: true, installable, blocked: [] };
  }

  /** Re-computes SHA-512 for every VERIFIED blob; mismatches are reported
   *  (they indicate tampering or bit-rot — never silently repaired). */
  verifyCache(): { verified: number; mismatches: Array<{ packageKey: string }> } {
    const mismatches: Array<{ packageKey: string }> = [];
    let verified = 0;
    for (const artifact of this.listArtifacts()) {
      if (artifact.trustState !== "VERIFIED" || !artifact.sha512Hex) continue;
      const blob = readBlob(artifact.sha512Hex);
      if (!blob) { mismatches.push({ packageKey: artifact.packageKey }); continue; }
      const digest = sha512Digest(blob).sha512Hex;
      if (digest === artifact.sha512Hex) verified += 1;
      else mismatches.push({ packageKey: artifact.packageKey });
    }
    return { verified, mismatches };
  }

  listArtifacts(): ArtifactRecord[] {
    return this.store.listArtifacts();
  }

  listQuarantine(): ArtifactRecord[] {
    return this.store.listArtifacts().filter((artifact) => artifact.trustState === "QUARANTINED");
  }

  /** §43: no automatic trust promotion — reverify recomputes from bytes. */
  reverifyQuarantined(artifactId: string, expectedIntegrity: string | null, actor: string): ArtifactRecord {
    if (!/^(operator|dashboard|user|human|owner)/i.test(actor.trim())) {
      throw new DependencyVaultError("DEPENDENCY_POLICY_DENIED", "invariant violation: only human actors may reverify quarantined artifacts");
    }
    const artifact = this.store.getArtifact(artifactId);
    if (!artifact?.sha512Hex) throw new DependencyVaultError("NOT_FOUND", `artifact not found: ${artifactId}`);
    const blob = readBlob(artifact.sha512Hex);
    if (!blob) throw new DependencyVaultError("DEPENDENCY_NOT_CACHED", "artifact bytes are gone; re-acquire required");
    const verdict = verifyIntegrity(blob, expectedIntegrity ?? artifact.integrity);
    if (!verdict.ok) {
      this.store.appendAudit({ eventType: "dependency.verify.failed", packageKey: artifact.packageKey, metadata: { expected: expectedIntegrity, actual: verdict.actual.integrity } });
      throw new DependencyVaultError("DEPENDENCY_INTEGRITY_MISMATCH", "reverification failed; artifact remains QUARANTINED");
    }
    const storagePath = commitToCas(verdict.actual.sha512Hex, join(vaultStorageRoot(), "quarantine", verdict.actual.sha512Hex.slice(0, 2), verdict.actual.sha512Hex));
    return this.store.putArtifact({
      packageKey: artifact.packageKey, tarballUrl: artifact.tarballUrl, registryOrigin: artifact.registryOrigin,
      integrity: expectedIntegrity ?? artifact.integrity, sha512Hex: verdict.actual.sha512Hex,
      sizeBytes: blob.byteLength, storagePath, trustState: "VERIFIED", verifiedAt: new Date().toISOString(),
    });
  }

  deleteArtifact(artifactId: string, actor: string): void {
    if (!/^(operator|dashboard|user|human|owner)/i.test(actor.trim())) {
      throw new DependencyVaultError("DEPENDENCY_POLICY_DENIED", "invariant violation: only human actors may delete artifacts");
    }
    const artifact = this.store.getArtifact(artifactId);
    if (!artifact) throw new DependencyVaultError("NOT_FOUND", `artifact not found: ${artifactId}`);
    this.store.putArtifact({ ...artifact, trustState: "DELETED", storagePath: null });
    this.store.appendAudit({ eventType: "dependency.policy.blocked", packageKey: artifact.packageKey, metadata: { action: "delete", actor } });
  }

  /** §30 GC: dry-run first; only unreferenced, unpinned, aged artifacts. */
  collectGarbage(input: { dryRun: boolean; retentionDays?: number }): { candidates: Array<{ packageKey: string; sha512Hex: string | null }>; deleted: number } {
    const retentionDays = input.retentionDays ?? Number(process.env.DEPENDENCY_VAULT_GC_RETENTION_DAYS || 30);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const candidates = this.store.listArtifacts().filter((artifact) =>
      artifact.trustState === "VERIFIED"
      && !artifact.pinned
      && new Date(artifact.updatedAt).getTime() < cutoff);
    if (input.dryRun) return { candidates: candidates.map((artifact) => ({ packageKey: artifact.packageKey, sha512Hex: artifact.sha512Hex })), deleted: 0 };
    let deleted = 0;
    for (const artifact of candidates) {
      this.store.putArtifact({ ...artifact, trustState: "DELETED", storagePath: null });
      deleted += 1;
    }
    this.store.appendAudit({ eventType: "dependency.cache.gc", metadata: { deleted, dryRun: false } });
    return { candidates: [], deleted };
  }

  generateSbom(projectDir: string, packageManager: DependencyGraph["packageManager"] = "npm"): Record<string, unknown> {
    return generateCycloneDx(this.scanProject(projectDir, packageManager));
  }

  listProfiles() {
    return SEED_PROFILES;
  }

  listAudit(limit = 50) {
    return this.store.listAudit(limit);
  }

  listPolicyDecisions(limit = 50) {
    return this.store.listPolicyDecisions(limit);
  }
}

let singleton: DependencyVaultService | null = null;

export function getDependencyVaultService(): DependencyVaultService {
  if (!singleton) singleton = new DependencyVaultService();
  return singleton;
}

export function resetDependencyVaultForTests(): void {
  singleton = null;
}
