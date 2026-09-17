import { expect, test } from "bun:test";

const LOCALES = ["de", "en", "fr", "ja", "ko", "ru", "th", "tr", "zh", "zh-TW"] as const;

async function read(path: string): Promise<string> {
  return Bun.file(new URL(path, import.meta.url)).text();
}

// The Sensorimotor control plane (Phase 20.82 CortexKit AFT) must only talk to
// the sensorimotor management surface — it renders runtime state and issues
// transactional actions through the governed REST routes. It must never touch
// the filesystem, spawn processes, or embed credential-shaped material.
test("the Sensorimotor page only talks to the governed management API", async () => {
  const page = await read("../src/pages/Sensorimotor.tsx");
  for (const endpoint of [
    "/api/agent-os/sensorimotor/health",
    "/api/agent-os/sensorimotor/sessions",
    "/api/agent-os/sensorimotor/actions",
  ]) {
    expect(page).toContain(endpoint);
  }
  expect(page).not.toMatch(/writeFile|appendFile|rmSync|Bun\.spawn|execSync/);
  expect(page).not.toMatch(/sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{16,}|Bearer\s+[a-zA-Z0-9]/);
});

// Every mutation goes through POST /actions with kind + target so the runtime
// (not the GUI) owns policy, approval, checkpoint, and rollback semantics.
test("the Sensorimotor page submits actions through the transactional route only", async () => {
  const page = await read("../src/pages/Sensorimotor.tsx");
  expect(page).toContain('method: "POST"');
  expect(page).toContain("kind:");
  // The page never composes destructive commands itself — no shell.exec surface.
  expect(page).not.toContain("shell.exec");
  expect(page).not.toContain("git.mutate");
});

// Degraded runtime is a normal state: failures land in a visible message, and
// the page offers a refresh path rather than a dead panel.
test("the Sensorimotor page covers loading, error, and refresh states", async () => {
  const page = await read("../src/pages/Sensorimotor.tsx");
  expect(page).toContain("unavailable");
  expect(page).toContain("Failed to");
  expect(page).toMatch(/loadActions|load\(/);
});

// Navigation wiring: the page id is a registered route, the nav label is
// i18n-backed in every shipped locale, and the hash route resolves.
test("the Sensorimotor surface is routed and i18n-backed in every locale", async () => {
  const { readPageFromHash, VALID_PAGES } = await import("../src/app-routing");
  expect(VALID_PAGES.has("sensorimotor")).toBe(true);
  expect(readPageFromHash("sensorimotor")).toBe("sensorimotor");

  const app = await read("../src/App.tsx");
  expect(app).toContain('"sensorimotor": "nav.sensorimotor"');
  expect(app).toContain("<Sensorimotor apiBase={API_BASE} />");

  for (const locale of LOCALES) {
    const content = await read(`../src/i18n/${locale}.ts`);
    expect(content).toContain("sensorimotor");
  }
});
