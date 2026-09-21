/**
 * Phase 20.101 — MCP Browser Gateway Tools
 * Exposes universal browser capabilities as normalized MCP tools for agents.
 */

import { UniversalBrowserRouter } from "./router";
import { PersonaVault } from "./persona-vault";
import { PlaybookEngine } from "./playbook-engine";

export interface BrowserMcpTool {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createBrowserMcpTools(): BrowserMcpTool[] {
  const router = new UniversalBrowserRouter();
  const personaVault = new PersonaVault();
  const playbookEngine = new PlaybookEngine();

  return [
    {
      name: "pao.browser.status",
      description: "Get health status and capacity across the browser provider fleet (Local Chrome, Oya, Cloud).",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const fleetHealth = await router.registry.getFleetHealth();
        return { ok: true, fleetHealth };
      },
    },
    {
      name: "pao.browser.start",
      description: "Lease and start a browser session routed by policy, sensitivity, and workload requirements.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          workloadType: { type: "string", enum: ["research", "authenticated_task", "stock_upload", "general"] },
          sensitivity: { type: "string", enum: ["low", "medium", "high", "regulated"] },
          personaId: { type: "string", description: "Optional persona ID for session persistence" },
        },
        required: ["workloadType", "sensitivity"],
      },
      handler: async (args) => {
        const result = await router.leaseBrowser({
          workloadType: (args.workloadType as never) ?? "general",
          sensitivity: (args.sensitivity as never) ?? "low",
          personaId: args.personaId ? String(args.personaId) : undefined,
        });

        return {
          ok: true,
          leaseId: result.lease.leaseId,
          providerId: result.lease.providerId,
          routingReason: result.routing.reason,
          wsEndpoint: result.lease.wsEndpoint,
        };
      },
    },
    {
      name: "pao.browser.persona_list",
      description: "List persistent browser personas and their security policies.",
      riskTier: "R0",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const personas = personaVault.listPersonas().map((p) => ({
          id: p.id,
          name: p.name,
          mode: p.mode,
          locale: p.browserPreferences.locale,
          humanRequiredFor: p.policy.humanRequiredFor,
        }));
        return { ok: true, count: personas.length, personas };
      },
    },
    {
      name: "pao.browser.takeover_release",
      description: "Release human takeover lock and resume autonomous browser execution.",
      riskTier: "R1",
      parameters: {
        type: "object",
        properties: {
          takeoverId: { type: "string", description: "Takeover ID to release" },
        },
        required: ["takeoverId"],
      },
      handler: async (args) => {
        const takeoverId = String(args.takeoverId);
        const resumed = playbookEngine.releaseHumanTakeover(takeoverId);
        return { ok: resumed, takeoverId, status: resumed ? "resumed" : "not_found" };
      },
    },
  ];
}
