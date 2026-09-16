// Phase 20.23 — Discord webhook provider adapter.

import { redactNotificationSecrets } from "../redaction";
import { classifyNotificationFailure, type NotificationFailureClassification } from "../retry";
import type {
  DiscordRateLimitObservation,
  NotificationAggregation,
  NotificationDelivery,
  NotificationDestination,
  NotificationEvent,
} from "../types";
import { parseDiscordRateLimitResponse } from "./headers";
import { DiscordNotificationRenderer, type DiscordWebhookPayload } from "./renderer";
import { validateDiscordWebhookUrl } from "./url-policy";

export interface ProviderSendRequest {
  delivery: NotificationDelivery;
  event: NotificationEvent;
  destination: NotificationDestination;
  aggregation?: NotificationAggregation | null;
  attempt: number;
  nowMs?: number;
}

export interface ProviderSendResult {
  status: number;
  headers: Headers;
  rateLimit: DiscordRateLimitObservation;
  bodyText?: string;
  providerMessageId?: string | null;
  durationMs: number;
}

export interface DestinationValidationResult {
  ok: boolean;
  reason?: string;
}

export interface DiscordWebhookProviderOptions {
  fetchFn?: typeof fetch;
  secretResolver?: (secretRef: string) => string | null | undefined;
  timeoutMs?: number;
  renderer?: DiscordNotificationRenderer;
}

export class DiscordWebhookProvider {
  readonly id = "discord_webhook" as const;
  readonly name = "Discord Webhook";
  private readonly fetchFn: typeof fetch;
  private readonly secretResolver: (secretRef: string) => string | null | undefined;
  private readonly timeoutMs: number;
  private readonly renderer: DiscordNotificationRenderer;

  constructor(options: DiscordWebhookProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.renderer = options.renderer ?? new DiscordNotificationRenderer();
    this.secretResolver = options.secretResolver ?? ((ref: string) => {
      if (ref.startsWith("env:")) {
        const envKey = ref.slice(4);
        return process.env[envKey] ?? process.env.DISCORD_WEBHOOK_URL;
      }
      if (ref.startsWith("https://")) {
        return ref;
      }
      return process.env.DISCORD_WEBHOOK_URL;
    });
  }

  async validateDestination(destination: NotificationDestination): Promise<DestinationValidationResult> {
    const rawUrl = this.secretResolver(destination.secretRef);
    if (!rawUrl) {
      return { ok: false, reason: `secretRef '${destination.secretRef}' could not be resolved` };
    }
    const validation = validateDiscordWebhookUrl(rawUrl);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }
    return { ok: true };
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    const nowMs = request.nowMs ?? Date.now();
    const rawUrl = this.secretResolver(request.destination.secretRef);
    if (!rawUrl) {
      throw new Error(`cannot send: secretRef '${request.destination.secretRef}' not resolved`);
    }

    const validation = validateDiscordWebhookUrl(rawUrl);
    if (!validation.ok) {
      throw new Error(`cannot send: ${validation.reason}`);
    }

    const webhookUrl = validation.url.toString();
    const payload: DiscordWebhookPayload = this.renderer.render(request.event, request.aggregation);
    const bodyJson = JSON.stringify(payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startTime = Date.now();

    try {
      const response = await this.fetchFn(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Pao-hubPro-Notification-Gateway/1.0",
        },
        body: bodyJson,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }

      const rateLimit = parseDiscordRateLimitResponse({
        status: response.status,
        headers: response.headers,
        bodyText,
        nowMs,
      });

      let providerMessageId: string | null = null;
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText) as Record<string, unknown>;
          if (parsed && typeof parsed.id === "string") {
            providerMessageId = parsed.id;
          }
        } catch {
          // ignore non-json
        }
      }

      return {
        status: response.status,
        headers: response.headers,
        rateLimit,
        bodyText: redactNotificationSecrets(bodyText),
        providerMessageId,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      const safeMessage = redactNotificationSecrets(message);
      const error = new Error(safeMessage);
      if (err instanceof Error && err.name) {
        error.name = err.name;
      }
      if (err && typeof err === "object" && "code" in err) {
        (error as unknown as Record<string, unknown>).code = (err as Record<string, unknown>).code;
      }
      (error as unknown as Record<string, unknown>).durationMs = durationMs;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  classifyError(error: unknown, response?: { status?: number }): NotificationFailureClassification {
    return classifyNotificationFailure({ status: response?.status, error });
  }
}
