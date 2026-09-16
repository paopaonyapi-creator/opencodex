// Phase 20.32 — speech governance policy (doc §9, §10, §11).
// Every gate here is fail-closed: a missing record behaves like an unknown
// record, and an unknown record blocks production use. Licensing is never
// inferred from "open source" (doc §10.2) — only an explicitly approved
// registry row authorizes commercial or stock use.

import { REJECTED_CONSENT_BASES } from "./types";
import type { ModelLicenseRecord, SpeechManifest, VoiceConsentRecord, VoiceProfileRecord } from "./types";

/** Same human-actor invariant as the Phase 20.27 cockpit: agents may request,
 *  only humans may resolve governance state. */
export const HUMAN_ACTOR_PATTERN = /^(operator|dashboard|user|human|owner)/i;

export function isHumanActor(actor: string): boolean {
  return HUMAN_ACTOR_PATTERN.test(actor.trim());
}

export interface PolicyVerdict {
  allowed: boolean;
  reasonCode: string | null;
  requiredAction?: string;
}

/**
 * Commercial License Guard (doc §10). `forStock` additionally requires the
 * weights to be cleared for stock resale.
 */
export function evaluateModelLicense(
  license: ModelLicenseRecord | null,
  opts: { forStock: boolean },
): PolicyVerdict {
  if (!license) {
    return {
      allowed: false,
      reasonCode: "MODEL_LICENSE_UNVERIFIED",
      requiredAction: "Register and human-review the model license before production use",
    };
  }
  if (license.status === "blocked") {
    return {
      allowed: false,
      reasonCode: "MODEL_LICENSE_UNVERIFIED",
      requiredAction: "This engine/model is blocked by license policy",
    };
  }
  if (license.status !== "approved") {
    return {
      allowed: false,
      reasonCode: "MODEL_LICENSE_UNVERIFIED",
      requiredAction: "License status must be human-approved (never inferred from open source)",
    };
  }
  if (!license.commercialUse) {
    return {
      allowed: false,
      reasonCode: "MODEL_COMMERCIAL_USE_BLOCKED",
      requiredAction: "Choose an engine/model whose weights permit commercial use",
    };
  }
  if (opts.forStock && !license.stockUse) {
    return {
      allowed: false,
      reasonCode: "MODEL_STOCK_USE_BLOCKED",
      requiredAction: "The model license does not permit Adobe Stock redistribution",
    };
  }
  return { allowed: true, reasonCode: null };
}

/** Clone request gate (doc §9.1): registered reference, verified consent,
 *  cloning scope, and a consent basis that can never be one of the rejected
 *  impersonation bases. */
export function evaluateCloneGate(input: { consent: VoiceConsentRecord | null }): PolicyVerdict {
  if (!input.consent) {
    return {
      allowed: false,
      reasonCode: "VOICE_CONSENT_REQUIRED",
      requiredAction: "Register verified consent for the reference voice before cloning",
    };
  }
  if (input.consent.revokedAt) {
    return { allowed: false, reasonCode: "VOICE_CONSENT_REVOKED", requiredAction: "Consent was revoked" };
  }
  if (input.consent.expiresAt && new Date(input.consent.expiresAt).getTime() <= Date.now()) {
    return { allowed: false, reasonCode: "VOICE_CONSENT_REVOKED", requiredAction: "Consent has expired" };
  }
  if (!input.consent.voiceCloneAllowed) {
    return { allowed: false, reasonCode: "VOICE_CLONE_NOT_ALLOWED", requiredAction: "Consent does not cover cloning" };
  }
  if (REJECTED_CONSENT_BASES.includes(input.consent.consentBasis)) {
    return {
      allowed: false,
      reasonCode: "VOICE_CLONE_NOT_ALLOWED",
      requiredAction: "Scraped, celebrity, public-figure and unlicensed third-party voices are never cloneable",
    };
  }
  return { allowed: true, reasonCode: null };
}

/**
 * Adobe Stock Safe Mode for speech (doc §11). Unknown anything blocks with a
 * specific reason; the manifest must already exist so provenance is provable.
 */
export function evaluateSpeechStockExport(input: {
  voice: VoiceProfileRecord;
  license: ModelLicenseRecord | null;
  manifest: SpeechManifest | null;
}): PolicyVerdict {
  if (!input.manifest) {
    return {
      allowed: false,
      reasonCode: "MANIFEST_MISSING",
      requiredAction: "Generate the provenance manifest before stock export",
    };
  }
  if (input.voice.impersonatesPublicFigure) {
    return {
      allowed: false,
      reasonCode: "PUBLIC_PERSON_IMPERSONATION_BLOCKED",
      requiredAction: "Public-person voice impersonation can never be stock-approved",
    };
  }
  if (input.voice.status !== "active") {
    return {
      allowed: false,
      reasonCode: "VOICE_NOT_APPROVED_FOR_STOCK",
      requiredAction: "A human must approve this voice for stock use",
    };
  }
  if (input.voice.consentStatus !== "verified") {
    return {
      allowed: false,
      reasonCode: "VOICE_CONSENT_REQUIRED",
      requiredAction: "Cloned/reference voices need verified consent",
    };
  }
  if (input.voice.commercialUseStatus !== "approved") {
    return {
      allowed: false,
      reasonCode: "VOICE_NOT_APPROVED_FOR_STOCK",
      requiredAction: "Commercial use status must be human-approved",
    };
  }
  return evaluateModelLicense(input.license, { forStock: true });
}
