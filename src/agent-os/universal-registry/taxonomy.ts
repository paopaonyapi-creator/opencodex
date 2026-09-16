// Phase 20.25 — Capability namespace (doc §8) and goal → capability extraction.
//
// Capabilities are the comparison currency of the registry: many providers can
// serve one capability, and the planner speaks only in capabilities. The alias
// map is intentionally small and rule-based; semantic (embedding) search is a
// documented follow-up behind the same search interface.

export const CAPABILITY_NAMESPACES = [
  "web.search", "web.scrape", "web.crawl",
  "social.search", "social.tiktok", "social.youtube", "social.instagram", "social.x",
  "social.douyin.inspect", "social.douyin.download", "social.douyin.search",
  "social.douyin.hot_board", "social.douyin.profile.sync", "social.douyin.comments.read",
  "social.douyin.replies.read", "social.douyin.transcribe", "social.douyin.live.record",
  "research.discover", "research.extract", "research.summarize", "research.analyze",
  "image.generate", "image.edit", "image.upscale", "image.remove_background",
  "video.generate", "video.extend", "video.upscale", "video.audio_generate",
  "llm.reason", "llm.code", "llm.review", "llm.translate",
  "code.generate", "code.review", "code.modify", "code.execute", "repo.inspect", "test.run", "migration.generate",
  "filesystem.read", "filesystem.write", "filesystem.move", "filesystem.delete",
  "shell.execute", "process.start",
  "git.status", "git.diff", "git.commit",
  "browser.navigate", "browser.click", "browser.type", "browser.fill", "browser.download", "browser.screenshot", "browser.extract",
  "stock.keyword", "stock.metadata", "stock.quality_review", "stock.export", "stock.idea",
  "notification.discord", "notification.telegram", "notification.email",
  "control.agent.list", "control.agent.health", "control.agent.session.start",
  "control.agent.session.cancel", "control.agent.access.set", "control.context.snapshot",
  "control.gate.check", "control.gate.strict", "control.evidence.list",
  "control.provider.list", "control.provider.verify", "control.git.release.compare",
  "media.download", "media.transcribe",
  "data.transform", "export.package", "agent.execute",
] as const;

export type Capability = (typeof CAPABILITY_NAMESPACES)[number];

const CAPABILITY_ALIASES: Record<Capability, string[]> = {
  "web.search": ["search", "google", "serp", "query engine", "search engine"],
  "web.scrape": ["scrape", "scraper", "scraping", "extract html", "parse page"],
  "web.crawl": ["crawl", "crawler", "spider", "site map"],
  "social.search": ["social media", "social listening", "social trends"],
  "social.tiktok": ["tiktok", "tik tok"],
  "social.youtube": ["youtube", "video search"],
  "social.instagram": ["instagram", "insta"],
  "social.x": ["twitter", " x ", "tweet", "x.com"],
  "social.douyin.inspect": ["douyin inspect", "douyin url"],
  "social.douyin.download": ["douyin download", "douyin video download"],
  "social.douyin.search": ["douyin search", "douyin keyword", "douyin"],
  "social.douyin.hot_board": ["douyin hot", "douyin trend board", "hot board"],
  "social.douyin.profile.sync": ["douyin creator", "douyin profile sync", "douyin creator sync"],
  "social.douyin.comments.read": ["douyin comments"],
  "social.douyin.replies.read": ["douyin replies"],
  "social.douyin.transcribe": ["douyin transcript", "douyin transcribe"],
  "social.douyin.live.record": ["douyin live", "douyin live record"],
  "control.agent.list": ["control agents", "agent cockpit list"],
  "control.agent.health": ["agent health", "agent doctor"],
  "control.agent.session.start": ["start agent session", "agent session"],
  "control.agent.session.cancel": ["cancel agent session", "stop agent"],
  "control.agent.access.set": ["agent access mode", "set access mode"],
  "control.context.snapshot": ["context snapshot", "pao context"],
  "control.gate.check": ["readiness gate", "gate check", "production readiness"],
  "control.gate.strict": ["strict gate", "strict production gate"],
  "control.evidence.list": ["evidence ledger", "list evidence"],
  "control.provider.list": ["provider list", "provider board"],
  "control.provider.verify": ["verify provider", "provider verification"],
  "control.git.release.compare": ["release compare", "release drift"],
  "research.discover": ["discover", "find trends", "trend research", "market research"],
  "research.extract": ["extract", "collect evidence", "pull data"],
  "research.summarize": ["summarize", "summary", "digest", "condense"],
  "research.analyze": ["analyze", "analysis", "cluster", "signal", "study"],
  "image.generate": ["generate image", "image generation", "text to image", "create picture", "render image", "make image"],
  "image.edit": ["edit image", "inpaint", "retouch"],
  "image.upscale": ["upscale", "super resolution", "enhance resolution"],
  "image.remove_background": ["remove background", "background removal", "cutout"],
  "video.generate": ["generate video", "generate a video", "video generation", "text to video", "make video", "make a video", "render video", "produce a video", "video production"],
  "video.extend": ["extend video", "video continuation"],
  "video.upscale": ["upscale video", "video resolution"],
  "video.audio_generate": ["generate audio", "voiceover", "text to speech", "tts", "narration", "soundtrack"],
  "llm.reason": ["reason", "think", "plan", "summarize with ai", "chat", "assistant"],
  "llm.code": ["write code", "coding model", "implement"],
  "llm.review": ["review output", "critique", "quality review", "evaluate"],
  "llm.translate": ["translate", "translation"],
  "code.generate": ["generate code", "scaffold", "write function"],
  "code.review": ["code review", "review pull request", "pr review"],
  "code.modify": ["modify code", "refactor", "patch code"],
  "code.execute": ["run code", "execute code", "sandbox"],
  "repo.inspect": ["inspect repository", "repo analysis", "repository analysis", "codebase map"],
  "test.run": ["run tests", "test suite", "verify tests"],
  "migration.generate": ["migration", "schema change"],
  "filesystem.read": ["read file", "open file", "file contents"],
  "filesystem.write": ["write file", "save file", "create file"],
  "filesystem.move": ["move file", "rename file"],
  "filesystem.delete": ["delete file", "remove file"],
  "shell.execute": ["shell", "terminal", "run command", "command execution", "npm install", "cli command"],
  "process.start": ["start process", "launch process", "spawn"],
  "git.status": ["git status"],
  "git.diff": ["git diff", "diff"],
  "git.commit": ["git commit", "commit changes"],
  "browser.navigate": ["navigate", "open url", "browse to", "visit page"],
  "browser.click": ["click", "press button"],
  "browser.type": ["type text", "keyboard input"],
  "browser.fill": ["fill form", "form input"],
  "browser.download": ["download file", "browser download"],
  "browser.screenshot": ["screenshot", "capture page"],
  "browser.extract": ["extract from page", "page content", "read webpage"],
  "stock.keyword": ["stock keyword", "stock trend", "adobe stock keyword"],
  "stock.metadata": ["stock metadata", "metadata tag", "title description keywords"],
  "stock.quality_review": ["stock qc", "commercial usability", "stock review"],
  "stock.export": ["stock export", "export package", "submit to stock"],
  "stock.idea": ["stock concept", "stock idea", "generate stock concept"],
  "notification.discord": ["discord", "discord webhook"],
  "notification.telegram": ["telegram"],
  "notification.email": ["email", "smtp", "send mail"],
  "media.download": ["download video", "download media", "yt-dlp", "fetch video"],
  "media.transcribe": ["transcribe", "subtitles", "captions", "whisper"],
  "data.transform": ["normalize", "transform data", "clean data", "convert format"],
  "export.package": ["package output", "zip", "bundle"],
  "agent.execute": ["run agent", "delegate to agent", "specialist agent"],
};

/** Map free text (a goal, a tool description, an MCP tool name) to capabilities. */
export function extractCapabilities(text: string): Capability[] {
  const hay = ` ${text.toLowerCase()} `;
  const matched = new Set<Capability>();
  for (const [cap, aliases] of Object.entries(CAPABILITY_ALIASES) as [Capability, string[]][]) {
    if (hay.includes(` ${cap} `) || hay.includes(cap.replace(".", " "))) {
      matched.add(cap);
      continue;
    }
    for (const alias of aliases) {
      if (hay.includes(alias.trim()) && (alias.startsWith(" ") || alias.endsWith(" ") || !alias.includes(" ") || hay.includes(alias))) {
        if (hay.includes(alias.trim())) matched.add(cap);
      }
    }
  }
  return [...matched];
}

/** Expand a capability into its family prefix (search.google → web.search family via aliases). */
export function capabilityFamily(capability: string): string {
  const idx = capability.indexOf(".");
  return idx === -1 ? capability : capability.slice(0, idx);
}

// --- Toolchain templates (doc §49) -------------------------------------------

export interface PlannerTemplate {
  id: string;
  title: string;
  match: string[];
  capabilities: Capability[];
}

export const PLANNER_TEMPLATES: PlannerTemplate[] = [
  {
    id: "adobe_stock_video_production",
    title: "Adobe Stock Video Production",
    match: ["adobe stock", "video production", "stock video"],
    capabilities: ["stock.keyword", "research.analyze", "stock.idea", "video.generate", "video.audio_generate", "stock.quality_review", "stock.metadata", "stock.export"],
  },
  {
    id: "adobe_stock_image_production",
    title: "Adobe Stock Image Production",
    match: ["stock image", "image production", "stock photo"],
    capabilities: ["stock.keyword", "research.analyze", "stock.idea", "image.generate", "image.upscale", "stock.quality_review", "stock.metadata", "stock.export"],
  },
  {
    id: "adobe_stock_research",
    title: "Adobe Stock Research",
    match: ["adobe stock", "stock research", "stock trends", "stock opportunity"],
    capabilities: ["web.search", "social.tiktok", "research.extract", "research.analyze", "stock.keyword", "stock.idea"],
  },
  {
    id: "research_agent",
    title: "Research Agent",
    match: ["research", "investigate", "study topic"],
    capabilities: ["web.search", "research.extract", "research.summarize"],
  },
  {
    id: "web_scraping",
    title: "Web Scraping",
    match: ["scrape", "scraping", "crawl"],
    capabilities: ["web.scrape", "data.transform"],
  },
  {
    id: "social_listening",
    title: "Social Listening",
    match: ["social listening", "social trend", "tiktok trend", "trend tiktok"],
    capabilities: ["social.search", "social.tiktok", "research.analyze", "research.summarize"],
  },
  {
    id: "seo_research",
    title: "SEO Research",
    match: ["seo", "keyword research", "search rank"],
    capabilities: ["web.search", "research.analyze", "research.summarize"],
  },
  {
    id: "code_review",
    title: "Code Review",
    match: ["code review", "review code", "pr review"],
    capabilities: ["repo.inspect", "code.review", "llm.review"],
  },
  {
    id: "repository_analysis",
    title: "Repository Analysis",
    match: ["repository analysis", "analyze repo", "inspect repository", "codebase"],
    capabilities: ["repo.inspect", "research.summarize"],
  },
  {
    id: "media_acquisition",
    title: "Media Acquisition",
    match: ["download video", "acquire media", "fetch video", "download media"],
    capabilities: ["media.download", "media.transcribe", "data.transform"],
  },
];

/**
 * Deterministic goal decomposition: pick the best matching template by keyword
 * hits, then merge in any additional capabilities extracted from the raw goal
 * text that the template does not already cover. Falls back to a minimal
 * research loop so every goal yields a plannable, explainable output.
 */
export function decomposeGoal(goal: string): { templateId: string | null; capabilities: Capability[]; notes: string[] } {
  const lower = goal.toLowerCase();
  const notes: string[] = [];
  let best: { template: PlannerTemplate; hits: number } | null = null;
  for (const template of PLANNER_TEMPLATES) {
    const hits = template.match.filter((m) => lower.includes(m)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { template, hits };
  }

  const extras = extractCapabilities(goal);
  if (best) {
    const merged = [...best.template.capabilities];
    for (const cap of extras) {
      if (!merged.includes(cap)) {
        merged.push(cap);
        notes.push(`added capability ${cap} from goal text`);
      }
    }
    return { templateId: best.template.id, capabilities: merged, notes };
  }

  if (extras.length > 0) {
    notes.push("no template matched; using capabilities extracted from the goal text");
    return { templateId: null, capabilities: extras, notes };
  }

  notes.push("no template or capability matched; falling back to the minimal research loop");
  return { templateId: null, capabilities: ["web.search", "research.summarize"], notes };
}
