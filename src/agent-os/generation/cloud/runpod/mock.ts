// Phase 20 — Mock RunPod API Server (for tests & zero-cost development).
//
// Implements the REST API endpoints in-memory so test suites can exercise
// provisioning, lifecycle, readiness, billing, and failure modes without real spending.

import type { Server } from "bun";
import type {
  RunPodPod,
  RunPodCreatePodInput,
  RunPodTemplate,
  RunPodNetworkVolume,
  RunPodBillingPodRecord,
} from "./api-types";

export interface MockRunPodOptions {
  validApiKey?: string;
  simulateGpuUnavailable?: boolean;
  simulateRateLimit?: boolean;
  simulate500?: boolean;
  comfyPort?: number;
}

export class MockRunPodServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  readonly validApiKey: string;
  simulateGpuUnavailable = false;
  simulateRateLimit = false;
  simulate500 = false;
  comfyPort: number;

  pods: Map<string, RunPodPod> = new Map();
  templates: Map<string, RunPodTemplate> = new Map();
  networkVolumes: Map<string, RunPodNetworkVolume> = new Map();
  billingRecords: RunPodBillingPodRecord[] = [];

  constructor(options: MockRunPodOptions = {}) {
    this.validApiKey = options.validApiKey ?? "mock_runpod_secret_key_12345";
    this.simulateGpuUnavailable = options.simulateGpuUnavailable ?? false;
    this.simulateRateLimit = options.simulateRateLimit ?? false;
    this.simulate500 = options.simulate500 ?? false;
    this.comfyPort = options.comfyPort ?? 8188;
    this.seedDefaults();
  }

  private seedDefaults(): void {
    // Seed default template: hs44di56w7
    this.templates.set("hs44di56w7", {
      id: "hs44di56w7",
      name: "Pao ComfyUI Golden Template",
      imageName: "runpod/comfyui:latest",
      isServerless: false,
      category: "ComfyUI",
      containerDiskInGb: 50,
      volumeInGb: 100,
      volumeMountPath: "/workspace",
      ports: "8188/http,22/tcp",
      env: [{ key: "COMFYUI_PORT", value: "8188" }],
      readme: "Pao-hubPro validated reference template",
    });

    // Seed another template for testing
    this.templates.set("serverless-tmpl", {
      id: "serverless-tmpl",
      name: "Serverless Endpoint",
      imageName: "runpod/serverless:latest",
      isServerless: true,
    });

    // Seed default network volume
    this.networkVolumes.set("vol-pao-models", {
      id: "vol-pao-models",
      name: "pao-stock-models",
      size: 500,
      dataCenterId: "US-GA-1",
    });
  }

  async start(): Promise<string> {
    const self = this;
    this.server = Bun.serve({
      port: 0, // ephemeral
      fetch(req: Request) {
        return self.handleRequest(req);
      },
    });
    return `http://127.0.0.1:${this.server.port}/v1`;
  }

  stop(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
  }

  get url(): string {
    return this.server ? `http://127.0.0.1:${this.server.port}/v1` : "";
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token || token !== this.validApiKey) {
      return new Response(JSON.stringify({ error: "Unauthorized", message: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (this.simulate500) {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (this.simulateRateLimit) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
      });
    }

    const path = url.pathname.replace(/^\/v1/, "");
    const method = req.method;

    // GET /pods
    if (path === "/pods" && method === "GET") {
      return new Response(JSON.stringify([...this.pods.values()]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /pods
    if (path === "/pods" && method === "POST") {
      if (this.simulateGpuUnavailable) {
        return new Response(JSON.stringify({ error: "GPU type currently not available in data center" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const input = (await req.json()) as RunPodCreatePodInput;
      const podId = `mock-pod-${Math.random().toString(36).slice(2, 9)}`;
      const gpuType = input.gpuTypeIds?.[0] ?? "NVIDIA GeForce RTX 4090";

      const newPod: RunPodPod = {
        id: podId,
        name: input.name,
        desiredStatus: "RUNNING",
        lastStatusChange: new Date().toISOString(),
        imageName: input.imageName ?? "runpod/comfyui:latest",
        templateId: input.templateId,
        gpuTypeId: gpuType,
        gpuCount: input.gpuCount ?? 1,
        costPerHour: gpuType.includes("5090") ? 1.20 : gpuType.includes("A100") ? 1.89 : 0.74,
        networkVolumeId: input.networkVolumeId,
        volumeMountPath: input.volumeMountPath ?? "/workspace",
        dataCenterId: input.dataCenterId ?? "US-GA-1",
        createdAt: new Date().toISOString(),
        runtime: {
          uptimeInSeconds: 1,
          ports: [
            {
              ip: "127.0.0.1",
              isIpPublic: true,
              privatePort: 8188,
              publicPort: this.comfyPort,
              type: "http",
            },
          ],
        },
      };

      this.pods.set(podId, newPod);
      return new Response(JSON.stringify(newPod), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /pods/:id
    const podMatch = path.match(/^\/pods\/([^/]+)$/);
    if (podMatch && method === "GET") {
      const podId = decodeURIComponent(podMatch[1]!);
      const pod = this.pods.get(podId);
      if (!pod) {
        return new Response(JSON.stringify({ error: `Pod ${podId} not found` }), { status: 404 });
      }
      return new Response(JSON.stringify(pod), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /pods/:id/start
    const startMatch = path.match(/^\/pods\/([^/]+)\/start$/);
    if (startMatch && method === "POST") {
      const podId = decodeURIComponent(startMatch[1]!);
      const pod = this.pods.get(podId);
      if (!pod) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      pod.desiredStatus = "RUNNING";
      return new Response(JSON.stringify(pod), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // POST /pods/:id/stop
    const stopMatch = path.match(/^\/pods\/([^/]+)\/stop$/);
    if (stopMatch && method === "POST") {
      const podId = decodeURIComponent(stopMatch[1]!);
      const pod = this.pods.get(podId);
      if (!pod) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      pod.desiredStatus = "PAUSED";
      return new Response(JSON.stringify(pod), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // DELETE /pods/:id
    if (podMatch && method === "DELETE") {
      const podId = decodeURIComponent(podMatch[1]!);
      if (!this.pods.has(podId)) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      this.pods.delete(podId);
      return new Response(null, { status: 204 });
    }

    // GET /templates
    if (path === "/templates" && method === "GET") {
      return new Response(JSON.stringify([...this.templates.values()]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /templates/:id
    const tmplMatch = path.match(/^\/templates\/([^/]+)$/);
    if (tmplMatch && method === "GET") {
      const tmplId = decodeURIComponent(tmplMatch[1]!);
      const tmpl = this.templates.get(tmplId);
      if (!tmpl) return new Response(JSON.stringify({ error: `Template ${tmplId} not found` }), { status: 404 });
      return new Response(JSON.stringify(tmpl), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // GET /networkvolumes
    if (path === "/networkvolumes" && method === "GET") {
      return new Response(JSON.stringify([...this.networkVolumes.values()]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /networkvolumes/:id
    const volMatch = path.match(/^\/networkvolumes\/([^/]+)$/);
    if (volMatch && method === "GET") {
      const volId = decodeURIComponent(volMatch[1]!);
      const vol = this.networkVolumes.get(volId);
      if (!vol) return new Response(JSON.stringify({ error: "Volume not found" }), { status: 404 });
      return new Response(JSON.stringify(vol), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // GET /billing/pods
    if (path === "/billing/pods" && method === "GET") {
      return new Response(JSON.stringify(this.billingRecords), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Not found: ${method} ${path}` }), { status: 404 });
  }
}
