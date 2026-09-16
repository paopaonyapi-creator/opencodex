// Phase 20.23 — Discord webhook embed and content renderer.

import type {
  NotificationAggregation,
  NotificationEvent,
  NotificationSeverity,
} from "../types";
import { redactNotificationSecrets } from "../redaction";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: DiscordEmbedFooter;
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

const SEVERITY_COLORS: Record<NotificationSeverity, number> = {
  critical: 0xed4245, // Red
  error: 0xed4245,    // Red
  warning: 0xfee75c,  // Yellow
  success: 0x57f287,  // Green
  info: 0x5865f2,     // Blurple
  debug: 0x95a5a6,    // Gray
};

const SEVERITY_ICONS: Record<NotificationSeverity, string> = {
  critical: "🚨",
  error: "❌",
  warning: "⚠️",
  success: "✅",
  info: "ℹ️",
  debug: "🔍",
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export class DiscordNotificationRenderer {
  render(event: NotificationEvent, aggregation?: NotificationAggregation | null): DiscordWebhookPayload {
    if (aggregation && aggregation.eventCount > 1) {
      return this.renderAggregated(event, aggregation);
    }
    return this.renderSingle(event);
  }

  private renderSingle(event: NotificationEvent): DiscordWebhookPayload {
    const icon = SEVERITY_ICONS[event.severity] ?? "📢";
    const color = SEVERITY_COLORS[event.severity] ?? SEVERITY_COLORS.info;

    const fields: DiscordEmbedField[] = [
      { name: "Source", value: `\`${event.source}\``, inline: true },
      { name: "Event Type", value: `\`${event.eventType}\``, inline: true },
      { name: "Priority", value: `\`${event.priority}\``, inline: true },
    ];

    if (event.entityType && event.entityId) {
      fields.push({
        name: "Entity",
        value: `${event.entityType}: \`${event.entityId}\``,
        inline: true,
      });
    }

    if (event.status) {
      fields.push({ name: "Status", value: event.status, inline: true });
    }

    if (event.progress !== null && event.progress !== undefined) {
      fields.push({
        name: "Progress",
        value: `${Math.round(event.progress * 100)}%`,
        inline: true,
      });
    }

    if (event.tags && event.tags.length > 0) {
      fields.push({
        name: "Tags",
        value: event.tags.map((t) => `\`${t}\``).join(" "),
        inline: false,
      });
    }

    // Add additional fields from data
    if (event.data && Object.keys(event.data).length > 0) {
      for (const [key, val] of Object.entries(event.data)) {
        if (fields.length >= 25) break;
        if (val === undefined || val === null) continue;
        const valStr = typeof val === "object" ? JSON.stringify(val) : String(val);
        fields.push({
          name: key,
          value: truncate(redactNotificationSecrets(valStr), 1024),
          inline: true,
        });
      }
    }

    const embed: DiscordEmbed = {
      title: truncate(`${icon} ${event.title}`, 256),
      description: event.message ? truncate(redactNotificationSecrets(event.message), 2048) : undefined,
      color,
      fields: fields.slice(0, 25),
      footer: {
        text: `Pao-hubPro Gateway • ${event.id}`,
      },
      timestamp: event.occurredAt || event.createdAt,
    };

    return {
      embeds: [embed],
    };
  }

  private renderAggregated(event: NotificationEvent, aggregation: NotificationAggregation): DiscordWebhookPayload {
    const icon = SEVERITY_ICONS[event.severity] ?? "📊";
    const color = SEVERITY_COLORS[event.severity] ?? SEVERITY_COLORS.info;

    const fields: DiscordEmbedField[] = [
      { name: "Source", value: `\`${event.source}\``, inline: true },
      { name: "Batch Key", value: `\`${aggregation.aggregationKey}\``, inline: true },
      { name: "Total Events", value: `**${aggregation.eventCount}**`, inline: true },
    ];

    const typeSummary = Object.entries(aggregation.summary.eventTypes)
      .map(([type, count]) => `• \`${type}\`: ${count}`)
      .join("\n");
    if (typeSummary) {
      fields.push({
        name: "Event Types",
        value: truncate(typeSummary, 1024),
        inline: false,
      });
    }

    const metricSummary = Object.entries(aggregation.summary.numericTotals)
      .map(([metric, total]) => `• **${metric}**: ${total}`)
      .join("\n");
    if (metricSummary) {
      fields.push({
        name: "Aggregated Totals",
        value: truncate(metricSummary, 1024),
        inline: false,
      });
    }

    const embed: DiscordEmbed = {
      title: truncate(`${icon} ${event.title} (Batch: ${aggregation.eventCount} items)`, 256),
      description: event.message
        ? truncate(redactNotificationSecrets(event.message), 2048)
        : `Aggregated ${aggregation.eventCount} notification events for batch key \`${aggregation.aggregationKey}\`.`,
      color,
      fields: fields.slice(0, 25),
      footer: {
        text: `Pao-hubPro Gateway • Aggregation ${aggregation.id}`,
      },
      timestamp: event.occurredAt || event.createdAt,
    };

    return {
      embeds: [embed],
    };
  }
}
