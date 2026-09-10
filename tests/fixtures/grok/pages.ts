// Phase 20.18 — mock Grok page fixtures.
//
// CI must never require a live Grok account. These fixtures reproduce the SIGNALS
// the detector reads — URL, visible text, aria labels, roles — rather than pretending
// to be the real page, because the detector is what is under test.
//
// Each fixture also records what the page is FOR: a page that should be detected as
// blocked exists to prove the system stops, not to prove it can carry on.

export interface MockGrokPage {
  readonly name: string;
  readonly url: string;
  readonly title: string;
  readonly visibleText: readonly string[];
  readonly ariaLabels: readonly string[];
  readonly roles: readonly string[];
  /** What the detector SHOULD conclude. */
  readonly expectedPageType: string;
  /** Whether a job may be submitted against this page. */
  readonly submittable: boolean;
  readonly detail: string;
}

export const MOCK_GROK_PAGES: readonly MockGrokPage[] = [
  {
    name: "projects",
    url: "https://grok.com/projects",
    title: "Projects — Grok",
    visibleText: ["Projects", "New project", "Recent"],
    ariaLabels: ["Ask anything", "Submit"],
    roles: ["textbox", "button"],
    expectedPageType: "grok-projects",
    submittable: true,
    detail: "The normal Projects surface. A job should be accepted.",
  },
  {
    name: "imagine",
    url: "https://grok.com/imagine",
    title: "Imagine — Grok",
    visibleText: ["Imagine", "Describe the image you want"],
    ariaLabels: ["prompt", "Generate", "upload"],
    roles: ["textbox", "button"],
    expectedPageType: "grok-imagine",
    submittable: true,
    detail: "The Imagine surface. A job should be accepted.",
  },
  {
    name: "generating",
    url: "https://grok.com/imagine",
    title: "Imagine — Grok",
    visibleText: ["Imagine", "Generating your image"],
    ariaLabels: ["Generating"],
    roles: ["textbox", "progressbar"],
    expectedPageType: "grok-generation",
    submittable: false,
    detail: "A generation in flight outranks the container page it sits on.",
  },
  {
    name: "completed",
    url: "https://grok.com/imagine",
    title: "Imagine — Grok",
    visibleText: ["Imagine", "Here is your image"],
    ariaLabels: ["prompt"],
    roles: ["textbox", "img"],
    expectedPageType: "grok-imagine",
    submittable: true,
    detail: "An idle page that shows a previous result; the observer collects from it.",
  },
  {
    name: "rate-limit",
    url: "https://grok.com/imagine",
    title: "Imagine — Grok",
    visibleText: ["You have hit the rate limit", "Try again later"],
    ariaLabels: [],
    roles: ["textbox"],
    expectedPageType: "rate-limited",
    submittable: false,
    detail: "A rate limit must BLOCK the job. Retrying would be an attempted evasion.",
  },
  {
    name: "login-required",
    url: "https://grok.com/login",
    title: "Sign in — Grok",
    visibleText: ["Sign in to continue"],
    ariaLabels: ["Sign in"],
    roles: ["button"],
    expectedPageType: "login-required",
    submittable: false,
    detail: "An expired session must BLOCK the job and ask for a person.",
  },
  {
    name: "captcha",
    url: "https://grok.com/imagine",
    title: "Imagine — Grok",
    visibleText: ["Verify you are human to continue"],
    ariaLabels: [],
    roles: [],
    expectedPageType: "login-required",
    submittable: false,
    detail: "A CAPTCHA must BLOCK. The extension has no code path that could clear it.",
  },
  {
    name: "selector-changed",
    url: "https://grok.com/imagine",
    title: "Imagine — Grok",
    visibleText: ["Imagine", "A redesigned layout"],
    ariaLabels: [],
    roles: [],
    expectedPageType: "grok-imagine",
    submittable: false,
    detail: "The page is recognisable but has no prompt control: selectors are stale and the job must not proceed.",
  },
  {
    name: "unsupported",
    url: "https://example.com/",
    title: "Example",
    visibleText: ["Hello"],
    ariaLabels: [],
    roles: [],
    expectedPageType: "unsupported",
    submittable: false,
    detail: "A non-Grok tab is unsupported rather than unknown.",
  },
];

/** Look up a fixture by name. Throws rather than returning undefined. */
export function mockPage(name: string): MockGrokPage {
  const page = MOCK_GROK_PAGES.find((entry) => entry.name === name);
  if (!page) throw new Error(`Unknown mock page '${name}'.`);
  return page;
}

/** Project a fixture into the signal bundle the detector consumes. */
export function signalsFor(page: MockGrokPage): {
  url: string;
  visibleText: readonly string[];
  ariaLabels: readonly string[];
  roles: readonly string[];
  title: string;
} {
  return {
    url: page.url,
    visibleText: page.visibleText,
    ariaLabels: page.ariaLabels,
    roles: page.roles,
    title: page.title,
  };
}
