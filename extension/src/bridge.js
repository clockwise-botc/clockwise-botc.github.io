// Isolated-world content script: relays messages between page-hook.js and the extension.
(() => {
  let statusWaiters = [];

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.__botcTracker !== true || msg.dir !== 'out') return;
    if (!['status', 'game:upsert', 'game:void', 'assets', 'roles'].includes(msg.type)) return;
    if (msg.type === 'status') {
      statusWaiters.forEach((resolve) => resolve(msg.payload));
      statusWaiters = [];
    }
    try {
      chrome.runtime.sendMessage({ type: msg.type, payload: msg.payload }).catch(() => {});
    } catch {
      // Extension was reloaded; a newer bridge has been injected and takes over.
    }
  });

  // The popup pings the tab to get a fresh status straight from the page.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'ping') return;
    const timer = setTimeout(() => sendResponse({ bridge: true, status: null }), 2500);
    statusWaiters.push((status) => { clearTimeout(timer); sendResponse({ bridge: true, status }); });
    window.postMessage({ __botcTracker: true, dir: 'in', type: 'ping' }, location.origin);
    return true;
  });
})();
