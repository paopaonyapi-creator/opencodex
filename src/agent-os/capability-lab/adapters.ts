/**
 * Compile published capabilities into MCP / Skill / REST adapter records.
 */

import { createHash } from "node:crypto";
import type { AdapterRecord, CapabilityManifest } from "./types";

export function compileAdapters(manifest: CapabilityManifest): AdapterRecord[] {
  const mcpName = `pao.cap.${manifest.metadata.id}`;
  const mcpBody = JSON.stringify({
    name: mcpName,
    description: manifest.metadata.description,
    inputSchema: manifest.inputs,
    risk: manifest.risk.level,
    permissions: manifest.permissions,
  }, null, 2);
  const skillBody = `# ${manifest.metadata.name}\n\n${manifest.metadata.description}\n\nInvoke via ${mcpName}. Risk: ${manifest.risk.level}.\n`;
  const restBody = JSON.stringify({
    method: "POST",
    path: `/api/agent-os/capability-lab/capabilities/${encodeURIComponent(manifest.metadata.id)}/invoke`,
    input: manifest.inputs,
  }, null, 2);
  return [
    record("mcp", mcpName, mcpBody),
    record("skill", `skill:${manifest.metadata.id}`, skillBody),
    record("rest", `rest:${manifest.metadata.id}`, restBody),
  ];
}

function record(type: AdapterRecord["type"], name: string, body: string): AdapterRecord {
  return {
    type,
    name,
    enabled: true,
    sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    body,
  };
}

