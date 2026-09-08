// Phase 20.14 — Authenticated Remote RPC Client
//
// Sends authenticated JSON-RPC commands to remote browser worker daemons
// running on VPS, Cloud VMs, or RunPod utility instances.

import type { RemoteRpcRequest, RemoteRpcResponse } from "./types";

export interface RemoteRpcClientOptions {
  timeoutMs?: number;
  retries?: number;
}

export class RemoteRpcClient {
  private timeoutMs: number;
  private retries: number;

  constructor(options?: RemoteRpcClientOptions) {
    this.timeoutMs = options?.timeoutMs || 30000;
    this.retries = options?.retries || 2;
  }

  /**
   * Invokes an RPC method on a remote browser worker.
   */
  public async call(
    endpointUrl: string,
    authToken: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<RemoteRpcResponse> {
    const rpcId = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const request: RemoteRpcRequest = {
      id: rpcId,
      method,
      params,
      timestamp: Date.now(),
    };

    const url = `${endpointUrl.replace(/\/$/, "")}/rpc`;
    const start = Date.now();

    let lastError = "UNKNOWN_ERROR";

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          lastError = `HTTP_${res.status}: ${errText || res.statusText}`;
          continue;
        }

        const data = (await res.json()) as any;
        const durationMs = Date.now() - start;

        return {
          id: rpcId,
          success: data.success ?? true,
          data: data.data ?? data,
          error: data.error,
          durationMs,
        };
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err.name === "AbortError" ? "TIMEOUT" : err.message;
      }
    }

    return {
      id: rpcId,
      success: false,
      error: `RPC_FAILED: ${lastError}`,
      durationMs: Date.now() - start,
    };
  }
}

let rpcClientInstance: RemoteRpcClient | null = null;
export function getRemoteRpcClient(): RemoteRpcClient {
  if (!rpcClientInstance) {
    rpcClientInstance = new RemoteRpcClient();
  }
  return rpcClientInstance;
}
