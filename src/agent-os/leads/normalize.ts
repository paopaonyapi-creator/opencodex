// Phase 20.34 — normalization pipeline (spec §16). Raw evidence is never
// destroyed: callers keep the raw value in the source record and the
// normalized form here. Country-guessing is forbidden — phone E.164 is only
// applied when the query context supplies an unambiguous country.

import type { CompanyProfile, ContactPoint, ContactType, DiscoveredLead, PersonProfile } from "./types";

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return "";
  if (!value.includes("://")) value = "https://" + value;
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): { normalized: string; syntaxValid: boolean } {
  const value = raw.trim().replace(/^mailto:/i, "");
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return { normalized: value.toLowerCase(), syntaxValid: false };
  const normalized = value.slice(0, at) + "@" + value.slice(at + 1).toLowerCase();
  return { normalized, syntaxValid: EMAIL_SHAPE.test(normalized) };
}

const TH_COUNTRY_HINTS = ["thailand", "th", "ไทย", "มหาสารคาม", "กรุงเทพ", "เชียงใหม่"];

/** E.164 only when the context proves the country; otherwise raw-normalized
 *  digits with a confidence penalty applied by the caller (spec §16.3). */
export function normalizePhone(raw: string, country?: string): { normalized: string; e164Applied: boolean } {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return { normalized: "", e164Applied: false };
  if (digits.startsWith("+")) return { normalized: digits, e164Applied: true };
  const hint = (country || "").toLowerCase();
  const thContext = hint === "th" || hint === "thailand" || TH_COUNTRY_HINTS.some((needle) => hint.includes(needle));
  if (thContext && digits.startsWith("0") && digits.length === 10) {
    return { normalized: "+66" + digits.slice(1), e164Applied: true };
  }
  return { normalized: digits, e164Applied: false };
}

const LEGAL_SUFFIXES = /\b(ltd|limited|inc|llc|gmbh|co\.?,?\s*ltd|จำกัด|บจก\.?|บริษัท\s*จำกัด|มหาชน)\b/gi;

export function normalizeCompanyName(raw: string): { canonicalName: string; canonicalKey: string } {
  const canonicalName = raw.trim().replace(/\s+/g, " ");
  const key = canonicalName
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { canonicalName, canonicalKey: key };
}

export function normalizeLocation(raw: string): { country?: string; region?: string; city?: string } {
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { region: parts[0] };
  return { city: parts[0], region: parts[1], country: parts[2] };
}

/** Builds the dedupe composite keys (spec §17). */
export function compositeKeys(lead: DiscoveredLead): { companyKey?: string; personKey?: string; domain?: string } {
  const domain = lead.company?.domain ? normalizeDomain(lead.company.domain) : undefined;
  let companyKey: string | undefined;
  if (lead.company?.canonicalName) {
    const { canonicalKey } = normalizeCompanyName(lead.company.canonicalName);
    companyKey = [canonicalKey, domain ?? "", lead.company.city ?? lead.company.region ?? ""].join("|");
  }
  let personKey: string | undefined;
  if (lead.person?.fullName) {
    const name = lead.person.fullName.trim().toLowerCase().replace(/\s+/g, " ");
    personKey = [name, lead.person.companyDomain ?? domain ?? "", lead.person.jobTitle?.toLowerCase() ?? ""].join("|");
  }
  return { companyKey, personKey, domain };
}

export function canonicalKeyFor(lead: DiscoveredLead): string {
  const keys = compositeKeys(lead);
  return keys.companyKey ?? keys.personKey ?? keys.domain ?? (lead.person?.fullName.toLowerCase() ?? "lead");
}

/** Merges an enrichment/discovery payload into an existing lead's profiles
 *  without clobbering already-present values (first evidence wins; stronger
 *  evidence updates confidence only). */
export function mergeCompany(base: CompanyProfile | undefined, patch: Partial<CompanyProfile>): CompanyProfile {
  const merged: CompanyProfile = base ? { ...base } : { canonicalName: patch.canonicalName || "" };
  const target = merged as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "") continue;
    if (target[key] === undefined || target[key] === "") {
      target[key] = value;
    }
  }
  if (!merged.canonicalName && patch.canonicalName) merged.canonicalName = patch.canonicalName;
  return merged;
}

export function mergePerson(base: PersonProfile | undefined, patch: Partial<PersonProfile>): PersonProfile {
  return mergeCompany(base as unknown as CompanyProfile, patch as unknown as Partial<CompanyProfile>) as unknown as PersonProfile;
}

/** Dedupe contact points by type+normalizedValue, keeping the highest
 *  confidence observation (spec §10.3 duplicate filtering). */
export function mergeContactPoints(existing: ContactPoint[], incoming: ContactPoint[]): ContactPoint[] {
  const byKey = new Map<string, ContactPoint>();
  for (const point of [...existing, ...incoming]) {
    const key = point.type + ":" + point.normalizedValue;
    const current = byKey.get(key);
    if (!current || point.confidence > current.confidence) byKey.set(key, point);
  }
  return [...byKey.values()];
}

export function contactPoint(type: ContactType, rawValue: string, providerId: string, confidence: number, country?: string): ContactPoint | null {
  if (!rawValue) return null;
  if (type === "email") {
    const { normalized, syntaxValid } = normalizeEmail(rawValue);
    if (!syntaxValid) return null;
    return { type, value: rawValue, normalizedValue: normalized, sourceProviderId: providerId, confidence, verificationStatus: "unknown" };
  }
  if (type === "phone") {
    const { normalized, e164Applied } = normalizePhone(rawValue, country);
    if (!normalized) return null;
    return { type, value: rawValue, normalizedValue: normalized, sourceProviderId: providerId, confidence: e164Applied ? confidence : Math.max(0.1, confidence - 0.2), verificationStatus: "unknown" };
  }
  const domain = normalizeDomain(rawValue);
  if (!domain) return null;
  return { type, value: rawValue, normalizedValue: domain, sourceProviderId: providerId, confidence, verificationStatus: "unknown" };
}
