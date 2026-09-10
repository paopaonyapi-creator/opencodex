# Pao Grok Bridge — Chrome extension

A Manifest V3 extension that lets Pao-hubPro drive Grok Projects / Imagine through the
browser tab you already have open. It is **local-only** and **human-in-the-loop**.

## What it does not do

Read this first, because these are properties of the code rather than promises:

- It **cannot** bypass a CAPTCHA, a login wall, a rate limit, a subscription limit, or
  an account-verification page. There is no code path that attempts to. A page that
  presents one is reported as `blocked` for a person to resolve.
- It **never** reads, stores, or transmits a Grok cookie, password, or session token.
  The bridge has no route that could accept one, which is a stronger guarantee than a
  rule saying it must not.
- It **does not** reach any tab other than a Grok tab, and it does not request
  `<all_urls>`. The four permissions it asks for are `storage`, `tabs`, `downloads`,
  and `scripting`.
- It **never** auto-uploads to Adobe Stock. Export stops at a local package.

## Install (unpacked)

```bash
# 1. Start the bridge.
bun run src/cli/index.ts bridge        # or: bun run .tmp/bridge-run.ts during development

# 2. Load the extension.
#    chrome://extensions -> Developer mode -> Load unpacked
#    Select: apps/chrome-grok-bridge

# 3. Note the extension id Chrome assigns, then restart the bridge with it allowed.
PAO_BRIDGE_EXTENSION_IDS=<the-id-chrome-assigned> bun run src/cli/index.ts bridge
```

**Step 3 is required.** The bridge's extension allowlist is empty by default and an
empty allowlist permits no extension at all. That is deliberate: it means an unrelated
extension cannot attach even if it learns the port and the token.

The extension id is stable once loaded, because Chrome derives it from the unpacked
directory's absolute path. If you move the directory, the id changes and step 3 must be
repeated.

## Pairing

1. Open the extension popup. It reports `Bridge unreachable` until the bridge is running
   with the extension id allowed.
2. Start a pairing from the popup (or `POST /v1/extension/pair/start`).
3. The bridge returns a six-digit code. Enter it in the popup.
4. The extension stores the bridge token in Chrome storage and heartbeats from then on.

The code is single-use and expires after two minutes. A code that stayed valid would be
a permanent weak credential, which is the thing pairing exists to avoid.

## Configuration

Open the extension options page. The settings that matter:

| Setting | Notes |
| --- | --- |
| Bridge URL | Defaults to `http://127.0.0.1:43117` |
| Safe mode | On, and not switchable in this build |
| Max concurrent jobs | Fixed at 1 |
| Auto download | On by default |
| Retry attempts / delay | Bounded; the queue never retries forever |
| Debug logging | Off by default |
| Screenshot on error | Off by default; captures only the Grok tab |

### Why concurrency is fixed at 1

Browser generation is a single interactive session. Two concurrent jobs would type into
the same prompt field, so the second would overwrite the first and both would report
confusing failures. The queue enforces one in-flight job regardless of this setting.

## Usage

1. Open a Grok tab on Projects or Imagine and sign in normally.
2. The popup should read `Connected` with the tab detected.
3. Create jobs from the Pao-hubPro dashboard, or directly:

```bash
curl -X POST http://127.0.0.1:43117/v1/jobs \
  -H "Origin: chrome-extension://<id>" \
  -H "X-Pao-Bridge-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{"type":"image","prompt":"a farm at sunrise","count":4,"aspectRatio":"16:9"}'
```

## Execution modes

| Mode | Behaviour |
| --- | --- |
| `manual` | Types and verifies the prompt, then stops. You press Generate. |
| `assisted` (default) | Generates automatically, stops before export. |
| `automatic` | Full pipeline including export handoff, still stopping at any human gate. |

## Diagnostics

The diagnostics page reports environment, bridge health, and per-selector confidence.
`Copy Diagnostic Report` produces JSON containing **no token, cookie, or authorization
header** — it is assembled from a whitelist of fields rather than by filtering, so a new
field cannot leak by default.

The useful number is selector confidence. A selector resolving at low confidence means
the page changed and the profile needs updating. See
[selector maintenance](../docs/grok-bridge-selector-maintenance.md).

## Troubleshooting

See [troubleshooting](../docs/grok-bridge-troubleshooting.md).

