import { describe, expect, test } from "bun:test";
import { MOCK_GROK_PAGES, mockPage, signalsFor } from "./fixtures/grok/pages";
import { detectPage, isSubmittable, requiresHuman } from "../src/agent-os/browser-provider/page-detector";
import { resolveSelector, GROK_SELECTOR_PROFILE } from "../src/agent-os/browser-provider/selectors";

/**
 * Phase 20.18 — mock Grok page integration.
 *
 * CI must never need a Grok account. These fixtures exercise the detector against
 * every page state the real world produces, including the ones where the correct
 * behaviour is to STOP. The blocked cases matter most: a detector that treated a
 * CAPTCHA as an ordinary page would send a job into a wall and retry it.
 */

describe("Phase 20.18 — mock page detection", () => {
  test("every fixture is detected as its declared page type", () => {
    for (const page of MOCK_GROK_PAGES) {
      const detection = detectPage(signalsFor(page));
      expect(detection.pageType, page.name).toBe(page.expectedPageType);
    }
  });

  test("a blocked fixture is never submittable", () => {
    // This is the assertion that protects the operator: if a blocking page became
    // submittable, the queue would type into it and report a failure that looks
    // like a selector bug.
    for (const name of ["rate-limit", "login-required", "captcha"]) {
      const page = mockPage(name);
      const detection = detectPage(signalsFor(page));
      expect(isSubmittable(detection.pageType), name).toBe(false);
      expect(requiresHuman(detection.pageType), name).toBe(true);
    }
  });

  test("a blocked fixture never reports high confidence from a URL alone", () => {
    // The rate-limit page sits on the Imagine URL. Reporting the URL signal as the
    // answer would be confidently wrong.
    const detection = detectPage(signalsFor(mockPage("rate-limit")));
    expect(detection.pageType).not.toBe("grok-imagine");
    expect(detection.evidence.join(" ")).toContain("rate-limit");
  });

  test("a selector-changed page is recognised but has no prompt control", () => {
    // The detector identifies the page while the selector engine finds nothing to
    // type into. Those two answers differ on purpose: the first says where we are,
    // the second says whether this build can act there.
    const page = mockPage("selector-changed");
    const detection = detectPage(signalsFor(page));
    expect(detection.pageType).toBe("grok-imagine");

    // With no aria label and no role, the prompt input has nothing but CSS to try.
    const resolution = resolveSelector(GROK_SELECTOR_PROFILE.specs.promptInput!, () => false);
    expect(resolution.found).toBe(false);
    expect(resolution.failures.length).toBeGreaterThan(0);
  });

  test("a non-Grok fixture is reported unsupported rather than unknown", () => {
    const detection = detectPage(signalsFor(mockPage("unsupported")));
    expect(detection.pageType).toBe("unsupported");
    expect(detection.confidence).toBeGreaterThan(0.5);
  });

  test("every fixture carries a stated purpose", () => {
    // A fixture nobody can explain is a fixture nobody will maintain.
    for (const page of MOCK_GROK_PAGES) {
      expect(page.detail.length, page.name).toBeGreaterThan(20);
    }
  });
});

describe("Phase 20.18 — prompt injection verification", () => {
  /**
   * Mirrors the content script's comparison, so the rule is tested here rather than
   * only inside a page context. A drift between the two would be silent.
   */
  function normalize(text: string): string {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function verify(injected: string, expected: string): boolean {
    return normalize(injected) === normalize(expected);
  }

  test("a reflowed prompt still verifies", () => {
    // A rich text field reflows whitespace, so an exact compare would reject a
    // correct injection and block every job.
    expect(verify("a farm\nat\nsunrise", "a farm at sunrise")).toBe(true);
  });

  test("a truncated prompt fails verification", () => {
    // The failure this check exists for: the field accepted part of the text.
    expect(verify("a farm", "a farm at sunrise")).toBe(false);
  });

  test("a substituted prompt fails verification", () => {
    expect(verify("a city at sunrise", "a farm at sunrise")).toBe(false);
  });

  test("an empty field fails verification", () => {
    expect(verify("", "a farm at sunrise")).toBe(false);
  });
});
