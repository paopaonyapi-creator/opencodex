#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { anythingMcpLogin, provisionJsonPlaceholderConnector } from "../../tests/helpers/anythingmcp-live";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const here = dirname(resolve(import.meta.path));
const env = { ...loadEnv(join(here, ".env")), ...process.env };
const port = env.BACKEND_PORT || "14000";
const baseUrl = (env.PAO_ANYTHINGMCP_URL || ("http://127.0.0.1:" + port)).replace(/\/+$/, "");
const email = env.PAO_ANYTHINGMCP_ADMIN_EMAIL;
const password = env.PAO_ANYTHINGMCP_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("PAO_ANYTHINGMCP_ADMIN_EMAIL and PAO_ANYTHINGMCP_ADMIN_PASSWORD are required in scripts/anythingmcp-live/.env");
  process.exit(1);
}

const health = await fetch(baseUrl + "/health");
if (!health.ok) {
  console.error("health failed HTTP " + health.status + " at " + baseUrl + "/health");
  process.exit(1);
}

const accessToken = await anythingMcpLogin(baseUrl, email, password);
const state = await provisionJsonPlaceholderConnector({ baseUrl, accessToken });
const outDir = resolve(here, "..", "..", ".tmp");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "anythingmcp-live-state.json");
writeFileSync(outFile, JSON.stringify({ ...state, provisionedAt: new Date().toISOString() }, null, 2));
console.log("AnythingMCP provisioned");
console.log("PAO_ANYTHINGMCP_URL=" + baseUrl);
console.log("connector=" + state.connectorName);
console.log("tool=" + state.toolName);
console.log("state=" + outFile);
