# Pao Universal AI Bridge — Chrome extension

A Manifest V3 extension that drives **Grok, ChatGPT, Gemini, and Claude** as Pao-hubPro
generation providers through **one** adapter runtime. Local-only, human-in-the-loop.

This is the Phase 20.18 Grok extension migrated to the Phase 20.19 universal runtime. The
extension id changes because it is derived from the directory path, so re-pairing is
required after the move.

## What it does not do

- **Cannot** bypass a CAPTCHA, a login wall, a rate limit, a subscription limit, a payment
  prompt, or an account-verification page. There is no code path that attempts to. A page
  presenting one is reported as blocked for a person to resolve.
- **Never** reads, stores, or transmits a cookie, password, or session token. The bridge has
  no route that could accept one.
- **Does not** reach any tab outside the four adapter hosts, and does not request
  `<all_urls>`. Permissions are `storage`, `tabs`, `downloads`, `scripting`, `sidePanel`.
- **Never** auto-uploads to Adobe Stock.

## Install (unpacked)

```bash
# 1. Start the bridge.
bun run .tmp/bridge-run.ts

# 2. Load the extension.
#    chrome://extensions -> Developer mode -> Load unpacked
#    Select: apps/pao-universal-ai-extension

# 3. Note the id Chrome assigns, then restart the bridge with it allowed.
PAO_BRIDGE_EXTENSION_IDS=<the-id-chrome-assigned> bun run .tmp/bridge-run.ts
```

**Step 3 is required.** The bridge allowlist is empty by default and an empty allowlist
permits nothing. That is deliberate: an unrelated extension cannot attach even if it learns
the port and the token.

## Adapters

| Adapter | Hosts | Modes | Live verified |
| --- | --- | --- | --- |
| grok | grok.com, *.grok.com | manual, assisted, automatic | no |
| chatgpt | chatgpt.com, *.chatgpt.com, chat.openai.com | manual, assisted | no |
| gemini | gemini.google.com, *.gemini.google.com | manual, assisted | no |
| claude | claude.ai, *.claude.ai | manual, assisted | no |

**No adapter is live-verified**, so automatic is not offered for any of them. Automatic is
granted only after an adapter has been confirmed against the real site and marked
liveVerified.

Detection refuses to act when two adapters score within the ambiguity margin. That matters
when a page mentions a competitor: the answer is to stop, not to pick the higher scorer,
because a prompt typed into the wrong site cannot be undone by retrying.

## Side panel

Click the extension icon, then open the side panel from Chrome panel picker. It shows the
current tab adapter, page type, detection confidence, per-target selector confidence, and
the queue.

The panel has **no submit control**. Submitting spends real money and time at the other end,
and a status surface is the wrong place for a button that generates on a site you are not
looking at.

## Dry run

Dry run resolves every selector and reports what it found while executing **no** side-effect
action. This is possible because the action vocabulary is closed — an adapter proposes typed
actions and the executor decides whether each is a side effect. With arbitrary code there
would be nothing to enumerate.

## Selector confidence

Each element has weighted candidates across role, aria, text, and CSS. The strongest signal
that resolves wins, and its confidence is reported. A fallback to CSS shows as **stale**
rather than as healthy — that is the flag that says this will break next time while it still
works.

## Adding a fifth site

1. Add an adapter entry to `src/content/adapter-runtime.js` (manifest, score, gate detection,
   targets) and the matching manifest in
   `src/agent-os/browser-provider/universal/adapters.ts`.
2. Add its hosts to `manifest.json` host_permissions and the content-script matches.
3. Add a selector profile to `src/content/selector-profiles.js`.
4. Add fixtures and detection tests.

Nothing else changes. That is the property the universal layer exists to provide, and the
first real test of it is doing step 1 for a site that is actually loaded.

## Troubleshooting

See `docs/grok-bridge-troubleshooting.md`. The bridge, auth, and gate behaviour is unchanged
from Phase 20.18.
