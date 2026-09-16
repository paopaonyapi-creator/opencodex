export type DiscordWebhookUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const DISCORD_WEBHOOK_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

const WEBHOOK_PATH = /^\/api(?:\/v\d+)?\/webhooks\/([0-9]+)\/([^/?#]+)$/;

export function validateDiscordWebhookUrl(value: string): DiscordWebhookUrlValidation {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Discord webhook URL is invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Discord webhook URL must use HTTPS" };
  if (url.username || url.password) return { ok: false, reason: "Discord webhook URL must not include user information" };
  if (!DISCORD_WEBHOOK_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, reason: "Discord webhook host is not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "Discord webhook URL must use the default HTTPS port" };
  if (url.search || url.hash) return { ok: false, reason: "Discord webhook URL must not include a query or fragment" };
  const match = WEBHOOK_PATH.exec(url.pathname);
  if (!match || match[2]!.length < 1) return { ok: false, reason: "Discord webhook path is invalid" };
  return { ok: true, url };
}
