// Where the dashboard's games come from.
//   Extension, not set up to share: this browser's games only (as before).
//   Extension, sharing: everyone's games from the shared store, plus this browser's games not uploaded yet.
//   Website (community dashboard): everyone's games, after the community password.
// Downloads are cached (chrome.storage in the extension, IndexedDB on the website) and topped up incrementally.
import { BACKEND_URL, SITE_URL } from './config.js';
import { call, pull, ping, editPatch } from './shared.js';

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
// "Remember on this device" keeps the password in localStorage; otherwise only for this browser tab.
export const webAuth = {
  get: () => { try { return sessionStorage.getItem('clockwise.password') || localStorage.getItem('clockwise.password') || ''; } catch { return ''; } },
  set: (pw, remember) => { try { (remember ? localStorage : sessionStorage).setItem('clockwise.password', pw); } catch {} },
  clear: () => { try { sessionStorage.removeItem('clockwise.password'); localStorage.removeItem('clockwise.password'); localStorage.removeItem('clockwise.editorKey'); } catch {} },
  editorKey: () => { try { return localStorage.getItem('clockwise.editorKey') || ''; } catch { return ''; } },
  setEditorKey: (k) => { try { k ? localStorage.setItem('clockwise.editorKey', k) : localStorage.removeItem('clockwise.editorKey'); } catch {} },
};

// ---------- credentials ----------
export function creds(settings = {}) {
  if (WEB) return { url: WEB.backendUrl, password: webAuth.get(), editorKey: webAuth.editorKey() };
  return { url: settings.backendUrl || BACKEND_URL, password: settings.viewPassword || '', editorKey: settings.editorKey || '' };
}
export const siteUrl = () => (WEB ? location.href.split('#')[0] : SITE_URL);

// ---------- reading ----------
export const loadShared = cacheGet;

// Download what changed. Returns { ok, changed, error } and saves the cache.
export async function refreshShared(settings) {
  const c = creds(settings);
  if (!c.url || !(c.password || c.editorKey)) return { ok: false, error: 'no-password' };
  const before = await cacheGet();
  const res = await pull(c.url, c.password || c.editorKey, before);
  if (!res.ok) return res;
  // Remember deleted ids, so this browser's own copy of a deleted game isn't shown again.
  const removed = before ? Object.keys(before.games || {}).filter((id) => !res.cache.games[id]) : [];
  res.cache.deleted = [...new Set([...((before && before.deleted) || []), ...removed])];
  if (res.changed || !before) await cacheSet(res.cache);
  else await cacheSet({ ...before, since: res.cache.since, at: res.cache.at });
  return { ok: true, changed: res.changed, canEdit: res.canEdit };
}

// Everyone's games, plus this browser's own games that haven't reached the shared store yet.
export function mergeGames(local, cache) {
  const shared = (cache && cache.games) || {};
  const deleted = new Set((cache && cache.deleted) || []);
  const out = { ...shared };
  for (const g of Object.values(local || {})) {
    if (!out[g.id] && !deleted.has(g.id)) out[g.id] = { ...g, pending: !g.syncedAt && !g.id.startsWith('sample-') };
  }
  return out;
}

// Is this key the community password (canRead) / an editor key (canEdit)?
export async function checkKey(settings, key) {
  const c = creds(settings);
  if (!c.url) return { ok: false, error: 'no-backend' };
  return ping(c.url, key);
}

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
