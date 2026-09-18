// Phase 20.89 — Capability Hub REST API + MCP registration tests.
// Exercises the real management route handler (handleMarketplaceRoutes) and
// the MCP gateway registration, per mission §20/§52.

import { describe, expect, it } from "bun:test";
import { handleMarketplaceRoutes } from "../src/server/management/marketplace-routes";
import type { ManagementContext } from "../src/server/management/context";
import { getMcpToolGateway } from "../src/agent-os/mcp-gateway/gateway";
import { parseCapabilityManifest } from "../src/agent-os/marketplace/manifest";

const BASE = `
apiVersion: paohub.io/v1alpha1
kind: Capability
metadata:
  id: api-cap
  name: API Capability
  sourceType: github
  sourceUrl: https://github.com/example/api-cap
  license: MIT
spec:
  type: runtime-adapter
  version: "1.0.0"
  permissions:
    filesystem:
      read:
        - workspace/**
  install:
    strategy: registry
    steps:
      - type: register
  health:
    checks:
      - type: process
`.trimStart();

function makeCtx(method: string, path: string, body?: unknown): ManagementContext {
  const req = new Request(`http://localhost:10100${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json", "x-pao-actor": "api-test" } } : { headers: { "x-pao-actor": "api-test" } }),
  });
  return { req, url: new URL(req.url), config: {} as never, deps: {} as never } as unknown as ManagementContext;
}

describe("capability hub REST API (mission §20)", () => {
  it("health endpoint reports the registry and canonical invariant", async () => {
    const res = await handleMarketplaceRoutes(makeCtx("GET", "/api/agent-os/marketplace/health"));
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean; phase: string; registry: { capabilities: number }; invariantCheck: string };
    expect(body.ok).toBe(true);
    expect(body.phase).toBe("20.89");
    expect(body.invariantCheck).toBe("pass");
    expect(body.registry.capabilities).toBeGreaterThanOrEqual(0);
  });

  it("import-phases registers the tracked blueprint corpus as registry drafts", async () => {
    const res = await handleMarketplaceRoutes(makeCtx("POST", "/api/agent-os/marketplace/import-phases", { actor: "api-test" }));
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { ok: boolean; run: { scanned: number; imported: number; updated: number; skipped: number; collisions: Array<{ canonicalId: string }> } };
    expect(body.ok).toBe(true);
    expect(body.run.scanned).toBeGreaterThanOrEqual(29);
    // Only the known legacy 20.62 duplicate file may collide.
    expect(body.run.collisions.every((c) => c.canonicalId === "20.62")).toBe(true);
  });

  it("list + detail endpoints return real registry data with permissions and policy", async () => {
    // Seed one capability through the registry for deterministic detail checks.
    const manifest = parseCapabilityManifest(BASE);
    if (!manifest.ok) throw new Error("fixture must parse");
    const unique = { ...manifest.manifest, metadata: { ...manifest.manifest.metadata, id: `api-cap-${Date.now().toString(36)}`, slug: `api-cap-${Date.now().toString(36)}` } };
    const { getCapabilityRegistry } = await import("../src/agent-os/marketplace/registry");
    const upsert = getCapabilityRegistry().upsertFromManifest({ manifest: unique, phaseId: "20.99", blueprintPath: null, blueprintStatus: null, manifestYamlText: BASE, sourceRef: "commit:abc", checksumSha256: null, actor: "api-test", trustState: "verified" });
    const slug = getCapabilityRegistry().getCapabilityById(upsert.capabilityId)!.slug;

    const listRes = await handleMarketplaceRoutes(makeCtx("GET", `/api/agent-os/marketplace/capabilities?search=${encodeURIComponent(slug)}`));
    const listBody = (await listRes!.json()) as { ok: boolean; count: number; capabilities: Array<{ slug: string }> };
    expect(listBody.ok).toBe(true);
    expect(listBody.capabilities.some((c) => c.slug === slug)).toBe(true);

    const detailRes = await handleMarketplaceRoutes(makeCtx("GET", `/api/agent-os/marketplace/capabilities/${slug}`));
    const detail = (await detailRes!.json()) as {
      ok: boolean;
      capability: { slug: string; phaseId: string | null; status: string };
      manifest: { spec: { install: { steps: unknown[] } } } | null;
      permissions: Array<{ permission: string }>;
      policy: { decision: string };
      installation: null;
    };
    expect(detail.ok).toBe(true);
    expect(detail.capability.slug).toBe(slug);
    expect(detail.capability.status).toBe("NORMALIZED");
    expect(detail.manifest?.spec.install.steps.length).toBeGreaterThan(0);
    expect(detail.permissions.some((p) => p.permission === "filesystem.read")).toBe(true);
    expect(detail.policy.decision).toBe("ALLOW");
    expect(detail.installation).toBeNull();
  });

  it("plan → approve → execute → rollback lifecycle through REST", async () => {
    const manifest = parseCapabilityManifest(BASE);
    const unique = { ...manifest.manifest, metadata: { ...manifest.manifest.metadata, id: `api-life-${Date.now().toString(36)}`, slug: `api-life-${Date.now().toString(36)}` } };
    const { getCapabilityRegistry } = await import("../src/agent-os/marketplace/registry");
    const upsert = getCapabilityRegistry().upsertFromManifest({ manifest: unique, phaseId: null, blueprintPath: null, blueprintStatus: null, manifestYamlText: BASE, sourceRef: "commit:abc", checksumSha256: null, actor: "api-test", trustState: "verified" });
    const slug = getCapabilityRegistry().getCapabilityById(upsert.capabilityId)!.slug;

    const planRes = await handleMarketplaceRoutes(makeCtx("POST", `/api/agent-os/marketplace/capabilities/${slug}/plan-install`, {}));
    const plan = (await planRes!.json()) as { planId: string; policyDecision: string; approvalRequired: boolean };
    expect(plan.approvalRequired).toBe(false);
    expect(plan.policyDecision).toBe("ALLOW");

    const execRes = await handleMarketplaceRoutes(makeCtx("POST", `/api/agent-os/marketplace/install-plans/${plan.planId}/execute`, {}));
    const exec = (await execRes!.json()) as { ok: boolean; transaction: { state: string; installationId: string | null } };
    expect(exec.ok).toBe(true);
    expect(exec.transaction.state).toBe("COMMITTED");
    expect(exec.transaction.installationId).toBeTruthy();

    const detailRes = await handleMarketplaceRoutes(makeCtx("GET", `/api/agent-os/marketplace/capabilities/${slug}`));
    const detail = (await detailRes!.json()) as { installation: { state: string; enabled: boolean } | null };
    expect(detail.installation?.state).toBe("INSTALLED");

    const rbRes = await handleMarketplaceRoutes(makeCtx("POST", `/api/agent-os/marketplace/installations/${exec.transaction.installationId}/rollback`, { reason: "api test" }));
    const rb = (await rbRes!.json()) as { ok: boolean; transaction: { state: string } };
    expect(rb.ok).toBe(true);
    expect(rb.transaction.state).toBe("ROLLED_BACK");
  });

  it("audit endpoint exposes the append-only trail", async () => {
    const res = await handleMarketplaceRoutes(makeCtx("GET", "/api/agent-os/marketplace/audit?limit=10"));
    const body = (await res!.json()) as { ok: boolean; events: Array<{ eventType: string }> };
    expect(body.ok).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("unknown capability returns the machine-readable error code", async () => {
    const res = await handleMarketplaceRoutes(makeCtx("GET", "/api/agent-os/marketplace/capabilities/does-not-exist"));
    expect(res?.status).toBe(404);
    const body = (await res!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CAPABILITY_NOT_FOUND");
  });
});

describe("capability hub MCP registration (mission §52)", () => {
  it("registers the capability_marketplace server with read-only R0 tools", () => {
    const gateway = getMcpToolGateway();
    const allTools = gateway.listTools();
    const mkTools = allTools.filter((t) => t.name.startsWith("marketplace."));
    expect(mkTools.length).toBeGreaterThanOrEqual(5);
    expect(mkTools.some((t) => t.name === "marketplace.search")).toBe(true);
    expect(mkTools.some((t) => t.name === "marketplace.health")).toBe(true);
    expect(mkTools.some((t) => t.name === "marketplace.reconciliation")).toBe(true);
    for (const tool of mkTools) {
      if (tool.riskTier === "R0") expect(tool.mutability).toBe("read_only");
    }
  });
});
