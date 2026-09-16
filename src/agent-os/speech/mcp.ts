// Phase 20.32 — minimal MCP client for the documented VoiceStudio tool surface
// (doc §2, §6). Only the upstream-documented tools are ever called:
// generate_speech, clone_voice, transcribe, list_voices, list_languages,
// check_health. MCP access is configuration-gated behind Pao-hubPro — it is
// never exposed to untrusted callers and file output mode is mandatory.

import { SpeechError } from "./errors";
import { authHeadersShape } from "./redact";

const MCP_TOOLS = [
  "generate_speech",
  "clone_voice",
  "transcribe",
  "list_voices",
  "list_languages",
  "check_health",
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

export function documentedMcpTools(): readonly string[] {
  return MCP_TOOLS;
}

export interface McpCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

function mcpUrl(): string {
  return (process.env.VOICESTUDIO_MCP_URL || "http://127.0.0.1:3900/mcp").replace(/\/+$/, "");
}

/** Extracts the JSON payload from either a plain JSON-RPC response or an
 *  SSE-framed one (data: lines). */
function parseMcpPayload(raw: string, contentType: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("data:")) candidates.push(line.slice(5).trim());
    }
  } else {
    candidates.push(raw);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function unwrapToolResult(payload: Record<string, unknown>): unknown {
  const result = payload.result;
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as Record<string, unknown>;
    if (typeof first.text === "string") {
      try {
        return JSON.parse(first.text);
      } catch {
        return first.text;
      }
    }
  }
  return record;
}

export async function callMcpTool(tool: McpToolName, args: Record<string, unknown> = {}): Promise<McpCallResult> {
  if (!MCP_TOOLS.includes(tool)) {
    return { ok: false, error: `Tool '${tool}' is not part of the documented VoiceStudio MCP surface` };
  }
  if (process.env.FEATURE_SPEECH_MCP === "false") {
    return { ok: false, error: "MCP integration is disabled by flag" };
  }
  let res: Response;
  try {
    res = await fetch(mcpUrl(), {
      method: "POST",
      headers: { ...authHeadersShape(), Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, error: "VoiceStudio MCP endpoint is unreachable" };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "VoiceStudio MCP rejected the configured credentials" };
  }
  if (!res.ok) return { ok: false, error: `VoiceStudio MCP returned HTTP ${res.status}` };
  const raw = await res.text();
  const payload = parseMcpPayload(raw, res.headers.get("content-type") || "");
  if (!payload) return { ok: false, error: "VoiceStudio MCP returned an unreadable response" };
  if (payload.error) {
    const err = payload.error as Record<string, unknown>;
    return { ok: false, error: typeof err.message === "string" ? err.message : "VoiceStudio MCP tool call failed" };
  }
  return { ok: true, data: unwrapToolResult(payload) };
}

/** Defensive extraction of voice entries from a list_voices result. Never
 *  invents entries: unrecognized shapes yield an empty list. */
export function extractVoiceEntries(data: unknown): Array<{ profileId: string; name: string; language?: string }> {
  const entries: Array<{ profileId: string; name: string; language?: string }> = [];
  const pushFrom = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const profileId = record.profile_id ?? record.voice_id ?? record.id;
    const name = record.name ?? record.display_name ?? record.voice_name;
    if (typeof profileId === "string" && profileId && typeof name === "string" && name) {
      const language = record.language ?? record.lang ?? record.locale;
      entries.push({
        profileId,
        name,
        language: typeof language === "string" ? language : undefined,
      });
    }
  };
  if (Array.isArray(data)) {
    for (const item of data) pushFrom(item);
  } else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const list = record.voices ?? record.data ?? record.items;
    if (Array.isArray(list)) for (const item of list) pushFrom(item);
  }
  return entries;
}

export function assertMcpFileMode(): void {
  const requested = process.env.OMNIVOICE_MCP_OUTPUT_MODE || "files";
  if (requested !== "files") {
    throw new SpeechError(
      "SPEECH_POLICY_BLOCKED",
      "MCP output mode 'files' is mandatory for production agents; blob/base64 output modes are refused (doc §6.2)",
    );
  }
}
