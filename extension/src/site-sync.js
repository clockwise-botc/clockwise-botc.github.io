// Runs on the community website, before its own scripts: keeps the sign-in the same in the extension and on the
// website, so people sign in once, wherever they go first. Whichever side changed last wins: a sign-in counts from
// when its token was issued, a sign-out from when it happened (each side records that time). Checked when the page
// opens, when the extension's sign-in changes (the popup), and every couple of seconds for the page's own.
const issued = (token) => Number(String(token || '').split('.')[1]) || 0;
const page = (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch { return ''; } };

async function syncSignIn() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const ext = settings.accountToken ? { token: settings.accountToken, name: settings.accountName, at: issued(settings.accountToken) } : { at: Number(settings.signedOutAt) || 0 };
  const siteToken = page('clockwise.token');
  const site = siteToken ? { token: siteToken, name: page('clockwise.username'), at: issued(siteToken) } : { at: Number(page('clockwise.signedOutAt')) || 0 };
  if ((ext.token || '') === (site.token || '') || ext.at === site.at) return;

  if (ext.at > site.at) {
    // The extension's is newer: sign the website in (remembered on this device) or out, and reload so it shows.
    try {
      for (const k of ['clockwise.token', 'clockwise.username', 'clockwise.profile']) { sessionStorage.removeItem(k); localStorage.removeItem(k); }
      if (ext.token) {
        localStorage.setItem('clockwise.token', ext.token);
        localStorage.setItem('clockwise.username', ext.name || '');
        localStorage.removeItem('clockwise.signedOutAt');
      } else {
        localStorage.setItem('clockwise.signedOutAt', String(ext.at));
      }
    } catch { return; }
    location.reload();
  } else {
    // The website's is newer: the extension (and its popup) follow it.
    const same = site.token && site.name === settings.accountName;
    await chrome.storage.local.set({ settings: { ...settings,
      accountToken: site.token || '', accountName: site.name || '',
      accountCommunities: same ? settings.accountCommunities || [] : [],
      signedOutAt: site.token ? 0 : site.at } });
  }
}

// (After the extension is reloaded or updated, this copy loses its connection; it then just stops.)
const run = () => syncSignIn().catch(() => {});
run();
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) run(); });
setInterval(run, 2000);
