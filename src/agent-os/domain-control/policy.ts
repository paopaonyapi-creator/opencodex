// Phase 20.15 — Domain Control Plane: allowlist, hostname validation, risk tiers.
//
// Deny-by-default, in this order:
//   1. structural validity (a name that is not a hostname is never "probably fine")
//   2. explicit denylist
//   3. allowlist membership (an EMPTY allowlist allows NOTHING)
//   4. risk classification
//
// Rule 3 is deliberately the harshest of the three: Phase 20.15 section 18.1 says an
// agent must never mutate a domain that was not registered in Pao-hubPro, and the
// only fail-closed reading of that is "unconfigured means frozen".

import {
  type DnsRecordIntent,
  type DnsRecordType,
  type RiskAssessment,
  type RiskLevel,
  type ApprovalMode,
  DomainControlError,
  FIRST_RELEASE_RECORD_TYPES,
  maxRisk,
  riskRank,
} from "./types";

/** Longest legal FQDN is 253 characters; each label is at most 63. */
const MAX_FQDN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface NormalizedHostname {
  /** Lowercased, no trailing dot, no scheme, no path. */
  readonly fqdn: string;
  readonly labels: readonly string[];
  /** True when any label is a wildcard owner. */
  readonly wildcard: boolean;
}

/**
 * Validate and normalize a user- or agent-provided hostname.
 *
 * Rejects anything that is not a bare DNS name. The rejections matter as much as
 * the acceptances: a value carrying a scheme, a path, a port, a credential, or a
 * shell metacharacter is either a mistake or an attempt to redirect the request,
 * and it must never reach a provider call or a proxy configuration template.
 */
export function normalizeHostname(input: string): NormalizedHostname {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new DomainControlError("VALIDATION_FAILED", "Hostname is empty.", {
      nextAction: "supply a fully-qualified domain name",
    });
  }
  if (raw.length > MAX_FQDN_LENGTH) {
    throw new DomainControlError("VALIDATION_FAILED", `Hostname exceeds ${MAX_FQDN_LENGTH} characters.`);
  }
  // Structural rejections BEFORE any normalization, because silently "fixing" a
  // URL-shaped input is how an allowlist check gets bypassed.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new DomainControlError("VALIDATION_FAILED", "Hostname must not include a URL scheme.", {
      nextAction: "pass a bare hostname, not a URL",
    });
  }
  if (/[\s/\\?#@]/.test(raw)) {
    throw new DomainControlError(
      "VALIDATION_FAILED",
      "Hostname contains a path, separator, or credential delimiter.",
      { nextAction: "pass a bare hostname" },
    );
  }
  if (/[^A-Za-z0-9.*_-]/.test(raw)) {
    throw new DomainControlError("VALIDATION_FAILED", "Hostname contains unsupported characters.");
  }
  const fqdn = raw.replace(/\.$/, "").toLowerCase();
  if (fqdn.length > MAX_FQDN_LENGTH) {
    throw new DomainControlError("VALIDATION_FAILED", `Hostname exceeds ${MAX_FQDN_LENGTH} characters.`);
  }
  const labels = fqdn.split(".");
  if (labels.length < 2) {
    throw new DomainControlError("VALIDATION_FAILED", "Hostname must have at least two labels.", {
      nextAction: "supply a fully-qualified domain name",
    });
  }
  let wildcard = false;
  for (const label of labels) {
    if (label === "*") {
      wildcard = true;
      continue;
    }
    if (label.length === 0) {
      throw new DomainControlError("VALIDATION_FAILED", "Hostname contains an empty label.");
    }
    if (label.length > MAX_LABEL_LENGTH) {
      throw new DomainControlError("VALIDATION_FAILED", `Hostname label exceeds ${MAX_LABEL_LENGTH} characters.`);
    }
    if (!LABEL_PATTERN.test(label)) {
      throw new DomainControlError("VALIDATION_FAILED", `Invalid hostname label: ${label}`);
    }
  }
  return { fqdn, labels, wildcard };
}

/**
 * The registrable zone (eTLD+1 style, two labels) a hostname belongs to.
 *
 * Deliberately naive — it does NOT consult the public suffix list. For an
 * allowlist boundary, over-estimating the zone is the safe direction: "a.b.co.uk"
 * reduces to "co.uk", which then has to be allowlisted explicitly, so a
 * mis-derived zone can only make the allowlist STRICTER, never looser.
 */
export function zoneOf(hostname: string): string {
  const { labels } = normalizeHostname(hostname);
  return labels.slice(-2).join(".");
}

/** True when "name" equals "zone" or is a subdomain of it. Boundary-aware. */
export function isWithinZone(name: string, zone: string): boolean {
  const n = name.toLowerCase().replace(/\.$/, "");
  const z = zone.toLowerCase().replace(/\.$/, "");
  return n === z || n.endsWith(`.${z}`);
}

export interface AllowlistDecision {
  readonly allowed: boolean;
  readonly zone: string;
  readonly matchedAllowEntry?: string;
  readonly matchedDenyEntry?: string;
  readonly reason: string;
}

/**
 * Decide whether a hostname may be acted on at all.
 *
 * Resolution is per-zone against the configured entries, so an allowlist entry of
 * "example.com" admits "www.example.com" but never "notexample.com" (the
 * boundary-aware match is what prevents the suffix-confusion bug).
 */
export function checkAllowlist(
  hostname: string,
  allowlist: readonly string[],
  denylist: readonly string[] = [],
): AllowlistDecision {
  const { fqdn } = normalizeHostname(hostname);
  const zone = zoneOf(fqdn);

  const deny = denylist.find((entry) => isWithinZone(fqdn, entry));
  if (deny) {
    return {
      allowed: false,
      zone,
      matchedDenyEntry: deny,
      reason: `Hostname ${fqdn} is explicitly denied by entry "${deny}".`,
    };
  }
  const allow = allowlist.find((entry) => isWithinZone(fqdn, entry));
  if (!allow) {
    return {
      allowed: false,
      zone,
      reason:
        allowlist.length === 0
          ? "Domain allowlist is empty; no domain may be mutated until one is configured."
          : `Hostname ${fqdn} is not covered by any allowlist entry.`,
    };
  }
  return {
    allowed: true,
    zone,
    matchedAllowEntry: allow,
    reason: `Hostname ${fqdn} is covered by allowlist entry "${allow}".`,
  };
}

/** Throwing form used on the mutation path. */
export function assertAllowed(
  hostname: string,
  allowlist: readonly string[],
  denylist: readonly string[] = [],
): AllowlistDecision {
  const decision = checkAllowlist(hostname, allowlist, denylist);
  if (!decision.allowed) {
    throw new DomainControlError("DOMAIN_NOT_ALLOWED", decision.reason, {
      nextAction: "add the zone to DOMAIN_CONTROL_ALLOWLIST if this is intended",
      detail: { hostname, zone: decision.zone, matchedDenyEntry: decision.matchedDenyEntry },
    });
  }
  return decision;
}

/**
 * Hostnames that carry a known mail, delegation, or ingress meaning. Mutating one
 * can take mail, the whole zone, or every subdomain offline, so they always
 * require a human decision regardless of record type or environment.
 */
export const PROTECTED_HOSTNAMES: readonly string[] = [
  "@",
  "www",
  "mail",
  "smtp",
  "imap",
  "pop",
  "mx",
  "_dmarc",
  "_domainkey",
  "caa",
];

const PROTECTED_HOSTNAME_SET = new Set(PROTECTED_HOSTNAMES);

/** SPF/DKIM/DMARC selectors and other mail-authentication TXT owners. */
const MAIL_AUTH_TXT_PREFIXES = ["_dmarc", "v=spf1", "dkim", "selector", "_domainkey", "default._domainkey"];

export interface RiskInput {
  readonly intent: DnsRecordIntent;
  /** Absolute hostname, e.g. "www.example.com" or "example.com" for apex. */
  readonly hostname: string;
  /** True when the zone is production (config or registry). */
  readonly production: boolean;
  /** True when this is the apex/root owner name. */
  readonly apex: boolean;
  /**
   * The mutation kind. Explicit rather than inferred: inferring "delete" from a
   * missing content field is how a malformed update payload silently becomes a
   * deletion, which is the exact failure this classification exists to catch.
   */
  readonly operation: "create" | "update" | "delete";
}

/**
 * Classify a single intended record mutation.
 *
 * Returns a level, an approval posture, and the STABLE RULE IDS that fired. Tests
 * assert on rule ids so that adding a rule cannot silently absorb another rule's
 * case, and so a reviewer can see exactly why an operation was escalated.
 */
export function classifyRecordRisk(input: RiskInput): RiskAssessment {
  const rules: string[] = [];
  const reasons: string[] = [];
  let level: RiskLevel = "low";

  const bump = (to: RiskLevel, rule: string, why: string): void => {
    rules.push(rule);
    reasons.push(why);
    level = maxRisk(level, to);
  };

  const { intent, hostname, production, apex, operation } = input;
  const relativeName = intent.name.toLowerCase().replace(/\.$/, "");

  if (intent.type === "NS") {
    bump("critical", "record.ns", "NS changes alter delegation for the entire zone.");
  }
  if (intent.type === "MX") {
    bump("critical", "record.mx", "MX changes can stop all inbound mail for the domain.");
  }
  if (relativeName === "@" || apex) {
    bump("critical", "hostname.apex", "Apex/root changes affect every service on the zone at once.");
  }
  if (relativeName.includes("*")) {
    bump("critical", "hostname.wildcard", "Wildcard records affect all unmatched subdomains.");
  }
  if (PROTECTED_HOSTNAME_SET.has(relativeName)) {
    bump("high", "hostname.protected", `"${relativeName}" is a protected service hostname.`);
  }

  const contentLower = intent.content.toLowerCase();
  const mailAuthTxt =
    intent.type === "TXT" &&
    (MAIL_AUTH_TXT_PREFIXES.some((prefix) => contentLower.includes(prefix)) ||
      contentLower.includes("v=dmarc") ||
      relativeName.startsWith("_dmarc"));
  if (mailAuthTxt) {
    bump("high", "record.mail_auth", "SPF/DKIM/DMARC records govern mail deliverability and spoofing.");
  }
  if (intent.type === "CAA") {
    bump("high", "record.caa", "CAA changes can block certificate issuance.");
  }

  if (!FIRST_RELEASE_RECORD_TYPES.includes(intent.type)) {
    bump(
      "high",
      "record.out_of_scope_type",
      `Record type ${intent.type} is outside the autonomously mutable set for this release.`,
    );
  }

  // Deletions are always escalated: a delete that loses a mail or verification
  // record is not recoverable from the diff alone.
  if (operation === "delete") {
    bump("critical", "mutation.delete", "Deleting a DNS record is not reversible from state alone.");
  } else if (operation === "update") {
    bump("medium", "mutation.update", "Updating an existing record changes live resolution.");
  } else {
    bump("medium", "mutation.create", "Creating a record publishes new resolution data.");
  }

  if (production) {
    bump("high", "environment.production", "Target zone is marked production.");
  }

  // Compared by rank rather than by literal equality: the level is raised inside
  // the bump closure above, and control-flow narrowing cannot see closure writes,
  // so a direct comparison here would be narrowed to the initial "low" and the
  // critical branch would become unreachable.
  const approvalMode: ApprovalMode =
    riskRank(level) >= riskRank("critical") ? "MANUAL_CRITICAL" : "MANUAL_MUTATION";
  return {
    level,
    approvalMode,
    requiresApproval: true,
    reasons,
    matchedRules: rules,
  };
}

/** Reads are always free; this exists so callers share one vocabulary. */
export function readOnlyAssessment(): RiskAssessment {
  return {
    level: "low",
    approvalMode: "AUTO_READ",
    requiresApproval: false,
    reasons: ["Read-only operation."],
    matchedRules: ["read.auto"],
  };
}

export function isAutonomouslyMutable(type: DnsRecordType): boolean {
  return FIRST_RELEASE_RECORD_TYPES.includes(type);
}
