// Phase 20.60 — OpenPost transport seam.
//
// The typed client (client.ts) speaks a *JSON-level* transport so tests can
// inject a deterministic fake (stateful in-memory OpenPost) without any HTTP
// socket. The default transport is fetch-based: bearer auth, hard timeouts via
// AbortSignal, a bounded response body, a correlation ID header, and header
// redaction on failure reporting.

import { mapRemoteStatus, mapTransportFailure, OpenPostRequestError } from "./errors";
import { sanitizeHeaders } from "../secrets";

export interface OpenPostRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path *after* `/api/v1`, e.g. `/publications`. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Raw upload requests bypass JSON bodies (media storage PUT). */
  raw?: { url: string; method: string; headers: Record<string, string>; body: Uint8Array };
  correlationId?: string;
}

export interface OpenPostResponse {
  status: number;
  body: unknown;
}

export interface OpenPostTransport {
  request(req: OpenPostRequest): Promise<OpenPostResponse>;
}

export interface FetchTransportOptions {
  baseUrl: string;
  token: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

const REDACTED = "***";

export function createFetchTransport(options: FetchTransportOptions): OpenPostTransport {
  return {
    async request(req: OpenPostRequest): Promise<OpenPostResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
      try {
        let url: string;
        let init: RequestInit;
        if (req.raw) {
          url = req.raw.url;
          init = {
            method: req.raw.method,
            headers: req.raw.headers,
            body: req.raw.body as unknown as BodyInit,
            signal: controller.signal,
          };
        } else {
          url = options.baseUrl.replace(/\/+$/, "") + "/api/v1" + req.path;
          if (req.query) {
            const qs = new URLSearchParams(req.query).toString();
            if (qs) url += "?" + qs;
          }
          const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: "Bearer " + options.token,
          };
          if (req.correlationId) headers["X-Correlation-Id"] = req.correlationId;
          if (req.body !== undefined) headers["Content-Type"] = "application/json";
          init = {
            method: req.method,
            headers,
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
            signal: controller.signal,
          };
        }

        let response: Response;
        try {
          response = await fetch(url, init);
        } catch (cause) {
          throw new OpenPostRequestError(mapTransportFailure(cause));
        }

        const contentType = response.headers.get("content-type") ?? "";
        let body: unknown = null;
        if (contentType.includes("application/json")) {
          const text = await response.text();
          if (text.length > options.maxResponseBytes) {
            throw new OpenPostRequestError({
              code: "OPENPOST_UNAVAILABLE",
              httpStatus: 502,
              message: "OpenPost response exceeded the configured size bound.",
              remoteStatus: response.status,
            });
          }
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = { raw: text.slice(0, 2048) };
          }
        }

        if (response.status >= 400) {
          const preview = typeof body === "object" && body !== null ? JSON.stringify(body) : "";
          throw new OpenPostRequestError(mapRemoteStatus(response.status, preview));
        }
        return { status: response.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export { REDACTED, sanitizeHeaders };
