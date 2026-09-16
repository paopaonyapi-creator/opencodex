// Phase 20.61 — Runtime transport seam.
//
// JSON-level transport so the AmuxAdapter is testable against a fake without
// sockets. The fetch-backed implementation adds bearer auth, timeouts, and a
// bounded response body. HTTP status → typed error mapping lives here so
// every transport behaves identically.

import { RuntimeAdapterError, type RuntimeTransportContract, type RuntimeTransportRequest, type RuntimeTransportResponse } from "./types";
import type { AgentRuntimeErrorCode } from "../types";

export type { RuntimeTransportContract, RuntimeTransportRequest, RuntimeTransportResponse };

export function mapTransportStatus(status: number, path: string): RuntimeAdapterError {
  const code: AgentRuntimeErrorCode =
    status === 401 || status === 403 ? "RUNTIME_AUTH_FAILED"
      : status === 404 ? "RUNTIME_TASK_NOT_FOUND"
        : status === 409 ? "RUNTIME_CONFLICT"
          : "RUNTIME_UNAVAILABLE";
  return new RuntimeAdapterError(code, status >= 500 ? 502 : status, "amux " + path + " responded " + status);
}

export function mapTransportFailure(cause: unknown): RuntimeAdapterError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new RuntimeAdapterError("RUNTIME_UNAVAILABLE", 502, "amux unreachable: " + message);
}

export interface FetchRuntimeTransportOptions {
  baseUrl: string;
  token: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

export function createFetchRuntimeTransport(options: FetchRuntimeTransportOptions): RuntimeTransportContract {
  return {
    async request(req: RuntimeTransportRequest): Promise<RuntimeTransportResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
      try {
        let url = options.baseUrl.replace(/\/+$/, "") + req.path;
        if (req.query) {
          const qs = new URLSearchParams(req.query).toString();
          if (qs) url += "?" + qs;
        }
        const headers: Record<string, string> = { Accept: "application/json" };
        if (options.token) headers["Authorization"] = "Bearer " + options.token;
        if (req.body !== undefined) headers["Content-Type"] = "application/json";
        let response: Response;
        try {
          response = await fetch(url, {
            method: req.method,
            headers,
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
            signal: controller.signal,
          });
        } catch (cause) {
          throw mapTransportFailure(cause);
        }
        const contentType = response.headers.get("content-type") ?? "";
        let body: unknown = null;
        if (contentType.includes("application/json")) {
          const text = await response.text();
          if (text.length > options.maxResponseBytes) {
            throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", 502, "amux response exceeded the size bound");
          }
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = { raw: text.slice(0, 2048) };
          }
        }
        return { status: response.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
