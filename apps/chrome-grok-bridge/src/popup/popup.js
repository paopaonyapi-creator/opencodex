// Pao Grok Bridge — popup.
//
// Reads state from the bridge and the worker. Deliberately read-mostly: the popup is
// a status surface, and a status surface that can also change things is one people
// are reluctant to open.

const PROTOCOL = "pao-grok-bridge/1";

async function settings() {
  const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken", "safeMode"]);
  return {
    bridgeUrl: stored.bridgeUrl || "http://127.0.0.1:43117",
    bridgeToken: stored.bridgeToken || "",
    safeMode: stored.safeMode === undefined ? true : Boolean(stored.safeMode)
  };
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

async function refresh() {
  const s = await settings();
  setText("safe-mode", s.safeMode ? "ON" : "OFF");

  const connection = document.getElementById("connection");
  if (connection) {
    connection.className = "status status--unknown";
    connection.textContent = "Checking…";
  }

  try {
    const response = await fetch(`${s.bridgeUrl}/health`);
    const health = await response.json();
    if (connection) {
      connection.className = health.extensionConnected ? "status status--ok" : "status status--warn";
      connection.textContent = health.extensionConnected ? "Connected" : "Bridge up, no tab";
    }
    setText("queue", String(health.queued));
    setText("running", health.running || "—");
  } catch (error) {
    if (connection) {
      connection.className = "status status--bad";
      connection.textContent = "Bridge unreachable";
    }
    setText("queue", "—");
    setText("running", "—");
  }

  const tabs = await chrome.tabs.query({ url: ["https://grok.com/*", "https://*.grok.com/*"] });
  setText("grok-tab", tabs.length > 0 ? `${tabs.length} open` : "none");
}

function notice(message) {
  const node = document.getElementById("notice");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
}

document.getElementById("pause")?.addEventListener("click", async () => {
  await chrome.storage.local.set({ paused: true });
  notice("Queue paused. Jobs stay queued and will not be dispatched.");
});

document.getElementById("resume")?.addEventListener("click", async () => {
  await chrome.storage.local.set({ paused: false });
  notice("Queue resumed.");
});

document.getElementById("dashboard")?.addEventListener("click", async () => {
  const s = await settings();
  // The dashboard lives on the local Pao-hubPro proxy. The URL is derived from the
  // bridge host rather than hard-coded, so a non-default port still works.
  chrome.tabs.create({ url: s.bridgeUrl.replace(":43117", ":10100") + "/#control-plane" });
});

void PROTOCOL;
refresh();
