import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import PaoSeo from "../src/pages/PaoSeo";
import { LanguageProvider } from "../src/i18n/provider";

const globals = ["document", "window", "navigator", "localStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previousGlobals: Record<(typeof globals)[number], unknown>;
let testWindow: Window;
let root: Root | null;
let clipboardWrites: string[];

beforeEach(() => {
  previousGlobals = Object.fromEntries(globals.map(key => [key, Reflect.get(globalThis, key)])) as typeof previousGlobals;
  testWindow = new Window({ url: "http://localhost/#seo" });
  Object.defineProperty(testWindow.navigator, "language", { configurable: true, value: "en-US" });
  clipboardWrites = [];
  Object.defineProperty(testWindow.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => { clipboardWrites.push(text); } },
  });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    localStorage: { configurable: true, value: testWindow.localStorage },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/provider/health")) {
        return Response.json({ provider: "mock", status: "healthy", activeMode: "mock", latencyMs: 0, capabilities: [], security: { status: "safe" } });
      }
      if (url.pathname.endsWith("/projects") && (init?.method ?? "GET") === "GET") {
        return Response.json({ projects: [{ id: "seo_demo", domain: "worpao.example", displayName: "Wor-Pao Group" }] });
      }
      if (url.pathname.endsWith("/projects/seo_demo/recommendations")) return Response.json({ recommendations: [] });
      if (url.pathname.endsWith("/projects/seo_demo/audit") && init?.method === "POST") {
        return Response.json({
          runId: "run_geo",
          heuristicscore: 72,
          verificationSummary: { verified: 4, unverified: 0, conflict: 0, suppressed: 1 },
          findings: [],
          crawlerPolicy: [],
          llmsTxt: { state: "missing", url: "https://worpao.example/llms.txt", issues: [] },
          schema: { blocksFound: 1, families: ["Organization"] },
          citability: { overallScore: 74, strongCount: 2, weakCount: 1, topIssues: [] },
          entity: { consistent: true, score: 100 },
          eeatScore: 80,
          platformReadiness: [],
          technical: {
            sitemap: { state: "present", urls: 12 },
            canonical: { present: true, url: "https://worpao.example/" },
            freshness: { hasDate: true, datePublished: "2026-09-01" },
          },
          llmsProposal: {
            content: "# Wor-Pao Group\n\n## Site\n- [Home](https://worpao.example/)",
            includedUrls: ["https://worpao.example/"],
            excludedCount: 0,
            warnings: [],
          },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
  });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  testWindow.close();
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: previousGlobals[key] });
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

test("GEO audit renders verified technical state and a copy-only llms.txt proposal", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<LanguageProvider><PaoSeo apiBase="" /></LanguageProvider>);
  });
  await flush();

  await act(async () => { host.querySelector<HTMLButtonElement>(".seo-project button")!.click(); });
  await flush();
  const geoButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Run GEO audit")!;
  await act(async () => { geoButton.click(); });
  await flush();

  expect(host.textContent).toContain("Sitemap: present · 12 URLs");
  expect(host.textContent).toContain("Canonical: https://worpao.example/");
  expect(host.textContent).toContain("Freshness: 2026-09-01");
  expect(host.textContent).toContain("llms.txt proposal");
  expect(host.textContent).toContain("Human approval is required before deployment.");
  expect([...host.querySelectorAll("button")].some(button => button.textContent?.includes("Deploy"))).toBe(false);

  const copyButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Copy proposal")!;
  await act(async () => { copyButton.click(); });
  expect(clipboardWrites).toEqual(["# Wor-Pao Group\n\n## Site\n- [Home](https://worpao.example/)"]);
});
