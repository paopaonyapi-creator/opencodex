// Phase 20.89 — Capability Hub MCP tools (registry-first; policy-gated).

import type { CapabilityHubService } from "./service";
import { MarketplaceError } from "./types";
import type { CapabilityType } from "./types";

export interface MarketplaceMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function errToPayload(err: unknown): Record<string, unknown> {
  if (err instanceof MarketplaceError) {
    return { ok: false, status: err.httpStatus, error: { code: err.code, message: err.message } };
  }
  return { ok: false, status: 500, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
}

export function createMarketplaceMcpTools(service: CapabilityHubService): MarketplaceMcpTool[] {
  return [
    {
      name: "marketplace.search",
      description: "Search the Pao-hubPro Capability Registry (Phase 20.89). Read-only; returns registry drafts and installed capabilities with lifecycle, trust, and policy state.",
      riskTier: "R0",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Keyword across slug/name/summary/phase id" },
          type: { type: "string", description: "Capability type filter (agent, skill, mcp-server, …)" },
          status: { type: "string", description: "Lifecycle filter (DISCOVERED, NORMALIZED, INSTALLED, HEALTHY, …)" },
        },
      },
      handler: async (args) => {
        try {
          const capabilities = service.listCapabilities({
            search: typeof args.search === "string" ? args.search : undefined,
            type: typeof args.type === "string" ? (args.type as CapabilityType) : undefined,
            status: typeof args.status === "string" ? (args.status as never) : undefined,
          });
          return {
            ok: true,
            count: capabilities.length,
            capabilities: capabilities.map((c) => ({
              slug: c.slug,
              phaseId: c.phaseId,
              name: c.name,
              type: c.type,
              status: c.status,
              trustState: c.trustState,
              riskClass: c.riskClass,
              blueprintStatus: c.blueprintStatus,
            })),
          };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "marketplace.health",
      description: "Capability Hub health: registry counts, canonical phase invariant check (no phase-id collisions after reconciliation).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          return { ...service.health(), ok: true };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "marketplace.reconciliation",
      description: "Phase registry reconciliation rows (Phase 20.61 → 20.90): canonical id, blueprint vs runtime status, registry/manifest/test/health status, migration action, blockers.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const rows = service.reconciliation();
          return { ok: true, count: rows.length, rows };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "marketplace.import_phases",
      description: "Run the Phase Importer: scan blueprint markdown (20.61 → 20.90) and upsert registry drafts. Blueprint status is recorded separately from runtime status — imported phases are never marked installed.",
      riskTier: "R2",
      parameters: { type: "object", properties: {} },
      handler: async (args) => {
        try {
          const run = service.importPhases(typeof args.actor === "string" ? args.actor.slice(0, 64) : "mcp-agent");
          return {
            ok: true,
            runId: run.runId,
            scanned: run.scanned,
            imported: run.imported,
            updated: run.updated,
            skipped: run.skipped,
            collisions: run.collisions,
          };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
    {
      name: "marketplace.plan_install",
      description: "Generate an immutable install plan for a capability. The plan records policy decision, permissions, and steps; deferred external steps are never executed silently.",
      riskTier: "R2",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: "Capability slug" } },
        required: ["slug"],
      },
      handler: async (args) => {
        try {
          const plan = service.planInstall(String(args.slug), typeof args.actor === "string" ? args.actor.slice(0, 64) : "mcp-agent");
          return {
            ok: true,
            planId: plan.planId,
            planHash: plan.planHash,
            capabilitySlug: plan.capabilitySlug,
            version: plan.version,
            policyDecision: plan.policyDecision,
            approvalRequired: plan.approvalRequired,
            permissions: plan.permissions,
            steps: plan.steps.map((s) => ({ type: s.type, status: s.status })),
          };
        } catch (err) {
          return errToPayload(err);
        }
      },
    },
  ];
}
