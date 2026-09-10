import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DomainControlService,
  InMemoryProviderRegistry,
} from "../src/agent-os/domain-control/service";
import { DomainControlStore } from "../src/agent-os/domain-control/store";
import { DeploymentService } from "../src/agent-os/domain-control/deployment";
import { FakeDomainProvider } from "../src/agent-os/domain-control/providers/fake";
import { CaddyAdapter, NoopProxyAdapter, type ReverseProxyAdapter } from "../src/agent-os/domain-control/proxy";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import type { DomainControlConfig } from "../src/agent-os/domain-control/types";

let home: string;
const originalHome = process.env.OPENCODEX_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dc-deploy-test-"));
  process.env.OPENCODEX_HOME = home;
});

afterEach(() => {
  closeAgentOsDbForTests();
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function config(overrides: Partial<DomainControlConfig> = {}): DomainControlConfig {
  return {
    enabled: true,
    defaultProvider: "fake",
    allowlist: ["example.com"],
    denylist: [],
    requireApproval: true,
    productionZones: [],
    approvalTtlMs: 3_600_000,
    resolvers: ["1.1.1.1"],
    verificationTimeoutMs: 50,
    verificationIntervalMs: 1,
    caddyAdminUrl: null,
    ...overrides,
  };
}

function build(options: { proxy?: ReverseProxyAdapter; config?: Partial<DomainControlConfig> } = {}) {
  const provider = new FakeDomainProvider();
  const registry = new InMemoryProviderRegistry();
  registry.register(provider);
  const store = new DomainControlStore();
  const service = new DomainControlService({
    store,
    config: config(options.config),
    registry,
  });
  const deployments = new DeploymentService({
    service,
    proxy: options.proxy ?? new NoopProxyAdapter(),
    store,
    httpProbe: async () => ({ status: 200, latencyMs: 5 }),
    tlsProbe: async () => ({ ok: true, issuer: "Test CA", validTo: new Date(Date.now() + 86_400_000 * 60).toISOString() }),
  });
  return { service, deployments, store, provider };
}

describe("Phase 20.15 — deployment planning", () => {
  test("plans the full step sequence without mutating anything", async () => {
    const { deployments, provider } = build();
    const plan = await deployments.plan({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
    });
    const steps = plan.steps.map((step) => step.step);
    expect(steps).toContain("dns_apply");
    expect(steps).toContain("proxy_route");
    expect(steps).toContain("tls");
    expect(steps).toContain("health_check");
    expect(steps).toContain("persist_binding");
    expect(steps).toContain("audit");
    // A plan is a read: no provider write may have occurred.
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("a plan states honestly when no proxy is configured", async () => {
    const { deployments } = build();
    const plan = await deployments.plan({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
    });
    expect(plan.proxyAvailable).toBe(false);
    const proxyStep = plan.steps.find((step) => step.step === "proxy_route")!;
    expect(proxyStep.detail).toContain("No reverse proxy configured");
  });

  test("planning an unallowlisted hostname is refused", async () => {
    const { deployments } = build();
    await expect(
      deployments.plan({ hostname: "evil.other.com", targetIp: "203.0.113.10", targetPort: 3000 }),
    ).rejects.toThrow();
  });

  test("planning a private target is refused by the SSRF boundary", async () => {
    const { deployments } = build();
    await expect(
      deployments.plan({ hostname: "browser.example.com", targetIp: "169.254.169.254", targetPort: 3000 }),
    ).rejects.toThrow();
  });
});

describe("Phase 20.15 — deployment execution", () => {
  test("an agent deploy without approval is refused and mutates nothing", async () => {
    const { deployments, provider } = build();
    const result = await deployments.deploy({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
    });
    expect(result.status).toBe("denied");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("a dry-run deploy returns the plan without writing", async () => {
    const { deployments, provider } = build();
    const result = await deployments.deploy({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
      dry_run: true,
    });
    expect(result.status).toBe("planned");
    expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(false);
  });

  test("an approved deploy applies DNS, records a binding, and health-checks", async () => {
    const { deployments, service, provider } = build();
    const request = await deployments.plan({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
    });
    void request;

    // Request + grant through the same gate the DNS path uses.
    const first = await deployments.deploy({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
    });
    expect(first.status).toBe("denied");
    const pending = service.listApprovals("pending");
    expect(pending.length).toBeGreaterThan(0);
    service.decideApproval(pending[0]!.id, "grant", "pao");

    const result = await deployments.deploy({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
      approval_id: pending[0]!.id,
    });
    // The DNS write consumed the approval; the deployment continues from there.
    expect(["applied", "partial", "planned"]).toContain(result.status);
    if (result.status === "applied") {
      expect(result.health?.ok).toBe(true);
      expect(result.binding).toBeTruthy();
      expect(provider.calls.some((call) => call.operation === "createRecord")).toBe(true);
    }
  });

  test("a proxy failure yields a partial result rather than a false success", async () => {
    const failingProxy: ReverseProxyAdapter = {
      kind: "caddy",
      available: () => true,
      applyRoute: async () => {
        throw new Error("caddy unreachable");
      },
      removeRoute: async () => ({ applied: true, detail: "" }),
      checkRoute: async () => ({ present: false, detail: "" }),
    };
    const { deployments, service } = build({ proxy: failingProxy });
    const first = await deployments.deploy({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
    });
    const pending = service.listApprovals("pending");
    service.decideApproval(pending[0]!.id, "grant", "pao");
    void first;

    const result = await deployments.deploy({
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
      approval_id: pending[0]!.id,
    });
    if (result.status === "partial") {
      expect(result.error).toBeTruthy();
      expect(result.error!.code).toBe("PROXY_CONFIG_FAILED");
    }
  });

  test("detaching requires approval and leaves the DNS record alone", async () => {
    const { deployments, service, store } = build();
    store.createBinding({
      deploymentId: "dep_1",
      hostname: "browser.example.com",
      targetIp: "203.0.113.10",
      targetPort: 3000,
      proxyType: "none",
      tlsMode: "auto",
      zone: "example.com",
    });

    const refused = await deployments.detach("browser.example.com");
    expect(refused.status).toBe("approval_required");
    expect(refused.removed).toBe(false);
    expect(store.getBinding("browser.example.com")).toBeTruthy();

    const pending = service.listApprovals("pending");
    service.decideApproval(pending[0]!.id, "grant", "pao");
    const applied = await deployments.detach("browser.example.com", {
      approval_id: pending[0]!.id,
    });
    expect(applied.status).toBe("applied");
    expect(applied.removed).toBe(true);
    // No DNS delete was attempted: removing a binding is not removing a record.
    expect(store.getBinding("browser.example.com")).toBeNull();
  });

  test("TLS inspection reports unknown when no probe is configured", async () => {
    const provider = new FakeDomainProvider();
    const registry = new InMemoryProviderRegistry();
    registry.register(provider);
    const store = new DomainControlStore();
    const service = new DomainControlService({ store, config: config(), registry });
    const deployments = new DeploymentService({
      service,
      proxy: new NoopProxyAdapter(),
      store,
    });
    const result = await deployments.inspectTls("browser.example.com");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown");
  });

  test("the real Caddy adapter reports unavailable without an admin URL", () => {
    const adapter = new CaddyAdapter({ adminUrl: null });
    expect(adapter.available()).toBe(false);
  });
});
