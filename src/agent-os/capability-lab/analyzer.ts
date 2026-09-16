/**
 * Phase 20.56 — static Python analysis. Discovery never executes source.
 */

import type { AnalysisResult, AnalysisSignals, CandidateType, RecipeRecommendation } from "./types";
import { scoreRisk } from "./risk";

const IMPORT_RE = /(?:^|\n)\s*(?:from\s+([A-Za-z0-9_\.]+)\s+import|import\s+([A-Za-z0-9_\.]+))/g;
const SECRET_RE = /api[_-]?key|secret|password|token|authorization|sk-[A-Za-z0-9]/i;

const NETWORK_MODS = new Set(["requests", "httpx", "urllib", "aiohttp", "socket", "http.client"]);
const GUI_MODS = new Set(["tkinter", "PyQt5", "PyQt6", "wx", "pygame"]);
const DEVICE_MODS = new Set(["cv2", "sounddevice", "pyaudio", "serial", "adb"]);

export function analyzePythonSource(filePath: string, source: string): AnalysisResult {
  const imports: string[] = [];
  const re = new RegExp(IMPORT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = (match[1] || match[2] || "").split(".")[0];
    if (name) imports.push(name);
  }
  const unique = [...new Set(imports)];
  const text = source;
  const signals: AnalysisSignals = {
    imports: unique,
    filesystem: /\bopen\s*\(|pathlib|os\.path/.test(text),
    network: unique.some((m) => NETWORK_MODS.has(m)) || /urllib\.request|http\.client/.test(text),
    subprocess: /\bsubprocess\b|os\.popen/.test(text),
    shell: /os\.system|shell\s*=\s*True|powershell|cmd\.exe/.test(text),
    evalExec: /\beval\s*\(|\bexec\s*\(|compile\s*\(/.test(text),
    envRead: /os\.environ|getenv\s*\(/.test(text),
    secrets: SECRET_RE.test(text),
    gui: unique.some((m) => GUI_MODS.has(m)),
    device: unique.some((m) => DEVICE_MODS.has(m)),
    destructive: /os\.remove|shutil\.rmtree|unlink\s*\(/.test(text),
    dynamicImport: /__import__\s*\(|importlib/.test(text),
  };

  const { score, level, reasons, permissions } = scoreRisk(signals);
  const candidateType = classify(signals, unique);
  const recommendation = recommend(signals, level, candidateType);
  const entry = detectEntrypoint(text);
  return {
    filePath,
    language: "python",
    candidateType,
    entrypoint: entry,
    summary: summarize(filePath, candidateType, signals),
    signals,
    permissions,
    riskScore: score,
    riskLevel: level,
    reasons,
    recommendation,
    licenseHint: /\bMIT\b|Apache-2|GPL/.exec(text)?.[0] ?? null,
  };
}

function classify(signals: AnalysisSignals, imports: readonly string[]): CandidateType {
  if (signals.gui) return "GUI_APP";
  if (signals.device) return "DEVICE_TOOL";
  if (signals.network) return "HTTP_CLIENT";
  if (imports.includes("hashlib") || signals.filesystem) return "FILE_TOOL";
  if (/json|csv|sqlite/.test(imports.join(","))) return "DATA_PIPELINE";
  if (signals.subprocess || signals.shell) return "AUTOMATION";
  return "FUNCTION";
}

function recommend(signals: AnalysisSignals, level: AnalysisResult["riskLevel"], type: CandidateType): RecipeRecommendation {
  if (signals.evalExec || signals.shell || (signals.subprocess && signals.network && signals.secrets)) return "UNSAFE";
  if (type === "GUI_APP") return "INTERACTIVE_ONLY";
  if (type === "DEVICE_TOOL") return "DEVICE_BOUND";
  if (level === "high" || level === "critical") return "NEEDS_REFACTOR";
  return "GOOD_CANDIDATE";
}

function detectEntrypoint(source: string): string | null {
  if (/def\s+run\s*\(/.test(source)) return "run";
  if (/def\s+main\s*\(/.test(source)) return "main";
  if (/if\s+__name__\s*==\s*["']__main__["']/.test(source)) return "__main__";
  return null;
}

function summarize(filePath: string, type: CandidateType, signals: AnalysisSignals): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const flags = [
    signals.network ? "network" : null,
    signals.subprocess ? "subprocess" : null,
    signals.gui ? "gui" : null,
  ].filter(Boolean);
  return flags.length ? `${base} (${type}; ${flags.join(",")})` : `${base} (${type})`;
}

export function discoverPythonFiles(files: ReadonlyArray<{ path: string; content: string }>): AnalysisResult[] {
  return files
    .filter((f) => f.path.endsWith(".py"))
    .filter((f) => !f.path.includes("setup.py") && !/[\\/]test_/.test(f.path))
    .map((f) => analyzePythonSource(f.path, f.content));
}

