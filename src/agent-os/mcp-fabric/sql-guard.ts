import { McpFabricError } from "./types";

const DENY_KEYWORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CREATE", "GRANT", "REVOKE",
  "REPLACE", "MERGE", "EXEC", "EXECUTE", "CALL", "ATTACH", "DETACH", "PRAGMA", "VACUUM",
  "REINDEX", "INTO", "COPY", "LOAD", "INSTALL", "UNLOAD", "BACKUP", "RESTORE",
]);

export interface SqlDecision {
  allow: boolean;
  reason: string;
  kind: "select" | "with-select" | "denied";
  statements: number;
}

function tokenizeSql(sql: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = sql;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "-" && s[i + 1] === "-") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      const q = ch;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === "\\") i++;
        i++;
      }
      i++;
      tokens.push("STRING");
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++;
      tokens.push(s.slice(i, j).toUpperCase());
      i = j;
      continue;
    }
    tokens.push(ch);
    i++;
  }
  return tokens;
}

export function classifySql(sql: string): SqlDecision {
  const tokens = tokenizeSql(sql);
  const statements = tokens.filter((t) => t === ";").length + (tokens[tokens.length - 1] === ";" ? 0 : 1);
  const significant = tokens.filter((t) => t !== ";");
  const semi = tokens.filter((t) => t === ";");
  if (semi.length > 1 || (semi.length === 1 && tokens[tokens.length - 1] !== ";")) {
    return { allow: false, reason: "multi-statement queries are denied", kind: "denied", statements };
  }
  if (significant.length === 0) return { allow: false, reason: "empty query", kind: "denied", statements: 0 };
  for (const tok of significant) {
    if (DENY_KEYWORDS.has(tok)) {
      return { allow: false, reason: "keyword denied: " + tok, kind: "denied", statements };
    }
  }
  const first = significant[0];
  if (first === "SELECT") return { allow: true, reason: "select", kind: "select", statements: 1 };
  if (first === "WITH") {
    if (!significant.includes("SELECT")) return { allow: false, reason: "WITH without SELECT", kind: "denied", statements };
    return { allow: true, reason: "with-select", kind: "with-select", statements: 1 };
  }
  return { allow: false, reason: "only SELECT/WITH SELECT are allowed on production DB connectors", kind: "denied", statements };
}

export function assertSafeSelect(sql: string): SqlDecision {
  const decision = classifySql(sql);
  if (!decision.allow) throw new McpFabricError("SQL_DENIED", 403, decision.reason, { sqlKind: decision.kind });
  return decision;
}
