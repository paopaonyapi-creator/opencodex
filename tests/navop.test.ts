// Phase Navop & 21.03 — Host-Authoritative Operations Runtime test suite.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  getNavopRuntimeService,
  createNavopMcpTools,
} from "../src/agent-os/navop";

describe("Phase Navop & 21.03 — Host-Authoritative Operations Runtime", () => {
  // -------------------------------------------------------------------------
  // 1. Schema & DB State Plane (§22)
  // -------------------------------------------------------------------------
  describe("Schema & DB State Plane", () => {
    it("reports schema version at least 73", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(73);
    });

    it("verifies all navop_* and ccs_* tables exist and accept queries", () => {
      const db = openAgentOsDb();
      const tables = [
        "navop_resources",
        "navop_capabilities",
        "navop_sessions",
        "navop_tool_invocations",
        "navop_approvals",
        "navop_audit_events",
        "ccs_providers",
        "ccs_provider_models",
        "ccs_runtimes",
        "ccs_routes",
        "ccs_circuit_breakers",
        "ccs_usage_events",
        "ccs_config_projections",
        "ccs_credential_refs",
      ];
      for (const table of tables) {
        const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
        expect(row).toBeDefined();
        expect(typeof row.count).toBe("number");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Resource Registry (§7)
  // -------------------------------------------------------------------------
  describe("Resource Registry", () => {
    it("registers host and files resources without exposing credentials to callers", () => {
      const svc = getNavopRuntimeService();
      const res = svc.registerResource({
        resourceUri: "host://vps/production-main",
        resourceType: "host",
        displayName: "Production VPS Server",
        adapterType: "ssh",
        credentialRef: "vault://secret/vps-ssh-key",
        config: { ip: "192.168.1.50", port: 22 },
        labels: { env: "production" },
        enabled: true,
      });

      expect(res.resourceUri).toBe("host://vps/production-main");
      const fetched = svc.getResource("host://vps/production-main");
      expect(fetched).toBeDefined();
      expect(fetched?.credentialRef).toBe("vault://secret/vps-ssh-key");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Execution Router & Policy Enforcement (§16, §23, §24, §51)
  // -------------------------------------------------------------------------
  describe("Execution Router & Policy Enforcement", () => {
    it("allows read-only action without approval", async () => {
      const svc = getNavopRuntimeService();
      svc.registerCapability({
        name: "pao.files.read",
        version: "1.0.0",
        adapterType: "filesystem",
        riskLevel: "R1",
        mutates: false,
        supportsDryRun: true,
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        outputSchema: { type: "object" },
        enabled: true,
      });

      const session = svc.createSession("agent-codex", "guarded");
      const exec = await svc.requestExecution({
        sessionId: session.id,
        capabilityName: "pao.files.read",
        resourceUri: "files://project/pao-hubpro",
        input: { path: "package.json" },
      });

      expect(exec.status).toBe("completed");
      expect(exec.traceId).toBeDefined();
    });

    it("blocks path traversal attempts and logs security audit", async () => {
      const svc = getNavopRuntimeService();
      const session = svc.createSession("agent-malicious", "guarded");
      expect(async () => {
        await svc.requestExecution({
          sessionId: session.id,
          capabilityName: "pao.files.read",
          resourceUri: "files://project/pao-hubpro",
          input: { path: "../../etc/shadow" },
        });
      }).toThrow(/path traversal/);
    });

    it("requires human approval for dangerous R4 actions", async () => {
      const svc = getNavopRuntimeService();
      svc.registerCapability({
        name: "pao.ssh.restart_service",
        version: "1.0.0",
        adapterType: "ssh",
        riskLevel: "R4",
        mutates: true,
        supportsDryRun: true,
        inputSchema: { type: "object", properties: { serviceName: { type: "string" } } },
        outputSchema: { type: "object" },
        enabled: true,
      });

      const session = svc.createSession("agent-operator", "guarded");
      const exec = await svc.requestExecution({
        sessionId: session.id,
        capabilityName: "pao.ssh.restart_service",
        resourceUri: "host://vps/production-main",
        input: { serviceName: "nginx" },
      });

      expect(exec.status).toBe("requires_approval");
      expect(exec.approvalId).toBeDefined();

      // Human resolves approval
      const resolved = svc.resolveApproval(exec.approvalId!, "approved", "admin-pao", "Service restart verified");
      expect(resolved.status).toBe("approved");
    });
  });

  // -------------------------------------------------------------------------
  // 4. CC-Switch Provider & Runtime Federation (§8, §9)
  // -------------------------------------------------------------------------
  describe("CC-Switch Provider & Runtime Federation", () => {
    it("registers and federates providers and local runtimes", () => {
      const svc = getNavopRuntimeService();
      const prov = svc.registerProvider({
        name: "OpenRouter Gateway",
        providerFamily: "openrouter",
        protocol: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        trustClass: "trusted",
        enabled: true,
        metadata: { models: ["anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b"] },
      });

      expect(prov.name).toBe("OpenRouter Gateway");
      const providers = svc.listProviders();
      expect(providers.some((p) => p.name === "OpenRouter Gateway")).toBe(true);

      const rt = svc.registerRuntime({
        runtimeType: "claude-code",
        displayName: "Claude Code CLI",
        executablePath: "C:\\Users\\AD PAO\\AppData\\Roaming\\npm\\claude.cmd",
        status: "ready",
        metadata: { version: "1.0.0" },
      });

      expect(rt.runtimeType).toBe("claude-code");
      const runtimes = svc.listRuntimes();
      expect(runtimes.some((r) => r.runtimeType === "claude-code")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. MCP Tools (§13)
  // -------------------------------------------------------------------------
  describe("MCP Tools Integration", () => {
    it("registers pao.* tools and executes resources listing", async () => {
      const tools = createNavopMcpTools();
      expect(tools.length).toBe(6);
      expect(tools.some((t) => t.name === "pao.routing.routes.list")).toBe(true);

      const listTool = tools.find((t) => t.name === "pao.resources.list");
      expect(listTool).toBeDefined();
      const res = await listTool!.handler({});
      expect(res.ok).toBe(true);
      expect(Array.isArray((res as any).resources)).toBe(true);
    });
  });

  describe("Provider failover and circuit breaker", () => {
    it("fails over an idempotent request and refuses to replay a side-effecting one", () => {
      const svc = getNavopRuntimeService();
      const primary = svc.registerProvider({
        name: "Primary OpenAI",
        providerFamily: "openai",
        protocol: "openai",
        trustClass: "trusted",
        enabled: true,
        metadata: {},
      });
      const fallback = svc.registerProvider({
        name: "Local Fallback",
        providerFamily: "ollama",
        protocol: "openai-compatible",
        trustClass: "local",
        enabled: true,
        metadata: {},
      });
      svc.registerRoute({
        name: "coding-default",
        routingMode: "auto-failover",
        candidates: [
          { providerId: primary.id, modelId: "model-a", priority: 1 },
          { providerId: fallback.id, modelId: "local-model", priority: 2 },
        ],
      });

      const failedOver = svc.routeRequest({
        routeName: "coding-default",
        requestClass: "idempotent",
        projectId: "pao",
        taskId: "task-1",
        probe: (candidate) => candidate.providerId === primary.id
          ? { ok: false, errorCode: "upstream_503", inputTokens: 10, outputTokens: 0 }
          : { ok: true, inputTokens: 10, outputTokens: 4, estimatedCost: 0.01 },
      });
      expect(failedOver.status).toBe("completed");
      expect(failedOver.selectedProviderId).toBe(fallback.id);
      expect(failedOver.replayed).toBe(true);
      expect(failedOver.failoverCount).toBe(1);

      const blocked = svc.routeRequest({
        routeName: "coding-default",
        requestClass: "side_effecting",
        projectId: "pao",
        taskId: "task-2",
        probe: (candidate) => candidate.providerId === primary.id
          ? { ok: false, errorCode: "uncertain_timeout" }
          : { ok: true },
      });
      expect(blocked.status).toBe("blocked");
      expect(blocked.selectedProviderId).toBeNull();
      expect(blocked.attempts.some((a) => a.outcome === "blocked_unsafe_replay")).toBe(true);
      expect(svc.listUsage({ taskId: "task-1" }).some((e) => e.outcome === "failover")).toBe(true);
    });

    it("opens the circuit after repeated failures and recovers after cooldown", () => {
      const svc = getNavopRuntimeService();
      const provider = svc.registerProvider({
        name: "Flaky Provider",
        providerFamily: "openrouter",
        protocol: "openai-compatible",
        trustClass: "unclassified",
        enabled: true,
        metadata: {},
      });
      const now = Date.now();
      svc.recordProviderOutcome(provider.id, "failure", now);
      svc.recordProviderOutcome(provider.id, "failure", now + 1);
      const opened = svc.recordProviderOutcome(provider.id, "failure", now + 2);
      expect(opened.state).toBe("OPEN");

      const stillOpen = svc.getCircuit(provider.id, now + 10_000);
      expect(stillOpen.state).toBe("OPEN");
      const halfOpen = svc.getCircuit(provider.id, now + 31_000);
      expect(halfOpen.state).toBe("HALF_OPEN");
      const closed = svc.recordProviderOutcome(provider.id, "success", now + 32_000);
      expect(closed.state).toBe("CLOSED");
      expect(closed.failureCount).toBe(0);
    });

    it("previews config drift and restores the captured original text", () => {
      const svc = getNavopRuntimeService();
      const preview = svc.previewConfigProjection({
        runtimeId: "codex",
        targetPath: "C:/Users/AD PAO/.codex/config.toml",
        currentText: "model = \"old\"\n",
        projectedText: "model = \"new\"\n",
      });
      expect(preview.drift).toBe(true);
      expect(preview.status).toBe("preview");
      expect(preview.beforeHash).not.toBe(preview.afterHash);

      const restored = svc.restoreConfigProjection("codex", "C:/Users/AD PAO/.codex/config.toml");
      expect(restored.status).toBe("restored");
      expect(restored.afterText).toBe("model = \"old\"\n");
      expect(restored.afterHash).toBe(preview.beforeHash);
    });

    it("inspects Codex and Claude configs without writing them", () => {
      const root = mkdtempSync(join(tmpdir(), "ccs-runtime-"));
      const previousCodex = process.env.CODEX_HOME;
      const previousClaude = process.env.CLAUDE_CONFIG_DIR;
      process.env.CODEX_HOME = join(root, "codex");
      process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
      mkdirSync(join(root, "codex"));
      mkdirSync(join(root, "claude"));
      writeFileSync(join(root, "codex", "config.toml"), "model = \"xai/grok-4.7\"\nopenai_base_url = \"http://127.0.0.1:10100/v1\"\n");
      writeFileSync(join(root, "claude", "settings.json"), "{\n  \"model\": \"opus[1m]\"\n}\n");
      const svc = getNavopRuntimeService();
      try {
        const codex = svc.inspectRuntimeConfig("codex", "xai/grok-4.7", "http://127.0.0.1:10100/v1");
        const claude = svc.inspectRuntimeConfig("claude", "opus[1m]");
        expect(codex.exists).toBe(true);
        expect(claude.exists).toBe(true);
        expect(codex.drift).toBe(false);
        expect(claude.drift).toBe(false);
        const changed = svc.inspectRuntimeConfig("codex", "openai/gpt-5", "http://127.0.0.1:10100/v1");
        expect(changed.drift).toBe(true);
        expect(changed.projectedText).toContain("openai/gpt-5");
      } finally {
        if (previousCodex === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previousCodex;
        if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
        else process.env.CLAUDE_CONFIG_DIR = previousClaude;
      }
    });

    it("stores a credential reference as an encrypted envelope and resolves it", () => {
      const svc = getNavopRuntimeService();
      const provider = svc.registerProvider({
        name: "Credential Broker Provider",
        providerFamily: "openai",
        protocol: "openai",
        trustClass: "trusted",
        enabled: true,
        metadata: {},
      });
      const stored = svc.storeCredentialRef(provider.id, "openai/main", "sk-test-secret");
      expect(stored.secretRef).toBe("credential://openai/main");
      expect(JSON.stringify(stored.envelope)).not.toContain("sk-test-secret");
      expect(svc.resolveCredential(stored.secretRef)).toBe("sk-test-secret");
    });
  });
});
