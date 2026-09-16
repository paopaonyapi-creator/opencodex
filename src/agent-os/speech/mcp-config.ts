// Phase 20.32 — MCP integration configuration view (doc §6). File output mode
// is mandatory for production agents: audio artifacts stay on the shared
// workspace path instead of entering LLM context as base64 blobs. This module
// returns a redacted view for the dashboard and refuses non-file modes.

import { SpeechError } from "./errors";
import { documentedMcpTools } from "./mcp";
import { speechWorkspaceRoot } from "./workspace";

export interface SpeechMcpConfigView {
  enabled: boolean;
  url: string;
  outputMode: "files";
  basePath: string;
  clientIdHeader: string;
  clientIds: string[];
  documentedTools: string[];
}

export function buildSpeechMcpConfig(): SpeechMcpConfigView {
  // Hard policy: blob/base64 MCP output modes are refused (doc §6.2).
  const requested = process.env.OMNIVOICE_MCP_OUTPUT_MODE || "files";
  if (requested !== "files") {
    throw new SpeechError(
      "SPEECH_POLICY_BLOCKED",
      "MCP output mode 'files' is mandatory; blob output would leak audio into LLM context",
    );
  }
  return {
    enabled: process.env.FEATURE_SPEECH_MCP !== "false",
    url: (process.env.VOICESTUDIO_MCP_URL || "http://127.0.0.1:3900/mcp").replace(/\/+$/, ""),
    outputMode: "files",
    basePath: speechWorkspaceRoot(),
    clientIdHeader: "X-VoiceStudio-Client-Id",
    clientIds: ["pao-hubpro", "codex", "reviewer-agent", "video-agent", "stock-agent"],
    documentedTools: [...documentedMcpTools()],
  };
}
