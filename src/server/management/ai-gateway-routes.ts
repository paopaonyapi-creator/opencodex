// Phase 20.30 — Universal AI Gateway control plane routes
// (/api/agent-os/ai-gateway/*): aliases, policies, budget, route preview.
// Execution remains in the existing opencodex proxy router (doc §59).

import { createHash } from "node:crypto";
import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { AIRouterStore, explainRoute, previewRoute, type ModelCandidate } from "../../agent-os/ai-router/router";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

let storeSingleton: AIRouterStore | null = null;

function getStore(): AIRouterStore {
  if (!storeSingleton) {
    const store = new AIRouterStore();
    store.seedDefaults();
    storeSingleton = store;
  }
  return storeSingleton;
}

/** Test seam. */
export function resetAIRouterForTests(): void {
  storeSingleton = null;
}

export async function handleAIGatewayRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const store = getStore();

  // 1. GET /api/agent-os/ai-gateway/status
  if (req.method === "GET" && pathname === "/api/agent-os/ai-gateway/status") {
    return jsonResponse({
      aliases: store.listAliases(),
      budget: store.getBudget(store.dailyPeriodKey()),
      note: "execution remains in the existing proxy router; this is the alias/policy/budget control plane",
    }, 200, req, {});
  }

  // 2. GET /api/agent-os/ai-gateway/aliases
  if (req.method === "GET" && pathname === "/api/agent-os/ai-gateway/aliases") {
    return jsonResponse({ aliases: store.listAliases() }, 200, req, {});
  }

  // 3. POST /api/agent-os/ai-gateway/aliases (create/update alias → policy mapping)
  if (req.method === "POST" && pathname === "/api/agent-os/ai-gateway/aliases") {
    const body = await readJsonBody(req);
    const alias = typeof body.alias === "string" ? body.alias : "";
    const policyId = typeof body.policyId === "string" ? body.policyId : "";
    if (!alias || !policyId) return badRequest(req, "Fields 'alias' and 'policyId' are required");
    store.saveAlias({ alias, policyId, description: typeof body.description === "string" ? body.description : undefined });
    return jsonResponse({ alias, policyId }, 201, req, {});
  }

  // 4. POST /api/agent-os/ai-gateway/route-preview (doc §34: never executes)
  if (req.method === "POST" && pathname === "/api/agent-os/ai-gateway/route-preview") {
    const body = await readJsonBody(req);
    const candidates = Array.isArray(body.candidates) ? (body.candidates as ModelCandidate[]) : [];
    if (candidates.length === 0) {
      return badRequest(req, "Field 'candidates' (ModelCandidate[]) is required — supply the proxy's current model catalog entries");
    }
    const preview = previewRoute(store, {
      alias: typeof body.alias === "string" ? body.alias : undefined,
      taskType: body.taskType as never,
      needsTools: body.needsTools === true,
      needsVision: body.needsVision === true,
      estimatedInputTokens: typeof body.estimatedInputTokens === "number" ? body.estimatedInputTokens : undefined,
      candidates,
    });
    const fingerprint = preview.selected
      ? "sha256:" + createHash("sha256").update(preview.selected.candidate.id).digest("hex").slice(0, 32)
      : undefined;
    return jsonResponse({ preview, explain: explainRoute(preview), fingerprint }, 200, req, {});
  }

  // 5. GET /api/agent-os/ai-gateway/budget
  if (req.method === "GET" && pathname === "/api/agent-os/ai-gateway/budget") {
    return jsonResponse({ budget: store.getBudget(store.dailyPeriodKey()), periodKey: store.dailyPeriodKey() }, 200, req, {});
  }

  // 6. POST /api/agent-os/ai-gateway/budget (set daily limit)
  if (req.method === "POST" && pathname === "/api/agent-os/ai-gateway/budget") {
    const body = await readJsonBody(req);
    const limitUsd = typeof body.dailyLimitUsd === "number" ? body.dailyLimitUsd : -1;
    if (limitUsd < 0) return badRequest(req, "Field 'dailyLimitUsd' must be a non-negative number");
    store.setBudget(store.dailyPeriodKey(), limitUsd);
    return jsonResponse({ budget: store.getBudget(store.dailyPeriodKey()) }, 200, req, {});
  }

  // 7. GET /api/agent-os/ai-gateway/audit (route events)
  if (req.method === "GET" && pathname === "/api/agent-os/ai-gateway/audit") {
    return jsonResponse({ events: store.listRouteEvents(Number(url.searchParams.get("limit") || 50)) }, 200, req, {});
  }

  return null;
}
