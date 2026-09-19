// Phase 20.94 — coding adapter capability probes.
// Sandbox fallback stays available and is labeled explicitly.

import { CodexCockpitAdapter } from "../coding-cockpit/providers-codex";
import { collectRawFindings } from "../code-review/engine";
import { parseUnifiedDiff } from "../code-review/diff-parser";
import { getSensorimotorService } from "../sensorimotor/service";
import type { RuntimeState } from "./models";

export interface AdapterProbe {
  id: "codex" | "aft" | "opencodereview" | "sandbox";
  state: RuntimeState;
  detail: string;
}

export function probeCodingAdapters(): AdapterProbe[] {
  return [probeCodex(), probeAft(), probeOpenCodeReview(), {
    id: "sandbox",
    state: "AVAILABLE",
    detail: "deterministic sandbox runtime; never inherits host secrets",
  }];
}

export function selectCodingRuntime(probes = probeCodingAdapters()): { active: AdapterProbe; fallback: boolean } {
  const sandbox = probes.find((p) => p.id === "sandbox")!;
  const preferred = probes.find((p) => p.id === "codex" && p.state === "AVAILABLE");
  if (preferred) return { active: preferred, fallback: false };
  return { active: { ...sandbox, state: "FALLBACK" }, fallback: true };
}

export function reviewWithOpenCodeReview(diff: string): { state: RuntimeState; findings: Array<{ severity: "info" | "warning" | "error"; message: string }> } {
  const probe = probeOpenCodeReview();
  if (probe.state !== "AVAILABLE") {
    return { state: probe.state === "ERROR" ? "ERROR" : "FALLBACK", findings: heuristicReview(diff) };
  }
  try {
    const files = parseUnifiedDiff(diff.startsWith("diff") || diff.startsWith("---") ? diff : "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n" + diff);
    const raw = collectRawFindings(files);
    const findings = raw.slice(0, 20).map((f) => ({
      severity: mapSeverity(f.checker.severity),
      message: f.checker.title + ": " + f.text.slice(0, 160),
    }));
    if (findings.length === 0) findings.push({ severity: "info", message: "OpenCodeReview: no rule findings" });
    return { state: "AVAILABLE", findings };
  } catch (err) {
    return { state: "ERROR", findings: [{ severity: "warning", message: "OpenCodeReview failed: " + (err instanceof Error ? err.message : "error") }, ...heuristicReview(diff)] };
  }
}

function probeCodex(): AdapterProbe {
  try {
    // probe() is async; use the sync available path via a throwaway adapter.
    const adapter = new CodexCockpitAdapter();
    const caps = adapter.getCapabilities();
    if (caps.chat) return { id: "codex", state: "AVAILABLE", detail: "Codex CLI + native runtime enabled" };
    return { id: "codex", state: "UNCONFIGURED", detail: "Codex CLI not detected or native runtime disabled" };
  } catch (err) {
    return { id: "codex", state: "ERROR", detail: err instanceof Error ? err.message : "codex probe failed" };
  }
}

function probeAft(): AdapterProbe {
  try {
    const health = getSensorimotorService().health();
    if (health.ok) return { id: "aft", state: "AVAILABLE", detail: "AFT sensorimotor runtime healthy" };
    return { id: "aft", state: "DEGRADED", detail: "AFT health.ok=false" };
  } catch (err) {
    return { id: "aft", state: "UNCONFIGURED", detail: err instanceof Error ? err.message : "AFT unavailable" };
  }
}

function probeOpenCodeReview(): AdapterProbe {
  try {
    collectRawFindings([]);
    return { id: "opencodereview", state: "AVAILABLE", detail: "OpenCodeReview engine loaded" };
  } catch (err) {
    return { id: "opencodereview", state: "ERROR", detail: err instanceof Error ? err.message : "review engine failed" };
  }
}

export function heuristicReview(diff: string): Array<{ severity: "info" | "warning" | "error"; message: string }> {
  return heuristicReviewInner(diff);
}

function mapSeverity(severity: string): "info" | "warning" | "error" {
  if (severity === "HIGH" || severity === "CRITICAL") return "error";
  if (severity === "MEDIUM") return "warning";
  return "info";
}

function heuristicReviewInner(diff: string): Array<{ severity: "info" | "warning" | "error"; message: string }> {
  const findings: Array<{ severity: "info" | "warning" | "error"; message: string }> = [];
  if (/sk-[A-Za-z0-9]{8,}|ghp_|BEGIN PRIVATE KEY/.test(diff)) {
    findings.push({ severity: "error", message: "diff appears to contain a secret" });
  }
  if (/\.\.[/\\]/.test(diff)) {
    findings.push({ severity: "error", message: "path traversal pattern in diff" });
  }
  if (findings.length === 0) findings.push({ severity: "info", message: "sandbox heuristic review: no blocking findings" });
  return findings;
}
