// Phase 20.29 — Workflow compiler: permission manifest, risk score,
// approval requirement, immutable execution plan (doc §7-§10).

import type {
  PermissionManifestEntry,
  ParsedWorkflow,
  CompiledWorkflow,
  WorkflowRisk,
  WorkflowPermissions,
} from "./types";

const EFFECT_CEILING_ORDER: Record<string, number> = { deny: 0, read: 1, allowlist: 2, named: 2, allow: 3, write: 3 };

/** Risk contribution per permission domain/mode (doc §9). */
const DOMAIN_RISK: Partial<Record<keyof WorkflowPermissions, Partial<Record<string, number>>>> = {
  filesystem: { read: 5, write: 18, deny: 0 },
  shell: { deny: 0, allowlist: 35, allow: 40 },
  network: { deny: 0, allowlist: 10, allow: 18, write: 18 },
  browser: { deny: 0, read: 6, allow: 20 },
  git: { deny: 0, read: 4, allowlist: 10, allow: 18 },
  database: { deny: 0, read: 6, allow: 25 },
  secrets: { deny: 0, named: 15, allow: 30 },
  mcp: { deny: 0, allowlist: 8, allow: 15 },
  external_api: { deny: 0, allowlist: 10, allow: 20 },
  notifications: { deny: 0, allow: 8 },
};

const HIGH_RISK_DOMAINS = new Set(["shell", "database", "secrets", "external_api"]);

export function compileWorkflow(parsed: ParsedWorkflow): CompiledWorkflow {
  const permissions = parsed.frontMatter.permissions;
  const manifest: PermissionManifestEntry[] = [];
  let riskScore = 0;
  let touchesShell = false;
  let touchesWrite = false;
  let touchesExternal = false;

  for (const [domain, config] of Object.entries(permissions) as Array<[keyof WorkflowPermissions, WorkflowPermissions[keyof WorkflowPermissions]]>) {
    if (!config) continue;
    const mode = config.mode;
    const detail = "commands" in config && Array.isArray(config.commands)
      ? config.commands.join(", ")
      : "paths" in config && Array.isArray(config.paths)
        ? config.paths.join(", ")
        : "domains" in config && Array.isArray(config.domains)
          ? config.domains.join(", ")
          : "names" in config && Array.isArray(config.names)
            ? config.names.join(", ")
            : "servers" in config && Array.isArray(config.servers)
              ? config.servers.join(", ")
              : undefined;
    manifest.push({ domain, mode, detail });

    const domainRisk = DOMAIN_RISK[domain]?.[mode] ?? (mode === "deny" ? 0 : 8);
    riskScore += domainRisk;
    if (domain === "shell" && mode !== "deny") touchesShell = true;
    if (domain === "filesystem" && (mode === "write" || mode === "allow")) touchesWrite = true;
    if (domain === "external_api" && mode !== "deny") touchesExternal = true;
  }

  riskScore = Math.min(100, riskScore);
  const riskLevel: WorkflowRisk = riskScore >= 60 ? "CRITICAL" : riskScore >= 35 ? "HIGH" : riskScore >= 15 ? "MEDIUM" : "LOW";

  const approval = parsed.frontMatter.approval ?? {};
  const requiresApproval =
    riskLevel === "CRITICAL"
    || riskLevel === "HIGH"
    || (approval.before_write === true && touchesWrite)
    || (approval.before_shell === true && touchesShell)
    || (approval.before_external_action === true && touchesExternal);

  const warnings: string[] = [];
  if (touchesShell) warnings.push("workflow uses shell permissions; shell steps are governed and deny-by-default");
  const permissionRecord = permissions as unknown as Record<string, { mode?: string } | undefined>;
  for (const domain of ["shell", "database", "secrets", "external_api"]) {
    const entry = permissionRecord[domain];
    if (entry?.mode && entry.mode !== "deny") {
      warnings.push("workflow touches high-risk permission domain: " + domain);
    }
  }

  return {
    workflowId: parsed.frontMatter.id,
    version: parsed.frontMatter.version,
    name: parsed.frontMatter.name,
    steps: parsed.steps.map((title, index) => ({ index: index + 1, title, advisory: true })),
    permissions: manifest,
    riskScore,
    riskLevel,
    requiresApproval,
    checksum: parsed.checksum,
    warnings,
  };
}
