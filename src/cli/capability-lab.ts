/**
 * ocx capability-lab — Phase 20.56 headless surface.
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
  ocx capability-lab health [--json]
  ocx capability-lab seed [--json]
  ocx capability-lab sources [--json]
  ocx capability-lab recipes [--json]
  ocx capability-lab list [--json]
  ocx capability-lab publish <key> [--json]
  ocx capability-lab run <key> [--json]`;

async function health(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest("/api/agent-os/capability-lab/health", {}, deps);
  printData(result, wantsJson, ["capability-lab ok"]);
}

async function seed(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest("/api/agent-os/capability-lab/seed", { method: "POST", body: "{}" }, deps);
  printData(result, wantsJson, ["seed imported"]);
}

async function sources(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest("/api/agent-os/capability-lab/sources", {}, deps);
  printData(result, wantsJson, ["sources"]);
}

async function recipes(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest("/api/agent-os/capability-lab/recipes", {}, deps);
  printData(result, wantsJson, ["recipes"]);
}

async function listCaps(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest<{ capabilities?: Array<{ key: string; status: string }> }>("/api/agent-os/capability-lab/capabilities", {}, deps);
  printData(result, wantsJson, (result.capabilities ?? []).map((c) => `${c.key} ${c.status}`));
}

function requireKey(argv: string[]): string {
  const key = argv.shift()?.trim();
  if (!key) throw new CliUsageError("capability key is required", USAGE);
  return key;
}

async function publish(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const key = requireKey(argv);
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/capability-lab/capabilities/${encodeURIComponent(key)}/publish`, { method: "POST", body: JSON.stringify({ actorId: "admin" }) }, deps);
  printData(result, wantsJson, [`published ${key}`]);
}

async function run(argv: string[], deps: RuntimeApiDeps): Promise<void> {
  const wantsJson = takeFlag(argv, "--json");
  const key = requireKey(argv);
  rejectArgs(argv, USAGE);
  const result = await runtimeRequest(`/api/agent-os/capability-lab/capabilities/${encodeURIComponent(key)}/invoke`, { method: "POST", body: JSON.stringify({ args: { text: "pao" }, caller: "user" }) }, deps);
  printData(result, wantsJson, [`ran ${key}`]);
}

export async function handleCapabilityLabCommand(argv: string[], deps: RuntimeApiDeps = {}): Promise<number> {
  const sub = argv.shift();
  const handlers: Record<string, (args: string[], deps: RuntimeApiDeps) => Promise<void>> = {
    health, seed, sources, recipes, list: listCaps, publish, run,
  };
  const handler = sub ? handlers[sub] : undefined;
  if (!handler) {
    console.error(sub ? `unknown capability-lab subcommand ${sub}` : "capability-lab subcommand is required");
    console.error(USAGE);
    return 2;
  }
  return runCliAction(() => handler(argv, deps));
}

export const CAPABILITY_LAB_USAGE = USAGE;

