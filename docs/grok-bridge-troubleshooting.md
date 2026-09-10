# Pao Grok Bridge — troubleshooting

## The popup says "Bridge unreachable"

1. Confirm the bridge process is running and which port it bound:

```bash
curl -s http://127.0.0.1:43117/health
```

   A response means the process is up. A connection refusal means it is not, or it
   bound a different port.

2. Check the bridge URL in extension options matches the port above.

3. Confirm the bridge is bound to loopback only. It always is — the host is not
   configurable — so a bridge reachable from another machine would indicate a
   different process on that port.

## "Bridge up, no tab"

The bridge is running but no extension has completed a pairing, or the heartbeat has
gone stale.

1. Open the popup; it shows the last known tab state.
2. Run diagnostics. `Extension connected: no` means no valid pairing.
3. Re-pair. The code is single-use and expires after two minutes, so an old code is
   always the first thing to suspect.

## Every request returns 401

Four distinct causes, in the order to check them:

| Cause | Check |
| --- | --- |
| No Origin header | The caller must send one. curl does not by default. |
| A web origin | Only a chrome-extension:// origin is accepted. A page can reach localhost, so this check is what stops a website driving the bridge. |
| An extension id not on the allowlist | Set PAO_BRIDGE_EXTENSION_IDS to the id Chrome assigned. |
| A wrong token | Re-pair. |

The bridge reports the same status for all four with a distinguishing message, so a
caller cannot enumerate which control it failed.

## The prompt is typed but the job fails with GROK_PROMPT_VERIFY_FAILED

The field did not hold what was written. Causes:

- The page's framework reformatted or truncated the text.
- The prompt field matched a low-confidence selector and is not the real control.

Run diagnostics and look at the promptInput confidence. A confidence below 1 means a
fallback signal was used, and the profile likely needs an update.

**Do not work around this by disabling verification.** Submitting unverified text
generates something the operator did not ask for while reporting success, which is
worse than the failure.

## A job is stuck in waiting_browser

That is the correct state when no Grok tab is available. The queue does not fail
these, because a closed laptop is not a failed generation.

1. Open a Grok tab and sign in.
2. Confirm the popup reads Connected.
3. The next heartbeat picks the job up.

## A job is in blocked

A human gate appeared. The errorCode says which:

| Code | What to do |
| --- | --- |
| GROK_SESSION_REQUIRED | Sign in to Grok in that tab, then resume. |
| GROK_RATE_LIMITED | Wait. The bridge will not retry, and retrying would be an evasion attempt. |
| GROK_USER_ACTION_REQUIRED | The page wants an interaction the extension will not perform. |

Blocked jobs never auto-resume. That is the design: the point is that a person looks.

## A job is in needs_review

Chrome, the extension, or the bridge restarted while the job was mid-generation, so
the system does not know whether the output exists.

1. Check the Grok tab: did the output appear?
2. If yes, collect the result and mark the job completed.
3. If no, resume it.

**It is needs_review rather than failed on purpose.** A failed job is retryable by
the queue, and retrying something that may already have generated is how duplicate
work appears.

## The page changed and selectors fall back

Expected over time. See [selector maintenance](grok-bridge-selector-maintenance.md).

## Jobs are not downloading

1. Confirm autoDownload is on in options.
2. Check the downloads root is writable.
3. Look for .part files in the job directory. A .part file means a write was
   interrupted; it is never presented as a complete download.

## Collecting a diagnostic report

Diagnostics page, then Copy Diagnostic Report. It contains no credential. If a report
ever does, that is a defect worth reporting immediately.
