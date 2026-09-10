// Pao Universal AI Extension — side panel.
//
// The panel answers one question at a glance: what is this tab, and what is the queue doing.
// It deliberately does NOT offer a submit control. Submitting is the action with a real cost
// at the other end, and a button that generates on a site the operator is not looking at is
// not something a status surface should provide.

const PROTOCOL = 'pao-browser-bridge/2';

async function settings() {
  const stored = await chrome.storage.local.get(['bridgeUrl', 'bridgeToken', 'safeMode']);
  return {
    bridgeUrl: stored.bridgeUrl || 'http://127.0.0.1:43117',
    bridgeToken: stored.bridgeToken || '',
    safeMode: stored.safeMode === undefined ? true : Boolean(stored.safeMode),
  };
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function notice(message) {
  const node = document.getElementById('notice');
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || '';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function probe() {
  const tab = await activeTab();
  if (!tab || tab.id === undefined) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { protocol: PROTOCOL, type: 'diagnostics.run' });
  } catch (error) {
    // A tab without the content script is normal: the adapter set does not claim it.
    return null;
  }
}

function renderTargets(probeResult) {
  const body = document.getElementById('targets');
  if (!body) return;
  body.textContent = '';
  if (!probeResult || !probeResult.targets || probeResult.targets.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'muted';
    td.textContent = 'No adapter claims this page.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  for (const target of probeResult.targets) {
    const tr = document.createElement('tr');
    for (const value of [
      target.target,
      target.found ? 'yes' : 'no',
      target.found ? Number(target.confidence).toFixed(2) : '—',
    ]) {
      const td = document.createElement('td');
      td.textContent = value;
      // A stale match is the signal that the page changed, so it is coloured rather than
      // reported as a plain success.
      if (target.stale && value === 'yes') td.className = 'warning';
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

async function refresh() {
  const s = await settings();
  const connection = document.getElementById('connection');

  const probeResult = await probe();
  const tab = await activeTab();
  setText('host', tab && tab.url ? new URL(tab.url).hostname : '—');

  if (probeResult && probeResult.detection) {
    const d = probeResult.detection;
    setText('adapter', d.adapterId || 'none');
    setText('page-type', d.pageType);
    setText('confidence', Number(d.confidence).toFixed(2));
    setText('detection-note', d.ambiguous ? 'Ambiguous detection: refusing to act.' : d.detail);
  } else {
    setText('adapter', 'none');
    setText('page-type', 'unsupported');
    setText('confidence', '—');
    setText('detection-note', 'No Pao adapter claims this tab.');
  }
  renderTargets(probeResult);

  try {
    const response = await fetch(`${s.bridgeUrl}/health`);
    const health = await response.json();
    if (connection) {
      connection.className = health.extensionConnected ? 'status status--ok' : 'status status--warn';
      connection.textContent = health.extensionConnected ? 'Connected' : 'Bridge up, no tab';
    }
    setText('queued', String(health.queued));
    setText('running', health.running || 'none');
    setText('job-id', health.running || 'none');
  } catch (error) {
    if (connection) {
      connection.className = 'status status--bad';
      connection.textContent = 'Bridge unreachable';
    }
    setText('queued', '—');
    setText('running', '—');
  }

  const bindings = await chrome.storage.session.get(['tabBindings']);
  const bound = bindings.tabBindings ? Object.keys(bindings.tabBindings).length : 0;
  setText('bound', String(bound));
}

document.getElementById('diagnose')?.addEventListener('click', async () => {
  await refresh();
  notice('Diagnostics refreshed.');
});

document.getElementById('dry-run')?.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || tab.id === undefined) return;
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { protocol: PROTOCOL, type: 'job.dryRun' });
    renderTargets(result);
    // Dry run is non-submitting by construction: it resolves selectors and reports what it
    // found, and the executor refuses every side-effect action.
    notice('Dry run complete. No action was submitted.');
  } catch (error) {
    notice('No adapter claims this tab.');
  }
});

document.getElementById('pause')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ paused: true });
  notice('Queue paused. Waiting jobs will not be dispatched.');
});

document.getElementById('cancel')?.addEventListener('click', async () => {
  const tab = await activeTab();
  if (tab && tab.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, { protocol: PROTOCOL, type: 'job.cancel' });
    } catch (error) {
      // Nothing to cancel on this tab.
    }
  }
  notice('Cancellation requested for this tab.');
});

document.getElementById('dashboard')?.addEventListener('click', async () => {
  const s = await settings();
  chrome.tabs.create({ url: s.bridgeUrl.replace(':43117', ':10100') + '/#control-plane' });
});

refresh();
setInterval(refresh, 5000);
