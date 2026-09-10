# Pao Grok Bridge — selector maintenance

When the Grok UI changes, this is the only file that should need editing:

```text
src/agent-os/browser-provider/selectors.ts     GROK_SELECTOR_PROFILE
apps/chrome-grok-bridge/src/content/grok-detector.js   PROFILE (mirror)
```

## How to tell a selector broke

Run extension diagnostics. The table shows per-selector confidence:

| Result | Meaning | Action |
| --- | --- | --- |
| Not found | No candidate resolved | Update the profile |
| Found, confidence 1.0 | Matched the strongest signal | Nothing |
| Found, confidence below 1.0 | Matched a fallback | Add a stronger candidate |
| Stale | Found but below the floor | Treat as broken |

A RATE matters more than any single row. One selector falling back is a warning; five
at once means the page changed.

## Why there is no single CSS selector to update

Each element has several weighted candidates using different signal kinds:

| Signal | Weight | Why |
| --- | --- | --- |
| role | 100 | Survives redesigns, localisation, and class renaming |
| aria | 95 | Semantically meaningful; a site has a reason to keep it |
| text | 80 | Visible copy changes with localisation |
| css | 55 | Least stable; may match a layout artefact |

CSS is not absent — it is the last resort. A CSS match still works and is reported as
STALE, which is the signal that says "this will break next time".

## How to add a candidate

1. Open the page and inspect the element.
2. Ask what makes it identifiable to a screen reader. Prefer that answer:

```js
// Good: semantic, stable, meaningful to the site too
{ strategy: "role", value: "textbox", weight: 100 }
{ strategy: "aria", value: "Describe your image", weight: 95 }

// Acceptable as a fallback
{ strategy: "css", value: "textarea[placeholder]", weight: 55 }

// Poor: a build-hashed class, which changes on every deploy
{ strategy: "css", value: ".css-1x9f2k", weight: 55 }
```

3. Assign a weight. Use the defaults unless the site gives a strong reason otherwise.
4. Add it to BOTH files. The duplication is deliberate — a content script cannot import
   from the extension module graph, and fetching code at runtime would be worse.
5. Run `bun test tests/grok-bridge.test.ts` and `tests/grok-bridge-mock-pages.test.ts`.

## Verifying a change

```bash
bun test tests/grok-bridge.test.ts tests/grok-bridge-mock-pages.test.ts
bun run typecheck
```

Then reload the extension and run diagnostics against a live page. A mocked page cannot
tell you whether the real page now has a role attribute it did not have before.

## When to raise the minConfidence floor

`minConfidence` is set per spec. The result selector's floor is 0.75 and higher than
the default because output detection is the weakest signal on a generative page: media
elements are reused for avatars and icons, so a loose floor reports a completed
generation that never happened.

Raise a floor when a false positive is worse than a false negative — that is, when
acting on a wrong match is more damaging than failing to act.

## When the whole page is unrecognisable

If the detector reports `unknown` with low confidence, the URL and text signals both
stopped matching. Check whether the site moved to a new hostname or path, and update
`detect` in `page-detector.ts` alongside the profile.

Do not widen the detector to accept any `grok.com` URL. A page that cannot be
identified must not be typed into, because the failure mode is a generation submitted
somewhere unintended.
