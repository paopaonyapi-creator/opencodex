// Phase 20.39 — @Context registry (spec §14) + slash command registry
// (spec §15). Context refs are structured pointers resolved SERVER-SIDE
// under workspace containment checks — file contents never enter frontend
// text fields. Slash commands are registry-driven; the frontend renders
// metadata only and the backend executes through the policy engine.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CockpitError, type ContextReference, type ContextRefType, type ProviderCapabilities } from "./types";
import type { CockpitStore } from "./store";
import { resolveInsideWorkspace } from "./paths";

export const CONTEXT_TYPES: readonly ContextRefType[] = [
  "workspace", "repo", "file", "folder", "session", "agent", "skill", "mcp", "phase", "run", "artifact",
];

// --- Context registry -----------------------------------------------------------------

export class ContextRegistry {
  constructor(private readonly store: CockpitStore) {}

  register(ref: Omit<ContextReference, "id">): ContextReference {
    if (!CONTEXT_TYPES.includes(ref.type)) {
      throw new CockpitError("VALIDATION_ERROR", "unknown context ref type: " + ref.type);
    }
    return this.store.insertContextRef(ref);
  }

  /** Search candidates for the composer's `@` autocomplete. Grouped by type
   *  client-side; ordering is deterministic (type, label). */
  search(query: string, workspaceId?: string, limit = 30): ContextReference[] {
    const needle = query.trim().toLowerCase();
    const all = this.store.listContextRefs({ workspaceId, limit: 500 });
    const matches = all.filter((ref) => {
      if (needle.length === 0) return true;
      return ref.label.toLowerCase().includes(needle)
        || (ref.path ?? "").toLowerCase().includes(needle)
        || (ref.targetId ?? "").toLowerCase().includes(needle)
        || ref.type.includes(needle);
    });
    return matches
      .sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  /** Resolve refs against live registries. File/folder refs are validated to
   *  stay inside their workspace (spec §53: context refs cannot escape the
   *  permitted scope). Returns metadata only — never file contents. */
  resolve(refs: ContextReference[], workspaceRoot: string | null): ResolvedContextRef[] {
    return refs.map((ref) => {
      if (ref.type === "file" || ref.type === "folder") {
        if (!ref.path || !workspaceRoot) {
          throw new CockpitError("PATH_OUTSIDE_WORKSPACE", "file/folder context requires a workspace-bound path");
        }
        const resolved = resolveInsideWorkspace(workspaceRoot, ref.path);
        let exists = false;
        let sizeBytes: number | null = null;
        try {
          const stat = statSync(resolved);
          exists = true;
          sizeBytes = stat.isFile() ? stat.size : null;
        } catch {
          exists = false;
        }
        return { ...ref, resolvedPath: resolved, exists, sizeBytes };
      }
      if (ref.type === "session") {
        const session = ref.targetId ? this.store.getSession(ref.targetId) : null;
        if (!session) throw new CockpitError("SESSION_NOT_FOUND", "session context not found: " + (ref.targetId ?? ""));
        return { ...ref, metadata: { title: session.title, status: session.status, providerId: session.providerId } };
      }
      if (ref.type === "run") {
        const run = ref.targetId ? this.store.getRun(ref.targetId) : null;
        if (!run) throw new CockpitError("NOT_FOUND", "run context not found: " + (ref.targetId ?? ""));
        return { ...ref, metadata: { status: run.status, startedAt: run.startedAt } };
      }
      if (ref.type === "artifact") {
        const artifact = ref.targetId ? this.store.listArtifacts({ runId: ref.targetId, limit: 1 }) : null;
        if (!artifact || artifact.length === 0) throw new CockpitError("NOT_FOUND", "artifact context not found");
        return { ...ref, metadata: { type: artifact[0].type, label: artifact[0].label } };
      }
      // workspace/repo/agent/skill/mcp/phase resolve to metadata pointers the
      // downstream consumer may enrich from their own registries.
      return { ...ref };
    });
  }

  /** Harvest file/folder candidates from the workspace for autocomplete. */
  indexWorkspaceFiles(workspaceId: string, workspaceRoot: string, maxEntries = 200): ContextReference[] {
    const harvested: ContextReference[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 3 || harvested.length >= maxEntries) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (harvested.length >= maxEntries) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          harvested.push(this.register({ type: "folder", label: entry.name, workspaceId, path: full }));
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          harvested.push(this.register({ type: "file", label: entry.name, workspaceId, path: full }));
        }
      }
    };
    walk(workspaceRoot, 0);
    return harvested;
  }
}

export interface ResolvedContextRef extends ContextReference {
  resolvedPath?: string;
  exists?: boolean;
  sizeBytes?: number | null;
}

// --- Slash command registry ----------------------------------------------------------------

export interface SlashCommandDefinition {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  argsSchema?: string;
  requiredCapabilities?: (keyof ProviderCapabilities)[];
  handler: (ctx: SlashCommandContext) => Promise<{ summary: string; data?: Record<string, unknown> }>;
}

export interface SlashCommandContext {
  sessionId: string | null;
  workspaceId: string | null;
  args: string[];
  actor: string;
}

export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommandDefinition>();
  private aliases = new Map<string, string>();

  register(command: SlashCommandDefinition): void {
    this.commands.set(command.name, command);
    for (const alias of command.aliases ?? []) {
      this.aliases.set(alias, command.name);
    }
  }

  list(): SlashCommandDefinition[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Deterministic alias resolution: exact name match wins, then alias map. */
  resolve(token: string): SlashCommandDefinition | null {
    const cleaned = token.replace(/^\//, "").trim().toLowerCase();
    const byName = this.commands.get(cleaned);
    if (byName) return byName;
    const aliasTarget = this.aliases.get(cleaned);
    return aliasTarget ? this.commands.get(aliasTarget) ?? null : null;
  }

  /** Parse a composer message. Returns null when the message is not a
   *  command; throws VALIDATION_ERROR for unknown commands (structured
   *  error path, spec §54). */
  parse(message: string): { command: SlashCommandDefinition | null; rest: string; isCommand: boolean } {
    const trimmed = message.trim();
    if (!trimmed.startsWith("/")) return { command: null, rest: trimmed, isCommand: false };
    const [token, ...restTokens] = trimmed.split(/\s+/);
    const command = this.resolve(token);
    if (!command) {
      throw new CockpitError("VALIDATION_ERROR", "unknown command: " + token);
    }
    return { command, rest: restTokens.join(" "), isCommand: true };
  }
}
