// Phase 20.11 — Pao-hubPro Browser Configuration & Constants

import { join } from "node:path";

export interface BrowserConfig {
  bridgeHost: string;
  bridgePort: number;
  policyPath: string;
  defaultWorkspace: string;
  maxSnapshotElements: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  downloadWaitTimeoutMs: number;
  enableKillSwitchShortcut: boolean;
  version: string;
}

export function getBrowserConfig(): BrowserConfig {
  const host = "127.0.0.1"; // Security invariant: never default to 0.0.0.0
  const port = parseInt(process.env.PAO_BROWSER_BRIDGE_PORT || "17891", 10);
  const policyPath = process.env.PAO_BROWSER_POLICY_PATH || join(process.cwd(), "config", "browser-policy.yaml");

  return {
    bridgeHost: host,
    bridgePort: isNaN(port) ? 17891 : port,
    policyPath,
    defaultWorkspace: "default",
    maxSnapshotElements: 500,
    navigationTimeoutMs: 30000,
    actionTimeoutMs: 10000,
    downloadWaitTimeoutMs: 60000,
    enableKillSwitchShortcut: true,
    version: "0.1.0",
  };
}

export const SENSITIVE_INPUT_REGEXES = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /cookie/i,
  /credential/i,
  /ssn/i,
  /card[_-]?number/i,
];
