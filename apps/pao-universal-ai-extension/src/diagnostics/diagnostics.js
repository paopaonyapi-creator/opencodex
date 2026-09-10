// Pao Universal AI Bridge — diagnostics page.
//
// The report is built from a whitelist of fields rather than by serializing whatever
// happens to be in scope. A report assembled by exclusion leaks the moment someone
// adds a field; a report assembled by inclusion cannot.

const PROTOCOL = "pao-browser-bridge/2";

let lastReport = null;

function row(parent, cells) {
  const tr = document.createElement("tr");
  for (const cell of cells) {
    const td = document.createElement("td");
    td.textContent = cell;
    tr.appendChild(td);
  }
  parent.appendChild(tr);
}

async function runDiagnostics() {
  const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken", "safeMode"]);
  const bridgeUrl = stored.bridgeUrl || "http://127.0.0.1:43117";

  let bridge = { reachable: false, extensionConnected: false, queued: 0, running: null };
  try {
    const response = await fetch(`${bridgeUrl}/health`);
    const health = await response.json();
    bridge = {
      reachable: true,
      extensionConnected: Boolean(health.extensionConnected),
      queued: Number(health.queued) || 0,
      running: health.running || null
    };
  } catch (error) {
    bridge.reachable = false;
  }

  const tabs = await chrome.tabs.query({
    url: [
      "https://grok.com/*",
      "https://*.grok.com/*",
      "https://chatgpt.com/*",
      "https://*.chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://gemini.google.com/*",
      "https://*.gemini.google.com/*",
      "https://claude.ai/*",
      "https://*.claude.ai/*",
    ],
  });
  let pageProbe = null;
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    try {
      pageProbe = await chrome.tabs.sendMessage(tabs[0].id, { protocol: PROTOCOL, type: "diagnostics.run" });
    } catch (error) {
      pageProbe = null;
    }
  }

  const manifest = chrome.runtime.getManifest();

  const env = document.getElementById("env-body");
  if (env) {
    env.textContent = "";
    row(env, ["Extension version", manifest.version]);
    row(env, ["Bridge URL", bridgeUrl]);
    row(env, ["Bridge reachable", bridge.reachable ? "yes" : "no"]);
    row(env, ["Extension connected", bridge.extensionConnected ? "yes" : "no"]);
    row(env, ["Grok tabs open", String(tabs.length)]);
    row(env, ["Detected page type", pageProbe ? pageProbe.pageType : "not probed"]);
    row(env, ["Selector profile", pageProbe ? pageProbe.profileVersion : "unknown"]);
    row(env, ["Queue", String(bridge.queued)]);
    row(env, ["Running job", bridge.running || "none"]);
    row(env, ["Safe mode", "on (fixed)"]);
  }

  const selectorBody = document.getElementById("selector-body");
  if (selectorBody) {
    selectorBody.textContent = "";
    if (pageProbe && Array.isArray(pageProbe.selectors)) {
      for (const entry of pageProbe.selectors) {
        const tr = document.createElement("tr");
        for (const value of [
          entry.name,
          entry.found ? "yes" : "no",
          entry.found ? entry.confidence.toFixed(2) : "—",
          entry.strategy || "—",
          entry.stale ? "yes" : "no"
        ]) {
          const td = document.createElement("td");
          td.textContent = value;
          if (entry.stale && value === "yes") td.className = "warning";
          tr.appendChild(td);
        }
        selectorBody.appendChild(tr);
      }
    } else {
      row(selectorBody, ["No Grok tab to probe", "—", "—", "—", "—"]);
    }
  }

  lastReport = {
    generatedAt: new Date().toISOString(),
    extensionVersion: manifest.version,
    bridgeUrl,
    bridge,
    grokTabs: tabs.length,
    pageType: pageProbe ? pageProbe.pageType : null,
    selectors: pageProbe && pageProbe.selectors ? pageProbe.selectors : []
  };

  const errorNode = document.getElementById("last-error");
  if (errorNode) {
    errorNode.textContent = bridge.reachable
      ? "None recorded."
      : "The bridge did not respond. Confirm it is running and the URL is correct.";
  }
}

document.getElementById("run")?.addEventListener("click", runDiagnostics);

document.getElementById("copy")?.addEventListener("click", async () => {
  if (!lastReport) await runDiagnostics();
  await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
});

document.getElementById("reset")?.addEventListener("click", async () => {
  await chrome.storage.local.remove("selectorProfile");
  const errorNode = document.getElementById("last-error");
  if (errorNode) errorNode.textContent = "Selector cache cleared.";
});

runDiagnostics();
