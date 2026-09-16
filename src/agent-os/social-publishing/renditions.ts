// Phase 20.60 — Capability-driven rendition engine (spec §11).
//
// One master publication becomes one destination-specific rendition per
// account. Every rule consults the account's capability snapshot — platform
// identity is never used as a proxy for capability ("capability driven, not
// hardcoded from assumptions"). Unknown capability data blocks rather than
// passes: an unknown text limit is treated as "cannot verify", not "no limit".

import { SOCIAL_PUBLISHING_POLICY_VERSION, type AccountCapabilities, type GenerateRenditionsInput, type Publication, type PublicationAsset, type Rendition, type RenditionFormat, type ValidationIssue } from "./types";
import { computeContentHash, materialState } from "./content-hash";
import type { UpsertRenditionRow } from "./store";

export interface PlannedRendition {
  accountId: string;
  platform: string;
  format: RenditionFormat;
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  assetRefs: string[];
  providerSettings: Record<string, unknown>;
  scheduledAt: string | null;
  warnings: ValidationIssue[];
  blocked: ValidationIssue[];
}

/**
 * Draft a destination rendition from the master content + the account's
 * capability snapshot. Master text is carried over verbatim (agents refine
 * via overrides); the validator enforces capability limits downstream.
 */
export function planRendition(input: {
  publication: Publication;
  account: { id: string; platform: string; openpostAccountRef: string; capabilities: AccountCapabilities };
  format?: RenditionFormat;
  override?: NonNullable<GenerateRenditionsInput["overrides"]>[string];
  assets: PublicationAsset[];
}): PlannedRendition {
  const warnings: ValidationIssue[] = [];
  const blocked: ValidationIssue[] = [];
  const caps = input.account.capabilities;

  const format = input.format ?? inferFormat(input.publication, caps);
  if (caps.known && caps.intents.length > 0 && !caps.intents.includes(format)) {
    blocked.push({ code: "capability.intent_unsupported", severity: "error", message: `account does not support the ${format} intent (supports: ${caps.intents.join(", ")})` });
  }
  if (!caps.known) {
    warnings.push({ code: "capability.unknown", severity: "warning", message: "OpenPost has not reported capability data for this provider; validation cannot verify limits" });
  }
  for (const caveat of caps.caveats) {
    warnings.push({ code: "capability.caveat", severity: "warning", message: caveat });
  }
  if (caps.requiresAppReview) {
    warnings.push({ code: "capability.provider_review", severity: "warning", message: "provider may require app review before this content can publish" });
  }

  const title = input.override?.title ?? input.publication.masterTitle;
  const caption = input.override?.caption ?? input.publication.masterCaption;
  const description = input.override?.description ?? input.publication.masterDescription;
  const hashtags = input.override?.hashtags ?? deriveHashtags(input.publication);
  const assetRefs = input.assets.map((a) => a.sha256);

  return {
    accountId: input.account.id,
    platform: input.account.platform,
    format,
    title,
    caption,
    description,
    hashtags,
    assetRefs,
    providerSettings: {},
    scheduledAt: input.publication.scheduledAt,
    warnings,
    blocked,
  };
}

function inferFormat(publication: Publication, caps: AccountCapabilities): RenditionFormat {
  const mediaTypes = new Set((publication.metadataJson["mediaTypes"] as string[] | undefined) ?? []);
  if (publication.sourceType === "video" || mediaTypes.has("video")) return "video";
  if (publication.sourceType === "image" || mediaTypes.has("image")) return "post";
  return "post";
}

function deriveHashtags(publication: Publication): string[] {
  return publication.masterTags.map((tag) => (tag.startsWith("#") ? tag : "#" + tag));
}

/**
 * Capability-driven validation of a planned or stored rendition (spec §11.3,
 * §34 "Unknown capability is not treated as supported").
 */
export function validateRendition(input: {
  rendition: Pick<Rendition, "title" | "caption" | "description" | "format" | "hashtags" | "assetRefs">;
  capabilities: AccountCapabilities;
  priorIssues: ValidationIssue[];
}): { status: "valid" | "invalid"; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [...input.priorIssues];
  const caps = input.capabilities;
  const body = (input.rendition.caption ?? "").trim();

  if (!body && input.rendition.assetRefs.length === 0) {
    issues.push({ code: "content.empty", severity: "error", message: "rendition has neither text nor media" });
  }

  if (!caps.known) {
    issues.push({ code: "capability.unknown", severity: "warning", message: "OpenPost has not reported capability data for this provider; limits cannot be verified" });
  }

  if (caps.known) {
    if (caps.textLimit !== null && body.length > caps.textLimit) {
      issues.push({ code: "content.text_limit", severity: "error", message: `caption exceeds the account text limit (${body.length} > ${caps.textLimit})`, field: "caption" });
    }
    if (caps.titleRequired && !(input.rendition.title ?? "").trim()) {
      issues.push({ code: "content.title_required", severity: "error", message: "account requires a title", field: "title" });
    }
    if (caps.descriptionRequired && !(input.rendition.description ?? "").trim()) {
      issues.push({ code: "content.description_required", severity: "error", message: "account requires a description", field: "description" });
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  return { status: errors.length > 0 ? "invalid" : "valid", issues };
}

/** Build the store row for a planned rendition, including its content hash. */
export function renditionRowFromPlan(input: {
  publicationId: string;
  plan: PlannedRendition;
  accountOpenpostRef: string;
  capabilitySnapshot: AccountCapabilities;
  capabilitySnapshotAt: string;
  renditionId: string;
  policyVersion?: string;
}): UpsertRenditionRow {
  const contentHash = computeContentHash({
    title: input.plan.title,
    caption: input.plan.caption,
    description: input.plan.description,
    hashtags: input.plan.hashtags,
    accountRef: input.accountOpenpostRef,
    platform: input.plan.platform,
    format: input.plan.format,
    mediaSha256s: input.plan.assetRefs,
    providerSettings: input.plan.providerSettings,
    scheduledAt: input.plan.scheduledAt,
    policyVersion: input.policyVersion ?? SOCIAL_PUBLISHING_POLICY_VERSION,
  });
  return {
    id: input.renditionId,
    publicationId: input.publicationId,
    accountId: input.plan.accountId,
    platform: input.plan.platform,
    format: input.plan.format,
    title: input.plan.title,
    caption: input.plan.caption,
    description: input.plan.description,
    hashtags: input.plan.hashtags,
    assetRefs: input.plan.assetRefs,
    providerSettings: input.plan.providerSettings,
    scheduledAt: input.plan.scheduledAt,
    capabilitySnapshot: input.capabilitySnapshot,
    capabilitySnapshotAt: input.capabilitySnapshotAt,
    contentHash,
  };
}
