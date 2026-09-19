import { toNormalizedTool, canonicalName } from "./classify";
import type { ConnectorKind, NormalizedTool } from "./types";
import { McpFabricError } from "./types";

export interface ImportSource {
  kind: ConnectorKind;
  name: string;
  raw: string;
  credentialRef?: string;
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch {
    throw new McpFabricError("INVALID_SOURCE", 400, "source is not valid JSON");
  }
}

function domainFromPath(path: string): string {
  const parts = path.split("/").filter((p) => p && !p.startsWith("{"));
  return parts[0] ?? "resource";
}

export function normalizeOpenApi(name: string, raw: string, credentialRef?: string): NormalizedTool[] {
  const doc = parseJson(raw) as Record<string, unknown>;
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const tools: NormalizedTool[] = [];
  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== "object") continue;
    for (const method of Object.keys(ops)) {
      const op = ops[method];
      if (!op || typeof op !== "object") continue;
      const upstream = String(op.operationId ?? method + " " + path);
      const action = String(op.operationId ?? method + "_" + domainFromPath(path));
      tools.push(toNormalizedTool({
        connector: name,
        domain: domainFromPath(path),
        action,
        upstreamName: upstream,
        description: String(op.summary ?? op.description ?? upstream),
        method: method.toUpperCase(),
        path,
        inputSchema: (op.requestBody as Record<string, unknown> | undefined) ?? { type: "object" },
        credentialRef,
        upstreamDestructiveHint: method.toLowerCase() === "delete" ? false : undefined,
      }));
    }
  }
  if (tools.length === 0) throw new McpFabricError("INVALID_SOURCE", 400, "OpenAPI document contained no operations");
  return tools;
}

export function normalizePostman(name: string, raw: string, credentialRef?: string): NormalizedTool[] {
  const doc = parseJson(raw) as { item?: Array<{ name?: string; request?: { method?: string; url?: string | { raw?: string } } }> };
  const items = doc.item ?? [];
  const tools = items.map((item) => {
    const method = String(item.request?.method ?? "GET");
    const url = typeof item.request?.url === "string" ? item.request.url : String(item.request?.url?.raw ?? "/");
    const path = url.replace(/^https?:\/\/[^/]+/i, "") || "/";
    return toNormalizedTool({
      connector: name,
      domain: domainFromPath(path),
      action: String(item.name ?? method),
      upstreamName: String(item.name ?? method + " " + path),
      description: String(item.name ?? path),
      method,
      path,
      credentialRef,
    });
  });
  if (tools.length === 0) throw new McpFabricError("INVALID_SOURCE", 400, "Postman collection contained no items");
  return tools;
}

export function normalizeCurl(name: string, raw: string, credentialRef?: string): NormalizedTool[] {
  const method = /(?:-X|--request)\s+([A-Z]+)/i.exec(raw)?.[1]?.toUpperCase() ?? (/-d |--data/.test(raw) ? "POST" : "GET");
  const url = /curl\s+(?:'([^']+)'|"([^"]+)"|(\S+))/i.exec(raw);
  const href = url?.[1] ?? url?.[2] ?? url?.[3];
  if (!href) throw new McpFabricError("INVALID_SOURCE", 400, "cURL missing URL");
  let path = href;
  try { path = new URL(href).pathname; } catch { /* keep */ }
  return [toNormalizedTool({
    connector: name,
    domain: domainFromPath(path),
    action: method.toLowerCase(),
    upstreamName: method + " " + href,
    description: "Imported cURL request",
    method,
    path,
    credentialRef,
  })];
}

export function normalizeWsdl(name: string, raw: string, credentialRef?: string): NormalizedTool[] {
  const ops = [...raw.matchAll(/<wsdl:operation[^>]*name="([^"]+)"/gi), ...raw.matchAll(/<operation[^>]*name="([^"]+)"/gi)];
  const names = [...new Set(ops.map((m) => m[1]!))];
  if (names.length === 0) throw new McpFabricError("INVALID_SOURCE", 400, "WSDL contained no operations");
  return names.map((op) => toNormalizedTool({
    connector: name,
    domain: "soap",
    action: op,
    upstreamName: op,
    description: "SOAP operation " + op,
    method: /delete|remove|drop/i.test(op) ? "DELETE" : /create|add|update|set/i.test(op) ? "POST" : "GET",
    path: "/" + op,
    credentialRef,
  }));
}

export function normalizeGraphQl(name: string, raw: string, credentialRef?: string): NormalizedTool[] {
  const tools: NormalizedTool[] = [];
  const queryBlock = /type\s+Query\s*\{([^}]+)\}/i.exec(raw)?.[1] ?? "";
  const mutationBlock = /type\s+Mutation\s*\{([^}]+)\}/i.exec(raw)?.[1] ?? "";
  const fields = (block: string) => block.split(/[\n,]/).map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/.exec(line);
    return m?.[1];
  }).filter((n): n is string => Boolean(n));
  for (const field of fields(queryBlock)) {
    tools.push(toNormalizedTool({ connector: name, domain: "query", action: field, upstreamName: field, description: "GraphQL query " + field, method: "GET", path: "/graphql/" + field, credentialRef }));
  }
  for (const field of fields(mutationBlock)) {
    tools.push(toNormalizedTool({ connector: name, domain: "mutation", action: field, upstreamName: field, description: "GraphQL mutation " + field, method: "POST", path: "/graphql/" + field, credentialRef }));
  }
  if (tools.length === 0) throw new McpFabricError("INVALID_SOURCE", 400, "GraphQL schema contained no Query/Mutation fields");
  return tools;
}

export function normalizeDatabase(kind: ConnectorKind, name: string, credentialRef?: string): NormalizedTool[] {
  return [
    toNormalizedTool({ connector: name, domain: "query", action: "select", upstreamName: kind + ".select", description: "Read-only SQL select", method: "GET", path: "/sql", credentialRef, inputSchema: { type: "object", required: ["sql"], properties: { sql: { type: "string" } } } }),
  ];
}

export function normalizeMcp(name: string, raw: string, credentialRef?: string): NormalizedTool[] {
  const doc = parseJson(raw) as { tools?: Array<{ name: string; description?: string; destructiveHint?: boolean; inputSchema?: Record<string, unknown> }> };
  const list = doc.tools ?? [];
  if (list.length === 0) throw new McpFabricError("INVALID_SOURCE", 400, "MCP descriptor contained no tools");
  return list.map((t) => toNormalizedTool({
    connector: name,
    domain: t.name.split(".")[0] ?? "mcp",
    action: t.name.split(".").slice(1).join("_") || t.name,
    upstreamName: t.name,
    description: t.description ?? t.name,
    method: t.destructiveHint ? "DELETE" : /write|create|update/i.test(t.name) ? "POST" : "GET",
    path: "/mcp/" + t.name,
    inputSchema: t.inputSchema,
    upstreamDestructiveHint: t.destructiveHint === false ? false : t.destructiveHint,
    credentialRef,
  }));
}

export function normalizeSource(input: ImportSource): NormalizedTool[] {
  switch (input.kind) {
    case "openapi":
    case "swagger":
    case "anythingmcp":
      return normalizeOpenApi(input.name, input.raw, input.credentialRef);
    case "postman":
      return normalizePostman(input.name, input.raw, input.credentialRef);
    case "curl":
      return normalizeCurl(input.name, input.raw, input.credentialRef);
    case "soap":
    case "wsdl":
      return normalizeWsdl(input.name, input.raw, input.credentialRef);
    case "graphql":
      return normalizeGraphQl(input.name, input.raw, input.credentialRef);
    case "postgres":
    case "mysql":
    case "mariadb":
    case "mssql":
    case "oracle":
    case "mongodb":
    case "sqlite":
      return normalizeDatabase(input.kind, input.name, input.credentialRef);
    case "mcp":
      return normalizeMcp(input.name, input.raw, input.credentialRef);
    default:
      throw new McpFabricError("INVALID_SOURCE", 400, "unsupported connector kind");
  }
}

export { canonicalName };
