// Pao Grok Bridge — extension service worker (Manifest V3).
//
// The worker is the only part of the extension that talks to the bridge, and it is
// the only part that holds the bridge token. A content script runs in the PAGE's
// world and can be observed by page scripts, so a token kept there would be
// reachable by the site. Keeping it in the worker is what makes the token a real
// boundary rather than a formality.
//
// The worker never touches a Grok cookie and has no API that could read one.

const PROTOCOL = "pao-grok-bridge/1";
const HEARTBEAT_MS = 10000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

async function getSettings() {
  const stored = await chrome.storage.local.get([
    "bridgeUrl",
    "bridgeToken",
    "safeMode",
    "autoDownload",
    "maxConcurrentJobs",
    "debugLogging",
    "screenshotOnError",
    "retryMaxAttempts",
    "retryBaseDelayMs",
    "downloadPrefix"
  ]);
  return {
    bridgeUrl: stored.bridgeUrl || "http://127.0.0.1:43117",
    bridgeToken: stored.bridgeToken || "",
    // Safe mode defaults ON. A default that protected the operator would be worse
    // than one that required them to opt in to protection.
    safeMode: stored.safeMode === undefined ? true : Boolean(stored.safeMode),
    autoDownload: stored.autoDownload === undefined ? true : Boolean(stored.autoDownload),
    maxConcurrentJobs: Number(stored.maxConcurrentJobs) || 1,
    debugLogging: Boolean(stored.debugLogging),
    screenshotOnError: Boolean(stored.screenshotOnError),
    retryMaxAttempts: Number(stored.retryMaxAttempts) || 3,
    retryBaseDelayMs: Number(stored.retryBaseDelayMs) || 5000,
    downloadPrefix: stored.downloadPrefix || "PAO-GROK"
  };
}

async function bridgeFetch(path, options = {}) {
  const settings = await getSettings();
  const response = await fetch(`${settings.bridgeUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Pao-Bridge-Token": settings.bridgeToken,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`Bridge responded ${response.status}`);
  }
  return response.json();
}

async function findGrokTab() {
  const tabs = await chrome.tabs.query({ url: ["https://grok.com/*", "https://*.grok.com/*"] });
  // Prefer a tab that is already on a generation surface, so a background tab on the
  // home page does not shadow the one the operator is actually using.
  return tabs.find((tab) => tab.active && tab.url && !tab.url.includes("/login")) || tabs[0] || null;
}

let reconnectDelay = RECONNECT_BASE_MS;
let heartbeatTimer = null;

async function beat() {
  try {
    const settings = await getSettings();
    const tab = await findGrokTab();
    let pageType = "unknown";
    if (tab && tab.id !== undefined) {
      try {
        const probe = await chrome.tabs.sendMessage(tab.id, { protocol: PROTOCOL, type: "diagnostics.run" });
        if (probe && probe.pageType) pageType = probe.pageType;
      } catch (error) {
        // A tab without the content script is normal right after install.
      }
    }
    await bridgeFetch("/v1/extension/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        extensionVersion: chrome.runtime.getManifest().version,
        pageType,
        signals: {
          url: tab && tab.url ? tab.url : "",
          title: tab && tab.title ? tab.title : "",
          visibleText: [],
          ariaLabels: [],
          roles: []
        }
      })
    });
    reconnectDelay = RECONNECT_BASE_MS;
    await setBadge("OK", "#2e7d32");
  } catch (error) {
    await setBadge("OFF", "#9e9e9e");
    // Exponential backoff with a ceiling. A bridge that is down should be retried
    // steadily rather than hammered, and the ceiling keeps recovery prompt.
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    if (settings_debug(await getSettings())) {
      console.warn("[pao-grok-bridge] heartbeat failed", error);
    }
  }
}

function settings_debug(settings) {
  return Boolean(settings.debugLogging);
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (error) {
    // Badge APIs can fail on a locked profile; it is cosmetic.
  }
}

async function dispatchNextJob() {
  try {
    const next = await bridgeFetch("/v1/jobs/next");
    if (!next || !next.job) return;
    const tab = await findGrokTab();
    if (!tab || tab.id === undefined) {
      await setBadge("!", "#e65100");
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { protocol: PROTOCOL, type: "job.start", job: next.job });
    await setBadge("1", "#1565c0");
  } catch (error) {
    await setBadge("ERR", "#c62828");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.protocol !== PROTOCOL) return false;

  if (message.type === "generation.state" || message.type === "generation.error" || message.type === "generation.result" || message.type === "browser.page") {
    bridgeFetch("/v1/extension/report", { method: "POST", body: JSON.stringify(message) })
      .catch(() => setBadge("ERR", "#c62828"))
      .finally(() => { if (message.type === "generation.state" && message.state === "collecting") dispatchNextJob(); });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "pairing.redeem") {
    bridgeFetch("/v1/extension/pair", {
      method: "POST",
      body: JSON.stringify({ clientId: message.clientId, code: message.code })
    })
      .then(async (result) => {
        if (result && result.token) {
          await chrome.storage.local.set({ bridgeToken: result.token });
        }
        sendResponse({ ok: true, result });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  setBadge("OFF", "#9e9e9e");
  beat();
});

if (heartbeatTimer) clearInterval(heartbeatTimer);
heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
beat();
