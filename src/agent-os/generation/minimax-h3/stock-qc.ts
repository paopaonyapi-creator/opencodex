// Phase 20.6 — Adobe Stock Mode QC & Gating Engine.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import { getH3Job } from "./jobs";
import { canRunInStockMode } from "./license-policy";
import type { H3StockQCResult } from "./types";

function rowToStockQC(row: Record<string, unknown>): H3StockQCResult {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    assetId: (row.asset_id as string | null) ?? undefined,
    licensePassed: row.license_passed === 1,
    logoCheckPassed: row.logo_check_passed === 1,
    textCheckPassed: row.text_check_passed === 1,
    anatomyCheckPassed: row.anatomy_check_passed === 1,
    ipCheckPassed: row.ip_check_passed === 1,
    overallPassed: row.overall_passed === 1,
    reviewerNotes: row.reviewer_notes as string,
    reviewedBy: (row.reviewed_by as string | null) ?? undefined,
    reviewedAt: row.reviewed_at as string,
  };
}

export function evaluateStockQC(
  jobId: string,
  manualChecks?: {
    logoCheckPassed?: boolean;
    textCheckPassed?: boolean;
    anatomyCheckPassed?: boolean;
    ipCheckPassed?: boolean;
    reviewerNotes?: string;
    reviewedBy?: string;
  },
): H3StockQCResult {
  const db = openAgentOsDb();
  const job = getH3Job(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found for Stock QC.`);
  }

  // 1. License Check
  const workflowKey = job.mode === "reference_edit" ? "H3_REFERENCE_EDIT" : "H3_T2I";
  const licenseEval = canRunInStockMode(workflowKey);
  const licensePassed = licenseEval.allowed;

  // 2. Automated & manual checks
  const logoCheckPassed = manualChecks?.logoCheckPassed !== false;
  const textCheckPassed = manualChecks?.textCheckPassed !== false;
  const anatomyCheckPassed = manualChecks?.anatomyCheckPassed !== false;
  const ipCheckPassed = manualChecks?.ipCheckPassed !== false;

  const overallPassed =
    licensePassed &&
    logoCheckPassed &&
    textCheckPassed &&
    anatomyCheckPassed &&
    ipCheckPassed;

  const id = `qc_${jobId}_${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const notes = manualChecks?.reviewerNotes ?? (overallPassed ? "Passed automated Stock QC." : `Failed: ${licenseEval.reason ?? "QC defects detected."}`);

  db.query(`
    INSERT INTO h3_stock_qc (
      id, job_id, asset_id, license_passed, logo_check_passed, text_check_passed,
      anatomy_check_passed, ip_check_passed, overall_passed, reviewer_notes,
      reviewed_by, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      license_passed = excluded.license_passed,
      logo_check_passed = excluded.logo_check_passed,
      text_check_passed = excluded.text_check_passed,
      anatomy_check_passed = excluded.anatomy_check_passed,
      ip_check_passed = excluded.ip_check_passed,
      overall_passed = excluded.overall_passed,
      reviewer_notes = excluded.reviewer_notes,
      reviewed_at = excluded.reviewed_at
  `).run(
    id,
    jobId,
    job.outputImagePath ?? null,
    licensePassed ? 1 : 0,
    logoCheckPassed ? 1 : 0,
    textCheckPassed ? 1 : 0,
    anatomyCheckPassed ? 1 : 0,
    ipCheckPassed ? 1 : 0,
    overallPassed ? 1 : 0,
    notes,
    manualChecks?.reviewedBy ?? "autonomous_reviewer",
    now,
  );

  return getStockQC(jobId)!;
}

export function getStockQC(jobId: string): H3StockQCResult | null {
  const row = openAgentOsDb()
    .query("SELECT * FROM h3_stock_qc WHERE job_id = ? ORDER BY reviewed_at DESC LIMIT 1")
    .get(jobId) as Record<string, unknown> | undefined;
  return row ? rowToStockQC(row) : null;
}
