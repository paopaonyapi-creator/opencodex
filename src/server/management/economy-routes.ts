// Phase 24 — Pao Autonomous Cost & Token Economy Governor (ACEG)
// REST Management API Endpoints
// Accessible via /api/agent-os/economy/* and /api/economy/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getBudgetLedger,
  getBurnGuard,
  getModelOptimizer,
  type BudgetScope,
  type RecordTransactionInput,
  type OptimizeRouteInput,
} from "../../agent-os/economy";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleEconomyRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/agent-os/economy/")) {
    path = url.pathname.slice("/api/agent-os/economy/".length);
  } else if (url.pathname === "/api/agent-os/economy") {
    path = "";
  } else if (url.pathname.startsWith("/api/economy/")) {
    path = url.pathname.slice("/api/economy/".length);
  } else if (url.pathname === "/api/economy") {
    path = "";
  } else {
    return null;
  }

  const ledger = getBudgetLedger();
  const burnGuard = getBurnGuard();
  const optimizer = getModelOptimizer();

  // 1. /budgets endpoints
  if (path === "budgets" || path === "budgets/" || path === "") {
    if (req.method === "GET") {
      const scopeFilter = url.searchParams.get("scope") as BudgetScope | null;
      const budgets = ledger.listBudgets(scopeFilter ?? undefined);
      return jsonResponse(
        {
          budgets,
          totalSpendUsd: ledger.getTotalSpend(),
          totalSavingsUsd: ledger.getTotalSavings(),
        },
        200,
        req,
        {}
      );
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        id?: string;
        scope?: BudgetScope;
        targetId?: string;
        name?: string;
        limitUsd?: number;
        softWarningPercent?: number;
      } | null;

      if (!body?.scope || !body?.name || typeof body?.limitUsd !== "number") {
        return badRequest(req, "Missing required fields: scope, name, limitUsd");
      }

      const budget = ledger.registerBudget({
        id: body.id,
        scope: body.scope,
        targetId: body.targetId,
        name: body.name,
        limitUsd: body.limitUsd,
        softWarningPercent: body.softWarningPercent,
      });

      return jsonResponse({ budget }, 201, req, {});
    }
  }

  if (path.startsWith("budgets/")) {
    const id = decodeURIComponent(path.slice("budgets/".length));
    const budget = ledger.getBudget(id);
    if (!budget) return notFound(req, `Budget '${id}' not found`);
    return jsonResponse({ budget }, 200, req, {});
  }

  // 2. /transactions endpoints
  if (path === "transactions" || path === "transactions/") {
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const transactions = ledger.listTransactions(limit);
      return jsonResponse({ transactions }, 200, req, {});
    }
  }

  if (path === "transactions/record" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as RecordTransactionInput | null;
    if (!body?.modelId || typeof body?.inputTokens !== "number" || typeof body?.outputTokens !== "number") {
      return badRequest(req, "Missing required fields: modelId, inputTokens, outputTokens");
    }

    const tx = ledger.recordTransaction(body);
    burnGuard.recordSpend(tx.costUsd);

    const budget = ledger.getBudget(tx.budgetId);
    return jsonResponse({ transaction: tx, budget }, 201, req, {});
  }

  // 3. /burn-guard endpoints
  if (path === "burn-guard" || path === "burn-guard/") {
    if (req.method === "GET") {
      const status = burnGuard.getStatus();
      return jsonResponse({ burnGuard: status }, 200, req, {});
    }
  }

  if (path === "burn-guard/trip" && req.method === "POST") {
    burnGuard.tripCircuitBreaker();
    return jsonResponse({ message: "Circuit breaker tripped manually", burnGuard: burnGuard.getStatus() }, 200, req, {});
  }

  if (path === "burn-guard/reset" && req.method === "POST") {
    burnGuard.resetCircuitBreaker();
    return jsonResponse({ message: "Circuit breaker reset", burnGuard: burnGuard.getStatus() }, 200, req, {});
  }

  // 4. /optimize-route endpoint
  if (path === "optimize-route" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as OptimizeRouteInput | null;
    if (!body?.requestedModelId) {
      return badRequest(req, "requestedModelId is required");
    }

    const burnStatus = burnGuard.getStatus();
    const recommendation = optimizer.recommendRoute({
      requestedModelId: body.requestedModelId,
      taskType: body.taskType,
      budgetStatus: body.budgetStatus,
      safeguardAction: body.safeguardAction ?? burnStatus.safeguardAction,
    });

    return jsonResponse({ recommendation }, 200, req, {});
  }

  return notFound(req, `Unknown economy route: /${path}`);
}
