// Phase 20.89 — Capability Hub GUI contract test (source-level, per repo pattern).
// The Marketplace page must only talk to the governed marketplace API, never
// touch the filesystem/shell directly, and must be routed + i18n-backed.

import { expect, test } from "bun:test";

async function read(path: string): Promise<string> {
  return Bun.file(new URL(path, import.meta.url)).text();
}

test("the Marketplace page only talks to the governed marketplace API", async () => {
  const page = await read("../src/pages/Marketplace.tsx");
  for (const endpoint of [
    "/api/agent-os/marketplace/health",
    "/api/agent-os/marketplace/capabilities",
    "/api/agent-os/marketplace/import-phases",
  ]) {
    expect(page).toContain(endpoint);
  }
  expect(page).not.toMatch(/writeFile|appendFile|rmSync|Bun\.spawn|execSync/);
  expect(page).not.toMatch(/sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{16,}|Bearer\s+[a-zA-Z0-9]/);
});

test("the Marketplace page installs through the policy-governed plan flow only", async () => {
  const page = await read("../src/pages/Marketplace.tsx");
  expect(page).toContain("plan-install");
  expect(page).toContain("install-plans");
  // The GUI never composes shell commands or bypasses the installer service.
  expect(page).not.toContain("shell.execute");
  expect(page).not.toContain("exec_shell");
});

test("the Marketplace surface is routed and i18n-backed in every locale", async () => {
  const { readPageFromHash, VALID_PAGES } = await import("../src/app-routing");
  expect(VALID_PAGES.has("marketplace")).toBe(true);
  expect(readPageFromHash("marketplace")).toBe("marketplace");

  const app = await read("../src/App.tsx");
  expect(app).toContain('"marketplace": "nav.marketplace"');
  expect(app).toContain("<Marketplace apiBase={API_BASE} />");

  for (const locale of ["de", "en", "fr", "ja", "ko", "ru", "th", "tr", "zh", "zh-TW"]) {
    const content = await read(`../src/i18n/${locale}.ts`);
    expect(content).toContain("nav.marketplace");
  }
});
