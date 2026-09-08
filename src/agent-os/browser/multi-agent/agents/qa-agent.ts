// Phase 20.13 — QA Web Agent
//
// Specialized agent persona that audits web forms, verifies field completeness,
// scans for validation error messages, captures visual proof, and renders a QA verdict.

import { openAgentOsDb } from "../../../db";
import { getBrowserBridge } from "../../bridge/browser-bridge";
import type { QACheckItem, QAEvaluation } from "../types";

export class QAWebAgent {
  /**
   * Audits the active page form and state before human approval and final submission.
   */
  public async evaluateFormState(
    missionId: string,
    stepIndex = 0,
    tabId?: string,
  ): Promise<QAEvaluation> {
    const bridge = getBrowserBridge();
    const activeTab = tabId
      ? bridge.listTabs().find((t) => t.id === tabId)
      : bridge.getActiveTab();

    if (!activeTab) {
      throw new Error("NO_ACTIVE_TAB: QA Agent cannot evaluate without an active tab.");
    }

    const snapshot = bridge.getSnapshot(activeTab.id);
    const checks: QACheckItem[] = [];
    const issues: string[] = [];

    // 1. Required Elements Check
    const hasInputs = snapshot.elements && snapshot.elements.some((el) => el.role === "textbox" || el.tag === "input");
    checks.push({
      id: "chk_inputs_exist",
      name: "Interactive Form Inputs Present",
      passed: Boolean(hasInputs),
      message: hasInputs ? "Form elements detected on page" : "No input elements found on page",
      severity: hasInputs ? "info" : "error",
    });
    if (!hasInputs) issues.push("No input elements detected on active page.");

    // 2. Value Populated Check
    const populatedInputs = snapshot.elements?.filter((el) => el.value && el.value.trim().length > 0) || [];
    const hasValues = populatedInputs.length > 0;
    checks.push({
      id: "chk_fields_populated",
      name: "Form Fields Populated",
      passed: hasValues,
      message: hasValues
        ? `${populatedInputs.length} populated field(s) detected`
        : "Form inputs are empty; metadata may not have been autofilled",
      severity: hasValues ? "info" : "warn",
    });
    if (!hasValues) issues.push("Form inputs appear empty prior to submission.");

    // 3. Error Message Scan
    const errorTerms = ["error", "invalid", "required field", "please fix", "missing information"];
    const pageText = (snapshot.rawText || snapshot.title || "").toLowerCase();
    let detectedError = false;
    for (const term of errorTerms) {
      if (pageText.includes(term)) {
        detectedError = true;
        issues.push(`Possible validation error message on page: '${term}'`);
        break;
      }
    }
    checks.push({
      id: "chk_no_form_errors",
      name: "Zero Visible Form Error Messages",
      passed: !detectedError,
      message: detectedError ? "Form error indicators found on page" : "No form error messages visible",
      severity: detectedError ? "error" : "info",
    });

    // 4. Visual Evidence Capture
    let screenshotB64: string | undefined;
    try {
      const shot = bridge.captureScreenshot(activeTab.id);
      screenshotB64 = shot.dataBase64;
    } catch {
      // ignore
    }

    // Determine Verdict
    const hasErrors = checks.some((c) => !c.passed && c.severity === "error");
    const hasWarnings = checks.some((c) => !c.passed && c.severity === "warn");
    const verdict = hasErrors ? "fail" : hasWarnings ? "warn" : "pass";

    const id = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const evaluation: QAEvaluation = {
      id,
      missionId,
      stepIndex,
      url: activeTab.url,
      screenshotB64,
      checks,
      verdict,
      issues,
      createdAt: Date.now(),
    };

    // Persist to SQLite
    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_qa_evaluations (id, mission_id, step_index, url, screenshot_b64, checks_json, verdict, issues_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evaluation.id,
      evaluation.missionId,
      evaluation.stepIndex,
      evaluation.url,
      evaluation.screenshotB64 || null,
      JSON.stringify(evaluation.checks),
      evaluation.verdict,
      JSON.stringify(evaluation.issues),
      evaluation.createdAt,
    );

    return evaluation;
  }
}

let qaWebAgentInstance: QAWebAgent | null = null;
export function getQAWebAgent(): QAWebAgent {
  if (!qaWebAgentInstance) {
    qaWebAgentInstance = new QAWebAgent();
  }
  return qaWebAgentInstance;
}
