// Deterministic review engine: file selection, review units, checkers,
// finding normalization, and the quality gate (Phase 20.81 blueprint
// §14-15, §19, §24, §26, §35-36).
//
// Everything here is deterministic engineering — the same diff, rules, and
// code produce the same findings and the same gate. LLM reviewers attach
// later as bounded reasoning inside review units; their findings enter the
// same normalization and gate, never a side door.

import { addedLinesWithAnchors } from "./diff-parser";
import { REVIEW_RULES, resolveRules, ruleRegistryHashInput } from "./rules";
import {
  ReviewError,
  type DiffFile,
  type GateResult,
  type ReviewFinding,
  type ReviewUnit,
  type Severity,
} from "./types";
import { createHash } from "node:crypto";

const MAX_FILES_PER_UNIT = 10;
const MAX_DIFF_LINES_PER_UNIT = 400;

export const DETERMINISTIC_ENGINE_ID = "pao-deterministic-review";

/** Group selected files into review units under the hard guards (§15). */
export function buildReviewUnits(selected: DiffFile[]): ReviewUnit[] {
  const groups = new Map<string, DiffFile[]>();
  for (const file of selected) {
    const normalized = file.path.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const groupKey = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(file);
    groups.set(groupKey, bucket);
  }

  const units: ReviewUnit[] = [];
  let unitIndex = 0;
  for (const [groupKey, groupFiles] of groups) {
    let batch: DiffFile[] = [];
    let batchLines = 0;
    const flush = () => {
      if (batch.length === 0) return;
      const rules = new Set<string>();
      let risk: "low" | "medium" | "high" = "low";
      for (const file of batch) {
        const resolved = resolveRules(file.path);
        for (const rule of resolved.rules) rules.add(rule);
        if (file.protectedPath || resolved.riskLevel === "high") risk = "high";
        else if (resolved.riskLevel === "medium" && risk === "low") risk = "medium";
      }
      unitIndex += 1;
      units.push({
        unitId: "ru_" + String(unitIndex).padStart(3, "0"),
        label: groupKey,
        files: batch.map((f) => f.path),
        risk,
        rules: [...rules],
      });
      batch = [];
      batchLines = 0;
    };
    for (const file of groupFiles) {
      const fileLines = file.addedLines + file.removedLines;
      if (batch.length >= MAX_FILES_PER_UNIT || (batchLines + fileLines > MAX_DIFF_LINES_PER_UNIT && batch.length > 0)) {
        flush();
      }
      batch.push(file);
      batchLines += fileLines;
    }
    flush();
  }
  // Hard guard: if grouping produced a unit over the guards, the fallback is
  // single-file units (§15) — the grouping above never exceeds them, but the
  // invariant is re-checked rather than assumed.
  for (const unit of units) {
    if (unit.files.length > MAX_FILES_PER_UNIT) {
      throw new ReviewError("REVIEW_UNIT_GUARD", 500, "review unit exceeded the hard file guard");
    }
  }
  return units;
}

interface CheckerDefinition {
  category: string;
  subcategory: string;
  title: string;
  severity: Severity;
  confidence: number;
  description: string;
  test: (line: string) => boolean;
}

const CHECKERS: CheckerDefinition[] = [
  {
    category: "security",
    subcategory: "private-key",
    title: "Private key material added to the repository",
    severity: "CRITICAL",
    confidence: 0.95,
    description: "An added line contains PEM private-key markers. Private keys must live in secret storage, never in source.",
    test: (line) => /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/.test(line),
  },
  {
    category: "security",
    subcategory: "credential",
    title: "Credential-shaped string added to source",
    severity: "HIGH",
    confidence: 0.9,
    description: "An added line matches a known API-key or credential token shape. Move the value into the secret broker and reference it.",
    test: (line) =>
      /\b(?:sk|ghp|github_pat|xoxb|xoxp|AKIA)[A-Za-z0-9_-]{18,}\b/.test(line) ||
      /\b(?:api[_-]?key|secret|passwd|password|token)\s*[=:]\s*["'][A-Za-z0-9/_+-]{12,}["']/i.test(line),
  },
  {
    category: "correctness",
    subcategory: "merge-conflict",
    title: "Unresolved merge conflict marker",
    severity: "MEDIUM",
    confidence: 0.95,
    description: "An added line is a merge-conflict marker, which means conflicted content was committed.",
    test: (line) => /^(?:<{7} |={7}$|>{7} )/.test(line),
  },
  {
    category: "maintainability",
    subcategory: "debugger",
    title: "Debugger statement left in code",
    severity: "LOW",
    confidence: 0.9,
    description: "An added line contains a `debugger;` statement.",
    test: (line) => /\bdebugger\s*;/.test(line),
  },
];

interface RawFinding {
  path: string;
  line: number;
  text: string;
  checker: CheckerDefinition;
}

/** Run every deterministic checker over anchored added lines. */
export function collectRawFindings(selected: DiffFile[]): RawFinding[] {
  const raw: RawFinding[] = [];
  for (const file of selected) {
    if (file.isBinary || file.status === "deleted") continue;
    for (const anchored of addedLinesWithAnchors(file)) {
      for (const checker of CHECKERS) {
        if (checker.test(anchored.text)) {
          raw.push({ path: file.path, line: anchored.line, text: anchored.text, checker });
        }
      }
    }
  }
  return raw;
}

/**
 * Normalize raw findings: line validation, dedup, and evidence attachment
 * (§26-28 reflection-lite). Deterministic findings are `verified` by
 * construction — their checker ran on the anchored line itself.
 */
export function normalizeFindings(sessionId: string, raw: RawFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const findings: ReviewFinding[] = [];
  let index = 0;
  for (const item of raw) {
    const dedupeKey = item.path + "|" + item.checker.category + "|" + item.checker.subcategory + "|" + item.text.trim();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (item.line < 1) continue; // line validation: anchors are 1-based
    index += 1;
    findings.push({
      findingId: "finding_" + String(index).padStart(4, "0"),
      sessionId,
      unitId: "",
      source: "deterministic",
      location: { path: item.path, startLine: item.line, endLine: item.line },
      category: item.checker.category,
      subcategory: item.checker.subcategory,
      severity: item.checker.severity,
      confidence: item.checker.confidence,
      title: item.checker.title,
      description: item.checker.description,
      evidence: item.text.trim().slice(0, 240),
      status: "verified",
    });
  }
  return findings;
}

/**
 * Deterministic quality gate (§36). Evaluation order is the blueprint's:
 * block → require_fix → human_approval → warn → pass. A failed review can
 * never become PASS because failures never reach this function as findings.
 *
 * Consensus rule (§33-34): `needs_context` findings are uncorroborated
 * delegated claims — they can send the change to HUMAN_APPROVAL but can
 * never harden the gate to BLOCK or REQUIRE_FIX on their own.
 */
export function evaluateGate(findings: ReviewFinding[], protectedPathChanged: boolean): GateResult {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let needsContext = 0;
  for (const finding of findings) {
    if (finding.status === "rejected" || finding.status === "duplicate") continue;
    if (finding.status === "needs_context") {
      needsContext += 1;
      continue;
    }
    if (finding.severity === "CRITICAL") counts.critical += 1;
    else if (finding.severity === "HIGH") counts.high += 1;
    else if (finding.severity === "MEDIUM") counts.medium += 1;
    else if (finding.severity === "LOW") counts.low += 1;
    else counts.info += 1;
  }
  const reasons: string[] = [];
  if (counts.critical > 0) {
    reasons.push(counts.critical + " confirmed critical finding(s)");
    return { gate: "BLOCK", counts, reasons };
  }
  if (counts.high > 0) {
    reasons.push(counts.high + " confirmed high finding(s)");
    return { gate: "REQUIRE_FIX", counts, reasons };
  }
  if (needsContext > 0) {
    reasons.push(needsContext + " uncorroborated delegated finding(s) require human review");
    return { gate: "HUMAN_APPROVAL", counts, reasons };
  }
  if (protectedPathChanged) {
    reasons.push("protected path changed; human approval required");
    return { gate: "HUMAN_APPROVAL", counts, reasons };
  }
  if (counts.medium > 0) {
    reasons.push(counts.medium + " confirmed medium finding(s)");
    return { gate: "WARN", counts, reasons };
  }
  reasons.push("no blocking findings");
  return { gate: "PASS", counts, reasons };
}

/** Required reviewer set by risk (§31): OCR-only low, council involvement high. */
export function requiredReviewers(risk: "low" | "medium" | "high"): string[] {
  if (risk === "high") return ["primary", "security"];
  if (risk === "medium") return ["primary"];
  return [];
}

export function estimateTokenBudget(selectedFileCount: number): number {
  return 4000 + selectedFileCount * 1200;
}

export function ruleRegistryHash(): string {
  return createHash("sha256").update(ruleRegistryHashInput()).digest("hex");
}

export function activeRuleIds(): string[] {
  return REVIEW_RULES.map((rule) => rule.id);
}
