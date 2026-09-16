# Phase 20.26 — Migration Notes (doc §108-§109)

## Existing Douyin/TikTok logic inventory

| Existing code | Phase | Relationship to 20.26 |
|---|---|---|
| `media-acquisition` provider router (`tiktok.com` platform tag) | 20.24 | TikTok routes to generic providers; Douyin family routes to the new provider. No duplication — separate platforms, one media core. |
| `social` module (Apify providers, `social.tiktok` capability) | 20.20 | Stays the Apify-based TikTok/social intelligence path. Douyin adds `social.douyin.*` as a sibling family in the Phase 20.25 registry; cross-platform correlation is a documented 20.26.x follow-up. |
| Universal registry `social.tiktok` tools | 20.25 | Unchanged; the douyin ingest source registers its own provider tools with stable `douyin:*` ids (re-sync preserves operator disable state). |
| `catalog seeds` (Apify TikTok Scraper) | 20.25 | Metadata-only catalog entries — unrelated to the executable douyin provider. |

No duplicate downloader, queue, artifact registry, or REST convention was
created; `media_jobs` / `media_artifacts` / the shared Agent OS store remain
the only persistence for acquired media.

## Schema migration

db v31 → v32 is additive (`CREATE TABLE IF NOT EXISTS` for eight
`douyin_*` tables). Safe defaults: new tables start empty; no existing row
is touched; rollback = drop the new tables (they are projections of provider
runs, not sources of truth for acquired artifacts).

## Backward compatibility guarantees

- `media.download` / OmniGet / yt-dlp / native providers: unchanged behavior
  for non-Douyin URLs (verified by regression test).
- Existing MCP tools: untouched.
- Existing artifact paths and usage-class semantics: unchanged; the douyin
  rights hook only fires for Douyin-family sources.
- Existing jobs and registry rows: untouched.
