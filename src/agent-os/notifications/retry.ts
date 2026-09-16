export interface NotificationFailureClassification {
  retryable: boolean;
  code: string;
  opensCircuit: boolean;
  invalidRequest: boolean;
  disablesDestination: boolean;
}

export function classifyNotificationFailure(input: { status?: number; error?: unknown }): NotificationFailureClassification {
  const status = input.status;
  if (status === 429) return { retryable: true, code: "DISCORD_RATE_LIMITED", opensCircuit: false, invalidRequest: true, disablesDestination: false };
  if (status === 400) return { retryable: false, code: "DISCORD_BAD_REQUEST", opensCircuit: false, invalidRequest: true, disablesDestination: false };
  if (status === 401) return { retryable: false, code: "DISCORD_AUTH_INVALID", opensCircuit: true, invalidRequest: true, disablesDestination: true };
  if (status === 403) return { retryable: false, code: "DISCORD_FORBIDDEN", opensCircuit: true, invalidRequest: true, disablesDestination: true };
  if (status === 404) return { retryable: false, code: "DISCORD_WEBHOOK_NOT_FOUND", opensCircuit: true, invalidRequest: true, disablesDestination: true };
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { retryable: true, code: "DISCORD_SERVER_ERROR", opensCircuit: false, invalidRequest: false, disablesDestination: false };
  }

  const error = input.error;
  const errorCode = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const errorName = error instanceof Error ? error.name : "";
  if (errorName === "AbortError" || errorCode === "ETIMEDOUT") {
    return { retryable: true, code: "DISCORD_TIMEOUT", opensCircuit: false, invalidRequest: false, disablesDestination: false };
  }
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(errorCode)) {
    return { retryable: true, code: "DISCORD_NETWORK_ERROR", opensCircuit: false, invalidRequest: false, disablesDestination: false };
  }
  return { retryable: false, code: "NOTIFY_UNKNOWN_ERROR", opensCircuit: false, invalidRequest: false, disablesDestination: false };
}

export function calculateRetryDelayMs(
  attempt: number,
  config: { baseMs: number; maxMs: number; jitterMs: number },
  random: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(config.maxMs, config.baseMs * (2 ** (normalizedAttempt - 1)));
  const randomValue = Math.min(1, Math.max(0, random()));
  return Math.round(exponential + (config.jitterMs * randomValue));
}
