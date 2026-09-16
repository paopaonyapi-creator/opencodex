// Phase 20.33 — Pao-hubPro × Open WebUI Unified AI Workspace: pao.* tool
// catalog (doc §6.2, §7). The catalog is METADATA over existing capabilities:
// governed tools delegate to the Phase 20.28 governance gateway providers
// (deny-first policy, grants, approvals, audit); surface tools point at the
// modules that already own those domains and are never fake-executed here.

export type ToolExecutorKind = "governed" | "surface";

/** Governance effect ceiling declared per governed tool (doc §7 → §11). */
export type ToolEffect = "read" | "write" | "execute" | "destructive";

export interface PaoToolEntry {
  /** Public pao.* name exposed over MCP. */
  name: string;
  group: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  /** governed → routed through governedDispatch; surface → metadata only. */
  executor: ToolExecutorKind;
  /** Governance provider id for governed tools (doc §6.2 risk metadata). */
  provider?: string;
  /** Tool name inside the governance provider (e.g. file.read). */
  capability?: string;
  /** Governance effect for governed tools (explicit — no name-sniffing). */
  effect?: ToolEffect;
  /** Spec §7 risk class. */
  risk: "read" | "write-low" | "write-high" | "execute" | "network" | "deploy" | "delete" | "credential";
  /** Where a surface tool really lives (honest pointer, doc §65). */
  availableVia?: string;
  timeoutSeconds: number;
  audit: true;
}

export const PAO_TOOL_GROUPS = [
  "pao.files",
  "pao.shell",
  "pao.review",
  "pao.system",
  "pao.codex",
  "pao.browser",
  "pao.comfyui",
  "pao.runpod",
  "pao.image",
  "pao.video",
  "pao.voice",
  "pao.stock",
  "pao.workflow",
] as const;

export const PAO_TOOL_CATALOG: PaoToolEntry[] = [
  {
    name: "pao.files.read",
    group: "pao.files",
    description: "Read a text file inside the approved workspace (Phase 20.28 governed local provider).",
    parameters: { type: "object", properties: { path: { type: "string", description: "Workspace-relative or absolute path inside the workspace root" } }, required: ["path"] },
    executor: "governed",
    provider: "local",
    capability: "file.read",
    effect: "read",
    risk: "read",
    timeoutSeconds: 30,
    audit: true,
  },
  {
    name: "pao.files.list",
    group: "pao.files",
    description: "List a directory inside the approved workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    executor: "governed",
    provider: "local",
    capability: "file.list",
    effect: "read",
    risk: "read",
    timeoutSeconds: 30,
    audit: true,
  },
  {
    name: "pao.files.write",
    group: "pao.files",
    description: "Write or overwrite a file inside the approved workspace. Audited; scoped by the grant resource pattern.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    executor: "governed",
    provider: "local",
    capability: "file.write",
    effect: "write",
    risk: "write-low",
    timeoutSeconds: 30,
    audit: true,
  },
  {
    name: "pao.files.delete",
    group: "pao.files",
    description: "Delete a file inside the approved workspace. Destructive: requires human approval.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    executor: "governed",
    provider: "local",
    capability: "file.delete",
    effect: "destructive",
    risk: "delete",
    timeoutSeconds: 30,
    audit: true,
  },
  {
    name: "pao.shell.execute",
    group: "pao.shell",
    description: "Execute an allowlisted binary with argv arguments (no shell interpolation) inside an approved workspace root. Requires human approval.",
    parameters: {
      type: "object",
      properties: {
        binary: { type: "string", description: "Allowlisted binary (git, bun, npm, python, ffmpeg, ...)" },
        args: { type: "string", description: "JSON-encoded argument array" },
        cwd: { type: "string", description: "Working directory inside the approved workspace roots" },
        timeout_seconds: { type: "string", description: "Clamped to the provider maximum" },
      },
      required: ["binary", "args"],
    },
    executor: "governed",
    provider: "pao-shell",
    capability: "shell.execute",
    effect: "execute",
    risk: "execute",
    timeoutSeconds: 120,
    audit: true,
  },
  {
    name: "pao.review.council",
    group: "pao.review",
    description: "Run the existing Phase 20.22 Reviewer Council bridge over a proposed action. Read-only reviewers; they never mutate.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        risk_level: { type: "string", description: "R0..R4" },
        reason: { type: "string" },
        args_json: { type: "string", description: "JSON-encoded arguments under review" },
      },
      required: ["tool_name", "risk_level", "reason"],
    },
    executor: "governed",
    provider: "pao-review",
    capability: "review.council",
    effect: "read",
    risk: "read",
    timeoutSeconds: 30,
    audit: true,
  },
  {
    name: "pao.system.health",
    group: "pao.system",
    description: "Read-only aggregate health snapshot of the Pao-hubPro workspace services.",
    parameters: { type: "object", properties: {} },
    executor: "governed",
    provider: "pao-meta",
    capability: "system.health",
    effect: "read",
    risk: "read",
    timeoutSeconds: 15,
    audit: true,
  },

  // --- Surface tools: owned by existing modules; never executed here (doc §65) ---
  {
    name: "pao.codex.run",
    group: "pao.codex",
    description: "Run the OpenAI Codex native runtime inside approved workspace roots.",
    parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    executor: "surface",
    risk: "execute",
    availableVia: "Codex Native Runtime (Phase 20.21) and Agent Cockpit sessions (Phase 20.27)",
    timeoutSeconds: 600,
    audit: true,
  },
  {
    name: "pao.browser.read",
    group: "pao.browser",
    description: "Read/navigate browser actions via the universal browser provider.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    executor: "surface",
    risk: "network",
    availableVia: "Browser runtime (Phase 20.19 universal provider, Browser Studio)",
    timeoutSeconds: 120,
    audit: true,
  },
  {
    name: "pao.comfyui.workflow.run",
    group: "pao.comfyui",
    description: "Run a ComfyUI workflow through the generation layer.",
    parameters: { type: "object", properties: { workflow: { type: "string" } }, required: ["workflow"] },
    executor: "surface",
    risk: "execute",
    availableVia: "Generation compute + ComfyUI video adapter (existing modules)",
    timeoutSeconds: 600,
    audit: true,
  },
  {
    name: "pao.runpod.start",
    group: "pao.runpod",
    description: "Start a RunPod GPU instance. Cost-impacting: subject to policy checks.",
    parameters: { type: "object", properties: { instance: { type: "string" } }, required: ["instance"] },
    executor: "surface",
    risk: "deploy",
    availableVia: "Generation compute provider layer (RunPod adapter)",
    timeoutSeconds: 120,
    audit: true,
  },
  {
    name: "pao.image.generate",
    group: "pao.image",
    description: "Generate images through the Pao image/generation factory.",
    parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    executor: "surface",
    risk: "write-low",
    availableVia: "Generation module + Image Factory (existing)",
    timeoutSeconds: 600,
    audit: true,
  },
  {
    name: "pao.video.generate",
    group: "pao.video",
    description: "Produce video through the Pao Video Factory / MoneyPrinterTurbo pipeline.",
    parameters: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] },
    executor: "surface",
    risk: "write-low",
    availableVia: "Video Factory orchestrator (Phase 20.7)",
    timeoutSeconds: 1800,
    audit: true,
  },
  {
    name: "pao.voice.synthesize",
    group: "pao.voice",
    description: "Synthesize speech through the VoiceStudio speech runtime.",
    parameters: { type: "object", properties: { text: { type: "string" }, voice_id: { type: "string" } }, required: ["text", "voice_id"] },
    executor: "surface",
    risk: "write-low",
    availableVia: "Speech Runtime (Phase 20.32) /api/agent-os/speech/synthesize",
    timeoutSeconds: 600,
    audit: true,
  },
  {
    name: "pao.stock.export.prepare",
    group: "pao.stock",
    description: "Prepare an Adobe Stock export package through the stock pipeline gates.",
    parameters: { type: "object", properties: { artifact_id: { type: "string" } }, required: ["artifact_id"] },
    executor: "surface",
    risk: "network",
    availableVia: "Stock pipeline + Video Factory export builder (Adobe Stock gates)",
    timeoutSeconds: 120,
    audit: true,
  },
  {
    name: "pao.workflow.run",
    group: "pao.workflow",
    description: "Run an approved ClawFlows workflow (WORKFLOW.md registry) through the automation engine.",
    parameters: { type: "object", properties: { workflow_id: { type: "string" } }, required: ["workflow_id"] },
    executor: "surface",
    risk: "execute",
    availableVia: "ClawFlows Workflow Registry & Safe Automation Engine (Phase 20.29) /api/agent-os/automation/run",
    timeoutSeconds: 1800,
    audit: true,
  },
];

export function findPaoTool(name: string): PaoToolEntry | undefined {
  return PAO_TOOL_CATALOG.find((tool) => tool.name === name);
}

export function listPaoToolGroups(): string[] {
  return [...PAO_TOOL_GROUPS];
}
