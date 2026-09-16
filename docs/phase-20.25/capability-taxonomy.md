# Phase 20.25 — Capability Taxonomy

Capabilities are the comparison currency: many providers can serve one
capability, and the planner speaks only in capabilities. Defined in
`src/agent-os/universal-registry/taxonomy.ts`.

## Namespaces

```text
web.search web.scrape web.crawl
social.search social.tiktok social.youtube social.instagram social.x
research.discover research.extract research.summarize research.analyze
image.generate image.edit image.upscale image.remove_background
video.generate video.extend video.upscale video.audio_generate
llm.reason llm.code llm.review llm.translate
code.generate code.review code.modify code.execute repo.inspect test.run migration.generate
filesystem.read filesystem.write filesystem.move filesystem.delete
shell.execute process.start
git.status git.diff git.commit
browser.navigate browser.click browser.type browser.fill browser.download browser.screenshot browser.extract
stock.keyword stock.metadata stock.quality_review stock.export stock.idea
notification.discord notification.telegram notification.email
media.download media.transcribe
data.transform export.package agent.execute
```

Capability families are the dot-prefix (`web.*`, `social.*`, …). Alias tables
map free text (goals, tool descriptions, MCP tool names) to capabilities.

## Toolchain templates

Deterministic goal decomposition matches templates by keyword hits and merges
in any additional capabilities extracted from the raw goal:

adobe_stock_video_production, adobe_stock_image_production,
adobe_stock_research, research_agent, web_scraping, social_listening,
seo_research, code_review, repository_analysis, media_acquisition.

A goal matching nothing falls back to extracted capabilities, then to the
minimal research loop (`web.search` → `research.summarize`) so every goal
yields a plannable, explainable output. Every fallback is recorded in the
plan's `notes`.

## Extending

1. Add the namespace to `CAPABILITY_NAMESPACES` (kebab/alphabet enforced).
2. Add aliases for extraction.
3. Map it to a permission class in `risk.ts` (`CAPABILITY_PERMISSION`) —
   unmapped capabilities default to `read_only` (fail-closed).
