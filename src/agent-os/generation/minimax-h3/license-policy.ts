// Phase 20.6 — 3-Tier License Governance & Commercial Policy Engine.

import { openAgentOsDb } from "../../db";
import { getModel } from "./models";
import { getWorkflow } from "./workflows";
import type { H3LicensePolicy, LicenseStatus } from "./types";

function rowToPolicy(row: Record<string, unknown>): H3LicensePolicy {
  return {
    id: row.id as string,
    targetType: row.target_type as H3LicensePolicy["targetType"],
    targetKey: row.target_key as string,
    repoCodeLicense: row.repo_code_license as string,
    modelAssetLicense: row.model_asset_license as string,
    commercialUseStatus: row.commercial_use_status as LicenseStatus,
    stockUseStatus: row.stock_use_status as LicenseStatus,
    notes: row.notes as string,
    updatedAt: row.updated_at as string,
  };
}

export function registerLicensePolicy(policy: {
  id?: string;
  targetType: H3LicensePolicy["targetType"];
  targetKey: string;
  repoCodeLicense: string;
  modelAssetLicense: string;
  commercialUseStatus: LicenseStatus;
  stockUseStatus: LicenseStatus;
  notes?: string;
}): H3LicensePolicy {
  const db = openAgentOsDb();
  const id = policy.id ?? `pol_${policy.targetType}_${policy.targetKey}`;
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO h3_license_policies (
      id, target_type, target_key, repo_code_license, model_asset_license,
      commercial_use_status, stock_use_status, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repo_code_license = excluded.repo_code_license,
      model_asset_license = excluded.model_asset_license,
      commercial_use_status = excluded.commercial_use_status,
      stock_use_status = excluded.stock_use_status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    id,
    policy.targetType,
    policy.targetKey,
    policy.repoCodeLicense,
    policy.modelAssetLicense,
    policy.commercialUseStatus,
    policy.stockUseStatus,
    policy.notes ?? "",
    now,
  );
  return getLicensePolicy(policy.targetKey)!;
}

export function getLicensePolicy(targetKey: string): H3LicensePolicy | null {
  const row = openAgentOsDb()
    .query("SELECT * FROM h3_license_policies WHERE target_key = ? OR id = ? LIMIT 1")
    .get(targetKey, targetKey) as Record<string, unknown> | undefined;
  return row ? rowToPolicy(row) : null;
}

export function evaluateLicensePolicy(input: {
  repoCodeLicense?: string;
  modelAssetLicense: string;
  officialOrCommunity?: "official" | "community";
  targetUse?: "commercial_stock" | "personal" | "lab_eval";
}): { status: LicenseStatus; reason?: string } {
  const targetUse = input.targetUse ?? "commercial_stock";
  const license = input.modelAssetLicense.toUpperCase();

  if (license.includes("NC") || license.includes("NON-COMMERCIAL") || license.includes("NONCOMMERCIAL")) {
    if (targetUse === "commercial_stock") {
      return {
        status: "DISALLOWED",
        reason: "Non-commercial license (NC) cannot be used for commercial stock export.",
      };
    }
    return { status: "ALLOWED" };
  }

  if (license.includes("APACHE") || license.includes("MIT") || license.includes("QIANWEN") || license.includes("OPENRAIL")) {
    return { status: "ALLOWED" };
  }

  return {
    status: "REVIEW_REQUIRED",
    reason: `License '${input.modelAssetLicense}' requires legal review for target use '${targetUse}'.`,
  };
}

export function canRunInStockMode(
  workflowKey: string,
  modelKeys?: string[],
): { allowed: boolean; reason?: string } {
  seedBuiltInPolicies();

  const wf = getWorkflow(workflowKey);
  if (!wf) {
    return { allowed: false, reason: `Workflow '${workflowKey}' not found in registry.` };
  }
  if (!wf.stockSafe) {
    return {
      allowed: false,
      reason: `Workflow '${workflowKey}' is experimental or not certified as stock-safe.`,
    };
  }

  const stack = modelKeys ?? wf.modelStack;
  for (const modKey of stack) {
    const mod = getModel(modKey);
    if (!mod) {
      return { allowed: false, reason: `Required model asset '${modKey}' not registered.` };
    }
    if (mod.stockUseStatus === "DISALLOWED") {
      return {
        allowed: false,
        reason: `Model '${mod.modelKey}' license (${mod.licenseName}) is strictly disallowed for Adobe Stock commercial mode.`,
      };
    }
    if (mod.stockUseStatus === "REVIEW_REQUIRED") {
      return {
        allowed: false,
        reason: `Model '${mod.modelKey}' license (${mod.licenseName}) requires manual legal review before stock export.`,
      };
    }
    if (mod.stockUseStatus === "UNKNOWN") {
      return {
        allowed: false,
        reason: `Model '${mod.modelKey}' license is UNKNOWN. Stock export blocked.`,
      };
    }
  }

  return { allowed: true };
}

export function seedBuiltInPolicies(): void {
  const db = openAgentOsDb();
  const count = (db.query("SELECT COUNT(*) as c FROM h3_license_policies").get() as { c: number }).c;
  if (count > 0) return;

  const policies: Array<Parameters<typeof registerLicensePolicy>[0]> = [
    {
      targetType: "code_repo",
      targetKey: "ComfyUI-MiniMax-H3-Image-Studio",
      repoCodeLicense: "Unlicense",
      modelAssetLicense: "Various",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      notes: "Repository code is public domain / unlicense. Models require independent evaluation.",
    },
    {
      targetType: "model_asset",
      targetKey: "minimax_h3_diffusion",
      repoCodeLicense: "Unlicense",
      modelAssetLicense: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      notes: "Official MiniMax foundation weights under Apache-2.0.",
    },
    {
      targetType: "model_asset",
      targetKey: "hybrid_single_adapter",
      repoCodeLicense: "Unlicense",
      modelAssetLicense: "CC-BY-NC-4.0",
      commercialUseStatus: "DISALLOWED",
      stockUseStatus: "DISALLOWED",
      notes: "Community experimental adapter prohibited for commercial and stock outputs.",
    },
    {
      targetType: "output_preset",
      targetKey: "STOCK_SAFE",
      repoCodeLicense: "Unlicense",
      modelAssetLicense: "Apache-2.0",
      commercialUseStatus: "ALLOWED",
      stockUseStatus: "ALLOWED",
      notes: "Stock Safe preset strictly enforces approved models and QC review.",
    },
  ];

  for (const p of policies) {
    registerLicensePolicy(p);
  }
}
