import { randomUUID } from "node:crypto";
import type { AcquisitionAdapter, AcquisitionPlan, AcquisitionRequest, AdapterId } from "./types";
import { assertNoSecretsInRequest } from "./classify";
import { classifySource, primarySource } from "./classify";

export function buildPlan(req: AcquisitionRequest, adapters: AcquisitionAdapter[]): AcquisitionPlan {
  assertNoSecretsInRequest(req);
  const url = primarySource(req);
  const classified = classifySource(url);
  const requestId = req.requestId ?? "req_" + randomUUID().replace(/-/g, "").slice(0, 12);

  const healthy = adapters.filter((a) => a.id !== "unsupported");
  let selected: AdapterId = "unsupported";
  const mcp = healthy.find((a) => a.id === "omniget_mcp");
  const cli = healthy.find((a) => a.id === "omniget_cli");
  const mock = healthy.find((a) => a.id === "mock");
  const legacy = healthy.find((a) => a.id === "legacy_20_24");
  // Selection happens after probes in the service. Here we prefer MCP > CLI > mock > legacy.
  selected = (mcp?.id ?? cli?.id ?? mock?.id ?? legacy?.id ?? "unsupported") as AdapterId;

  const preferSubtitles = req.intent === "research" || req.intent === "transcribe";
  const risk = classified.authClass === "BLOCKED_OR_DRM"
    ? "blocked"
    : classified.authClass === "SESSION_REQUIRED"
      ? "high"
      : req.intent === "batch"
        ? "medium"
        : "low";

  const outputs = ["manifest.json"];
  if (req.intent === "inspect") outputs.push("inspect.json");
  if (preferSubtitles) outputs.push("subtitles.vtt");
  if (req.intent === "transcribe" || req.options?.transcribe || req.intent === "research") outputs.push("transcript.md");
  if (req.intent === "research" || req.options?.summarize) outputs.push("research.md");
  if (req.intent === "download" || req.intent === "archive" || req.options?.preserveOriginal) outputs.push("original.bin");
  if (req.intent === "gallery") outputs.push("gallery-index.json");
  if (req.intent === "document_extract") outputs.push("document.md");

  const post: string[] = [];
  if (preferSubtitles) post.push("subtitle_first");
  if (req.options?.transcribe || req.intent === "transcribe" || req.intent === "research") post.push("transcribe_local");
  if (req.intent === "research" || req.options?.summarize) post.push("research_note");
  if (req.options?.ingestKnowledge) post.push("knowledge_ingest");

  return {
    requestId,
    sourceHost: classified.host,
    sourceClass: classified.sourceClass,
    authRequirement: classified.authClass === "PUBLIC" ? "none" : classified.authClass === "SESSION_OPTIONAL" ? "optional" : classified.authClass === "SESSION_REQUIRED" ? "required" : "unknown",
    authClass: classified.authClass,
    selectedAdapter: selected,
    selectedCapability: req.intent === "research" ? "media.research" : req.intent === "transcribe" ? "media.transcribe" : "media.download",
    riskClass: risk,
    approvalsRequired: risk === "high" ? ["authenticated_retrieval"] : [],
    estimatedOutputs: outputs,
    postProcessors: post,
    knowledgePipeline: req.options?.ingestKnowledge ? "opt-in" : undefined,
    preferSubtitles,
    commercialRightsDefault: "unknown",
  };
}
