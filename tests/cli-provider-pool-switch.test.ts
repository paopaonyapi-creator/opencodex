import { afterEach, expect, spyOn, test } from "bun:test";
import { Readable } from "node:stream";
import { handleProviderRuntimeCommand } from "../src/cli/provider-runtime";

type Recorded = { path: string; method: string; body: unknown };
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  process.exitCode = 0;
});

function fakeRuntime(responder?: (req: Request, body: unknown) => unknown) {
  const requests: Recorded[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "GET" ? null : await req.json().catch(() => null);
      requests.push({ path: `${url.pathname}${url.search}`, method: req.method, body });
      const custom = responder?.(req, body);
      if (custom instanceof Response) return custom;
      if (custom !== undefined) return Response.json(custom);
      return Response.json({ ok: true });
    },
  });
  servers.push(server);
  return { requests, deps: { baseUrl: `http://127.0.0.1:${server.port}` } };
}

test("provider switch-pool reads the new key only from stdin and sends one atomic request", async () => {
  const key = "pool-secret-value";
  const runtime = fakeRuntime(() => ({
    ok: true,
    name: "relay",
    baseUrl: "https://api.example.test/new-pool/v1",
    defaultModel: "model-b",
    models: 2,
    catalogRefresh: { status: "committed", changed: true, degraded: false, notices: [] },
  }));
  const input = Readable.from([`${key}\n`]) as typeof process.stdin;
  input.isTTY = false;
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await handleProviderRuntimeCommand("switch-pool", [
      "relay",
      "--base-url", "https://api.example.test/new-pool/v1",
      "--default-model", "model-b",
      "--json",
    ], { ...runtime.deps, stdinImpl: input });

    expect(code).toBe(0);
    expect(runtime.requests).toEqual([{
      path: "/api/providers/switch-pool?name=relay",
      method: "POST",
      body: {
        baseUrl: "https://api.example.test/new-pool/v1",
        defaultModel: "model-b",
        apiKey: key,
      },
    }]);
    const stdout = logSpy.mock.calls.map(call => String(call[0])).join("\n");
    expect(stdout).toContain('"models": 2');
    expect(stdout).not.toContain(key);
  } finally {
    logSpy.mockRestore();
  }
});

test("provider switch-pool rejects TTY and argv credentials without making a request or echoing the key", async () => {
  const runtime = fakeRuntime();
  const tty = Readable.from([]) as typeof process.stdin;
  tty.isTTY = true;
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    const ttyCode = await handleProviderRuntimeCommand("switch-pool", [
      "relay", "--base-url", "https://api.example.test/new-pool/v1", "--default-model", "model-b",
    ], { ...runtime.deps, stdinImpl: tty });
    expect(ttyCode).toBe(2);
    expect(runtime.requests).toEqual([]);

    const secret = "must-not-appear";
    const argvCode = await handleProviderRuntimeCommand("switch-pool", [
      "relay", "--base-url", "https://api.example.test/new-pool/v1", "--default-model", "model-b",
      "--api-key", secret,
    ], runtime.deps);
    expect(argvCode).toBe(2);
    expect(runtime.requests).toEqual([]);
    expect(errorSpy.mock.calls.map(call => String(call[0])).join("\n")).not.toContain(secret);
  } finally {
    errorSpy.mockRestore();
  }
});
