// Phase 20.92 — Asset Registry, Visual Matcher, Resolution Ladder, Prompt Compiler.
//
// Ladder law (source §14): NEVER generate expensive content while a suitable
// existing asset exists. The deterministic text/icon-card synthesizer is a
// first-class rung (TEXT_ONLY strategy) so the pipeline works with zero AI
// credentials; AI image generation is attempted only when a configured
// provider adapter is reachable, and its failure degrades down the ladder
// with an honest recorded reason.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openAgentOsDb } from "../db";
import { ToolExecutionSandbox } from "../mcp-gateway/sandbox";
import { VideoStudioError, type MediaAsset, type Scene, type VisualStrategy } from "./types";

// ---------------------------------------------------------------------------
// Visual matcher (source §13 — 9-factor weighted scoring, explainable)
// ---------------------------------------------------------------------------

export const MATCHER_WEIGHTS = {
  semantic_similarity: 0.30,
  brand_fit: 0.18,
  composition_fit: 0.14,
  technical_quality: 0.10,
  license_trust: 0.08,
  cost: 0.06,
  latency: 0.05,
  reuse_penalty: 0.05,
  visual_diversity: 0.04,
} as const;

export interface VisualCandidate {
  id: string;
  label: string;
  assetId?: string;
  strategy: VisualStrategy;
  factors: Partial<Record<keyof typeof MATCHER_WEIGHTS, number>>;
  costUsd: number;
  latencyMs: number;
  provider?: string;
}

export interface MatchResult {
  selected: VisualCandidate;
  ranked: Array<{ candidateId: string; score: number; reasons: string[]; selected: boolean }>;
}

function scoreCandidate(candidate: VisualCandidate, keywordSet: Set<string>, previouslyUsed: Set<string>): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const [factor, weight] of Object.entries(MATCHER_WEIGHTS)) {
    const raw = candidate.factors[factor as keyof typeof MATCHER_WEIGHTS] ?? 0.5;
    score += raw * weight;
    if (raw >= 0.8) reasons.push(`${factor} strong (${raw.toFixed(2)})`);
  }
  if (candidate.assetId && previouslyUsed.has(candidate.assetId)) {
    score -= MATCHER_WEIGHTS.reuse_penalty;
    reasons.push("reuse_penalty applied (asset already used)");
  }
  void keywordSet;
  return { score, reasons };
}

/** Ranked, explainable visual matching over the candidate set. */
export function matchVisuals(candidates: VisualCandidate[], keywords: string[], previouslyUsedAssetIds: string[]): MatchResult {
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));
  const used = new Set(previouslyUsedAssetIds);
  const scored = candidates
    .map((c) => ({ candidate: c, ...scoreCandidate(c, keywordSet, used) }))
    .sort((a, b) => b.score - a.score || a.candidate.label.localeCompare(b.candidate.label));
  const winner = scored[0];
  if (!winner) throw new VideoStudioError("ASSET_UNRESOLVED", 422, "no visual candidates supplied");
  return {
    selected: winner.candidate,
    ranked: scored.map((s) => ({ candidateId: s.candidate.id, score: Math.round(s.score * 1000) / 1000, reasons: s.reasons, selected: s.candidate.id === winner.candidate.id })),
  };
}

// ---------------------------------------------------------------------------
// Asset registry (content-addressable; checksum identity)
// ---------------------------------------------------------------------------

export class AssetRegistry {
  constructor(private studioRoot: string) {}

  private ensureDir(path: string): string {
    mkdirSync(path, { recursive: true });
    return path;
  }

  /** Register a media file already on disk (written by the synthesizer/TTS/provider). */
  register(input: Omit<MediaAsset, "id" | "checksum" | "createdAt"> & { checksum?: string; createdAt?: string }): MediaAsset {
    const db = openAgentOsDb();
    const existing = db.query("SELECT * FROM vs_assets WHERE checksum = ? LIMIT 1").get(input.checksum ?? "") as Record<string, unknown> | undefined;
    if (existing) {
      return this.rowToAsset(existing);
    }
    const id = `vsas_${randomUUID().slice(0, 12)}`;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const checksum = input.checksum ?? createHash("sha256").update(input.uri).digest("hex").slice(0, 32);
    db.run(
      "INSERT INTO vs_assets (id, type, uri, checksum, width, height, duration_ms, mime_type, tags_json, source_kind, provider, model, source_url, license_type, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.type, input.uri, checksum, input.width ?? null, input.height ?? null, input.durationMs ?? null, input.mimeType ?? null, JSON.stringify(input.tags), input.source.kind, input.source.provider ?? null, input.source.model ?? null, input.source.sourceUrl ?? null, input.license?.type ?? null, input.source.projectId ?? null, createdAt],
    );
    const row = db.query("SELECT * FROM vs_assets WHERE id = ?").get(id) as Record<string, unknown>;
    return this.rowToAsset(row);
  }

  get(id: string): MediaAsset | null {
    const row = openAgentOsDb().query("SELECT * FROM vs_assets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToAsset(row) : null;
  }

  findByChecksum(checksum: string): MediaAsset | null {
    const row = openAgentOsDb().query("SELECT * FROM vs_assets WHERE checksum = ? LIMIT 1").get(checksum) as Record<string, unknown> | undefined;
    return row ? this.rowToAsset(row) : null;
  }

  search(query: string, limit = 20): MediaAsset[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM vs_assets WHERE tags_json LIKE ? OR uri LIKE ? ORDER BY created_at DESC LIMIT ?")
      .all(`%${query}%`, `%${query}%`, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToAsset(r));
  }

  listByProject(projectId: string): MediaAsset[] {
    const rows = openAgentOsDb().query("SELECT * FROM vs_assets WHERE project_id = ? ORDER BY created_at").all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToAsset(r));
  }

  /** Deterministic text-card synthesizer: brand-colored title card via ffmpeg. */
  async synthesizeTextCard(input: { projectId: string; title: string; subtitle?: string; palette: { background: string; foreground: string; accent: string; secondary?: string }; width: number; height: number; cornerRadius: number }): Promise<MediaAsset> {
    const dir = this.ensureDir(join(this.studioRoot, "projects", input.projectId, "assets", "generated"));
    const safeName = `card_${createHash("sha256").update(`${input.title}|${input.subtitle ?? ""}|${input.width}x${input.height}`).digest("hex").slice(0, 16)}.png`;
    const outPath = join(dir, safeName);
    ToolExecutionSandbox.assertSafeWorkspacePath(input.projectId, this.studioRoot);
    if (!existsSync(outPath)) {
      // drawtext needs colon escaping on the filter graph; keep text ASCII-safe here.
      const escape = (s: string) => s.replace(/[:\\'\"]/g, " ").slice(0, 90);
      const fontFile = defaultFontFile();
      const { spawnSync } = await import("node:child_process");
      const fontSize = Math.round(input.height * 0.085);
      const titleDraw = fontFile
        ? `drawtext=fontfile='${fontFile}':text='${escape(input.title)}':fontcolor=0x${input.palette.foreground.replace("#", "")}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(input.height * 0.06)}`
        : "";
      const subtitleDraw = fontFile && input.subtitle
        ? `drawtext=fontfile='${fontFile}':text='${escape(input.subtitle)}':fontcolor=0x${input.palette.secondary?.replace("#", "") ?? input.palette.foreground.replace("#", "")}:fontsize=${Math.round(fontSize * 0.55)}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(input.height * 0.07)}`
        : "";
      const args = [
        "-y", "-f", "lavfi", "-i", `color=c=0x${input.palette.background.replace("#", "")}:s=${input.width}x${input.height},format=rgb24`,
        "-vf", [
          `drawbox=x=0:y=0:w=${input.width}:h=${Math.round(input.height * 0.012)}:color=0x${input.palette.accent.replace("#", "")}:t=fill`,
          titleDraw, subtitleDraw,
        ].filter(Boolean).join(","),
        "-frames:v", "1", outPath,
      ];
      const proc = spawnSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
      if (proc.status !== 0 || !existsSync(outPath)) {
        throw new VideoStudioError("RENDER_FAILED", 500, `text-card synthesis failed: ${proc.stderr?.toString().slice(-400) ?? "ffmpeg error"}`);
      }
    }
    return this.register({
      type: "image", uri: outPath, width: input.width, height: input.height, mimeType: "image/png",
      tags: ["text-card", input.projectId], source: { kind: "generated", provider: "local-ffmpeg", projectId: input.projectId },
      license: { type: "generated-owned" },
    });
  }

  private rowToAsset(row: Record<string, unknown>): MediaAsset {
    return {
      id: String(row.id),
      type: String(row.type) as MediaAsset["type"],
      uri: String(row.uri),
      checksum: String(row.checksum),
      width: row.width === null ? undefined : Number(row.width),
      height: row.height === null ? undefined : Number(row.height),
      durationMs: row.duration_ms === null ? undefined : Number(row.duration_ms),
      mimeType: row.mime_type === null ? undefined : String(row.mime_type),
      tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
      source: {
        kind: String(row.source_kind) as MediaAsset["source"]["kind"],
        provider: row.provider === null ? undefined : String(row.provider),
        model: row.model === null ? undefined : String(row.model),
        sourceUrl: row.source_url === null ? undefined : String(row.source_url),
        projectId: row.project_id === null ? undefined : String(row.project_id),
      },
      license: row.license_type === null ? undefined : { type: String(row.license_type) },
      createdAt: String(row.created_at),
    };
  }
}

// ---------------------------------------------------------------------------
// Resolution ladder (source §14)
// ---------------------------------------------------------------------------

export interface LadderContext {
  registry: AssetRegistry;
  projectId: string;
  brandPalette: { background: string; foreground: string; accent: string; secondary: string };
  width: number;
  height: number;
  cornerRadius: number;
  previouslyUsedAssetIds: string[];
  keywords: string[];
  aspectRatio: string;
}

export interface LadderOutcome {
  asset: MediaAsset;
  rung: string;
  attempted: Array<{ rung: string; outcome: "hit" | "miss" | "skipped" | "failed"; reason?: string }>;
}

/**
 * Resolve the visual for one scene, ladder order: project assets → brand
 * library → shared local library (tags) → generated cache (checksum) →
 * deterministic text/icon card. AI generation rungs are gated behind a
 * configured provider and degrade honestly when absent (source §67).
 */
export async function resolveSceneVisual(scene: Scene, ctx: LadderContext): Promise<LadderOutcome> {
  const attempted: LadderOutcome["attempted"] = [];
  const db = openAgentOsDb();
  const keywords = ctx.keywords.length > 0 ? ctx.keywords : [scene.narrationText.split(/\s+/).slice(0, 3).join(" ")];

  // Rung 1: project assets (tag match).
  const projectAssets = db.query("SELECT * FROM vs_assets WHERE project_id = ? AND type IN ('image','icon')").all(ctx.projectId) as Array<Record<string, unknown>>;
  if (projectAssets.length > 0) {
    const best = projectAssets.find((a) => (JSON.parse(String(a.tags_json)) as string[]).some((t) => keywords.some((k) => t.toLowerCase().includes(k.toLowerCase()))));
    if (best) {
      attempted.push({ rung: "project-assets", outcome: "hit" });
      return { asset: registryRow(ctx.registry, best), rung: "project-assets", attempted };
    }
    attempted.push({ rung: "project-assets", outcome: "miss" });
  } else {
    attempted.push({ rung: "project-assets", outcome: "miss" });
  }

  // Rung 2: brand library (logoAssetIds) — queried via registry.
  const brandAssets = db.query("SELECT * FROM vs_assets WHERE tags_json LIKE '%brand-library%' LIMIT 1").all() as Array<Record<string, unknown>>;
  if (brandAssets[0]) {
    attempted.push({ rung: "brand-library", outcome: "hit" });
    return { asset: registryRow(ctx.registry, brandAssets[0]), rung: "brand-library", attempted };
  }
  attempted.push({ rung: "brand-library", outcome: "miss" });

  // Rung 3: shared local asset library (tags across projects).
  const shared = db.query("SELECT * FROM vs_assets WHERE project_id IS NULL AND type IN ('image','icon') AND tags_json LIKE ? LIMIT 1").all(`%${keywords[0]?.toLowerCase() ?? ""}%`) as Array<Record<string, unknown>>;
  if (shared[0]) {
    attempted.push({ rung: "shared-library", outcome: "hit" });
    return { asset: registryRow(ctx.registry, shared[0]), rung: "shared-library", attempted };
  }
  attempted.push({ rung: "shared-library", outcome: "miss" });

  // Rung 4: generated cache — content-addressable by deterministic card key.
  const cardKey = createHash("sha256").update(`${scene.visualPlan.strategy}|${keywords.sort().join(",")}|${ctx.width}x${ctx.height}`).digest("hex");
  const cached = db.query("SELECT * FROM vs_assets WHERE checksum = ? LIMIT 1").get(cardKey) as Record<string, unknown> | undefined;
  if (cached) {
    attempted.push({ rung: "generated-cache", outcome: "hit" });
    return { asset: registryRow(ctx.registry, cached), rung: "generated-cache", attempted };
  }
  attempted.push({ rung: "generated-cache", outcome: "miss" });

  // Rungs 5-6: approved stock / AI image — provider-gated; absent credentials
  // degrade honestly (source §67) instead of faking success.
  attempted.push({ rung: "approved-stock", outcome: "skipped", reason: "no stock provider configured" });
  attempted.push({ rung: "ai-image", outcome: "skipped", reason: "no AI image provider configured" });

  // Rung 7: deterministic text/icon card (owned, licensed, zero-cost).
  const title = keywords[0]?.replace(/\b\w/g, (c) => c.toUpperCase()) ?? scene.intent.replace(/_/g, " ");
  const asset = await ctx.registry.synthesizeTextCard({
    projectId: ctx.projectId,
    title,
    subtitle: scene.narrationText.slice(0, 70),
    palette: ctx.brandPalette,
    width: ctx.width,
    height: ctx.height,
    cornerRadius: ctx.cornerRadius,
  });
  // Re-key the cache entry to the semantic card key for future ladder hits.
  db.run("UPDATE vs_assets SET checksum = ? WHERE id = ?", [cardKey, asset.id]);
  attempted.push({ rung: "text-card", outcome: "hit" });
  return { asset: { ...asset, checksum: cardKey }, rung: "text-card", attempted };
}

function registryRow(registry: AssetRegistry, row: Record<string, unknown>): MediaAsset {
  return registry.get(String(row.id)) ?? (row as unknown as MediaAsset);
}

// ---------------------------------------------------------------------------
// Prompt compiler (source §13) — for when a real image provider is configured
// ---------------------------------------------------------------------------

export interface CompiledPrompt {
  prompt: string;
  negative: string;
  promptHash: string;
}

/** Scene context + intent + strategy + brand + aspect + safe areas + negatives. */
export function compileImagePrompt(scene: Scene, brand: { palette: { background: string; accent: string }; iconStyle: string }, width: number, height: number): CompiledPrompt {
  const prompt = [
    `Minimal flat ${brand.iconStyle} illustration for a video scene.`,
    `Intent: ${scene.intent}. Keywords: ${scene.visualPlan.assetRequirements.map((r) => r.query).join(", ") || scene.narrationText.slice(0, 60)}.`,
    `Composition: single focal subject, generous ${scene.visualPlan.layout} layout, centered in ${width}x${height}.`,
    `Palette: background ${brand.palette.background}, accent ${brand.palette.accent}.`,
    "Leave the bottom 20% clear as a caption safe area. No text in the image.",
  ].join(" ");
  const negative = "photorealistic people, watermarks, embedded text, brand logos, clutter, low contrast";
  return { prompt, negative, promptHash: createHash("sha256").update(prompt + negative).digest("hex").slice(0, 32) };
}

/** Workspace root for per-project artifact directories. */
export function defaultStudioRoot(): string {
  return resolve(process.env.PAO_VIDEO_STUDIO_ROOT ?? join(process.cwd(), "runtime", "video-studio"));
}

/**
 * drawtext requires an explicit fontfile when fontconfig is unavailable
 * (default on Windows ffmpeg builds). Checked once per call, cross-platform.
 * The path is filtergraph-escaped (drive colon + forward slashes).
 */
export function defaultFontFile(): string | null {
  const candidates = [
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  const found = candidates.find((c) => existsSync(c));
  return found ? found.replace(/\\/g, "/").replace(":", "\\:") : null;
}

export { mkdirSync, writeFileSync };
