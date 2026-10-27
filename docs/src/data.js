// Where the dashboard's games come from.
//   Extension, not set up to share: this browser's games only (as before).
//   Extension, sharing: everyone's games from the shared store, plus this browser's games not uploaded yet.
//   Website (community dashboard): everyone's games, after the community password.
// Downloads are cached (chrome.storage in the extension, IndexedDB on the website) and topped up incrementally.
import { BACKEND_URL, SITE_URL } from './config.js?v=7739edf5ef';
import { call, pull, ping, editPatch } from './shared.js?v=7739edf5ef';

// Set by web-config.js on the community website.
export const WEB = (typeof window !== 'undefined' && window.CLOCKWISE_WEB) || null;
export const hasChrome = !WEB && typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);

// ---------- small key/value storage ----------
export const kv = {
  async get(key, fallback) {
    if (hasChrome) return (await chrome.storage.local.get(key))[key] ?? fallback;
    try { return JSON.parse(localStorage.getItem('clockwise.' + key)) ?? fallback; } catch { return fallback; }
  },
  async set(key, value) {
    if (hasChrome) return chrome.storage.local.set({ [key]: value });
    try { localStorage.setItem('clockwise.' + key, JSON.stringify(value)); } catch {}
  },
};

// IndexedDB for the website's copy of the games (too big for localStorage).
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('clockwise', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  };
});

async function cacheGet() {
  if (hasChrome) return (await chrome.storage.local.get('sharedCache')).sharedCache || null;
  try { return (await idb('readonly', (s) => s.get('shared'))) || null; } catch { return null; }
}
async function cacheSet(c) {
  if (hasChrome) return chrome.storage.local.set({ sharedCache: c });
  try { await idb('readwrite', (s) => s.put(c, 'shared')); } catch {}
}
export async function cacheClear() {
  if (hasChrome) return chrome.storage.local.remove('sharedCache');
  try { await idb('readwrite', (s) => s.delete('shared')); } catch {}
}

// ---------- the website's sign-in ----------
// "Remember on this device" keeps the password / sign-in in localStorage; otherwise only for this browser tab.
const stored = (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch { return ''; } };
const forget = (...keys) => { try { for (const k of keys) { sessionStorage.removeItem(k); localStorage.removeItem(k); } } catch {} };
export const webAuth = {
  get: () => stored('clockwise.password'),
  set: (pw, remember) => { try { (remember ? localStorage : sessionStorage).setItem('clockwise.password', pw); } catch {} },
  account: () => ({ token: stored('clockwise.token'), username: stored('clockwise.username') }),
  setAccount: (token, username, remember) => { forget('clockwise.token', 'clockwise.username', 'clockwise.signedOutAt'); try { const s = remember ? localStorage : sessionStorage; s.setItem('clockwise.token', token); s.setItem('clockwise.username', username); } catch {} },
  // Signing out leaves the time, so the extension (which shares the sign-in) signs out too rather than back in.
  clearAccount: () => { forget('clockwise.token', 'clockwise.username', 'clockwise.profile'); try { localStorage.setItem('clockwise.signedOutAt', String(Date.now())); } catch {} },
  clear: () => { forget('clockwise.password', 'clockwise.editorKey', 'clockwise.token', 'clockwise.username', 'clockwise.profile'); try { localStorage.setItem('clockwise.signedOutAt', String(Date.now())); } catch {} },
  // The account as the store last described it (claimed player, own communities), so the page is right before it asks.
  profile: () => { try { return JSON.parse(localStorage.getItem('clockwise.profile')) || undefined; } catch { return undefined; } },
  setProfile: (p) => { try { localStorage.setItem('clockwise.profile', JSON.stringify(p)); } catch {} },
  editorKey: () => { try { return localStorage.getItem('clockwise.editorKey') || ''; } catch { return ''; } },
  setEditorKey: (k) => { try { k ? localStorage.setItem('clockwise.editorKey', k) : localStorage.removeItem('clockwise.editorKey'); } catch {} },
};

// ---------- credentials ----------
export function creds(settings = {}) {
  if (WEB) { const a = webAuth.account(); return { url: WEB.backendUrl, password: webAuth.get(), editorKey: webAuth.editorKey(), token: a.token, username: a.username }; }
  return { url: settings.backendUrl || BACKEND_URL, password: settings.viewPassword || '', editorKey: settings.editorKey || '', token: settings.accountToken || '', username: settings.accountName || '' };
}
// What to send to read games: an account if signed in, else the community password (or editor key).
export const readAuth = (c) => ({ token: c.token || undefined, key: c.password || c.editorKey || undefined });
export const canReadWith = (c) => !!(c.token || c.password || c.editorKey);
export const siteUrl = () => (WEB ? location.href.split('#')[0] : SITE_URL);

// ---------- reading ----------
export const loadShared = cacheGet;

// Download what changed. Returns { ok, changed, error } and saves the cache.
export async function refreshShared(settings) {
  const c = creds(settings);
  if (!c.url || !canReadWith(c)) return { ok: false, error: 'no-password' };
  const before = await cacheGet();
  const res = await pull(c.url, readAuth(c), before);
  if (!res.ok) return res;
  // Remember deleted ids, so this browser's own copy of a deleted game isn't shown again. (Games that are only
  // hidden from you now, e.g. moved to someone's own community, aren't deleted.)
  const removed = res.deletedIds;
  res.cache.deleted = [...new Set([...((before && before.deleted) || []), ...removed])];
  // Who keeps their stats private can change without any game changing.
  const privacy = JSON.stringify((before && before.privatePlayers) || []) !== JSON.stringify(res.cache.privatePlayers);
  if (res.changed || !before) await cacheSet(res.cache);
  else await cacheSet({ ...before, since: res.cache.since, at: res.cache.at, privatePlayers: res.cache.privatePlayers });
  return { ok: true, changed: res.changed + (privacy ? 1 : 0), canEdit: res.canEdit };
}

// Everyone's games, plus this browser's own games that haven't reached the shared store yet.
export function mergeGames(local, cache) {
  const shared = (cache && cache.games) || {};
  const deleted = new Set((cache && cache.deleted) || []);
  const out = { ...shared };
  for (const g of Object.values(local || {})) {
    // `local`: only in this browser (so editable here without an editor key); `pending`: waiting to upload.
    if (!out[g.id] && !deleted.has(g.id)) out[g.id] = { ...g, local: true, pending: !g.syncedAt && !g.id.startsWith('sample-') };
  }
  return out;
}

// Is this key the community password (canRead) / an editor key (canEdit)?
export async function checkKey(settings, key) {
  const c = creds(settings);
  if (!c.url) return { ok: false, error: 'no-backend' };
  return ping(c.url, key);
}

// ---------- accounts ----------
const accountCall = (settings, body) => { const c = creds(settings); return c.url ? call(c.url, body) : Promise.resolve({ ok: false, error: 'no-backend' }); };
export const signUp = (settings, communityPassword, username, password) => accountCall(settings, { action: 'signup', key: communityPassword, username, password });
export const signIn = (settings, username, password) => accountCall(settings, { action: 'signin', username, password });
// The games anyone with the community password can see: checks that password, and lists the players to pick from
// before an account exists.
export const peekGames = (settings, communityPassword) => accountCall(settings, { action: 'read', key: communityPassword });
// Still signed in? (A password change elsewhere, or an editor's reset, signs this device out.)
export const whoAmI = (settings) => { const c = creds(settings); return c.token ? accountCall(settings, { action: 'ping', token: c.token }) : Promise.resolve(null); };
export const changePassword = (settings, password, newPassword) => accountCall(settings, { action: 'change-password', token: creds(settings).token, password, newPassword });
export const listAccounts = (settings) => accountCall(settings, { action: 'accounts', key: creds(settings).editorKey });
export const resetPassword = (settings, username, newPassword) => accountCall(settings, { action: 'reset-password', key: creds(settings).editorKey, username, newPassword });
export const deleteAccount = (settings, username) => accountCall(settings, { action: 'delete-account', key: creds(settings).editorKey, username });
export const claimPlayer = (settings, player, name) => accountCall(settings, { action: 'claim', token: creds(settings).token, player, name });
export const unclaimPlayer = (settings) => accountCall(settings, { action: 'unclaim', token: creds(settings).token });
export const saveCommunities = (settings, communities) => accountCall(settings, { action: 'save-communities', token: creds(settings).token, communities });
export const setPrivate = (settings, on) => accountCall(settings, { action: 'set-private', token: creds(settings).token, private: on });
export const removeClaim = (settings, username) => accountCall(settings, { action: 'remove-claim', key: creds(settings).editorKey, username });

// ---------- editing (editor key) ----------
export async function sharedEdit(settings, game, patch) {
  const c = creds(settings);
  const res = await call(c.url, { action: 'edit', key: c.editorKey, id: game.id, patch: editPatch(game, patch) });
  if (!res.ok) throw new Error(res.message || res.error || 'Edit failed');
  return res;
}
export async function sharedDelete(settings, id) {
  const c = creds(settings);
  const res = await call(c.url, { action: 'delete', key: c.editorKey, id });
  if (!res.ok) throw new Error(res.message || res.error || 'Delete failed');
  return res;
}
