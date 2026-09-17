// ocx gateway / pao gateway — Phase 20.85 OmniRoute Model Gateway CLI
// Capability-aware model routing, hard budget governance, circuits, and local-only execution.

import {
  CliUsageError,
  printData,
  rejectArgs,
  runCliAction,
  takeFlag,
  takeOption,
  type RuntimeApiDeps,
} from "./runtime-api";
import { getModelGateway } from "../agent-os/model-gateway/gateway";

export const USAGE = `Usage:
  ocx gateway status [--json]
  ocx gateway routes [--json]
  ocx gateway models [--json]
  ocx gateway circuits [--reset <provider>] [--json]`;

async function runModelRouterCommand(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const args = [...argv];
  const subcommand = args[0] && !args[0].startsWith("-") ? args.shift()! : "status";
  const json = takeFlag(args, "--json");
  const gateway = getModelGateway();

  if (subcommand === "status") {
    rejectArgs(args, USAGE);
    const health = await gateway.health();

    printData(health, json, [
      "--- Pao-hubPro Model Gateway (Phase 20.85) ---",
      "Status:            " + health.status.toUpperCase(),
      "Active Adapter:    " + health.activeAdapter,
      "OmniRoute Link:    " + (health.omnirouteConnected ? "Connected" : "Disconnected (Direct Fallback)"),
      "Open Circuits:     " + String(health.openCircuitsCount),
      "Total Routes:      " + String(gateway.registry.listRouteGroups().length),
      "Approved Models:   " + String(gateway.registry.listModels().length),
    ]);
    return;
  }

  if (subcommand === "routes") {
    rejectArgs(args, USAGE);
    const routes = gateway.registry.listRouteGroups();

    printData(routes, json, [
      "Active Route Groups (" + String(routes.length) + "):",
      ...routes.map(
        (r) =>
          "  " +
          r.routeGroup.padEnd(20) +
          " [" +
          r.policyType +
          "] -> " +
          r.candidates.join(", ") +
          (r.localOnly ? " (Strict Local)" : "") +
          (r.maxBudgetUsd ? " (Cap: $" + r.maxBudgetUsd.toFixed(2) + ")" : ""),
      ),
    ]);
    return;
  }

  if (subcommand === "models") {
    rejectArgs(args, USAGE);
    const models = gateway.registry.listModels();

    printData(models, json, [
      "Approved Model Catalog (" + String(models.length) + "):",
      ...models.map(
        (m) =>
          "  " +
          m.id.padEnd(30) +
          " family:" +
          m.modelFamily.padEnd(10) +
          (m.isLocal ? "[LOCAL] " : "[CLOUD] ") +
          "ctx:" +
          String(m.contextWindow).padStart(7) +
          " | " +
          (m.isLocal
            ? "Free"
            : "$" + m.pricing.inputPerMillion + "/$" + m.pricing.outputPerMillion + " per 1M"),
      ),
    ]);
    return;
  }

  if (subcommand === "circuits") {
    const resetProvider = takeOption(args, "--reset");
    rejectArgs(args, USAGE);

    if (resetProvider) {
      const resetState = gateway.circuitBreaker.manualReset(resetProvider, "Manual CLI reset");
      printData(resetState, json, [
        "Reset circuit breaker for provider " + resetProvider + ". State is now CLOSED.",
      ]);
      return;
    }

    const circuits = gateway.circuitBreaker.listCircuits();
    printData(circuits, json, [
      "Provider Circuit Breakers (" + String(circuits.length) + "):",
      ...circuits.map(
        (c) =>
          "  " +
          c.provider.padEnd(15) +
          " [" +
          c.state.toUpperCase() +
          "] Failures: " +
          String(c.failureCount) +
          (c.lastReason ? " | " + c.lastReason : ""),
      ),
    ]);
    return;
  }

  throw new CliUsageError("Unknown gateway subcommand: " + subcommand + "\n\n" + USAGE);
}

export async function handleModelRouter(argv: string[], deps: RuntimeApiDeps = {}): Promise<number> {
  return runCliAction(() => runModelRouterCommand(argv, deps));
}
