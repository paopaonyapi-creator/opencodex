// Phase 20.27 — Production Readiness Gate (doc §57-§70, §147-§149).
//
// Evidence-backed and reproducible: every finding cites evidence or an
// explicit "verification missing" reason; LLM opinion alone can never create a
// blocker. Verdicts (clear/warning/blocked/unknown) are derived per profile
// with stable CLI exit codes.

import { createHash } from "node:crypto";
import { newCockpitId } from "./cockpit-types";
import type {
  EvidenceRecord,
  GateFinding,
  GateProfile,
  GateRun,
  GateSeverity,
  GateVerdict,
  ProviderState,
  ReleaseMark,
} from "./cockpit-types";

/** TTLs for runtime proof (doc §78): provider health and probes expire. */
const EVIDENCE_TTL_MS: Partial<Record<EvidenceRecord["type"], number>> = {
  provider_verification: 24 * 60 * 60 * 1000,
  runtime_probe: 60 * 60 * 1000,
};

export function evidenceHash(payload: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function isEvidenceExpired(record: EvidenceRecord, now = Date.now()): boolean {
  const ttl = EVIDENCE_TTL_MS[record.type];
  if (!ttl) return false;
  return new Date(record.createdAt).getTime() + ttl < now;
}

interface RuleContext {
  evidence: EvidenceRecord[];
  providers: ProviderState[];
  gitDirty: boolean;
  knownGood: ReleaseMark | null;
  policyFilesChangedByAgent: boolean;
}

interface ReadinessRule {
  id: string;
  version: number;
  applies: (ctx: RuleContext) => boolean;
  evaluate: (ctx: RuleContext) => Array<{ severity: GateSeverity; title: string; evidence: GateFinding["evidence"]; suggestedActions: string[] }>;
}

const RULES: ReadinessRule[] = [
  {
    id: "tests.evidence-fresh",
    version: 1,
    applies: () => true,
    evaluate: (ctx) => {
      const testEvidence = ctx.evidence.filter((e) => e.type === "test_result" && !isEvidenceExpired(e));
      if (testEvidence.length === 0) {
        return [{
          severity: "warning",
          title: "No fresh test evidence; production claim would be unverified",
          evidence: [{ type: "verification_missing", summary: "no test_result evidence recorded for this context" }],
          suggestedActions: ["run the test suite and record evidence", "attach CI test results"],
        }];
      }
      const failed = testEvidence.filter((e) => e.summary.includes("failed"));
      if (failed.length > 0) {
        return [{
          severity: "blocker",
          title: "Test evidence records failures",
          evidence: failed.map((e) => ({ type: "test_result" as const, ref: e.id, summary: e.summary })),
          suggestedActions: ["fix failing tests", "re-run and re-record evidence"],
        }];
      }
      return [];
    },
  },
  {
    id: "provider.verification",
    version: 1,
    applies: (ctx) => ctx.providers.some((p) => p.status !== "not_detected"),
    evaluate: (ctx) => {
      const findings: Array<{ severity: GateSeverity; title: string; evidence: GateFinding["evidence"]; suggestedActions: string[] }> = [];
      for (const provider of ctx.providers) {
        if (provider.status === "configured" || provider.status === "verification_required") {
          findings.push({
            severity: "warning",
            title: `Provider ${provider.name} is configured but not runtime-verified (repo evidence is not runtime proof)`,
            evidence: [{ type: "verification_missing", summary: provider.detectionEvidence }],
            suggestedActions: [`run provider verification for ${provider.id}`],
          });
        }
        if (provider.status === "failed" || provider.status === "degraded") {
          findings.push({
            severity: "blocker",
            title: `Provider ${provider.name} reports ${provider.status}`,
            evidence: [{ type: "provider_verification", ref: provider.id, summary: provider.detectionEvidence }],
            suggestedActions: [`re-verify ${provider.id}`, "check credentials/quotas"],
          });
        }
      }
      return findings;
    },
  },
  {
    id: "git.clean-state",
    version: 1,
    applies: () => true,
    evaluate: (ctx) => {
      if (!ctx.gitDirty) return [];
      return [{
        severity: "warning",
        title: "Working tree has uncommitted changes; release comparison is approximate",
        evidence: [{ type: "git_diff", summary: "uncommitted changes present" }],
        suggestedActions: ["commit or stash changes", "re-run the gate on a clean tree"],
      }];
    },
  },
  {
    id: "secrets.exposure",
    version: 1,
    applies: () => true,
    evaluate: (ctx) => {
      const leaks = ctx.evidence.filter((e) => e.type === "config_check" && e.summary.includes("secret-exposure"));
      if (leaks.length === 0) return [];
      return [{
        severity: "critical",
        title: "Secret exposure finding is open",
        evidence: leaks.map((e) => ({ type: "config_check" as const, ref: e.id, summary: e.summary })),
        suggestedActions: ["revoke and rotate the exposed secret", "remove it from tracked files"],
      }];
    },
  },
  {
    id: "migrations.destructive-pending",
    version: 1,
    applies: () => true,
    evaluate: (ctx) => {
      const pending = ctx.evidence.filter((e) => e.type === "schema_check" && e.summary.includes("destructive") && e.summary.includes("unapproved"));
      if (pending.length === 0) return [];
      return [{
        severity: "blocker",
        title: "Destructive schema migration pending without approval",
        evidence: pending.map((e) => ({ type: "schema_check" as const, ref: e.id, summary: e.summary })),
        suggestedActions: ["obtain explicit approval", "verify backup and rollback path"],
      }];
    },
  },
  {
    id: "policy.tamper",
    version: 1,
    applies: () => true,
    evaluate: (ctx) => {
      if (!ctx.policyFilesChangedByAgent) return [];
      return [{
        severity: "critical",
        title: "Policy/gate artifacts were modified by an agent — enhanced review required",
        evidence: [{ type: "git_diff", summary: "policy/gate file changed in an agent-authored commit" }],
        suggestedActions: ["human review of the policy diff", "revert unauthorized policy changes"],
      }];
    },
  },
];

export interface GateInput {
  profile: GateProfile;
  evidence: EvidenceRecord[];
  providers: ProviderState[];
  gitDirty: boolean;
  policyFilesChangedByAgent: boolean;
  gitSha?: string;
}

/**
 * Profile semantics (doc §64): dev tolerates warnings; pull_request blocks on
 * critical only; production blocks on blockers; strict additionally refuses
 * when required runtime proof is missing/expired.
 */
export function calculateVerdict(profile: GateProfile, findings: GateFinding[], overridden: Set<string>, input: GateInput): { verdict: GateVerdict; exitCode: GateRun["exitCode"] } {
  const effective = findings.filter((f) => f.status === "open" && !overridden.has(f.id));
  const has = (severity: GateSeverity): boolean => effective.some((f) => f.severity === severity);

  switch (profile) {
    case "dev":
    case "pre_commit":
      if (has("critical")) return { verdict: "blocked", exitCode: 1 };
      if (effective.length > 0) return { verdict: "warning", exitCode: 0 };
      return { verdict: "clear", exitCode: 0 };
    case "pull_request":
    case "staging":
      if (has("critical")) return { verdict: "blocked", exitCode: 1 };
      if (has("blocker")) return { verdict: "warning", exitCode: 0 };
      if (effective.length > 0) return { verdict: "warning", exitCode: 0 };
      return { verdict: "clear", exitCode: 0 };
    case "production":
      if (has("critical") || has("blocker")) return { verdict: "blocked", exitCode: 1 };
      if (effective.length > 0) return { verdict: "warning", exitCode: 0 };
      return { verdict: "clear", exitCode: 0 };
    case "strict_production": {
      if (has("critical") || has("blocker")) return { verdict: "blocked", exitCode: 1 };
      const missingProof = input.evidence.some((e) => isEvidenceExpired(e));
      if (missingProof) return { verdict: "blocked", exitCode: 1 };
      // Strict requires FRESH test evidence: "tests probably passed" is not proof.
      const hasFreshTests = input.evidence.some((e) => e.type === "test_result" && !isEvidenceExpired(e) && !e.summary.includes("failed"));
      if (!hasFreshTests) return { verdict: "blocked", exitCode: 1 };
      const unverified = input.providers.some((p) => p.status === "configured" || p.status === "verification_required");
      if (unverified) return { verdict: "blocked", exitCode: 1 };
      if (effective.length > 0) return { verdict: "warning", exitCode: 0 };
      return { verdict: "clear", exitCode: 0 };
    }
    default:
      return { verdict: "unknown", exitCode: 3 };
  }
}

export function runGateEngine(input: GateInput): GateRun {
  const ctx: RuleContext = {
    evidence: input.evidence,
    providers: input.providers,
    gitDirty: input.gitDirty,
    knownGood: null,
    policyFilesChangedByAgent: input.policyFilesChangedByAgent,
  };
  const now = new Date().toISOString();
  const findings: GateFinding[] = [];
  for (const rule of RULES) {
    if (!rule.applies(ctx)) continue;
    for (const result of rule.evaluate(ctx)) {
      findings.push({
        id: newCockpitId("gfind"),
        ruleId: rule.id + "@v" + rule.version,
        severity: result.severity,
        title: result.title,
        status: "open",
        evidence: result.evidence,
        suggestedActions: result.suggestedActions,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }
  const overridden = new Set<string>();
  const { verdict, exitCode } = calculateVerdict(input.profile, findings, overridden, input);
  return {
    id: newCockpitId("grun"),
    profile: input.profile,
    verdict,
    exitCode,
    findings,
    gitSha: input.gitSha,
    overriddenFindingIds: [],
    createdAt: now,
  };
}
