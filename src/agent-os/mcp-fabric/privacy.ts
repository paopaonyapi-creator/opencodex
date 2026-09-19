import { createHash } from "node:crypto";
import { MCP_FABRIC_FLAGS } from "./flags";
import type { DataClass, PrivacyAction, RiskLevel } from "./types";
import { McpFabricError, SECRET_FIELD, redactSecrets } from "./types";
import { riskRank } from "./classify";

const SENSITIVE_KEYS = /^(password|passwd|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|ssn|pan|card|cvv|iban|account_number|private_key|encryption_key)$/i;
const EMAIL_KEY = /email/i;
const PII_KEY = /^(phone|mobile|address|dob|date_of_birth|national_id)$/i;

export interface PrivacyRule {
  field: string;
  action: PrivacyAction;
  classification: DataClass;
}

export interface PrivacyResult {
  visible: unknown;
  rawHeld: boolean;
  actions: Array<{ path: string; action: PrivacyAction; classification: DataClass }>;
  fallbackToRaw: false | true;
}

function hashValue(v: unknown): string {
  return "sha256:" + createHash("sha256").update(String(v)).digest("hex").slice(0, 16);
}

function classifyKey(key: string): { action: PrivacyAction; classification: DataClass } | null {
  if (SECRET_FIELD.test(key) || /^(headers|_meta|connectorPrivate|connector_private|__proto__|constructor|prototype)$/i.test(key)) return { action: "drop", classification: "CREDENTIAL" };
  if (SENSITIVE_KEYS.test(key)) return { action: "drop", classification: key.toLowerCase().includes("card") || key.toLowerCase().includes("iban") ? "FINANCIAL" : "CREDENTIAL" };
  if (EMAIL_KEY.test(key)) return { action: "mask", classification: "PII" };
  if (PII_KEY.test(key)) return { action: "mask", classification: "PII" };
  return null;
}

function mask(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes("@")) {
    const [u, d] = s.split("@");
    return (u?.slice(0, 1) ?? "*") + "***@" + (d ?? "");
  }
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "***" + s.slice(-2);
}

function walk(value: unknown, path: string, actions: PrivacyResult["actions"]): unknown {
  if (Array.isArray(value)) return value.map((v, i) => walk(v, path + "[" + i + "]", actions));
  if (typeof value === "string") return redactSecrets(value);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const rule = classifyKey(k);
    const childPath = path ? path + "." + k : k;
    if (!rule) {
      out[k] = walk(v, childPath, actions);
      continue;
    }
    actions.push({ path: childPath, action: rule.action, classification: rule.classification });
    if (rule.action === "drop" || rule.action === "deny") continue;
    if (rule.action === "hash") { out[k] = hashValue(v); continue; }
    if (rule.action === "placeholder") { out[k] = "[REDACTED]"; continue; }
    if (rule.action === "mask") { out[k] = mask(v); continue; }
    out[k] = walk(v, childPath, actions);
  }
  return out;
}

export function shapeResponse(input: { risk: RiskLevel; payload: unknown; fallbackToRaw?: boolean }): PrivacyResult {
  const failClosed = MCP_FABRIC_FLAGS.sensitiveFailClosed() && riskRank(input.risk) >= 2;
  const fallbackToRaw = failClosed ? false : Boolean(input.fallbackToRaw);
  try {
    if (Buffer.byteLength(JSON.stringify(input.payload) ?? "") > 1_048_576) throw new McpFabricError("PRIVACY_FAIL_CLOSED", 502, "Response size limit exceeded");
    const actions: PrivacyResult["actions"] = [];
    const visible = walk(input.payload, "", actions);
    const blob = redactSecrets(JSON.stringify(visible));
    if (/Bearer \[REDACTED\]|sk-\[REDACTED\]|password.{0,4}\[REDACTED\]/i.test(blob) === false && /sk-[A-Za-z0-9]{8,}|Bearer [A-Za-z0-9._]{12,}/.test(blob)) {
      throw new McpFabricError("SECRET_IN_RESPONSE", 500, "secret leak detected after shaping");
    }
    return { visible: JSON.parse(blob), rawHeld: false, actions, fallbackToRaw: false };
  } catch (err) {
    if (failClosed || !fallbackToRaw) {
      if (err instanceof McpFabricError) throw err;
      throw new McpFabricError("PRIVACY_FAIL_CLOSED", 500, "privacy transformation failed; raw upstream response withheld");
    }
    return { visible: { error: "privacy_failed_raw_withheld" }, rawHeld: false, actions: [], fallbackToRaw: false };
  }
}

export function scanPromptInjection(text: string): boolean {
  return /ignore (all )?(previous|prior) instructions|system prompt|you are now|sudo mode|jailbreak/i.test(text);
}
