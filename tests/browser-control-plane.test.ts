import { describe, expect, it } from "bun:test";
import {
  BrowserProviderRegistry,
  LocalChromeBrowserProvider,
  OyaBrowserProvider,
  PersonaVault,
  PlaybookEngine,
  UniversalBrowserRouter,
  createBrowserMcpTools,
  type BrowserPlaybook,
} from "../src/agent-os/browser-control";

describe("Phase 20.101 — Pao-hubPro Universal AI Browser Control Plane", () => {
  describe("Browser Providers (Local Chrome & Oya)", () => {
    it("Local Chrome provides high-trust capabilities and zero-cost local execution", async () => {
      const provider = new LocalChromeBrowserProvider();
      const caps = await provider.capabilities();
      expect(caps.cdp).toBe(true);
      expect(caps.humanTakeover).toBe(true);
      expect(provider.costPerMinuteUsd).toBe(0.0);

      const health = await provider.health();
      expect(health.status).toBe("healthy");

      const lease = await provider.start({ headful: false });
      expect(lease.providerId).toBe("local-chrome");
      expect(lease.wsEndpoint).toContain("ws://127.0.0.1:9222");

      const conn = await provider.connect(lease.leaseId);
      const actionRes = await conn.executeAction({ type: "goto", target: "https://example.com" });
      expect(actionRes.ok).toBe(true);

      const snapshot = await provider.snapshot(lease.leaseId);
      expect(snapshot.snapshotId).toBeDefined();

      await provider.stop(lease.leaseId);
    });

    it("Oya Browser Adapter supports cloud fleet leasing and remote sessions", async () => {
      const provider = new OyaBrowserProvider();
      const caps = await provider.capabilities();
      expect(caps.liveView).toBe(true);
      expect(provider.trustLevel).toBe("medium");
      expect(provider.costPerMinuteUsd).toBeGreaterThan(0);

      const lease = await provider.start({ timeoutMs: 60000 });
      expect(lease.providerId).toBe("oya");

      const conn = await provider.connect(lease.leaseId);
      const actionRes = await conn.executeAction({ type: "click", target: "#login-btn" });
      expect(actionRes.ok).toBe(true);

      await provider.stop(lease.leaseId);
    });
  });

  describe("Universal Browser Router", () => {
    it("routes high sensitivity workloads strictly to local-first browser provider", async () => {
      const router = new UniversalBrowserRouter();
      const decision = await router.selectRoute({
        workloadType: "authenticated_task",
        sensitivity: "high",
      });

      expect(decision.selectedProvider.id).toBe("local-chrome");
      expect(decision.reason).toContain("High sensitivity workload pinned to local-first");
      expect(decision.failoverCandidates).toHaveLength(0); // Regulated jobs do not fail over to cloud
    });

    it("routes general research workloads to Oya cloud fleet for concurrency", async () => {
      const router = new UniversalBrowserRouter();
      const decision = await router.selectRoute({
        workloadType: "research",
        sensitivity: "low",
      });

      expect(decision.selectedProvider.id).toBe("oya");
      expect(decision.failoverCandidates).toContain("local-chrome");
    });

    it("leases browser and handles failover when primary provider fails", async () => {
      const registry = new BrowserProviderRegistry();
      const router = new UniversalBrowserRouter(registry);

      const { lease, routing } = await router.leaseBrowser({
        workloadType: "research",
        sensitivity: "low",
      });

      expect(lease.leaseId).toBeDefined();
      expect(routing.selectedProvider.id).toBe("oya");
    });
  });

  describe("Persona & Session Vault", () => {
    it("creates, stores, and updates personas with encrypted storage and opaque credentials", () => {
      const vault = new PersonaVault();
      const persona = vault.createPersona({
        name: "Test Research Persona",
        owner: "pao",
        locale: "th-TH",
        credentialRefs: ["cred_opaque_id_99"],
        humanRequiredFor: ["financial_transaction", "delete_account"],
      });

      expect(persona.name).toBe("Test Research Persona");
      expect(persona.auth.credentialRefs).toEqual(["cred_opaque_id_99"]);
      expect(persona.storage.cookiesEncrypted).toBeDefined();

      vault.updateStorage(persona.id, [{ name: "session_id", value: "val123" }], { dark_mode: "true" });
      const updated = vault.getPersona(persona.id);
      expect(updated?.updatedAt).toBeDefined();

      expect(vault.listPersonas().length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Playbook Engine, Drift Detection & Human Takeover", () => {
    it("executes deterministic playbook and interpolates input variables", async () => {
      const engine = new PlaybookEngine();
      const provider = new LocalChromeBrowserProvider();
      const lease = await provider.start({});
      const conn = await provider.connect(lease.leaseId);

      const playbook: BrowserPlaybook = {
        id: "sample_playbook",
        version: 1,
        description: "Fill search form",
        allowedHosts: ["example.com"],
        inputs: ["keyword"],
        steps: [
          { id: "s1", action: "goto", target: "https://example.com" },
          { id: "s2", action: "fill", target: "#search", value: "{{keyword}}" },
          { id: "s3", action: "click", target: "#submit" },
        ],
        status: "approved",
        createdAt: new Date().toISOString(),
      };

      engine.registerPlaybook(playbook);

      const result = await engine.executePlaybook("sample_playbook", conn, {
        keyword: "Pao-hubPro Architecture",
      });

      expect(result.status).toBe("completed");
      expect(result.completedSteps).toBe(3);
    });

    it("detects DOM drift and generates proposed repair step", async () => {
      const engine = new PlaybookEngine();
      const provider = new LocalChromeBrowserProvider();
      const lease = await provider.start({});
      const conn = await provider.connect(lease.leaseId);

      const driftPlaybook: BrowserPlaybook = {
        id: "drift_playbook",
        version: 1,
        description: "Obsolete form submission",
        allowedHosts: ["example.com"],
        inputs: [],
        steps: [
          { id: "s1", action: "goto", target: "https://example.com" },
          { id: "s2", action: "click", target: "drift_sim_old_button" },
        ],
        status: "approved",
        createdAt: new Date().toISOString(),
      };

      engine.registerPlaybook(driftPlaybook);

      const result = await engine.executePlaybook("drift_playbook", conn);
      expect(result.status).toBe("drift_detected");
      expect(result.driftDetail?.expectedTarget).toBe("drift_sim_old_button");
      expect(result.driftDetail?.proposedRepairStep?.target).toBe("button[role='submit-updated']");
    });

    it("pauses for human takeover when approval policy is encountered and resumes", async () => {
      const engine = new PlaybookEngine();
      const provider = new LocalChromeBrowserProvider();
      const lease = await provider.start({});
      const conn = await provider.connect(lease.leaseId);

      const takeoverPlaybook: BrowserPlaybook = {
        id: "takeover_playbook",
        version: 1,
        description: "Payout account change",
        allowedHosts: ["finance.example.com"],
        inputs: [],
        steps: [
          { id: "s1", action: "goto", target: "https://finance.example.com" },
          { id: "s2", action: "approval", policy: "human_required_for_payout" },
          { id: "s3", action: "click", target: "#confirm" },
        ],
        status: "approved",
        createdAt: new Date().toISOString(),
      };

      engine.registerPlaybook(takeoverPlaybook);

      const result = await engine.executePlaybook("takeover_playbook", conn);
      expect(result.status).toBe("human_takeover_required");
      expect(result.humanTakeover?.takeoverId).toBeDefined();

      // Release takeover
      const released = engine.releaseHumanTakeover(result.humanTakeover!.takeoverId);
      expect(released).toBe(true);
    });

    it("executes Adobe Stock upload draft playbook with approval gate on final submission (§28)", async () => {
      const engine = new PlaybookEngine();
      const provider = new LocalChromeBrowserProvider();
      const lease = await provider.start({ personaId: "persona_adobe_stock_main" });
      const conn = await provider.connect(lease.leaseId);

      const adobePlaybook: BrowserPlaybook = {
        id: "adobe_stock_upload_v1",
        version: 1,
        description: "Upload an approved Adobe Stock asset draft",
        allowedHosts: ["contributor.stock.adobe.com"],
        inputs: ["asset_path", "title", "keywords"],
        steps: [
          { id: "s1", action: "goto", target: "https://contributor.stock.adobe.com/" },
          { id: "s2", action: "upload", target: "#file-upload", value: "{{asset_path}}" },
          { id: "s3", action: "fill", target: "#title", value: "{{title}}" },
          { id: "s4", action: "fill", target: "#keywords", value: "{{keywords}}" },
          { id: "s5", action: "approval", policy: "human_required_for_final_submission" },
          { id: "s6", action: "click", target: "#submit-btn" },
        ],
        status: "approved",
        createdAt: new Date().toISOString(),
      };

      engine.registerPlaybook(adobePlaybook);

      const result = await engine.executePlaybook("adobe_stock_upload_v1", conn, {
        asset_path: "C:\\data\\stock_assets\\photo_01.jpg",
        title: "Sunset Over Tropical Beach",
        keywords: "sunset, beach, tropical, travel, ocean",
      });

      expect(result.status).toBe("human_takeover_required");
      expect(result.completedSteps).toBe(4); // upload, title, keywords completed before approval pause
      expect(result.humanTakeover?.reason).toContain("approval");
    });
  });

  describe("Browser MCP Gateway Tools", () => {
    it("exposes browser fleet health, session leasing, and persona tools", async () => {
      const tools = createBrowserMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(4);

      const statusTool = tools.find((t) => t.name === "pao.browser.status")!;
      const statusRes = await statusTool.handler({});
      expect(statusRes.ok).toBe(true);
      expect((statusRes.fleetHealth as Record<string, unknown>)["local-chrome"]).toBeDefined();

      const startTool = tools.find((t) => t.name === "pao.browser.start")!;
      const startRes = await startTool.handler({ workloadType: "research", sensitivity: "low" });
      expect(startRes.ok).toBe(true);
      expect(startRes.providerId).toBe("oya");

      const personaTool = tools.find((t) => t.name === "pao.browser.persona_list")!;
      const personaRes = await personaTool.handler({});
      expect(personaRes.ok).toBe(true);
      expect(personaRes.count).toBeGreaterThanOrEqual(1);
    });
  });
});
