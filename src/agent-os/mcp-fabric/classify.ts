import { createHash } from "node:crypto";
import type { DataClass, NormalizedTool, RiskLevel, SideEffect } from "./types";

const WRITE_HINTS = /\b(create|insert|update|patch|put|post|upsert|write|set|save|send|submit|publish)\b/i;
const DELETE_HINTS = /\b(delete|remove|drop|destroy|truncate|purge|revoke|kill)\b/i;
const FINANCIAL_HINTS = /\b(payment|invoice|charge|refund|transfer|payout|wire|purchase|order)\b/i;
const SECURITY_HINTS = /\b(password|secret|token|credential|permission|grant|iam|firewall|ssh)\b/i;
const PII_HINTS = /\b(email|phone|ssn|address|dob|name|customer|employee)\b/i;

export function canonicalName(connector: string, domain: string, action: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "x";
  return slug(connector) + "." + slug(domain) + "." + slug(action);
}

export function classifyOperation(input: {
  name: string;
  method?: string;
  path?: string;
  description?: string;
  upstreamDestructiveHint?: boolean;
}): { risk: RiskLevel; sideEffect: SideEffect; destructiveHint: boolean; dataClasses: DataClass[] } {
  const blob = [input.name, input.method, input.path, input.description].join(" ");
  const method = (input.method ?? "GET").toUpperCase();
  const dataClasses: DataClass[] = [];
  if (PII_HINTS.test(blob)) dataClasses.push("PII");
  if (FINANCIAL_HINTS.test(blob)) dataClasses.push("FINANCIAL");
  if (SECURITY_HINTS.test(blob)) dataClasses.push("SECURITY", "CREDENTIAL");
  if (dataClasses.length === 0) dataClasses.push(method === "GET" ? "PUBLIC" : "INTERNAL");

  let sideEffect: SideEffect = "read";
  let risk: RiskLevel = "R0";
  const destructive = Boolean(input.upstreamDestructiveHint) || DELETE_HINTS.test(blob) || method === "DELETE";
  if (destructive) {
    sideEffect = FINANCIAL_HINTS.test(blob) ? "financial" : SECURITY_HINTS.test(blob) ? "security" : "delete";
    risk = "R4";
  } else if (method === "POST" || method === "PUT" || method === "PATCH" || WRITE_HINTS.test(blob)) {
    sideEffect = method === "POST" || /create/i.test(blob) ? "create" : "update";
    risk = FINANCIAL_HINTS.test(blob) || SECURITY_HINTS.test(blob) ? "R4" : "R3";
  } else if (dataClasses.includes("PII") || dataClasses.includes("FINANCIAL") || dataClasses.includes("CREDENTIAL")) {
    risk = "R2";
  } else if (/internal|workspace|private/i.test(blob)) {
    risk = "R1";
  }
  // Pao classification always overrides weaker upstream annotations.
  if (input.upstreamDestructiveHint === false && destructive) {
    risk = "R4";
  }
  return { risk, sideEffect, destructiveHint: destructive || risk === "R4", dataClasses };
}

export function schemaHash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function riskRank(risk: RiskLevel): number {
  return { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 }[risk];
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

export function toNormalizedTool(input: {
  connector: string;
  domain: string;
  action: string;
  upstreamName: string;
  description: string;
  method?: string;
  path?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  upstreamDestructiveHint?: boolean;
  credentialRef?: string;
}): NormalizedTool {
  const cls = classifyOperation({
    name: input.upstreamName,
    method: input.method,
    path: input.path,
    description: input.description,
    upstreamDestructiveHint: input.upstreamDestructiveHint,
  });
  return {
    canonicalName: canonicalName(input.connector, input.domain, input.action),
    upstreamName: input.upstreamName,
    description: input.description,
    method: input.method,
    path: input.path,
    inputSchema: input.inputSchema ?? { type: "object", additionalProperties: true },
    outputSchema: input.outputSchema ?? { type: "object" },
    risk: cls.risk,
    sideEffect: cls.sideEffect,
    dataClasses: cls.dataClasses,
    destructiveHint: cls.destructiveHint,
    credentialRef: input.credentialRef,
  };
}
