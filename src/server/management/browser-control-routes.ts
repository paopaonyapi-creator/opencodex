// Phase 20.101 — Pao-hubPro Universal AI Browser Control Plane routes (/api/agent-os/browser-control/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { UniversalBrowserRouter, PersonaVault } from "../../agent-os/browser-control";

const router = new UniversalBrowserRouter();
const personaVault = new PersonaVault();

export async function handleBrowserControlRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;

  if (pathname !== "/api/agent-os/browser-control" && !pathname.startsWith("/api/agent-os/browser-control/")) {
    return null;
  }

  if (req.method === "GET" && pathname === "/api/agent-os/browser-control/fleet") {
    const fleet = await router.registry.getFleetHealth();
    return jsonResponse({ ok: true, fleet }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/agent-os/browser-control/lease") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const result = await router.leaseBrowser({
        workloadType: (body.workloadType as never) ?? "general",
        sensitivity: (body.sensitivity as never) ?? "low",
        personaId: body.personaId ? String(body.personaId) : undefined,
      });
      return jsonResponse({ ok: true, lease: result.lease, routing: result.routing }, 201, req, {});
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400, req, {});
    }
  }

  if (req.method === "GET" && pathname === "/api/agent-os/browser-control/personas") {
    const personas = personaVault.listPersonas();
    return jsonResponse({ ok: true, count: personas.length, personas }, 200, req, {});
  }

  if (req.method === "POST" && pathname === "/api/agent-os/browser-control/personas") {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const persona = personaVault.createPersona({
        name: String(body.name || "Custom Persona"),
        owner: String(body.owner || "operator"),
        locale: body.locale ? String(body.locale) : undefined,
      });
      return jsonResponse({ ok: true, persona }, 201, req, {});
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400, req, {});
    }
  }

  return jsonResponse({ error: "Not found" }, 404, req, {});
}
