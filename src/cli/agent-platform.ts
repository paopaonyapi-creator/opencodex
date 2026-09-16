/**
 * ocx agent-platform — headless surface for Phase 20.54.
 */
import {
  CliUsageError,
  printData,
  rejectArgs,
  runCliAction,
  runtimeRequest,
  takeFlag,
  type RuntimeApiDeps,
} from "./runtime-api";

const USAGE = `Usage:
  ocx agent-platform health [--json]
  ocx agent-platform list [--json]
  ocx agent-platform show <agentId> [--json]
  ocx agent-platform patterns [--json]
  ocx agent-platform capabilities [--json]
  ocx agent-platform approvals [--json]
  ocx agent-platform approve <approvalId> [--actor <id>] [--json]
  ocx agent-platform reject <approvalId> [--actor <id>] [--json]
  ocx agent-platform receipts [--agent <id>] [--json]
  ocx agent-platform verify-chain <agentId> [--json]
  ocx agent-platform validate <manifest.json> [--json]`;

function requireId(argv: string[], label: string): string {
  const id = argv.shift()?.trim();
  if (!id) throw new CliUsageError(`${label} is required`, USAGE);
  return id;
}

async function health(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/agent-platform/health`, {}, deps);
  printData(result, wantsJson, [`agent-platform: ${String((result as Record<string, unknown>).ok)} (${String((result as Record<string, unknown>).agents)} agents)`]);
}

async function listAgents(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{ agents?: Array<{ id: string; enabled: boolean; version: string }> }>(`/api/agent-os/agent-platform/agents`, {}, deps);
  const agents = result.agents ?? [];
  printData(result, wantsJson, agents.map((a) => `${a.id} ${a.enabled ? "enabled" : "disabled"} v${a.version}`));
}

async function show(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const id = requireId(argv, "agent id");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/agent-platform/agents/${encodeURIComponent(id)}`, {}, deps);
  printData(result, wantsJson, [JSON.stringify(result)]);
}

async function patterns(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{ patterns?: Array<{ id: string }> }>(`/api/agent-os/agent-platform/patterns`, {}, deps);
  printData(result, wantsJson, (result.patterns ?? []).map((p) => p.id));
}

async function capabilities(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{ capabilities?: Array<{ id: string; riskLevel: string }> }>(`/api/agent-os/agent-platform/capabilities`, {}, deps);
  printData(result, wantsJson, (result.capabilities ?? []).map((c) => `${c.id} ${c.riskLevel}`));
}

async function approvals(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{ approvals?: Array<{ id: string; status: string; capabilityId: string }> }>(`/api/agent-os/agent-platform/approvals`, {}, deps);
  printData(result, wantsJson, (result.approvals ?? []).map((a) => `${a.id} ${a.status} ${a.capabilityId}`));
}

async function resolve(argv: string[], deps: RuntimeApiDeps, decision: "approved" | "rejected"): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const actorIdx = argv.indexOf("--actor");
  let actor = "admin";
  if (actorIdx >= 0) {
    actor = argv[actorIdx + 1] ?? "admin";
    argv.splice(actorIdx, 2);
  }
  const id = requireId(argv, "approval id");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/agent-platform/approvals/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ actorId: actor, decision }),
  }, deps);
  printData(result, wantsJson, [`${decision} ${id}`]);
}

async function receipts(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const agentIdx = argv.indexOf("--agent");
  let agent = "";
  if (agentIdx >= 0) {
    agent = argv[agentIdx + 1] ?? "";
    argv.splice(agentIdx, 2);
  }
  rejectArgs(argv, USAGE);
  const qs = agent ? `?agentId=${encodeURIComponent(agent)}` : "";
  const result = await runtimeRequest(`/api/agent-os/agent-platform/receipts${qs}`, {}, deps);
  printData(result, wantsJson, ["receipts"]);
}

async function verifyChain(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const id = requireId(argv, "agent id");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/agent-platform/receipts/chain?agentId=${encodeURIComponent(id)}`, {}, deps);
  printData(result, wantsJson, [JSON.stringify(result)]);
}

export async function handleAgentPlatformCommand(argv: string[], deps: RuntimeApiDeps = {}): Promise<number> {
  const sub = argv.shift();
  const handlers: Record<string, (args: string[], deps: RuntimeApiDeps) => Promise<void>> = {
    health,
    list: listAgents,
    show,
    patterns,
    capabilities,
    approvals,
    approve: (args, d) => resolve(args, d, "approved"),
    reject: (args, d) => resolve(args, d, "rejected"),
    receipts,
    "verify-chain": verifyChain,
  };
  const handler = sub ? handlers[sub] : undefined;
  if (!handler) {
    console.error(sub ? `unknown agent-platform subcommand ${sub}` : "agent-platform subcommand is required");
    console.error(USAGE);
    return 2;
  }
  return runCliAction(() => handler(argv, deps));
}

export const AGENT_PLATFORM_USAGE = USAGE;

