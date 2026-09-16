// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Automated Unit and Integration Tests

import { describe, expect, test, beforeEach } from "bun:test";
import { validateAndNormalizeUrl } from "../src/agent-os/media-acquisition/url-policy";
import { sanitizeBinaryName } from "../src/agent-os/media-acquisition/process-runner";
import {
  generateSafeMediaFilename,
  assertPathInsideRoot,
  initMediaStorage,
} from "../src/agent-os/media-acquisition/storage";
import { MediaQueueEngine } from "../src/agent-os/media-acquisition/queue-engine";
import { MediaProviderRouter } from "../src/agent-os/media-acquisition/provider-router";
import { ArtifactRegistry } from "../src/agent-os/media-acquisition/artifact-registry";
import { MediaPermissionEngine } from "../src/agent-os/media-acquisition/permission";
import { MediaSecretsVault, redactMediaSecrets } from "../src/agent-os/media-acquisition/vault";
import { LocalBridgeSecurity } from "../src/agent-os/media-acquisition/local-bridge";
import { getMediaAcquisitionService } from "../src/agent-os/media-acquisition/service";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Phase 20.24 URL Policy Guard & SSRF Protection", () => {
  test("accepts valid public URLs and detects platforms correctly", () => {
    const yt = validateAndNormalizeUrl("https://www.youtube.com/watch?v=12345");
    expect(yt.valid).toBe(true);
    expect(yt.platform).toBe("youtube");
    expect(yt.domain).toBe("www.youtube.com");

    const tiktok = validateAndNormalizeUrl("https://www.tiktok.com/@user/video/12345");
    expect(tiktok.platform).toBe("tiktok");

    const x = validateAndNormalizeUrl("https://x.com/user/status/12345");
    expect(x.platform).toBe("x");
  });

  test("rejects private IPs, loopback, and cloud metadata", () => {
    expect(() => validateAndNormalizeUrl("http://127.0.0.1:3000")).toThrow("SSRF");
    expect(() => validateAndNormalizeUrl("http://localhost:8080")).toThrow("SSRF");
    expect(() => validateAndNormalizeUrl("http://10.0.1.25/stream")).toThrow("SSRF");
    expect(() => validateAndNormalizeUrl("http://192.168.1.1/admin")).toThrow("SSRF");
    expect(() => validateAndNormalizeUrl("http://172.20.0.5:8000")).toThrow("SSRF");
    expect(() => validateAndNormalizeUrl("http://169.254.169.254/latest/meta-data/")).toThrow("SSRF");
    expect(() => validateAndNormalizeUrl("http://server.internal/media")).toThrow("SSRF");
  });

  test("rejects dangerous and non-http schemes", () => {
    expect(() => validateAndNormalizeUrl("file:///C:/Windows/System32/calc.exe")).toThrow("forbidden");
    expect(() => validateAndNormalizeUrl("ftp://files.example.com/movie.mp4")).toThrow("forbidden");
    expect(() => validateAndNormalizeUrl("javascript:alert(1)")).toThrow();
  });
});

describe("Phase 20.24 Safe Process Runner & Storage", () => {
  test("strictly allows only approved executables", () => {
    expect(sanitizeBinaryName("omniget")).toBe("omniget");
    expect(sanitizeBinaryName("yt-dlp.exe")).toBe("yt-dlp.exe");
    expect(sanitizeBinaryName("ffmpeg")).toBe("ffmpeg");
    expect(sanitizeBinaryName("ffprobe.exe")).toBe("ffprobe.exe");
    expect(() => sanitizeBinaryName("curl")).toThrow("not in the media acquisition process allowlist");
    expect(() => sanitizeBinaryName("sh")).toThrow("not in the media acquisition process allowlist");
    expect(() => sanitizeBinaryName("powershell.exe")).toThrow("not in the media acquisition process allowlist");
  });

  test("generates deterministic and sanitized filenames", () => {
    const filename = generateSafeMediaFilename({
      platform: "youtube",
      jobId: "job123",
      title: "How to Build an AI Assistant? (2026 Tutorial!)",
      ext: ".mp4",
    });

    expect(filename).toContain("youtube_job123_how-to-build-an-ai-assistant-2026-tutorial.mp4");
    expect(filename).not.toContain("?");
    expect(filename).not.toContain("!");
    expect(filename).not.toContain(" ");
  });

  test("enforces storage boundary and blocks path traversal", () => {
    const layout = initMediaStorage();
    const safePath = join(layout.incomingDir, "video.mp4");
    expect(() => assertPathInsideRoot(safePath, layout.rootDir)).not.toThrow();

    const badPath = join(layout.rootDir, "..", "..", "system32", "trojan.exe");
    expect(() => assertPathInsideRoot(badPath, layout.rootDir)).toThrow("traverses outside storage root");
  });
});

describe("Phase 20.24 Queue Engine & State Machine", () => {
  let queue: MediaQueueEngine;

  beforeEach(() => {
    queue = new MediaQueueEngine({ maxGlobalJobs: 2, maxPerDomain: 1, maxRetries: 3 });
  });

  test("enqueues jobs with default state and priority", () => {
    const job = queue.createJob({
      sourceUrl: "https://youtube.com/watch?v=sample1",
      preset: "best",
      requestedBy: "agent-1",
    });

    expect(job.status).toBe("queued");
    expect(job.priority).toBe("P2");
    expect(job.usageClass).toBe("research_reference");
    expect(job.exportToStockAllowed).toBe(false);

    const fetched = queue.getJob(job.id);
    expect(fetched?.id).toBe(job.id);
  });

  test("enforces per-domain and global concurrency limits", () => {
    expect(queue.canRunNext("youtube.com")).toBe(true);
    queue.acquireDomainSlot("youtube.com");
    // Domain limit of 1 reached for youtube.com
    expect(queue.canRunNext("youtube.com")).toBe(false);
    // Another domain is still eligible
    expect(queue.canRunNext("vimeo.com")).toBe(true);
    queue.releaseDomainSlot("youtube.com");
    expect(queue.canRunNext("youtube.com")).toBe(true);
  });

  test("supports job cancellation and retry transitions", () => {
    const job = queue.createJob({ sourceUrl: "https://vimeo.com/12345" });
    const cancelled = queue.cancelJob(job.id);
    expect(cancelled.status).toBe("cancelled");

    const retried = queue.retryJob(job.id);
    expect(retried.status).toBe("queued");
    expect(retried.retryCount).toBe(1);
  });
});

describe("Phase 20.24 Artifact Registry & Adobe Stock Boundary", () => {
  const registry = new ArtifactRegistry();
  const testFile = join(process.cwd(), "runtime", "media", "test_artifact.mp4");

  test("registers media artifacts with SHA-256 and strictly isolates research references", async () => {
    initMediaStorage();
    writeFileSync(testFile, Buffer.from("DUMMY_MP4_CONTENT_12345"));

    try {
      const art = await registry.registerArtifact({
        jobId: "job_test_1",
        type: "video",
        sourceUrl: "https://example.com/video.mp4",
        sourcePlatform: "example",
        title: "Test Video",
        localPath: testFile,
        usageClass: "research_reference",
      });

      expect(art.sha256).toBeDefined();
      expect(art.sha256.length).toBe(64);
      expect(art.mimeType).toBe("video/mp4");
      expect(art.usageClass).toBe("research_reference");
      // Critical check: research reference media CANNOT be exported to Adobe Stock!
      expect(art.exportToStock).toBe(false);

      const provenance = registry.getProvenance(art.artifactId);
      expect(provenance?.notes).toContain("Strictly not for Stock Export");
    } finally {
      if (existsSync(testFile)) unlinkSync(testFile);
    }
  });
});

describe("Phase 20.24 Permission Engine & Secrets Redaction", () => {
  const permissions = new MediaPermissionEngine();
  const vault = new MediaSecretsVault();

  test("evaluates actions according to risk tiers", () => {
    expect(permissions.evaluateAction("inspect").tier).toBe(0);
    expect(permissions.evaluateAction("inspect").allowed).toBe(true);

    expect(permissions.evaluateAction("transcribe").tier).toBe(1);
    expect(permissions.evaluateAction("download").tier).toBe(2);

    // Tier 4 forbidden actions
    expect(permissions.evaluateAction("arbitrary_shell").tier).toBe(4);
    expect(permissions.evaluateAction("arbitrary_shell").allowed).toBe(false);
    expect(permissions.evaluateAction("export_cookies").allowed).toBe(false);
  });

  test("redacts sensitive tokens, auth headers, and secrets in text", () => {
    const raw = "Error fetching https://user:secretpass123@api.test with Bearer " + "eyJhbGciOiJIUzI1Ni" + ".secret and cookie=session123";
    const redacted = redactMediaSecrets(raw);
    expect(redacted).not.toContain("secretpass123");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1Ni");
    expect(redacted).toContain("[REDACTED]");
  });

  test("stores and resolves vault secret references", () => {
    const ref = vault.registerSecret("browser_cookie", "YouTube Session", "cookie_value_xyz", "youtube.com");
    expect(ref.refId).toContain("vault://browser_cookie/");
    expect(vault.resolveSecret(ref.refId)).toBe("cookie_value_xyz");
  });
});

describe("Phase 20.24 Local Bridge Security", () => {
  const bridge = new LocalBridgeSecurity();

  test("successfully pairs with extension and validates nonces", () => {
    const pairResp = bridge.pair({
      extensionId: "ext_test_id",
      extensionVersion: "1.0.0",
      clientNonce: "nonce_abc_1",
      timestamp: Date.now(),
    });

    expect(pairResp.sessionToken).toContain("pao_sess_");
    expect(pairResp.installationToken).toContain("pao_inst_");

    // Replay with identical nonce must fail
    expect(() =>
      bridge.pair({
        extensionId: "ext_test_id",
        extensionVersion: "1.0.0",
        clientNonce: "nonce_abc_1",
        timestamp: Date.now(),
      }),
    ).toThrow("Nonce replay");
  });
});
