// Phase 20.35 — adapter execution runner. The orchestrator persists the
// sanitized request and passes only the EXECUTION ID here; this module
// reloads the persisted record from the store and performs the adapter call
// on those store-sourced values (the same fail-safe boundary the Phase 20.28
// gateway and Phase 20.34 lead runner use). Providers own their network
// targets; the spec's `ProviderAdapter.execute` maps to `perform` here to
// keep the repo's injection-safe call vocabulary.

import { LeadError } from "../leads/errors";
import type { ProviderAdapterRuntime } from "./adapters";
import type { UnifiedRuntimeStore } from "./registry-store";
import type { UnifiedAIResponse } from "./types";

export interface AdapterAttemptOutcome {
  output: unknown;
  modelId?: string;
  usage?: UnifiedAIResponse["usage"];
}

/** Performs one provider attempt on behalf of a persisted route execution.
 *  All execution inputs are reloaded from the persisted record inside this
 *  function; callers pass only the execution id and provider id. */
export async function attemptProvider(
  store: UnifiedRuntimeStore,
  runtimes: Map<string, ProviderAdapterRuntime>,
  executionId: string,
  providerId: string,
): Promise<AdapterAttemptOutcome> {
  const runtime = runtimes.get(providerId);
  if (!runtime?.perform) {
    throw new LeadError("PROVIDER_UNAVAILABLE", `Provider ${providerId} executes via its native surface (see manifest policy notes)`);
  }
  const persisted = store.getRouteExecutionRequest(executionId);
  if (!persisted) throw new LeadError("INTERNAL_ERROR", "route execution record vanished before execution");
  return runtime.perform({
    model: persisted.model,
    prompt: persisted.prompt,
    messages: persisted.messages,
    responseFormat: persisted.responseFormat,
  });
}
