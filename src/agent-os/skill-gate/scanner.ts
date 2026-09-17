// Phase 20.57 — deterministic skill scanner (spec §21, §23). Scans instruction
// text as data: it never executes content, never follows links, and never
// stores raw evidence beyond a hash. Findings feed the risk model that policy
// decisions consume; LLM analysis may only raise risk, never lower it.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RiskLevel, ScanFinding, Severity } from "./types";
import { sha256Bytes } from "./snapshot";
import { safeJoin } from "./paths";

export const SCANNER_VERSION = "sg-scan-1";

interface ScannerRule {
  ruleId: string;
  severity: Severity;
  weight: number;
  message: string;
  pattern: RegExp;
}

/**
 * Rule set derived from spec §21. Weights are the spec §23 table. Patterns are
 * matched per line so findings can carry evidence locations.
 */
export const SCANNER_RULES: ScannerRule[] = [
  { ruleId: "skill.shell.curl-pipe-sh", severity: "critical", weight: 35, message: "Remote content is piped directly into a shell", pattern: /\b(curl|wget)\b[^|\n]{0,120}\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i },
  { ruleId: "skill.shell.pipe-to-bash", severity: "high", weight: 20, message: "Content is piped into bash or a script interpreter", pattern: /\|\s*(sudo\s+)?(bash|zsh|python3?|node|pwsh|powershell)\b/i },
  { ruleId: "skill.shell.download-execute", severity: "high", weight: 30, message: "Download-and-execute pattern", pattern: /\b(Invoke-Expression|iex|Invoke-WebRequest\s+.*-UseBasicParsing.*;\s*iex|certutil\s+-urlcache|mshta\s+http|bitsadmin\s+\/transfer)\b/i },
  { ruleId: "skill.elevation.sudo", severity: "high", weight: 30, message: "Privilege elevation via sudo or runas", pattern: /\b(sudo\s+[a-z]+|runas\s+\/)/i },
  { ruleId: "skill.fs.destructive", severity: "high", weight: 30, message: "Destructive filesystem command", pattern: /(^|\s)(rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)|del\s+\/[sq]|rmdir\s+\/s|format\s+[a-z]:|mkfs|shred\s)/i },
  { ruleId: "skill.git.destructive", severity: "medium", weight: 20, message: "Force push or destructive git operation", pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+(-f|--force)|checkout\s+--\s+\.)/i },
  { ruleId: "skill.credential.access", severity: "high", weight: 20, message: "Reads credential or secret material", pattern: /(~\/?\.ssh|id_rsa|\.aws\/?credentials|\.netrc|\.npmrc|\.dockercfg|config\/?gcloud|credentials\.json|\.env\b|api[_-]?key\s*=|secret[_-]?key\s*=)/i },
  { ruleId: "skill.env.read", severity: "medium", weight: 12, message: "Reads environment variables", pattern: /\b(process\.env|os\.environ|\$ENV\{|ENV\[|getenv\s*\()/i },
  { ruleId: "skill.package.install", severity: "medium", weight: 12, message: "Installs packages or system software", pattern: /\b(npm\s+(-g\s+)?i(nstall)?|yarn\s+global\s+add|pnpm\s+add\s+-g|pip3?\s+install|gem\s+install|apt(-get)?\s+install|brew\s+install|choco\s+install|winget\s+install|dnf\s+install)\b/i },
  { ruleId: "skill.net.arbitrary-endpoint", severity: "medium", weight: 15, message: "Contacts an arbitrary network endpoint", pattern: /https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+\.[a-z]{2,}/i },
  { ruleId: "skill.net.upload", severity: "high", weight: 25, message: "Uploads local data to an external destination", pattern: /\b(curl\s+[^|\n]*(--upload-file|-d\s|(-F|--form)\s|(-T|--upload))|scp\s+\S+\s+\S+@|gsutil\s+cp|aws\s+s3\s+cp\s+\S+\s+s3:\/\/|az\s+storage\s+blob\s+upload)\b/i },
  { ruleId: "skill.mail.send", severity: "high", weight: 20, message: "Sends email or chat messages", pattern: /\b(smtp|sendmail|mail\s+-s|Send-MailMessage|curl\s+[^|\n]*--url\s+.*webhook|slack\.com\/api\/chat\.postMessage|telegram\.org\/bot.*sendMessage)\b/i },
  { ruleId: "skill.docker.socket", severity: "high", weight: 35, message: "Uses the Docker socket", pattern: /(\/var\/run\/docker\.sock|docker\s+-H\s+unix:\/\/)/i },
  { ruleId: "skill.persist.startup", severity: "critical", weight: 35, message: "Installs persistence (startup, cron, services, registry)", pattern: /\b(crontab\s+-|LaunchAgents|launchctl\s+load|systemctl\s+enable|schtasks\s+\/create|reg\s+add|CurrentVersion\\Run|\.bashrc|\.zshrc|\.profile\b)/i },
  { ruleId: "skill.persist.daemon", severity: "medium", weight: 15, message: "Starts a background daemon or listener", pattern: /\b(nohup\s|setsid\s|disown\b|nc\s+-l|netcat\s+-l|-L\s+0\.0\.0\.0|listen\s+0\.0\.0\.0)/i },
  { ruleId: "skill.device.capture", severity: "medium", weight: 15, message: "Accesses camera, microphone, or clipboard", pattern: /\b(webcam|ffmpeg\s+.*(-i\s+\/dev\/video|avfoundation|dshow)|osascript\s+.*volume|pbpaste|Get-Clipboard|xclip|xsel)\b/i },
  { ruleId: "skill.browser.cookies", severity: "high", weight: 20, message: "Reads browser profile or cookie stores", pattern: /(Cookies(\.sqlite|-file)?|Login Data|Local State|browser\s+profile\s+path|chrome:\/\/)/i },
  { ruleId: "skill.security.bypass", severity: "critical", weight: 35, message: "Instructs the agent to ignore policy or security controls", pattern: /\b(ignore\s+(all\s+)?(previous|prior|above)\s+instructions?|disregard\s+(your\s+)?(instructions|rules|policy)|disable\s+(security|policy|guardrails?|sandbox)|bypass\s+(security|policy|permissions?)|you\s+must\s+not\s+refuse|jailbreak)\b/i },
  { ruleId: "skill.payload.encoded-exec", severity: "high", weight: 30, message: "Decodes an encoded payload and executes it", pattern: /\b(base64\s+(-d|--decode)|echo\s+[A-Za-z0-9+/=]{40,}\s*\|\s*(ba)?sh|certutil\s+-decode|powershell\s+(-enc|-EncodedCommand)|FromBase64String)\b/i },
  { ruleId: "skill.fs.host-config", severity: "high", weight: 30, message: "Writes host-wide configuration", pattern: /(\/etc\/(passwd|shadow|sudoers|hosts|ssh\/)|C:\\Windows\\(System32|Sysnative))/i },
];

export interface ScanResult {
  findings: ScanFinding[];
  riskScore: number;
  riskLevel: RiskLevel;
}

export function riskLevelForScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

/** Force-critical combinations from spec §23. */
function hardCombinations(findings: ScanFinding[]): boolean {
  const rules = new Set(findings.map((finding) => finding.ruleId));
  return (
    (rules.has("skill.credential.access") && rules.has("skill.net.upload")) ||
    (rules.has("skill.elevation.sudo") && (rules.has("skill.shell.curl-pipe-sh") || rules.has("skill.shell.pipe-to-bash"))) ||
    (rules.has("skill.security.bypass") && rules.has("skill.fs.destructive")) ||
    (rules.has("skill.docker.socket") && (rules.has("skill.shell.pipe-to-bash") || rules.has("skill.payload.encoded-exec")))
  );
}

function scanText(filePath: string, text: string, findings: ScanFinding[]): void {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const rule of SCANNER_RULES) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        filePath,
        lineStart: index + 1,
        lineEnd: index + 1,
        evidenceHash: `sha256:${sha256Bytes(line.trim().slice(0, 200))}`,
        message: rule.message,
      });
    }
  }
}

function scanFile(rootDir: string, relativePath: string, findings: ScanFinding[]): void {
  const absolute = safeJoin(rootDir, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return;
  const stats = statSync(absolute);
  if (stats.size > 10_485_760) return;
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    return;
  }
  scanText(relativePath, text, findings);
}

/**
 * Scan the whole snapshot. Deterministic, read-only, evidence-located. The
 * raw matched line never leaves this module: only its hash is recorded.
 */
export function scanSkillSnapshot(snapshotDir: string, relativePaths: string[]): ScanResult {
  const findings: ScanFinding[] = [];
  const ordered = [...relativePaths].sort();
  const entryFirst = ordered.findIndex((path) => path === "SKILL.md");
  if (entryFirst > 0) {
    const [entry] = ordered.splice(entryFirst, 1);
    if (entry) ordered.unshift(entry);
  }
  for (const relativePath of ordered) {
    scanFile(snapshotDir, relativePath, findings);
  }
  let score = 0;
  const weightByRule = new Map(SCANNER_RULES.map((rule) => [rule.ruleId, rule.weight]));
  for (const finding of findings) {
    score += weightByRule.get(finding.ruleId) ?? 10;
  }
  const uniqueRules = new Set(findings.map((finding) => finding.ruleId));
  if (hardCombinations(findings) || score >= 75 || uniqueRules.has("skill.security.bypass")) {
    score = Math.max(score, 100);
  } else {
    score = Math.min(score, 100);
  }
  const level = riskLevelForScore(score);
  if (level === "critical") score = Math.max(score, 75);
  return { findings, riskScore: score, riskLevel: level };
}

export function evidenceHashFor(line: string): string {
  return `sha256:${createHash("sha256").update(line.trim().slice(0, 200)).digest("hex")}`;
}

export function scanInstructionText(text: string, filePath = "SKILL.md"): ScanFinding[] {
  const findings: ScanFinding[] = [];
  scanText(filePath, text, findings);
  return findings;
}
