// Phase 20.20 — Deterministic platform and capability classification (spec section 10).
//
// Provider tool titles/descriptions/categories are inconsistent, so classification is
// keyword-rule based and deterministic first. When nothing matches, the result stays
// "unknown" / [] — the classifier never guesses a platform from a generic title, and
// AI-inferred classification is deferred (not built in this phase).

import type { SocialCapability, SocialPlatform } from "./types";

interface PlatformRule {
  platform: SocialPlatform;
  patterns: RegExp[];
}

/**
 * Order matters only for specificity: a rule matching a platform's distinctive
 * product nouns (e.g. "subreddit", "shortcode", "handle") outranks a rule that
 * merely names the platform, because vendor titles often contain several
 * platform names ("TikTok + Instagram Cross-Poster").
 */
const PLATFORM_RULES: readonly PlatformRule[] = [
  { platform: "tiktok", patterns: [/\btiktok\b/i, /\btik ?tok\b/i, /\bsounds? for business\b/i] },
  { platform: "instagram", patterns: [/\binstagram\b/i, /\big\b(?=[ -]?(profile|post|reel|hashtag|scraper))/i, /\breels?\b/i, /\bstories?\b(?=.*(scraper|downloader|viewer))/i, /\bshortcode\b/i] },
  { platform: "youtube", patterns: [/\byoutube\b/i, /\byt\b(?=[ -]?(video|channel|short|scraper|transcript))/i, /\bshorts\b/i] },
  { platform: "facebook", patterns: [/\bfacebook\b/i, /\bfb\b(?=[ -]?(page|group|post|ads))/i] },
  { platform: "x_twitter", patterns: [/\btwitter\b/i, /\bx\s*\(.*twitter.*\)/i, /\btweets?\b/i, /\btweeters?\b/i] },
  { platform: "reddit", patterns: [/\breddit\b/i, /\bsubreddit\b/i, /\br\/[a-z0-9_]+/i] },
  { platform: "linkedin", patterns: [/\blinkedin\b/i] },
  { platform: "pinterest", patterns: [/\bpinterest\b/i, /\bpins?\b(?=.*(scraper|downloader|keyword))/i] },
  { platform: "bluesky", patterns: [/\bbluesky\b/i, /\bsky\.app\b/i, /\bb sky\b/i] },
  { platform: "telegram", patterns: [/\btelegram\b/i, /\btg\b(?=[ -]?(channel|group|message))/i] },
  { platform: "discord", patterns: [/\bdiscord\b/i, /\bguild\b(?=.*(scraper|member|message))/i] },
  { platform: "spotify", patterns: [/\bspotify\b/i, /\bplaylists?\b(?=.*(scraper|metadata|track))/i] },
];

const CAPABILITY_RULES: ReadonlyArray<{ capability: SocialCapability; patterns: RegExp[] }> = [
  { capability: "search_videos", patterns: [/\bvideo(s)?\b/i, /\bshorts?\b/i, /\breels?\b/i, /\bclip(s)?\b/i] },
  { capability: "search_posts", patterns: [/\bpost(s)?\b/i, /\btweets?\b/i, /\bpins?\b/i, /\bmedia\b/i] },
  { capability: "search_profiles", patterns: [/\bprofile(s)?\b/i, /\baccounts?\b/i, /\busers?\b(?=.*(scraper|search|finder))/i, /\bhandles?\b/i] },
  { capability: "get_profile", patterns: [/\bprofile\s?(detail|info|data)/i, /\buser\s?(detail|info|data)/i] },
  { capability: "get_post", patterns: [/\bpost\s?(detail|info|data|by url)/i] },
  { capability: "get_video", patterns: [/\bvideo\s?(detail|info|data|by url)/i] },
  { capability: "get_comments", patterns: [/\bcomments?\b/i, /\breplies\b/i] },
  { capability: "get_replies", patterns: [/\brepl(y|ies|ies_thread)\b/i, /\bthread(s)?\b/i] },
  { capability: "get_hashtag", patterns: [/\bhashtag\s?(detail|info|data)/i] },
  { capability: "search_hashtags", patterns: [/\bhashtags?\b/i] },
  { capability: "get_trending", patterns: [/\btrend(s|ing)?\b/i, /\bviral\b/i, /\bpopular\b/i, /\bdiscover\b/i] },
  { capability: "search_keyword", patterns: [/\bkeyword(s)?\b/i, /\bsearch\b/i, /\bquery\b/i] },
  { capability: "search_music", patterns: [/\bmusic\b/i, /\bsounds?\b/i, /\baudio\b/i] },
  { capability: "get_music", patterns: [/\bmusic\s?(detail|info|metadata)/i] },
  { capability: "get_channel", patterns: [/\bchannel\s?(detail|info|data)\b/i] },
  { capability: "get_channel_videos", patterns: [/\bchannel\s?(videos|uploads)\b/i] },
  { capability: "get_transcript", patterns: [/\btranscript(s)?\b/i, /\bcaptions?\b/i, /\bsubtitles?\b/i] },
  { capability: "get_engagement_metrics", patterns: [/\bengagement\b/i, /\blikes?\b/i, /\bviews?\b/i, /\bfollowers?\b/i, /\bshares?\b/i, /\bstats?\b/i] },
  { capability: "get_public_metadata", patterns: [/\bmetadata\b/i, /\bmeta\b/i] },
  { capability: "get_search_suggestions", patterns: [/\bsuggest(ion|ed)?s?\b/i, /\bautocomplete\b/i] },
  { capability: "get_related_topics", patterns: [/\brelated\b/i, /\btopics?\b/i] },
  { capability: "get_public_page", patterns: [/\bpage(s)?\b/i] },
  { capability: "get_public_group", patterns: [/\bgroups?\b/i, /\bcommunit(y|ies)\b/i] },
];

/** Classify a platform from free-text metadata; "multi" only when distinct platforms both match. */
export function classifyPlatform(...texts: Array<string | null | undefined>): SocialPlatform {
  const haystack = texts.filter(Boolean).join(" ");
  if (!haystack.trim()) return "unknown";

  const matched = new Set<SocialPlatform>();
  for (const rule of PLATFORM_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(haystack)) {
        matched.add(rule.platform);
        break;
      }
    }
  }

  if (matched.size === 0) return "unknown";
  if (matched.size === 1) return [...matched][0]!;
  // More than one distinct platform: only claim "multi" when the title itself is
  // explicitly cross-platform; otherwise prefer the first specific platform match
  // in rule order (most specific product noun) rather than diluting to "multi".
  const explicitMulti = /\b(tiktok|instagram|youtube|facebook|twitter|reddit)\b[^\n]{0,40}\b(tiktok|instagram|youtube|facebook|twitter|reddit)\b/i.test(haystack);
  return explicitMulti ? "multi" : [...matched][0]!;
}

/** Classify capabilities from free-text metadata; [] when nothing is evidenced. */
export function classifyCapabilities(...texts: Array<string | null | undefined>): SocialCapability[] {
  const haystack = texts.filter(Boolean).join(" ");
  if (!haystack.trim()) return [];

  const matched: SocialCapability[] = [];
  for (const rule of CAPABILITY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(haystack)) {
        matched.push(rule.capability);
        break;
      }
    }
  }
  return matched;
}
