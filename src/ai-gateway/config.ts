/**
 * Pao AI Gateway — Configuration loader.
 *
 * Loads gateway configuration from config/ai-gateway/ YAML files.
 * API keys are resolved from environment variables only — never stored in config.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  GatewayConfig,
  GatewayProviderConfig,
  GatewayModelConfig,
  AliasConfig,
  GatewayIdentity,
  GatewayBudgetConfig,
  IdentityGuardrailPolicy,
  TraceContentMode,
} from "./types";

// ---------------------------------------------------------------------------
// Env-var interpolation
// ---------------------------------------------------------------------------

const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Resolve `${ENV_VAR}` references in a string value.
 * Returns empty string for unset vars rather than leaking the placeholder.
 */
export function resolveEnvInterpolation(raw: string): string {
  return raw.replace(ENV_VAR_PATTERN, (_, name: string) => process.env[name] ?? "");
}

/**
 * Resolve an API key from an environment variable name.
 * Returns undefined if the env var is unset or empty.
 * Never returns the env var name itself.
 */
export function resolveApiKey(envVarName: string): string | undefined {
  const val = process.env[envVarName];
  return val && val.trim() !== "" ? val.trim() : undefined;
}

// ---------------------------------------------------------------------------
// YAML-like parser (simple key-value, avoids external dep per governance)
// ---------------------------------------------------------------------------

/**
 * Minimal YAML subset parser. Handles the flat/nested YAML structures used in
 * gateway config. For complex YAML, the project should adopt a proper parser,
 * but per minimal-code governance we start with what the config actually needs.
 *
 * Falls back to JSON parsing if the file starts with `{` or `[`.
 */
function parseConfigFile(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  const raw = readFileSync(filePath, "utf-8").trim();
  if (!raw) return undefined;

  // If it looks like JSON, parse as JSON
  if (raw.startsWith("{") || raw.startsWith("[")) {
    return JSON.parse(raw);
  }

  // Simple YAML-like parsing for our config structure.
  // For production, this should be replaced with a proper YAML parser
  // but the gateway config is simple enough for this to work.
  return parseSimpleYaml(raw);
}

interface YamlNode {
  [key: string]: unknown;
}

function parseSimpleYaml(raw: string): unknown {
  const lines = raw.split("\n");
  const result: YamlNode = {};
  const stack: { indent: number; obj: YamlNode }[] = [{ indent: -1, obj: result }];
  let currentArray: unknown[] | null = null;
  let currentArrayKey = "";
  let currentArrayIndent = -1;

  for (const line of lines) {
    // Skip comments and empty lines
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - trimmed.length;

    // Array item
    if (trimmed.startsWith("- ")) {
      const val = trimmed.slice(2).trim();
      if (currentArray && indent >= currentArrayIndent) {
        // Check if it's a key: value pair inside array
        const colonIdx = val.indexOf(":");
        if (colonIdx > 0 && !val.startsWith('"') && !val.startsWith("'")) {
          const k = val.slice(0, colonIdx).trim();
          const v = parseYamlValue(val.slice(colonIdx + 1).trim());
          // Array of objects: check if last item can be extended
          const lastItem = currentArray[currentArray.length - 1];
          if (lastItem && typeof lastItem === "object" && !Array.isArray(lastItem)) {
            (lastItem as YamlNode)[k] = v;
          } else {
            currentArray.push({ [k]: v });
          }
        } else {
          currentArray.push(parseYamlValue(val));
        }
        continue;
      }
    }

    // If we were in an array and indent dropped, close it
    if (currentArray && indent <= currentArrayIndent && !trimmed.startsWith("- ")) {
      // Find the right parent and set the array
      const parent = findParent(stack, currentArrayIndent);
      if (parent) parent.obj[currentArrayKey] = currentArray;
      currentArray = null;
    }

    // Key: value
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const valueStr = trimmed.slice(colonIdx + 1).trim();

      // Pop stack to find parent
      while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1]!;

      if (!valueStr) {
        // Start of a new nested object or upcoming array
        const nextLineIdx = lines.indexOf(line) + 1;
        const nextLine = nextLineIdx < lines.length ? lines[nextLineIdx]! : "";
        const nextTrimmed = nextLine.trimStart();

        if (nextTrimmed.startsWith("- ")) {
          // It's an array
          currentArray = [];
          currentArrayKey = key;
          currentArrayIndent = indent;
          parent.obj[key] = currentArray;
        } else {
          // Nested object
          const nested: YamlNode = {};
          parent.obj[key] = nested;
          stack.push({ indent, obj: nested });
        }
      } else {
        parent.obj[key] = parseYamlValue(valueStr);
      }
    }
  }

  // Close any remaining array
  if (currentArray) {
    const parent = findParent(stack, currentArrayIndent);
    if (parent) parent.obj[currentArrayKey] = currentArray;
  }

  return result;
}

function findParent(
  stack: { indent: number; obj: YamlNode }[],
  indent: number,
): { indent: number; obj: YamlNode } | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.indent < indent) return stack[i];
  }
  return stack[0];
}

function parseYamlValue(raw: string): unknown {
  if (!raw) return null;
  // Remove inline comments
  const commentIdx = raw.indexOf(" #");
  const clean = commentIdx >= 0 ? raw.slice(0, commentIdx).trim() : raw;

  // Quoted strings
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    return clean.slice(1, -1);
  }
  // Booleans
  if (clean === "true") return true;
  if (clean === "false") return false;
  // Null
  if (clean === "null" || clean === "~") return null;
  // Numbers
  const num = Number(clean);
  if (!Number.isNaN(num) && clean !== "") return num;
  // Default: string
  return clean;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const CONFIG_DIR = "config/ai-gateway";

function configPath(rootDir: string, filename: string): string {
  return join(rootDir, CONFIG_DIR, filename);
}

function loadProviders(rootDir: string): GatewayProviderConfig[] {
  const raw = parseConfigFile(configPath(rootDir, "providers.yaml")) as { providers?: Record<string, unknown> } | undefined;
  if (!raw?.providers) return [];
  return Object.entries(raw.providers).map(([id, cfg]) => {
    const c = cfg as Record<string, unknown>;
    return {
      id,
      type: (c.type as GatewayProviderConfig["type"]) ?? "openai-compatible",
      apiKeyEnv: (c.api_key_env as string) ?? "",
      baseUrl: c.base_url ? resolveEnvInterpolation(String(c.base_url)) : undefined,
      enabled: c.enabled !== false,
    };
  });
}

function loadModels(rootDir: string): GatewayModelConfig[] {
  const raw = parseConfigFile(configPath(rootDir, "models.yaml")) as { models?: Record<string, unknown> } | undefined;
  if (!raw?.models) return [];
  return Object.entries(raw.models).map(([id, cfg]) => {
    const c = cfg as Record<string, unknown>;
    const caps = (c.capabilities ?? {}) as Record<string, unknown>;
    const limits = (c.limits ?? {}) as Record<string, unknown>;
    const pricing = (c.pricing ?? {}) as Record<string, unknown>;
    return {
      id,
      providerId: String(c.provider ?? ""),
      model: c.model ? resolveEnvInterpolation(String(c.model)) : id,
      capabilities: {
        chat: caps.chat === true,
        tools: caps.tools === true,
        structuredOutput: caps.structured_output === true,
        vision: caps.vision === true,
        reasoning: caps.reasoning === true,
      },
      limits: {
        contextWindow: typeof limits.context_window === "number" ? limits.context_window : null,
        maxOutputTokens: typeof limits.max_output_tokens === "number" ? limits.max_output_tokens : null,
      },
      pricing: {
        inputPerMillionUsd: typeof pricing.input_per_million_usd === "number" ? pricing.input_per_million_usd : null,
        outputPerMillionUsd: typeof pricing.output_per_million_usd === "number" ? pricing.output_per_million_usd : null,
        cachedInputPerMillionUsd: typeof pricing.cached_input_per_million_usd === "number" ? pricing.cached_input_per_million_usd : null,
      },
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
      enabled: c.enabled !== false,
    };
  });
}

function loadAliases(rootDir: string): AliasConfig[] {
  const raw = parseConfigFile(configPath(rootDir, "aliases.yaml")) as { aliases?: Record<string, unknown> } | undefined;
  if (!raw?.aliases) return [];
  return Object.entries(raw.aliases).map(([id, cfg]) => {
    const c = cfg as Record<string, unknown>;
    const routes = Array.isArray(c.routes) ? (c.routes as Record<string, unknown>[]).map(r => ({
      modelId: String(r.model ?? ""),
      priority: typeof r.priority === "number" ? r.priority : 0,
    })) : [];
    const constraints = c.constraints as Record<string, unknown> | undefined;
    return {
      id,
      routes: routes.sort((a, b) => b.priority - a.priority),
      constraints: constraints ? {
        localOnly: constraints.local_only === true,
        reviewRequired: constraints.review_required === true,
      } : undefined,
    };
  });
}

function loadPolicies(rootDir: string): IdentityGuardrailPolicy[] {
  const raw = parseConfigFile(configPath(rootDir, "policies.yaml")) as { policies?: Record<string, unknown> } | undefined;
  if (!raw?.policies) return [];
  return Object.entries(raw.policies).map(([identityId, cfg]) => {
    const c = cfg as Record<string, unknown>;
    const input = (c.input ?? {}) as Record<string, string>;
    const output = (c.output ?? {}) as Record<string, string>;
    return {
      identityId,
      failClosed: c.fail_closed === true,
      input: Object.fromEntries(
        Object.entries(input).map(([k, v]) => [k, v as "allow" | "block" | "transform"]),
      ),
      output: Object.fromEntries(
        Object.entries(output).map(([k, v]) => [k, v as "allow" | "block" | "transform"]),
      ),
    };
  });
}

function loadBudgets(rootDir: string): GatewayBudgetConfig {
  const raw = parseConfigFile(configPath(rootDir, "budgets.yaml")) as { budgets?: Record<string, unknown> } | undefined;
  const b = raw?.budgets ?? {};
  const global = (b as Record<string, unknown>).global as Record<string, unknown> | undefined;
  const identities = (b as Record<string, unknown>).identities as Record<string, Record<string, unknown>> | undefined;
  return {
    global: {
      dailyUsd: typeof global?.daily_usd === "number" ? global.daily_usd : 15,
      monthlyUsd: typeof global?.monthly_usd === "number" ? global.monthly_usd : 250,
    },
    identities: identities ? Object.entries(identities).map(([id, c]) => ({
      identityId: id,
      dailyUsd: typeof c.daily_usd === "number" ? c.daily_usd : 10,
      perRequestUsd: typeof c.per_request_usd === "number" ? c.per_request_usd : 1.5,
      monthlyUsd: typeof c.monthly_usd === "number" ? c.monthly_usd : undefined,
    })) : [],
  };
}

/** Load identities from policies.yaml identity definitions. */
function loadIdentities(rootDir: string): GatewayIdentity[] {
  const raw = parseConfigFile(configPath(rootDir, "policies.yaml")) as { identities?: Record<string, unknown> } | undefined;
  if (!raw?.identities) return getDefaultIdentities();
  return Object.entries(raw.identities).map(([id, cfg]) => {
    const c = cfg as Record<string, unknown>;
    const aliases = (c.aliases ?? {}) as Record<string, unknown>;
    const allow = Array.isArray(aliases.allow) ? aliases.allow as string[] : [];
    return {
      id,
      name: String(c.name ?? id),
      allowedAliases: allow,
      maxRequestUsd: typeof c.max_request_usd === "number" ? c.max_request_usd : 1.5,
      maxDailyUsd: typeof c.max_daily_usd === "number" ? c.max_daily_usd : 10,
      maxMonthlyUsd: typeof c.max_monthly_usd === "number" ? c.max_monthly_usd : undefined,
      externalProviderAccess: c.external_provider_access !== false,
      localOnly: c.local_only === true,
    };
  });
}

function getDefaultIdentities(): GatewayIdentity[] {
  return [
    {
      id: "admin-pao",
      name: "Admin",
      allowedAliases: ["pao-fast", "pao-code", "pao-reasoning", "pao-review", "pao-vision", "pao-stock", "pao-browser", "pao-local", "pao-critical"],
      maxRequestUsd: 5,
      maxDailyUsd: 50,
      maxMonthlyUsd: 500,
    },
    {
      id: "codex",
      name: "Codex",
      allowedAliases: ["pao-code", "pao-reasoning", "pao-review"],
      maxRequestUsd: 1.5,
      maxDailyUsd: 8,
    },
    {
      id: "local-worker",
      name: "Local Worker",
      allowedAliases: ["pao-local"],
      maxRequestUsd: 0,
      maxDailyUsd: 0,
      externalProviderAccess: false,
      localOnly: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public loader
// ---------------------------------------------------------------------------

/**
 * Load the full gateway configuration from the config/ai-gateway/ directory.
 * Falls back to sensible defaults if files are missing.
 */
export function loadGatewayConfig(rootDir: string): GatewayConfig {
  const enabled = process.env.PAO_AI_GATEWAY_ENABLED === "true";
  const port = Number(process.env.PAO_AI_GATEWAY_PORT) || 8787;
  const traceContentMode = (process.env.PAO_AI_GATEWAY_TRACE_MODE as TraceContentMode) || "metadata_only";

  return {
    enabled,
    port,
    providers: loadProviders(rootDir),
    models: loadModels(rootDir),
    aliases: loadAliases(rootDir),
    identities: loadIdentities(rootDir),
    budgets: loadBudgets(rootDir),
    policies: loadPolicies(rootDir),
    traceContentMode,
    routerVersion: "router-v1-rule-based",
  };
}
