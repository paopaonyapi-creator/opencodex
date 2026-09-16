// Phase 20.25 — Registry ingestion (doc §9, §10, §60).
//
// Sources are: existing Agent OS subsystems (agents, skills, MCP tools, Codex
// runtime, models, browser tools) and curated external catalog metadata.
// External catalog entries are DATA ONLY (metadata_only, never executable):
// no code is fetched or run from external repositories during ingestion.

import { openAgentOsDb } from "../db";
import { listAgents } from "../registry";
import { listSkills } from "../skills";
import { McpToolProvider } from "../orchestration/mcp-tool-provider";
import { ToolPolicyEngine } from "../orchestration/tool-policy";
import { extractCapabilities } from "./taxonomy";
import type { IngestedToolInput, RegistryRiskLevel } from "./types";
import type { UniversalRegistryStore } from "./registry-store";
import { slugify } from "./util";

const policy = new ToolPolicyEngine();

function riskFor(toolName: string): RegistryRiskLevel {
  const level = policy.classifyTool(toolName, {});
  return { R0: 0, R1: 0, R2: 1, R3: 3, R4: 4 }[level] as RegistryRiskLevel;
}

/** Known MCP builtin tool → executor/capability mapping (safe-subset execution). */
const MCP_BUILTIN_CAPABILITIES: Record<string, { capabilities: string[]; executor?: string }> = {
  read_file: { capabilities: ["filesystem.read"], executor: "local_file_read" },
  write_file: { capabilities: ["filesystem.write"] },
  run_shell_command: { capabilities: ["shell.execute"] },
  fetch_web_data: { capabilities: ["web.search", "research.extract"], executor: "http_get" },
};

function ingestMcpTools(store: UniversalRegistryStore): number {
  const provider = new McpToolProvider();
  const tools = provider.listTools("untrusted_external");
  let count = 0;
  for (const tool of tools) {
    const mapping = MCP_BUILTIN_CAPABILITIES[tool.name];
    const capabilities = mapping?.capabilities ?? extractCapabilities(`${tool.name} ${tool.description}`);
    const riskLevel = riskFor(tool.name);
    store.upsertTool({
      id: `mcp:${tool.serverName}:${tool.name}`,
      name: tool.name,
      provider: tool.serverName,
      type: "mcp_server",
      description: tool.description,
      capabilities,
      runtime: { execution: "local", protocol: "mcp", executor: mapping?.executor },
      riskLevel,
      executable: Boolean(mapping?.executor),
      source: { kind: "mcp", ownerModule: "agent-os/orchestration" },
      tags: ["mcp", tool.serverName],
    });
    count += 1;
  }
  return count;
}

function ingestAgents(store: UniversalRegistryStore): number {
  let count = 0;
  for (const agent of listAgents()) {
    store.upsertTool({
      id: `agent_os:${agent.id}`,
      name: agent.name,
      provider: agent.provider,
      type: "agent",
      description: `Agent OS ${agent.type} agent (${agent.provider})`,
      capabilities: ["agent.execute", "llm.reason"],
      runtime: { execution: "local", protocol: "agent-os" },
      riskLevel: 0,
      executable: false,
      source: { kind: "agent_os", ownerModule: "agent-os/registry" },
      tags: ["agent", agent.type],
    });
    count += 1;
  }
  return count;
}

function ingestSkills(store: UniversalRegistryStore): number {
  let count = 0;
  for (const skill of listSkills()) {
    if (skill.status === "deprecated") continue;
    store.upsertTool({
      id: `skill:${skill.id}`,
      name: skill.name,
      provider: "agent-os",
      type: "local_tool",
      description: skill.description || `Agent OS skill ${skill.name}`,
      capabilities: extractCapabilities(`${skill.name} ${skill.description}`),
      runtime: { execution: "local", protocol: "skill" },
      riskLevel: 1,
      executable: false,
      source: { kind: "skill", ownerModule: "agent-os/skills" },
      tags: ["skill"],
    });
    count += 1;
  }
  return count;
}

function ingestCodexRuntime(store: UniversalRegistryStore): number {
  try {
    const db = openAgentOsDb();
    const table = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_runtime_capabilities'")
      .get() as { name: string } | undefined;
    if (!table) return 0;
    const rows = db
      .query(`
        SELECT c.id, c.exec_server_available, c.mcp_available, c.remote_control_available, n.name AS node_name
        FROM codex_runtime_capabilities c
        LEFT JOIN codex_runtime_nodes n ON n.id = c.node_id
        WHERE c.codex_installed = 1
      `)
      .all() as Array<{ id: string; exec_server_available: number; mcp_available: number; remote_control_available: number; node_name: string | null }>;
    let count = 0;
    for (const row of rows) {
      const capabilities = ["code.generate", "code.review", "repo.inspect"];
      if (row.exec_server_available === 1) capabilities.push("code.execute", "test.run");
      if (row.mcp_available === 1) capabilities.push("code.modify", "migration.generate");
      store.upsertTool({
        id: `codex:${row.id}`,
        name: `Codex ${row.node_name ?? row.id}`,
        provider: "codex",
        type: "codex_tool",
        description: "OpenAI Codex native runtime specialist capabilities",
        capabilities,
        runtime: { execution: "local", protocol: "codex" },
        riskLevel: 1,
        executable: false,
        source: { kind: "codex", ownerModule: "agent-os/codex-runtime" },
        tags: ["codex"],
      });
      count += 1;
    }
    return count;
  } catch {
    // The Codex runtime is an optional subsystem; a broken or missing table
    // must never take down registry sync.
    return 0;
  }
}

function ingestModels(store: UniversalRegistryStore): number {
  const db = openAgentOsDb();
  const table = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gen_models'")
    .get() as { name: string } | undefined;
  let count = 0;
  if (table) {
    const rows = db
      .query("SELECT id, display_name, family, provider, enabled FROM gen_models WHERE enabled = 1")
      .all() as Array<{ id: string; display_name: string; family: string; provider: string }>;
    for (const row of rows) {
      store.upsertTool({
        id: `model:${row.id}`,
        name: row.display_name,
        provider: row.provider,
        type: "image_generator",
        description: `${row.family} generation model managed by the AI Generation Studio`,
        capabilities: ["image.generate"],
        runtime: { execution: "local", protocol: "gen-studio" },
        riskLevel: 0,
        executable: false,
        source: { kind: "model", ownerModule: "agent-os (gen_models)" },
        tags: ["model", row.family],
      });
      count += 1;
    }
  }
  // The orchestration model router is always registered: it is how every LLM
  // capability is served without duplicating provider facts into this registry.
  store.upsertTool({
    id: "model:orchestration-router",
    name: "Pao Model Router",
    provider: "orchestration",
    type: "ai_model",
    description: "Routes LLM tasks (reasoning, code, review, translation) to the configured primary/fallback models",
    capabilities: ["llm.reason", "llm.code", "llm.review", "llm.translate"],
    runtime: { execution: "local", protocol: "orchestration" },
    riskLevel: 0,
    executable: true,
    source: { kind: "model", ownerModule: "agent-os/orchestration/model-router" },
    tags: ["model", "router"],
  });
  return count + 1;
}

const BROWSER_TOOLS: Array<{ name: string; capability: string; risk: RegistryRiskLevel; description: string }> = [
  { name: "browser.navigate", capability: "browser.navigate", risk: 0, description: "Navigate the Pao-hubPro browser to a URL" },
  { name: "browser.click", capability: "browser.click", risk: 2, description: "Click a page element in the managed browser" },
  { name: "browser.type", capability: "browser.type", risk: 2, description: "Type text into the managed browser" },
  { name: "browser.fill", capability: "browser.fill", risk: 2, description: "Fill a form field in the managed browser" },
  { name: "browser.download", capability: "browser.download", risk: 1, description: "Download a file through the managed browser" },
  { name: "browser.screenshot", capability: "browser.screenshot", risk: 0, description: "Capture a screenshot of the managed browser" },
  { name: "browser.extract", capability: "browser.extract", risk: 0, description: "Extract page content from the managed browser" },
];

function ingestBrowserTools(store: UniversalRegistryStore): number {
  let count = 0;
  for (const tool of BROWSER_TOOLS) {
    store.upsertTool({
      id: `browser:${tool.name}`,
      name: tool.name,
      provider: "pao-browser",
      type: "browser_tool",
      description: tool.description,
      capabilities: [tool.capability],
      runtime: { execution: "local", protocol: "browser" },
      riskLevel: tool.risk,
      executable: false,
      source: { kind: "browser", ownerModule: "agent-os/browser" },
      tags: ["browser"],
    });
    count += 1;
  }
  return count;
}

/**
 * Curated external catalog metadata (doc §60: external repositories are DATA,
 * never executable). Entries carry the upstream repository for provenance and
 * an env-var reference for auth — never a secret value.
 */
export const CATALOG_SEEDS: IngestedToolInput[] = [
  { name: "Google Search SERP", provider: "apify", type: "scraper", description: "Google SERP scraping actor", capabilities: ["web.search", "search.google" as string], source: { kind: "catalog", repository: "cporter202/API-mega-list" }, auth: { type: "env", ref: "APIFY_API_TOKEN" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["search", "serp", "apify"] },
  { name: "TikTok Scraper", provider: "apify", type: "scraper", description: "TikTok video metadata and trend scraping actor", capabilities: ["social.tiktok", "social.search", "web.scrape"], source: { kind: "catalog", repository: "cporter202/scraping-apis-for-devs" }, auth: { type: "env", ref: "APIFY_API_TOKEN" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["tiktok", "social", "scrape"] },
  { name: "Instagram Scraper", provider: "apify", type: "scraper", description: "Instagram profile and post scraping actor", capabilities: ["social.instagram", "social.search", "web.scrape"], source: { kind: "catalog", repository: "cporter202/scraping-apis-for-devs" }, auth: { type: "env", ref: "APIFY_API_TOKEN" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["instagram", "social"] },
  { name: "YouTube Scraper", provider: "apify", type: "scraper", description: "YouTube search and channel scraping actor", capabilities: ["social.youtube", "social.search"], source: { kind: "catalog", repository: "cporter202/scraping-apis-for-devs" }, auth: { type: "env", ref: "APIFY_API_TOKEN" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["youtube", "social"] },
  { name: "X / Twitter Scraper", provider: "apify", type: "scraper", description: "X (Twitter) timeline and search scraping actor", capabilities: ["social.x", "social.search"], source: { kind: "catalog", repository: "cporter202/scraping-apis-for-devs" }, auth: { type: "env", ref: "APIFY_API_TOKEN" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["twitter", "x", "social"] },
  { name: "SerpAPI", provider: "serpapi", type: "external_api", description: "Structured Google search results API", capabilities: ["web.search"], source: { kind: "catalog", repository: "cporter202/agentic-ai-apis" }, auth: { type: "env", ref: "SERPAPI_API_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["search", "serp"] },
  { name: "ScraperAPI", provider: "scraperapi", type: "external_api", description: "Rotating-proxy web scraping API", capabilities: ["web.scrape", "web.crawl"], source: { kind: "catalog", repository: "cporter202/scraping-apis-for-devs" }, auth: { type: "env", ref: "SCRAPERAPI_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["scrape", "proxy"] },
  { name: "Bing Web Search", provider: "microsoft", type: "external_api", description: "Bing web search API for research discovery", capabilities: ["web.search", "research.discover"], source: { kind: "catalog", repository: "cporter202/agentic-ai-apis" }, auth: { type: "env", ref: "BING_SEARCH_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["search", "research"] },
  { name: "ElevenLabs TTS", provider: "elevenlabs", type: "audio_generator", description: "Text-to-speech voice generation API", capabilities: ["video.audio_generate"], source: { kind: "catalog", repository: "cporter202/ai-agent-tools" }, auth: { type: "env", ref: "ELEVENLABS_API_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["audio", "tts", "voice"] },
  { name: "Stability Image Gen", provider: "stability", type: "image_generator", description: "Stable Diffusion image generation API", capabilities: ["image.generate", "image.edit"], source: { kind: "catalog", repository: "cporter202/ai-agent-tools" }, auth: { type: "env", ref: "STABILITY_API_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["image", "diffusion"] },
  { name: "Runway Video Gen", provider: "runway", type: "video_generator", description: "Generative video creation API", capabilities: ["video.generate", "video.extend"], source: { kind: "catalog", repository: "cporter202/ai-agent-tools" }, auth: { type: "env", ref: "RUNWAY_API_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["video", "generation"] },
  { name: "Replicate Inference", provider: "replicate", type: "external_api", description: "Hosted model inference API for image/video/audio models", capabilities: ["image.generate", "video.generate", "video.audio_generate"], source: { kind: "catalog", repository: "cporter202/agentic-ai-apis" }, auth: { type: "env", ref: "REPLICATE_API_TOKEN" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["inference", "gpu"] },
  { name: "Whisper Transcription", provider: "openai", type: "external_api", description: "Audio transcription API", capabilities: ["media.transcribe"], source: { kind: "catalog", repository: "cporter202/ai-agent-tools" }, auth: { type: "env", ref: "OPENAI_API_KEY" }, authStatus: "missing", cost: { model: "usage_based" }, tags: ["transcribe", "audio"] },
  { name: "Discord Webhook Notify", provider: "discord", type: "notification", description: "Discord webhook message delivery (managed by the Notification Gateway)", capabilities: ["notification.discord"], source: { kind: "catalog", repository: "cporter202/ai-agent-tools" }, auth: { type: "config", ref: "notification-gateway:discord_webhook" }, authStatus: "missing", cost: { model: "free" }, tags: ["discord", "notify"] },
  { name: "Adobe Stock Export Packager", provider: "pao", type: "exporter", description: "Builds stock-ready export packages (metadata + assets)", capabilities: ["stock.export", "export.package"], source: { kind: "catalog", repository: "pao-hubpro" }, cost: { model: "free" }, tags: ["stock", "export"] },
];

const DOUYIN_PROVIDER_TOOLS: IngestedToolInput[] = [
  { name: "Douyin Inspect", provider: "douyin", type: "research_tool", description: "Inspect a public Douyin URL and normalize metadata", capabilities: ["social.douyin.inspect"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Download", provider: "douyin", type: "automation", description: "Queue a controlled Douyin media download through the Phase 20.24 media queue", capabilities: ["social.douyin.download"], riskLevel: 2, permissionClass: "file_write", source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Keyword Search", provider: "douyin", type: "research_tool", description: "Keyword search on Douyin with bounded, snapshotted results", capabilities: ["social.douyin.search", "social.search"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Hot Board", provider: "douyin", type: "research_tool", description: "Capture an immutable Douyin hot-search board snapshot", capabilities: ["social.douyin.hot_board"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Creator Sync", provider: "douyin", type: "automation", description: "Incremental creator/profile sync with bounded item counts (requires approval at threshold)", capabilities: ["social.douyin.profile.sync"], riskLevel: 3, requiresApproval: true, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Comments Reader", provider: "douyin", type: "research_tool", description: "Fetch normalized comments (untrusted data) for a Douyin item", capabilities: ["social.douyin.comments.read"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Replies Reader", provider: "douyin", type: "research_tool", description: "Fetch comment replies for a Douyin item where upstream supports it", capabilities: ["social.douyin.replies.read"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Transcriber", provider: "douyin", type: "research_tool", description: "Transcribe an acquired Douyin media artifact (degrades when no artifact/provider)", capabilities: ["social.douyin.transcribe", "media.transcribe"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
  { name: "Douyin Live Recorder", provider: "douyin", type: "automation", description: "Record a Douyin live room (flag-gated, requires approval)", capabilities: ["social.douyin.live.record"], riskLevel: 3, requiresApproval: true, status: "metadata_only", source: { kind: "agent_os", ownerModule: "agent-os/douyin" }, runtime: { execution: "local", protocol: "douyin" }, tags: ["douyin"] },
];

function ingestDouyinProvider(store: UniversalRegistryStore): number {
  let count = 0;
  for (const tool of DOUYIN_PROVIDER_TOOLS) {
    const slug = slugify(tool.name);
    const existing = store.getToolBySlug(slug, tool.provider);
    store.upsertTool({
      ...tool,
      id: existing?.id ?? `douyin:${slug}`,
      status: existing?.status === "disabled" ? "disabled" : (tool.status ?? "active"),
    });
    count += 1;
  }
  return count;
}

const COCKPIT_CONTROL_TOOLS: IngestedToolInput[] = [
  { name: "Control Agent List", provider: "cockpit", type: "automation", description: "List discovered coding agents (Codex, Claude Code, Gemini CLI, generic CLI) with health", capabilities: ["control.agent.list", "agent.execute"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Agent Doctor", provider: "cockpit", type: "automation", description: "Bounded agent health probe (detection + version)", capabilities: ["control.agent.health"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Session Start", provider: "cockpit", type: "automation", description: "Start a governed agent session under the ASK/APPROVE/FULL policy", capabilities: ["control.agent.session.start"], riskLevel: 2, permissionClass: "code_execute", source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Access Mode", provider: "cockpit", type: "automation", description: "Change an agent access mode (human-only; agents cannot self-elevate)", capabilities: ["control.agent.access.set"], riskLevel: 3, requiresApproval: true, permissionClass: "account_action", source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Context Snapshot", provider: "cockpit", type: "research_tool", description: "Create an immutable context snapshot bound to git SHA and policy hash", capabilities: ["control.context.snapshot"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Gate Check", provider: "cockpit", type: "reviewer", description: "Run the evidence-backed production readiness gate", capabilities: ["control.gate.check"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Gate Strict", provider: "cockpit", type: "reviewer", description: "Run the strict-production gate (fails on blockers or stale proof)", capabilities: ["control.gate.strict"], riskLevel: 1, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Evidence Ledger", provider: "cockpit", type: "research_tool", description: "Inspect the hashed, expiring evidence ledger", capabilities: ["control.evidence.list"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Provider Board", provider: "cockpit", type: "research_tool", description: "Provider control board separating detected/configured from runtime-verified", capabilities: ["control.provider.list"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
  { name: "Control Release Compare", provider: "cockpit", type: "research_tool", description: "Compare current HEAD against the last known-good release", capabilities: ["control.git.release.compare", "git.diff"], riskLevel: 0, source: { kind: "agent_os", ownerModule: "agent-os/control-plane" }, runtime: { execution: "local", protocol: "cockpit" }, tags: ["control-plane"] },
];

function ingestCockpitControls(store: UniversalRegistryStore): number {
  let count = 0;
  for (const tool of COCKPIT_CONTROL_TOOLS) {
    const slug = slugify(tool.name);
    const existing = store.getToolBySlug(slug, tool.provider);
    store.upsertTool({
      ...tool,
      id: existing?.id ?? `cockpit:${slug}`,
      status: existing?.status === "disabled" ? "disabled" : "active",
    });
    count += 1;
  }
  return count;
}

export interface SyncResult {
  ingested: number;
  bySource: Record<string, number>;
  startedAt: string;
  finishedAt: string;
}

/**
 * Run one ingestion pass. Idempotent: stable ids mean re-syncs update in place,
 * and an operator-disabled tool keeps its disabled status across syncs.
 */
export function syncRegistry(store: UniversalRegistryStore, sources: string[] = ["mcp", "agents", "skills", "codex", "models", "browser", "catalog", "douyin", "cockpit"]): SyncResult {
  const startedAt = new Date().toISOString();
  const bySource: Record<string, number> = {};
  for (const source of sources) {
    let n = 0;
    if (source === "mcp") n = ingestMcpTools(store);
    else if (source === "agents") n = ingestAgents(store);
    else if (source === "skills") n = ingestSkills(store);
    else if (source === "codex") n = ingestCodexRuntime(store);
    else if (source === "models") n = ingestModels(store);
    else if (source === "browser") n = ingestBrowserTools(store);
    else if (source === "douyin") n = ingestDouyinProvider(store);
    else if (source === "cockpit") n = ingestCockpitControls(store);
    else if (source === "catalog") {
      for (const seed of CATALOG_SEEDS) {
        const slug = slugify(seed.name);
        const existing = store.getToolBySlug(slug, seed.provider);
        const disabled = existing?.status === "disabled";
        store.upsertTool({
          ...seed,
          id: existing?.id ?? `catalog:${slug}`,
          status: disabled ? "disabled" : "metadata_only",
        });
        n += 1;
      }
    }
    bySource[source] = n;
  }
  return {
    ingested: Object.values(bySource).reduce((a, b) => a + b, 0),
    bySource,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
