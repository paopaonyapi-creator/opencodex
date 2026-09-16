// Phase 20.34 — provider execution runner. The orchestrator persists a
// sanitized job and passes only the JOB ID here; this module reloads the job
// from the store and invokes the provider runtime on the persisted record.
// Network targets remain owned by the providers: fixed-host allowlist for the
// Apify data plane, Phase 20.24 SSRF validation for custom HTTP targets.

import { LeadError } from "./errors";
import type { LeadProviderRuntime } from "./providers";
import type { LeadStore } from "./store";
import type { LeadJob, SearchOutcome, EnrichmentOutcome } from "./types";

function requireRuntime(runtimes: Map<string, LeadProviderRuntime>, providerId: string): LeadProviderRuntime {
  const runtime = runtimes.get(providerId);
  if (!runtime) throw new LeadError("PROVIDER_UNAVAILABLE", `Provider runtime not registered: ${providerId}`);
  return runtime;
}

function requireQueuedSearchJob(store: LeadStore, jobId: string): LeadJob {
  const job = store.getJob(jobId);
  if (!job) throw new LeadError("NOT_FOUND", `Lead job not found: ${jobId}`);
  if (job.type !== "search") throw new LeadError("VALIDATION_ERROR", `Job ${jobId} is not a search job`);
  const providerId = job.selectedProviders[0];
  if (!providerId) throw new LeadError("PROVIDER_UNAVAILABLE", "Job has no selected provider");
  return job;
}

export async function runProviderSearch(
  store: LeadStore,
  runtimes: Map<string, LeadProviderRuntime>,
  jobId: string,
): Promise<SearchOutcome> {
  const job = requireQueuedSearchJob(store, jobId);
  const runtime = requireRuntime(runtimes, job.selectedProviders[0]!);
  if (!runtime.search) throw new LeadError("PROVIDER_UNAVAILABLE", "Selected provider cannot search");
  const storedQuery = job.request.query as import("./types").LeadQuery;
  return runtime.search({ query: storedQuery, runId: job.id });
}

export async function runProviderContactDiscovery(
  store: LeadStore,
  runtimes: Map<string, LeadProviderRuntime>,
  jobId: string,
): Promise<EnrichmentOutcome> {
  const job = store.getJob(jobId);
  if (!job) throw new LeadError("NOT_FOUND", `Lead job not found: ${jobId}`);
  const providerId = job.selectedProviders[0];
  if (!providerId) throw new LeadError("PROVIDER_UNAVAILABLE", "Job has no selected provider");
  const runtime = requireRuntime(runtimes, providerId);
  if (!runtime.findContacts) throw new LeadError("PROVIDER_UNAVAILABLE", "Selected provider cannot discover contacts");
  const domain = typeof job.request.domain === "string" ? job.request.domain : "";
  if (!domain) throw new LeadError("VALIDATION_ERROR", "Persisted job record lacks a domain");
  return runtime.findContacts({ domain, runId: job.id });
}

export async function runProviderVerification(
  runtimes: Map<string, LeadProviderRuntime>,
  providerId: string,
  input: { type: string; value: string; runId: string },
): Promise<{ verificationStatus: import("./types").VerificationStatus; confidence: number; units: number }> {
  const runtime = requireRuntime(runtimes, providerId);
  if (!runtime.verifyContact) throw new LeadError("PROVIDER_UNAVAILABLE", "Selected provider cannot verify contacts");
  return runtime.verifyContact(input);
}
