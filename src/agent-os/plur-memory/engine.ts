// Phase 20.43 — Memory engines (spec §7): engine-neutral MemoryEngine with
// two implementations. (1) PlurMemoryAdapter — capability-detected bridge to
// the upstream PLUR CLI (literal binary + literal subcommand + value argv
// positions; shell:false; no shell construction anywhere); activates only
// when `plur` is installed. (2) LocalFallbackEngine — deterministic Pao-
// owned store so the control plane works fully offline; the active engine
// is always disclosed in results.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { MemoryEngine, PlurCapabilityReport } from "./types";

// --- PLUR adapter (CLI bridge; capability-detected) -----------------------------------

export class PlurMemoryAdapter implements MemoryEngine {
  readonly id = "plur" as const;

  private cachedCapability: (PlurCapabilityReport & { probeAt: number }) | null = null;
  private probeTtlMs = 30_000;

  homeDir(): string {
    return process.env.PLUR_PATH ?? join(homedir(), ".plur");
  }

  capabilities(force = false): Promise<PlurCapabilityReport> {
    const now = Date.now();
    if (!force && this.cachedCapability && now - this.cachedCapability.probeAt < this.probeTtlMs) {
      return Promise.resolve(this.cachedCapability);
    }
    const report = this.probe();
    this.cachedCapability = { ...report, probeAt: now };
    return Promise.resolve(report);
  }

  private probe(): PlurCapabilityReport {
    const home = this.homeDir();
    const homeDirAvailable = existsSync(home);
    let cliAvailable = false;
    let cliVersion: string | null = null;
    try {
      // Literal binary + literal flag argv; shell:false (spec §7: no shell
      // construction; safe process execution only).
      const result = spawnSync("plur", ["--version"], { timeout: 5000, maxBuffer: 1024 * 1024, shell: false, windowsHide: true });
      if (result.status === 0 && result.stdout) {
        cliAvailable = true;
        cliVersion = result.stdout.toString("utf8").trim().split("\n")[0] ?? null;
      }
    } catch {
      cliAvailable = false;
    }
    const detail = cliAvailable
      ? "PLUR CLI detected" + (cliVersion ? " (" + cliVersion + ")" : "") + (homeDirAvailable ? "; store accessible" : "; store dir missing")
      : "PLUR CLI not found on PATH" + (homeDirAvailable ? "; store dir present but CLI unavailable" : "; PLUR not installed");
    return { cliAvailable, cliVersion, homeDirAvailable, homeDirPath: home, statusHealthy: cliAvailable ? true : null, detail };
  }

  async available(): Promise<boolean> {
    const caps = await this.capabilities();
    return caps.cliAvailable;
  }

  /** Controlled CLI bridge: literal "plur" binary, literal subcommand at
   *  argv[0], values in dedicated argv positions. Never interpolated. */
  private runCli(subcommand: "learn" | "recall" | "forget" | "feedback" | "rescope" | "status", args: string[], timeoutMs = 20_000): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync("plur", [subcommand, ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, shell: false, windowsHide: true });
    if (result.error) return { ok: false, stdout: "", stderr: result.error.message };
    return {
      ok: result.status === 0,
      stdout: result.stdout ? result.stdout.toString("utf8") : "",
      stderr: result.stderr ? result.stderr.toString("utf8") : "",
    };
  }

  async learn(input: { title: string; content: string; memoryType: string; scope: string; visibility: string; tags: string[] }): Promise<{ engineEngramId: string | null }> {
    const result = this.runCli("learn", ["--title", input.title, "--type", input.memoryType, "--scope", input.scope, "--visibility", input.visibility, "--content", input.content]);
    if (!result.ok) return { engineEngramId: null };
    const parsed = safeJson(result.stdout) as { id?: string; engram_id?: string } | null;
    return { engineEngramId: parsed?.id ?? parsed?.engram_id ?? null };
  }

  async recall(input: { query: string; scopes: string[]; limit: number }): Promise<Array<{ engineEngramId: string | null; title: string; content: string; memoryType: string; scope: string; score: number }>> {
    const result = this.runCli("recall", ["--query", input.query, "--scope", input.scopes.join(","), "--limit", String(input.limit), "--json"]);
    if (!result.ok) return [];
    const parsed = safeJson(result.stdout) as Array<{ id?: string; title?: string; content?: string; type?: string; scope?: string; score?: number }> | null;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      engineEngramId: item.id ?? null,
      title: item.title ?? "",
      content: item.content ?? "",
      memoryType: item.type ?? "note",
      scope: item.scope ?? "local",
      score: item.score ?? 0,
    }));
  }

  async forget(plurEngramId: string | null): Promise<boolean> {
    if (!plurEngramId) return false;
    return this.runCli("forget", ["--id", plurEngramId, "--yes"]).ok;
  }

  async applyFeedback(plurEngramId: string | null, signal: string): Promise<boolean> {
    if (!plurEngramId) return false;
    return this.runCli("feedback", ["--id", plurEngramId, "--signal", signal]).ok;
  }

  async rescope(plurEngramId: string | null, scope: string): Promise<boolean> {
    if (!plurEngramId) return false;
    return this.runCli("rescope", ["--id", plurEngramId, "--scope", scope]).ok;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// --- Local fallback engine (Pao-owned; disclosed as fallback) ---------------------------

export interface LocalEngramRow {
  id: string;
  contentHash: string;
  title: string;
  content: string;
  memoryType: string;
  scope: string;
  visibility: string;
  state: string;
}

export class LocalFallbackEngine implements MemoryEngine {
  readonly id = "pao-local-fallback" as const;
  private rows = new Map<string, LocalEngramRow>();

  upsert(row: LocalEngramRow): void {
    this.rows.set(row.id, row);
  }

  get(id: string): LocalEngramRow | null {
    return this.rows.get(id) ?? null;
  }

  remove(id: string): boolean {
    return this.rows.delete(id);
  }

  byHash(contentHash: string): LocalEngramRow | null {
    for (const row of this.rows.values()) {
      if (row.contentHash === contentHash && row.state === "active") return row;
    }
    return null;
  }

  async capabilities(): Promise<PlurCapabilityReport> {
    return {
      cliAvailable: false, cliVersion: null, homeDirAvailable: false, homeDirPath: "",
      statusHealthy: true,
      detail: "Pao local deterministic fallback engine; PLUR not required",
    };
  }

  async available(): Promise<boolean> {
    return true;
  }

  async learn(input: { title: string; content: string; memoryType: string; scope: string; visibility: string }): Promise<{ engineEngramId: string }> {
    const id = "lf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    this.rows.set(id, {
      id,
      contentHash: "sha256:" + createHash("sha256").update(input.title + "\n" + input.content).digest("hex").slice(0, 24),
      title: input.title, content: input.content, memoryType: input.memoryType,
      scope: input.scope, visibility: input.visibility, state: "active",
    });
    return { engineEngramId: id };
  }

  /** Deterministic normalized-term scoring over scope-filtered rows
   *  (frequency + title boost — local fallback, disclosed via engine id). */
  async recall(input: { query: string; scopes: string[]; limit: number }): Promise<Array<{ engineEngramId: string | null; title: string; content: string; memoryType: string; scope: string; score: number }>> {
    const terms = input.query.toLowerCase().split(/[^a-z0-9_-]+/).filter((term) => term.length > 1);
    const allowed = new Set(input.scopes);
    const hits: Array<{ engineEngramId: string | null; title: string; content: string; memoryType: string; scope: string; score: number }> = [];
    for (const row of this.rows.values()) {
      if (row.state !== "active" || !allowed.has(row.scope)) continue;
      const title = row.title.toLowerCase();
      const content = row.content.toLowerCase();
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        let termScore = 0;
        if (title.includes(term)) termScore += 3;
        const occurrences = content.split(term).length - 1;
        if (occurrences > 0) termScore += Math.min(3, occurrences);
        if (termScore > 0) matched += 1;
        score += termScore;
      }
      if (matched > 0) hits.push({ engineEngramId: row.id, title: row.title, content: row.content, memoryType: row.memoryType, scope: row.scope, score: score / (terms.length * 6) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, input.limit);
  }

  async forget(id: string | null): Promise<boolean> {
    if (!id) return false;
    const row = this.rows.get(id);
    if (!row) return false;
    row.state = "retired";
    return true;
  }

  async applyFeedback(id: string | null): Promise<boolean> {
    return id !== null && this.rows.has(id);
  }

  async rescope(id: string | null, scope: string): Promise<boolean> {
    if (!id) return false;
    const row = this.rows.get(id);
    if (!row) return false;
    row.scope = scope;
    return true;
  }
}

/** Engine selection: PLUR when available, else the local fallback. */
export async function selectEngine(plur: PlurMemoryAdapter, fallback: LocalFallbackEngine): Promise<MemoryEngine> {
  if (await plur.available()) return plur;
  return fallback;
}
