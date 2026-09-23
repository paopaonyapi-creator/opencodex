import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The proxy core must not reach the Cloud Sandbox Plane.
 *
 * `AGENTS.md` states the rule for optional subsystems generally: a user who configures one
 * provider and one model must execute no optional-subsystem code. The Cloud Sandbox Plane
 * is the strongest case yet, because activating it can start containers, spawn Terraform and
 * hold a SQLite handle — none of which a plain proxy request should be able to trigger or pay
 * for. Source spec §73 puts it as a rollback requirement ("core dashboard and coding features
 * must keep working with the plane offline"), and docs/Phase-20.15 §4.1 turns that prose into
 * this guard.
 *
 * Modelled on `tests/core-lab-boundary.test.ts`, including the reason that test exists: the
 * original Lab violation hid in a six-hop chain where no single file looked wrong.
 */
const PROTECTED = [
  "src/router.ts",
  "src/server/lifecycle.ts",
  "src/server/responses/core.ts",
  "src/server/management-api.ts",
] as const;

const SUBSYSTEM = "/src/agent-os/cloud-sandbox/";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/C:/...", and resolving
// that against the cwd produces "C:\C:\...". A boundary test that cannot open its own sources
// reports a broken path as a pass and would report a real violation the same way.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Runtime imports only; `import type` is erased and costs nothing.
 *
 * Covers static imports, side-effect imports, runtime re-exports and dynamic `import()`.
 * Known limits, stated rather than implied: a static walker cannot resolve a computed
 * specifier, so `import(someVariable)` is out of scope, and bare `require()` is unavailable
 * because this package is ESM.
 */
const IMPORT_RE = /^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|^\s*export\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

function resolveSpec(spec: string, fromFile: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts"), `${base}.mts`, `${base}.mjs`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Parsed import specifiers per file, cached across walks.
 *
 * The four protected entry points reach an overlapping graph that spans most of `src/`, so
 * without this the same files are read and regex-scanned once per entry and the test runs
 * past the default 5s budget. Caching keeps the walk honest — it changes what is re-read,
 * not what is reachable.
 */
const specCache = new Map<string, Array<{ spec: string; isDynamic: boolean }>>();

function extractSpecs(file: string): Array<{ spec: string; isDynamic: boolean }> {
  const cached = specCache.get(file);
  if (cached) return cached;

  const found: Array<{ spec: string; isDynamic: boolean }> = [];
  const source = readFileSync(file, "utf8");
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (spec) found.push({ spec, isDynamic: match[4] !== undefined });
  }
  specCache.set(file, found);
  return found;
}

/**
 * Walk the runtime import graph and return the first chain that reaches `needle`.
 *
 * A dynamic `import()` does NOT propagate the walk: it is a deferred edge, and lazy loading
 * behind an activation check is exactly the remedy this guard exists to encourage. Guard 2
 * below separately forbids a protected file from naming the subsystem dynamically itself,
 * which is what stops that from becoming a loophole.
 */
function firstPathReaching(entry: string, needle: string): string[] | null {
  const start = resolve(entry);
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!existsSync(current)) continue;

    for (const { spec, isDynamic } of extractSpecs(current)) {
      if (isDynamic) continue;

      const next = resolveSpec(spec, current);
      if (!next || previous.has(next)) continue;
      previous.set(next, current);

      // Compare on a slash-normalized path: `resolve`/`join` produce backslashes on Windows,
      // so a literal needle test silently matches nothing there and the guard reports clean
      // for every possible violation.
      if (next.replaceAll("\\", "/").includes(needle)) {
        const chain: string[] = [];
        let node: string | null = next;
        while (node) {
          chain.push(node.slice(repoRoot.length + 1).replaceAll("\\", "/"));
          node = previous.get(node) ?? null;
        }
        return chain.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** Basenames of a chain, so assertions do not depend on the fixture directory's location. */
function chainNames(chain: string[] | null): string[] {
  return (chain ?? []).map((hop) => {
    const normalized = hop.replaceAll("\\", "/");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  });
}

/**
 * Guard 2's predicate, exported so the self-test calls the real one.
 *
 * A copy cannot fail when the original drifts, which is the specific way a guard rots. The
 * directory form is matched explicitly because `src/agent-os/cloud-sandbox/index.ts` exists,
 * so `import("../cloud-sandbox")` resolves to the entrypoint while matching no trailing slash.
 */
export function namesCloudSandboxDirectly(source: string): boolean {
  const dir = "cloud-sandbox";
  return (
    new RegExp(`^\\s*(?:import|export)\\s+(?!type\\b)[^;]*?["'][^"']*\\/${dir}(?:\\/|["'])`, "m").test(source) ||
    new RegExp(`^\\s*import\\s+["'][^"']*\\/${dir}(?:\\/|["'])`, "m").test(source) ||
    new RegExp(`\\bimport\\s*\\(\\s*["'][^"']*\\/${dir}(?:\\/|["'])`).test(source)
  );
}

// Fixtures for the non-vacuity self-tests. Each test gets its own directory: the spec cache
// is keyed by absolute path, so two tests writing the same fixture filename would let the
// second one read the first one's imports and pass for the wrong reason.
const fixtureRoot = join(repoRoot, ".tmp", "cloud-sandbox-boundary-fixture");

afterEach(() => {
  specCache.clear();
  if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
});

function makeFixtureDir(name: string): string {
  const dir = join(fixtureRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeIn(dir: string, relativePath: string, content: string): string {
  const full = join(dir, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

const LEAF_DIR = join("src", "agent-os", "cloud-sandbox");

describe("phase 20.15 — the Cloud Sandbox Plane stays off the core path", () => {
  test("the subsystem it is guarding actually exists", () => {
    // Without this the whole file would pass by guarding a path nobody ever creates.
    expect(existsSync(join(repoRoot, "src/agent-os/cloud-sandbox/index.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/agent-os/cloud-sandbox/db-store.ts"))).toBe(true);
  });

  test("every protected file still exists and carries real content", () => {
    // A renamed or emptied core file would make the walk below pass by guarding nothing, and
    // the failure mode is silence. Asserting the paths are live is what keeps the guard aimed.
    for (const entry of PROTECTED) {
      const full = join(repoRoot, entry);
      expect(existsSync(full), `${entry} no longer exists; update PROTECTED`).toBe(true);
      expect(readFileSync(full, "utf8").length).toBeGreaterThan(500);
    }
  });

  test(
    "no protected core file reaches the subsystem through its import graph",
    () => {
      for (const entry of PROTECTED) {
        const chain = firstPathReaching(join(repoRoot, entry), SUBSYSTEM);
        expect(chain, `${entry} reaches the Cloud Sandbox Plane via: ${chain?.join(" -> ")}`).toBeNull();
      }
    },
    // The walk covers most of `src/` four times over. A slow pass must not be reported as a
    // broken guard, and a timeout that short would be the only thing failing on a cold cache.
    120_000,
  );

  test("no protected core file names the subsystem, not even dynamically", () => {
    for (const entry of PROTECTED) {
      const source = readFileSync(join(repoRoot, entry), "utf8");
      expect(namesCloudSandboxDirectly(source), `${entry} names the Cloud Sandbox Plane`).toBe(false);
    }
  });

  test("the walker is not vacuous: it finds a direct edge", () => {
    const dir = makeFixtureDir("direct");
    writeIn(dir, join(LEAF_DIR, "leaf.ts"), "export const x = 1;\n");
    const entry = writeIn(
      dir,
      "entry.ts",
      'import { x } from "./src/agent-os/cloud-sandbox/leaf";\nconsole.log(x);\n',
    );

    expect(chainNames(firstPathReaching(entry, SUBSYSTEM))).toEqual(["entry.ts", "leaf.ts"]);
  });

  test("the walker is not vacuous: it finds a transitive edge", () => {
    // The Lab violation this pattern exists for was six hops deep with no single guilty file.
    const dir = makeFixtureDir("transitive");
    writeIn(dir, join(LEAF_DIR, "deep.ts"), "export const y = 2;\n");
    writeIn(dir, "hop3.ts", 'import { y } from "./src/agent-os/cloud-sandbox/deep";\nexport const c = y;\n');
    writeIn(dir, "hop2.ts", 'import { c } from "./hop3";\nexport const b = c;\n');
    writeIn(dir, "hop1.ts", 'import { b } from "./hop2";\nexport const a = b;\n');
    const entry = writeIn(dir, "entry.ts", 'import { a } from "./hop1";\nconsole.log(a);\n');

    expect(chainNames(firstPathReaching(entry, SUBSYSTEM))).toEqual([
      "entry.ts",
      "hop1.ts",
      "hop2.ts",
      "hop3.ts",
      "deep.ts",
    ]);
  });

  test("a dynamic import does not propagate, but naming it directly still fails guard 2", () => {
    const dir = makeFixtureDir("dynamic");
    writeIn(dir, join(LEAF_DIR, "lazy.ts"), "export const z = 3;\n");
    const handler = writeIn(
      dir,
      "handler.ts",
      'export async function go() { const m = await import("./src/agent-os/cloud-sandbox/lazy"); return m.z; }\n',
    );
    const entry = writeIn(dir, "entry.ts", 'import { go } from "./handler";\nconsole.log(go);\n');

    // The deferred edge is intentional: activation-gated lazy loading is the sanctioned seam.
    // Assert the walk really visited handler.ts, or this passes without proving anything.
    expect(extractSpecs(handler)).toEqual([
      { spec: "./src/agent-os/cloud-sandbox/lazy", isDynamic: true },
    ]);
    expect(firstPathReaching(entry, SUBSYSTEM)).toBeNull();
    // But a protected file may not be the one doing it.
    expect(namesCloudSandboxDirectly(readFileSync(handler, "utf8"))).toBe(true);
    expect(namesCloudSandboxDirectly(readFileSync(entry, "utf8"))).toBe(false);
  });

  test("guard 2 recognises every spelling that resolves to the subsystem", () => {
    expect(namesCloudSandboxDirectly('import { a } from "../agent-os/cloud-sandbox";')).toBe(true);
    expect(namesCloudSandboxDirectly('import { a } from "./cloud-sandbox/index";')).toBe(true);
    expect(namesCloudSandboxDirectly('import "./cloud-sandbox/side-effect";')).toBe(true);
    expect(namesCloudSandboxDirectly('export { a } from "../cloud-sandbox";')).toBe(true);
    expect(namesCloudSandboxDirectly('const m = await import("../cloud-sandbox");')).toBe(true);
    // `import type` is erased at runtime and must not be a violation.
    expect(namesCloudSandboxDirectly('import type { A } from "../cloud-sandbox";')).toBe(false);
    expect(namesCloudSandboxDirectly('import { a } from "./cloud-storage";')).toBe(false);
    expect(namesCloudSandboxDirectly("// a comment mentioning cloud-sandbox")).toBe(false);
  });
});
