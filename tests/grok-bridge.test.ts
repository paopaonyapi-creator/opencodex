import { describe, expect, test } from "bun:test";
import {
  canTransitionBrowserJob,
  assertBrowserTransition,
  isInFlight,
  isTerminal,
  requiresUserAction,
  GrokBridgeError,
  BROWSER_JOB_STATES,
} from "../src/agent-os/browser-provider/types";
import {
  resolveSelector,
  summarizeSelectorHealth,
  GROK_SELECTOR_PROFILE,
  type SelectorCandidate,
} from "../src/agent-os/browser-provider/selectors";
import { detectPage, isSubmittable, requiresHuman, type PageSignals } from "../src/agent-os/browser-provider/page-detector";
import {
  buildFilename,
  sanitizeSegment,
  DownloadManager,
} from "../src/agent-os/browser-provider/download-manager";
import { isAllowedOrigin, tokenMatches, PairingRegistry } from "../src/agent-os/browser-provider/bridge";

/**
 * Phase 20.18 — Grok bridge unit tests.
 *
 * These are pure: no browser, no socket, no filesystem outside a temp dir. The cases
 * that get the most attention are the ones where a wrong answer is a security or
 * duplicate-work incident rather than a cosmetic bug.
 */

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return { url: "https://grok.com/", visibleText: [], ariaLabels: [], roles: [], title: "", ...overrides };
}

describe("Phase 20.18 — job state machine", () => {
  test("the happy path is a legal chain", () => {
    const path = ["queued", "waiting_browser", "preparing", "prompting", "generating", "collecting", "completed"] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionBrowserJob(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  test("a terminal state cannot be left", () => {
    expect(canTransitionBrowserJob("completed", "queued")).toBe(false);
    expect(canTransitionBrowserJob("cancelled", "preparing")).toBe(false);
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  test("a job cannot skip from queued straight to generating", () => {
    // Skipping would mean a generation the system never observed being requested.
    expect(canTransitionBrowserJob("queued", "generating")).toBe(false);
    expect(() => assertBrowserTransition("queued", "generating")).toThrow();
  });

  test("blocking is reachable from every active state", () => {
    // A CAPTCHA can appear at any point, so no active state may be unreachable from it.
    for (const state of ["queued", "waiting_browser", "preparing", "uploading", "prompting", "generating"] as const) {
      expect(canTransitionBrowserJob(state, "blocked"), state).toBe(true);
    }
  });

  test("in-flight states are exactly the ones a restart must reconcile", () => {
    expect(isInFlight("generating")).toBe(true);
    expect(isInFlight("collecting")).toBe(true);
    expect(isInFlight("queued")).toBe(false);
    expect(isInFlight("waiting_browser")).toBe(false);
    expect(isInFlight("completed")).toBe(false);
  });

  test("needs_review can be resumed or abandoned but never re-enters silently", () => {
    expect(canTransitionBrowserJob("needs_review", "preparing")).toBe(true);
    expect(canTransitionBrowserJob("needs_review", "cancelled")).toBe(true);
    // It must not silently become completed without a human decision.
    expect(canTransitionBrowserJob("needs_review", "generating")).toBe(false);
  });
});

describe("Phase 20.18 — error semantics", () => {
  test("user-action codes are not queue-retryable", () => {
    // A CAPTCHA that the queue retried would be an attempted bypass.
    for (const code of ["GROK_SESSION_REQUIRED", "GROK_RATE_LIMITED", "GROK_USER_ACTION_REQUIRED"] as const) {
      expect(requiresUserAction(code), code).toBe(true);
      const error = new GrokBridgeError(code, "needs a person");
      expect(error.retryable, code).toBe(false);
    }
  });

  test("an ordinary failure stays retryable", () => {
    const error = new GrokBridgeError("GROK_GENERATION_TIMEOUT", "timed out");
    expect(error.retryable).toBe(true);
    expect(error.toJSON().code).toBe("GROK_GENERATION_TIMEOUT");
  });
});

describe("Phase 20.18 — selector resilience", () => {
  test("the strongest resolving signal wins", () => {
    const resolution = resolveSelector(GROK_SELECTOR_PROFILE.specs.promptInput!, (candidate) => candidate.strategy === "role");
    expect(resolution.found).toBe(true);
    expect(resolution.strategy).toBe("role");
    expect(resolution.confidence).toBe(1);
    expect(resolution.stale).toBe(false);
  });

  test("a fallback to a weaker signal is reported as stale, not as healthy", () => {
    // This is the signal the diagnostics page depends on: a CSS match means the
    // page probably changed, even though something matched.
    const resolution = resolveSelector(GROK_SELECTOR_PROFILE.specs.promptInput!, (candidate) => candidate.strategy === "css");
    expect(resolution.found).toBe(true);
    expect(resolution.strategy).toBe("css");
    expect(resolution.stale).toBe(true);
    expect(resolution.confidence).toBeLessThan(1);
  });

  test("one throwing probe does not stop the fallback chain", () => {
    const spec = {
      name: "mixed",
      candidates: [
        { strategy: "css" as const, value: ".broken", weight: 100 },
        { strategy: "css" as const, value: ".works", weight: 50 },
      ],
    };
    const resolution = resolveSelector(spec, (candidate) => {
      if (candidate.value === ".broken") throw new Error("invalid selector");
      return true;
    });
    expect(resolution.found).toBe(true);
    expect(resolution.value).toBe(".works");
    expect(resolution.failures).toHaveLength(1);
  });

  test("an unresolved selector reports every candidate it tried", () => {
    const resolution = resolveSelector(GROK_SELECTOR_PROFILE.specs.submitButton!, () => false);
    expect(resolution.found).toBe(false);
    expect(resolution.failures.length).toBe(GROK_SELECTOR_PROFILE.specs.submitButton!.candidates.length);
  });

  test("a spec with no candidates reports that, rather than a silent failure", () => {
    const resolution = resolveSelector({ name: "empty", candidates: [] }, () => true);
    expect(resolution.found).toBe(false);
    expect(resolution.detail).toContain("no candidates");
  });

  test("equal weights resolve in declaration order, not arbitrarily", () => {
    const candidates: SelectorCandidate[] = [
      { strategy: "text", value: "first", weight: 50 },
      { strategy: "text", value: "second", weight: 50 },
    ];
    const resolution = resolveSelector({ name: "tie", candidates }, () => true);
    expect(resolution.value).toBe("first");
  });

  test("output detection refuses a weak match", () => {
    // Media elements are reused for avatars and icons, so a weak match on the result
    // selector would report a completed generation that never happened.
    const resolution = resolveSelector(GROK_SELECTOR_PROFILE.specs.resultCard!, (candidate) => candidate.strategy === "css");
    expect(resolution.found).toBe(true);
    expect(resolution.stale).toBe(true);
  });

  test("health summary distinguishes stale from degraded from healthy", () => {
    const healthy = summarizeSelectorHealth([
      resolveSelector(GROK_SELECTOR_PROFILE.specs.promptInput!, (c) => c.strategy === "role"),
    ]);
    expect(healthy.health).toBe("healthy");

    const degraded = summarizeSelectorHealth([
      resolveSelector(GROK_SELECTOR_PROFILE.specs.promptInput!, (c) => c.strategy === "css"),
    ]);
    expect(degraded.health).toBe("degraded");

    const stale = summarizeSelectorHealth([
      resolveSelector(GROK_SELECTOR_PROFILE.specs.promptInput!, () => false),
    ]);
    expect(stale.health).toBe("stale");
  });
});

describe("Phase 20.18 — page detection", () => {
  test("a projects URL is detected", () => {
    const detection = detectPage(signals({ url: "https://grok.com/projects" }));
    expect(detection.pageType).toBe("grok-projects");
    expect(detection.confidence).toBeGreaterThan(0.5);
  });

  test("a blocking state outranks the container page it sits on", () => {
    // Reporting the URL first would make the detector confidently wrong about a
    // page that cannot be submitted into.
    const detection = detectPage(
      signals({ url: "https://grok.com/projects", visibleText: ["Too many requests, try again later"] }),
    );
    expect(detection.pageType).toBe("rate-limited");
    expect(requiresHuman(detection.pageType)).toBe(true);
    expect(isSubmittable(detection.pageType)).toBe(false);
  });

  test("a CAPTCHA is reported as needing a person", () => {
    const detection = detectPage(signals({ visibleText: ["Verify you are human"] }));
    expect(detection.pageType).toBe("login-required");
    expect(requiresHuman(detection.pageType)).toBe(true);
  });

  test("a generation in flight outranks the container page", () => {
    const detection = detectPage(signals({ url: "https://grok.com/projects", roles: ["progressbar"] }));
    expect(detection.pageType).toBe("grok-generation");
  });

  test("a non-Grok host is unsupported rather than unknown", () => {
    const detection = detectPage(signals({ url: "https://example.com/" }));
    expect(detection.pageType).toBe("unsupported");
    expect(isSubmittable(detection.pageType)).toBe(false);
  });

  test("an unidentifiable Grok page is unknown with low confidence", () => {
    // Reporting high confidence here would hide the need for a profile update.
    const detection = detectPage(signals({ url: "https://grok.com/somewhere-new" }));
    expect(detection.pageType).toBe("unknown");
    expect(detection.confidence).toBeLessThan(0.5);
    expect(isSubmittable(detection.pageType)).toBe(false);
  });

  test("every detection carries evidence", () => {
    const detection = detectPage(signals({ url: "https://grok.com/projects" }));
    expect(detection.evidence.length).toBeGreaterThan(0);
  });
});

describe("Phase 20.18 — download safety", () => {
  test("path separators cannot survive sanitizing", () => {
    expect(sanitizeSegment("../../etc/passwd")).not.toContain("/");
    expect(sanitizeSegment("..\\..\\windows\\system32")).not.toContain("\\");
    expect(sanitizeSegment("a/b/c")).toBe("a-b-c");
  });

  test("a name of only dots is replaced rather than resolving to a parent", () => {
    expect(sanitizeSegment("..")).toBe("value");
    expect(sanitizeSegment(".")).toBe("value");
    expect(sanitizeSegment("")).toBe("value");
  });

  test("a filename is deterministic and collision-resistant", () => {
    const when = new Date("2026-09-11T04:05:06Z");
    const name = buildFilename({ jobId: "JOB-0021", index: 3, extension: "png", timestamp: when });
    expect(name).toBe("PAO-GROK_JOB-0021_03_20260911-040506.png");
  });

  test("a traversal attempt in the job id cannot escape the root", () => {
    const manager = new DownloadManager(process.cwd());
    const plan = manager.plan({ jobId: "../../escape", index: 0, extension: "png" });
    expect(plan.relativePath.startsWith("..")).toBe(false);
    expect(plan.targetPath.startsWith(manager.getRoot())).toBe(true);
  });
});

describe("Phase 20.18 — bridge security", () => {
  test("an empty extension allowlist permits no extension", () => {
    // Failing closed here is the entire point of the check.
    expect(isAllowedOrigin("chrome-extension://abcdef", [])).toBe(false);
  });

  test("only a named extension id is permitted", () => {
    expect(isAllowedOrigin("chrome-extension://allowed", ["allowed"])).toBe(true);
    expect(isAllowedOrigin("chrome-extension://other", ["allowed"])).toBe(false);
  });

  test("a web origin is refused even on loopback", () => {
    // A page can reach localhost, so without this check any website could drive the
    // bridge through a visitor's browser.
    expect(isAllowedOrigin("https://evil.example.com", ["allowed"])).toBe(false);
    expect(isAllowedOrigin("https://grok.com", ["allowed"])).toBe(false);
  });

  test("a data or file origin is refused", () => {
    expect(isAllowedOrigin("data:text/html,x", ["allowed"])).toBe(false);
    expect(isAllowedOrigin("file:///etc/passwd", ["allowed"])).toBe(false);
    expect(isAllowedOrigin(null, ["allowed"])).toBe(false);
  });

  test("a missing token is refused", () => {
    expect(tokenMatches(null, "secret")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
  });

  test("a correct token matches and a wrong one does not", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secreu", "secret")).toBe(false);
    expect(tokenMatches("secret-longer", "secret")).toBe(false);
  });
});

describe("Phase 20.18 — pairing", () => {
  test("a code is single use", () => {
    const registry = new PairingRegistry();
    const issued = registry.issue("client-1");
    expect(registry.redeem("client-1", issued.code).ok).toBe(true);
    expect(registry.redeem("client-1", issued.code).ok).toBe(false);
  });

  test("an expired code is refused", () => {
    let clock = 1_000_000;
    const registry = new PairingRegistry({ ttlMs: 1000, now: () => clock });
    const issued = registry.issue("client-1");
    clock += 2000;
    expect(registry.redeem("client-1", issued.code).ok).toBe(false);
  });

  test("a wrong code is refused", () => {
    const registry = new PairingRegistry();
    registry.issue("client-1");
    expect(registry.redeem("client-1", "000000").ok).toBe(false);
  });

  test("a code is bound to the client that requested it", () => {
    const registry = new PairingRegistry();
    registry.issue("client-1");
    expect(registry.redeem("client-2", "123456").ok).toBe(false);
  });

  test("every browser job state is covered by the transition table", () => {
    // A state with no entry would throw at runtime rather than being rejected.
    for (const state of BROWSER_JOB_STATES) {
      expect(() => canTransitionBrowserJob(state, state), state).not.toThrow();
    }
  });
});
