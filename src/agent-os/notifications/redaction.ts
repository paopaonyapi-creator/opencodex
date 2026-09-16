import { redactSecretString } from "../../lib/redact";

const DISCORD_WEBHOOK_SECRET = /https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api(?:\/v\d+)?\/webhooks\/([0-9]+)\/[^\s/?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?/gi;

export function redactNotificationSecrets(value: string): string {
  const withoutWebhookToken = value.replace(DISCORD_WEBHOOK_SECRET, (match, webhookId: string) => {
    const parsed = /^https:\/\/([^/]+)\/api(?:\/v\d+)?\/webhooks\//i.exec(match);
    const host = parsed?.[1] ?? "discord.com";
    return `https://${host}/api/webhooks/${webhookId}/[REDACTED]`;
  });
  return redactSecretString(withoutWebhookToken);
}
