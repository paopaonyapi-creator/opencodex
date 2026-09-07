// Phase 20 — RunPod Client & Mock tests.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RunPodClient, RunPodApiError, redactSecret } from "../src/agent-os/generation/cloud/runpod/client";
import { MockRunPodServer } from "../src/agent-os/generation/cloud/runpod/mock";

describe("phase 20 — RunPod REST client & mock", () => {
  let mockServer: MockRunPodServer;
  let mockBaseUrl: string;

  beforeAll(async () => {
    mockServer = new MockRunPodServer({ validApiKey: "test_key_xyz_123" });
    mockBaseUrl = await mockServer.start();
  });

  afterAll(() => {
    mockServer.stop();
  });

  it("redacts secrets from logs and errors", () => {
    const raw = "Error with Bearer rpa_secret_token_12345 and apiKey=secret_key_9999";
    const redacted = redactSecret(raw);
    expect(redacted).not.toContain("rpa_secret_token_12345");
    expect(redacted).not.toContain("secret_key_9999");
    expect(redacted).toContain("[REDACTED]");
  });

  it("SSRF protection blocks non-allowed hosts by default", () => {
    expect(() => {
      new RunPodClient({
        apiKey: "any_key",
        baseUrl: "https://evil-attacker.example.com/v1",
      });
    }).toThrow(/SSRF protection/);
  });

  it("allows loopback / mock server URLs", () => {
    const client = new RunPodClient({
      apiKey: "test_key_xyz_123",
      baseUrl: mockBaseUrl,
      allowCustomHost: true,
    });
    expect(client.baseUrl).toContain("127.0.0.1");
  });

  it("fails with RP_AUTH_FAILED on invalid API key", async () => {
    const client = new RunPodClient({
      apiKey: "wrong_key",
      baseUrl: mockBaseUrl,
      allowCustomHost: true,
    });

    try {
      await client.listPods();
      expect().fail("should have thrown auth error");
    } catch (err) {
      expect(err instanceof RunPodApiError).toBe(true);
      expect((err as RunPodApiError).code).toBe("RP_AUTH_FAILED");
      expect((err as RunPodApiError).statusCode).toBe(401);
    }
  });

  it("performs complete pod lifecycle on mock server", async () => {
    const client = new RunPodClient({
      apiKey: "test_key_xyz_123",
      baseUrl: mockBaseUrl,
      allowCustomHost: true,
    });

    // 1. List pods initially
    const initialPods = await client.listPods();
    expect(Array.isArray(initialPods)).toBe(true);
    const initialCount = initialPods.length;

    // 2. Create pod
    const created = await client.createPod({
      name: "pao-gen-test-pod-001",
      templateId: "hs44di56w7",
      gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
    });
    expect(created.id).toBeDefined();
    expect(created.name).toBe("pao-gen-test-pod-001");
    expect(created.desiredStatus).toBe("RUNNING");

    // 3. Get pod
    const fetched = await client.getPod(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.gpuTypeId).toBe("NVIDIA GeForce RTX 4090");

    // 4. Stop pod
    const stopped = await client.stopPod(created.id);
    expect(stopped.desiredStatus).toBe("PAUSED");

    // 5. Start pod
    const resumed = await client.startPod(created.id);
    expect(resumed.desiredStatus).toBe("RUNNING");

    // 6. Delete pod
    const deleted = await client.deletePod(created.id);
    expect(deleted).toBe(true);

    const postDeletePods = await client.listPods();
    expect(postDeletePods.length).toBe(initialCount);
  });

  it("inspects reference template hs44di56w7", async () => {
    const client = new RunPodClient({
      apiKey: "test_key_xyz_123",
      baseUrl: mockBaseUrl,
      allowCustomHost: true,
    });

    const templates = await client.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);

    const tmpl = await client.getTemplate("hs44di56w7");
    expect(tmpl.id).toBe("hs44di56w7");
    expect(tmpl.isServerless).toBe(false);
    expect(tmpl.ports).toContain("8188");
  });

  it("maps GPU shortage to RP_GPU_UNAVAILABLE", async () => {
    mockServer.simulateGpuUnavailable = true;
    const client = new RunPodClient({
      apiKey: "test_key_xyz_123",
      baseUrl: mockBaseUrl,
      allowCustomHost: true,
    });

    try {
      await client.createPod({
        name: "pao-gen-out-of-stock",
        gpuTypeIds: ["NVIDIA RTX 5090"],
      });
      expect().fail("should have thrown shortage error");
    } catch (err) {
      expect(err instanceof RunPodApiError).toBe(true);
      expect((err as RunPodApiError).code).toBe("RP_GPU_UNAVAILABLE");
    } finally {
      mockServer.simulateGpuUnavailable = false;
    }
  });
});
