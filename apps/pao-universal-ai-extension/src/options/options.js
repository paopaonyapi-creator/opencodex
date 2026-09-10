// Pao Universal AI Bridge — options.

const KEYS = [
  "bridgeUrl",
  "bridgeToken",
  "autoReconnect",
  "safeMode",
  "autoDownload",
  "downloadPrefix",
  "maxConcurrentJobs",
  "retryMaxAttempts",
  "retryBaseDelayMs",
  "debugLogging",
  "screenshotOnError"
];

const DEFAULTS = {
  bridgeUrl: "http://127.0.0.1:43117",
  bridgeToken: "",
  autoReconnect: true,
  safeMode: true,
  autoDownload: true,
  downloadPrefix: "PAO-GROK",
  maxConcurrentJobs: 1,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 5000,
  debugLogging: false,
  screenshotOnError: false
};

async function load() {
  const stored = await chrome.storage.local.get(KEYS);
  for (const key of KEYS) {
    const node = document.getElementById(key);
    if (!node) continue;
    const value = stored[key] === undefined ? DEFAULTS[key] : stored[key];
    if (node.type === "checkbox") node.checked = Boolean(value);
    else node.value = value === undefined || value === null ? "" : String(value);
  }
  // Safe mode is reported as it actually is, and the control is disabled rather than
  // hidden: a disabled checkbox with an explanation is clearer than a missing one.
  const safe = document.getElementById("safeMode");
  if (safe) {
    safe.checked = true;
    safe.disabled = true;
  }
  const concurrency = document.getElementById("maxConcurrentJobs");
  if (concurrency) {
    concurrency.value = "1";
    concurrency.disabled = true;
  }
}

async function save() {
  const payload = {};
  for (const key of KEYS) {
    const node = document.getElementById(key);
    if (!node) continue;
    if (node.type === "checkbox") payload[key] = node.checked;
    else if (node.type === "number") payload[key] = Number(node.value) || DEFAULTS[key];
    else payload[key] = node.value;
  }
  payload.safeMode = true;
  payload.maxConcurrentJobs = 1;
  await chrome.storage.local.set(payload);
  const saved = document.getElementById("saved");
  if (saved) {
    saved.hidden = false;
    setTimeout(() => {
      saved.hidden = true;
    }, 2000);
  }
}

document.getElementById("save")?.addEventListener("click", save);

document.getElementById("reset-selectors")?.addEventListener("click", async () => {
  await chrome.storage.local.remove("selectorProfile");
  const saved = document.getElementById("saved");
  if (saved) {
    saved.textContent = "Selector cache cleared. The built-in profile will be used.";
    saved.hidden = false;
  }
});

load();
