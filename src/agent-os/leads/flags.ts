// Phase 20.34 — feature flags (spec §49). External outreach is structurally
// OFF: there is no outreach executor in this phase at all, and the flag can
// only ever disable something that does not exist.

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export interface LeadFlags {
  intelligence: boolean;
  apifyProvider: boolean;
  aiScoring: boolean;
  export: boolean;
  externalActions: boolean;
}

export function leadFlags(): LeadFlags {
  return {
    intelligence: envFlag("FEATURE_LEAD_INTELLIGENCE", true),
    apifyProvider: envFlag("FEATURE_LEAD_APIFY_PROVIDER", false),
    aiScoring: envFlag("FEATURE_LEAD_AI_SCORING", true),
    export: envFlag("FEATURE_LEAD_EXPORT", true),
    // P2 outreach must never auto-enable (spec §3 P2 note, §22.5).
    externalActions: false,
  };
}

export function externalOutreachAutoSend(): boolean {
  // Hard-wired false: LEAD_EXTERNAL_OUTREACH_AUTO_SEND is parsed but the
  // value can never enable sending in this phase (spec §22.5).
  return false;
}
