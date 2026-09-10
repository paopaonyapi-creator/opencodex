// Phase 20.18 — Pao Grok Production Bridge: HTTP surface.
//
// A small, explicit router over `GrokBridgeService`. Every route except /health
// passes the origin and token checks first, and there is no route that accepts a
// browser cookie or session value — the absence of such a route is the guarantee,
// not a rule in a document.
//
// The bind host is not configurable to a public interface here. The phase forbids
// it by default, and the cheapest way to keep that true is to make the module
// incapable of doing otherwise.

import { jsonResponse } from "../server/auth-cors";
import {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  GrokBridgeService,
  type BridgeConfig,
} from "../agent-os/browser-provider/bridge";
import { getGrokBridgeStore } from "../agent-os/browser-provider/store";
import { getGrokBrowserProvider } from "../agent-os/browser-provider/grok-provider";
import { buildDefaultBridgeConfig } from "./bridge-config";

export interface BridgeServerHandle {
  readonly port: number;
  readonly host: string;
  stop(): void;
}

/** Body size ceiling. A local bridge has no legitimate reason to receive megabytes. */
const MAX_BODY_BYTES = 256 * 1024;

function badRequest(message: string, req: Request): Response {
  return jsonResponse({ error: { code: "bad_request", message } }, 400, req, {});
}

function unauthorized(message: string, req: Request): Response {
  return jsonResponse({ error: { code: "unauthorized", message } }, 401, req, {});
}

function tooLarge(req: Request): Response {
  return jsonResponse(
    { error: { code: "payload_too_large", message: `Body exceeds ${MAX_BODY_BYTES} bytes.` } },
    413,
    req,
    {},
  );
}

/**
 * Read and parse a JSON body with a size ceiling.
 *
 * The length is checked BEFORE parsing so an oversized payload is rejected without
 * being fully buffered, which is the difference between a refusal and a memory
 * problem.
 */
async function readJson(req: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; reason: string }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, reason: "too_large" };
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, reason: "too_large" };
    if (text.trim() === "") return { ok: true, value: {} };
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "not_an_object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

export function createBridgeHandler(service: GrokBridgeService): (req: Request) => Promise<Response> {
  const store = getGrokBridgeStore();
  const provider = getGrokBrowserProvider();

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const origin = req.headers.get("origin");
    const token = req.headers.get("x-pao-bridge-token");

    const refusal = service.authorize({ origin, token, path });
    if (refusal) return unauthorized(refusal, req);

    // -- Health (unauthenticated by design: liveness only) -------------------
    if (path === "/health" && req.method === "GET") {
      return jsonResponse(service.health(), 200, req, {});
    }

    // -- Pairing ------------------------------------------------------------
    if (path === "/v1/extension/pair/start" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.ok) return badRequest(body.reason, req);
      const clientId = String(body.value.clientId ?? "");
      if (clientId === "") return badRequest("clientId is required.", req);
      const issued = service.pairing.issue(clientId);
      return jsonResponse({ clientId, code: issued.code, expiresAt: issued.expiresAt }, 200, req, {});
    }

    if (path === "/v1/extension/pair" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.ok) return badRequest(body.reason, req);
      const clientId = String(body.value.clientId ?? "");
      const code = String(body.value.code ?? "");
      const outcome = service.pairing.redeem(clientId, code);
      if (!outcome.ok) return unauthorized(outcome.reason, req);
      store.audit({ action: "pair", provider: "grok-browser" });
      return jsonResponse({ ok: true, token: service.config.token }, 200, req, {});
    }

    // -- Heartbeat ----------------------------------------------------------
    if (path === "/v1/extension/heartbeat" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.ok) return badRequest(body.reason, req);
      const signals = body.value.signals;
      if (!signals || typeof signals !== "object") return badRequest("signals are required.", req);
      const detection = service.heartbeat({
        extensionVersion: String(body.value.extensionVersion ?? "unknown"),
        signals: signals as never,
      });
      return jsonResponse({ ok: true, detection }, 200, req, {});
    }

    // -- Reports ------------------------------------------------------------
    if (path === "/v1/extension/report" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.ok) return badRequest(body.reason, req);
      const type = String(body.value.type ?? "");
      const jobId = String(body.value.jobId ?? "");
      if (jobId === "") return badRequest("jobId is required.", req);

      if (type === "generation.result") {
        const result = (body.value.result ?? {}) as Record<string, unknown>;
        const updated = service.applyReport({
          jobId,
          state: "collecting",
          results: [
            {
              id: `${jobId}-result`,
              mediaType: "image",
              index: 0,
              sourceUrl: result.sourceUrl ? String(result.sourceUrl) : null,
              localPath: null,
              width: typeof result.width === "number" ? result.width : null,
              height: typeof result.height === "number" ? result.height : null,
              durationSec: null,
              prompt: "",
              sha256: null,
              metadata: { strategy: result.strategy ?? null, confidence: result.confidence ?? null },
            },
          ],
        });
        return jsonResponse({ ok: true, job: updated }, 200, req, {});
      }

      if (type === "generation.error") {
        const updated = service.applyReport({
          jobId,
          state: "failed",
          errorCode: String(body.value.errorCode ?? "GROK_OUTPUT_NOT_FOUND") as never,
          errorMessage: body.value.errorMessage ? String(body.value.errorMessage) : "",
        });
        return jsonResponse({ ok: true, job: updated }, 200, req, {});
      }

      if (type === "generation.state") {
        const updated = service.applyReport({ jobId, state: String(body.value.state) as never });
        return jsonResponse({ ok: true, job: updated }, 200, req, {});
      }

      return badRequest(`Unsupported report type '${type}'.`, req);
    }

    // -- Jobs ---------------------------------------------------------------
    if (path === "/v1/jobs" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.ok) return badRequest(body.reason, req);
      try {
        const submission = await provider.submit({
          provider: "grok-browser",
          mediaType: (body.value.type === "video" ? "video" : "image") as never,
          prompt: String(body.value.prompt ?? ""),
          count: typeof body.value.count === "number" ? body.value.count : 1,
          aspectRatio: body.value.aspectRatio ? String(body.value.aspectRatio) : undefined,
          project: body.value.project ? String(body.value.project) : undefined,
          autoDownload: body.value.autoDownload === undefined ? true : Boolean(body.value.autoDownload),
          executionMode: (body.value.executionMode ? String(body.value.executionMode) : "assisted") as never,
        });
        return jsonResponse({ ok: true, ...submission }, 201, req, {});
      } catch (error) {
        const code = (error as { code?: string }).code ?? "GROK_USER_ACTION_REQUIRED";
        return jsonResponse({ error: { code, message: String(error) } }, 400, req, {});
      }
    }

    if (path === "/v1/jobs" && req.method === "GET") {
      return jsonResponse({ jobs: store.listJobs(undefined, 200) }, 200, req, {});
    }

    if (path === "/v1/jobs/next" && req.method === "GET") {
      return jsonResponse({ job: service.nextJob() }, 200, req, {});
    }

    const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(path);
    if (jobMatch && req.method === "GET") {
      const job = store.getJob(decodeURIComponent(jobMatch[1]!));
      if (!job) return jsonResponse({ error: { code: "not_found", message: "Unknown job." } }, 404, req, {});
      return jsonResponse({ job, results: store.listResults(job.id) }, 200, req, {});
    }

    const cancelMatch = /^\/v1\/jobs\/([^/]+)\/cancel$/.exec(path);
    if (cancelMatch && req.method === "POST") {
      const jobId = decodeURIComponent(cancelMatch[1]!);
      const job = store.getJob(jobId);
      if (!job) return jsonResponse({ error: { code: "not_found", message: "Unknown job." } }, 404, req, {});
      await provider.cancel(jobId);
      return jsonResponse({ ok: true, job: store.getJob(jobId) }, 200, req, {});
    }

    if (path === "/v1/diagnostics" && req.method === "GET") {
      return jsonResponse(
        {
          protocol: "pao-grok-bridge/1",
          health: service.health(),
          session: store.getSession("grok-browser"),
          errorCodes: service.errorCodes(),
        },
        200,
        req,
        {},
      );
    }

    if (path === "/v1/audit" && req.method === "GET") {
      return jsonResponse({ audit: store.listAudit(200) }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found", message: `No route for ${path}.` } }, 404, req, {});
  };
}

/**
 * Start the bridge.
 *
 * The host is forced to the loopback constant rather than taken from the config,
 * so no configuration mistake can expose the bridge on a public interface.
 */
export async function startBridgeServer(overrides: Partial<BridgeConfig> = {}): Promise<BridgeServerHandle> {
  const config = { ...buildDefaultBridgeConfig(), ...overrides, host: DEFAULT_BRIDGE_HOST };
  const service = new GrokBridgeService({ config });
  const handler = createBridgeHandler(service);
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: handler,
  });
  return {
    port: server.port ?? config.port,
    host: config.host,
    stop: () => server.stop(true),
  };
}

export { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT, tooLarge };

