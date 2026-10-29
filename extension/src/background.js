import { communityForRoom, withRoomChoice, isManual } from './communities.js';
import { BACKEND_URL, WRITE_KEY } from './config.js';
import { call } from './shared.js';

// backendUrl / writeKey override the built-in ones (for testing); the password and editor key are the user's.
const DEFAULT_SETTINGS = { backendUrl: '', writeKey: '', viewPassword: '', editorKey: '' };

// Serialize storage writes so concurrent messages can't clobber each other.
let queue = Promise.resolve();
const locked = (fn) => (queue = queue.then(fn, fn));

async function getGames() {
  const { games = {} } = await chrome.storage.local.get('games');
  return games;
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

// "Don't record this game" (popup): { ids: { gameId: true }, rooms: { room: when } }. A skipped game is still kept
// in this browser (marked `skipped`) so it can be recorded after all, but it's never uploaded; a room in `rooms`
// skips the next game that ends there.
async function getSkips() {
  const { skips = {} } = await chrome.storage.local.get('skips');
  return { ids: skips.ids || {}, rooms: skips.rooms || {} };
}
const roomKey = (room) => String(room || '').trim().toLowerCase();
const RECENT_MS = 20 * 60e3; // how long after a game ends it still counts as "the game that just ended"

// Which game the popup's button is about: the one being played, the one that just ended here, or the next one.
async function skipTarget(room, gameId, inGame) {
  if (inGame && gameId) return { kind: 'current', id: gameId };
  const games = await getGames();
  const last = Object.values(games).filter((g) => roomKey(g.room) === roomKey(room)).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
  if (last && Date.now() - (last.capturedAt || 0) < RECENT_MS) return { kind: 'last', id: last.id };
  return { kind: 'next' };
}

async function skipState(room, gameId, inGame) {
  const t = await skipTarget(room, gameId, inGame);
  const skips = await getSkips();
  return { ...t, skipped: t.kind === 'next' ? !!skips.rooms[roomKey(room)] : !!skips.ids[t.id] };
}

async function setSkip(room, gameId, inGame, on) {
  const t = await skipTarget(room, gameId, inGame);
  let withdraw = null;
  await locked(async () => {
    const skips = await getSkips();
    const games = await getGames();
    if (t.kind === 'next') { if (on) skips.rooms[roomKey(room)] = Date.now(); else delete skips.rooms[roomKey(room)]; }
    else if (on) skips.ids[t.id] = true;
    else delete skips.ids[t.id];
    const g = t.id && games[t.id];
    if (g) {
      // Already recorded here: keep it, but take it back from the shared stats (or send it again).
      if (on && !g.skipped && g.syncedAt) withdraw = g;
      g.skipped = on;
      if (!on) g.syncedAt = null;
    }
    await chrome.storage.local.set({ skips, games });
  });
  if (withdraw) {
    const { url, writeKey } = await backend();
    const recorder = withdraw.capturedBy && (withdraw.capturedBy.username || withdraw.capturedBy.userId);
    if (url && writeKey) await call(url, { action: 'void', key: writeKey, id: withdraw.id, recorder }).catch(() => {});
  }
  if (!on) syncPending().catch(recordSyncError);
  return skipState(room, gameId, inGame);
}

async function upsertGame(game) {
  const settings = await getSettings();
  await locked(async () => {
    const games = await getGames();
    const prev = games[game.id];
    // Don't record: asked for this game, or for the next game in its room.
    const skips = await getSkips();
    if (!prev && skips.rooms[roomKey(game.room)]) {
      skips.ids[game.id] = true;
      delete skips.rooms[roomKey(game.room)];
      await chrome.storage.local.set({ skips });
    }
    const skipped = !!skips.ids[game.id];
    // A community picked for this game in the dashboard wins; otherwise use the room's community.
    const community = prev && prev.communityManual ? prev.community : communityForRoom(settings, game.room);
    // Picked by hand (for this game, or for its room in the popup): the shared store then won't refile it under one
    // of your own communities by room.
    const communityChosen = !!(prev && (prev.communityManual || prev.communityChosen)) || isManual(settings, game.room);
    // Keep the user's own edits (exclusion, notes) when the same game is re-captured.
    games[game.id] = { ...game, community, communityChosen, communityManual: !!(prev && prev.communityManual), excluded: prev ? !!prev.excluded : false, notes: prev ? prev.notes || '' : '', syncedAt: null, skipped };
    await chrome.storage.local.set({ games });
  });
  syncPending().catch(recordSyncError);
}

async function voidGame(id) {
  let recorder = null;
  await locked(async () => {
    const games = await getGames();
    if (!games[id]) return;
    recorder = games[id].capturedBy && (games[id].capturedBy.username || games[id].capturedBy.userId);
    delete games[id];
    await chrome.storage.local.set({ games });
  });
  // The storyteller cancelled the ending: take the upload back too (the store keeps it if others recorded it).
  const { url, writeKey } = await backend();
  if (url && writeKey) call(url, { action: 'void', key: writeKey, id, recorder }).catch(() => {});
}

// ---------- shared store ----------
async function backend() {
  const s = await getSettings();
  return { url: s.backendUrl || BACKEND_URL, writeKey: s.writeKey || WRITE_KEY };
}

// Upload games that haven't been sent yet (or all of them). Sample games stay in this browser.
async function syncPending(all = false) {
  const { url, writeKey } = await backend();
  if (!url || !writeKey) return { skipped: true };
  uploadMeta().catch(() => {}); // the art info too, if it changed (it's skipped when it hasn't)
  const games = await getGames();
  const pending = Object.values(games).filter((g) => !g.id.startsWith('sample-') && !g.skipped && (all || !g.syncedAt));
  if (!pending.length) return { synced: 0 };
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    const res = await call(url, { action: 'record', key: writeKey, games: chunk });
    if (!res.ok) throw new Error(res.message || res.error || 'Upload failed');
    await locked(async () => {
      const fresh = await getGames();
      const now = Date.now();
      // Games an editor deleted from the shared store count as sent; they won't be accepted again.
      [...(res.saved || []), ...(res.skipped || [])].forEach((id) => { if (fresh[id]) fresh[id].syncedAt = now; });
      await chrome.storage.local.set({ games: fresh, lastSync: { at: now, ok: true } });
    });
  }
  return { synced: pending.length };
}

async function recordSyncError(e) {
  await chrome.storage.local.set({ lastSync: { at: Date.now(), ok: false, error: String(e.message || e) } });
}

// Share botc.app's art info (image list, token art, character list) so the community website, which can't read
// botc.app itself, draws the same tokens. Only sent when something changed.
async function uploadMeta() {
  const { url, writeKey } = await backend();
  if (!url || !writeKey) return;
  const { assetMap, roleMeta = {}, metaSent } = await chrome.storage.local.get(['assetMap', 'roleMeta', 'metaSent']);
  if (!assetMap || !assetMap.tokenStyle) return;
  const sig = `${assetMap.source}|${assetMap.tokenStyle.v}|${Object.keys(roleMeta).length}|${Object.keys(assetMap.map || {}).length}`;
  if (sig === metaSent) return;
  const res = await call(url, { action: 'meta', key: writeKey, meta: { assetMap: { source: assetMap.source, map: assetMap.map }, tokenStyle: assetMap.tokenStyle, roleMeta } });
  if (res.ok) await chrome.storage.local.set({ metaSent: sig });
}

// ---------- messaging ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'status': {
        await chrome.storage.session.set({ liveStatus: { ...msg.payload, tabId: sender.tab && sender.tab.id } });
        const badge = msg.payload.inGame ? 'REC' : '';
        await chrome.action.setBadgeText({ text: badge });
        if (badge) await chrome.action.setBadgeBackgroundColor({ color: '#8b1a1a' });
        return { ok: true };
      }
      case 'game:upsert':
        await upsertGame(msg.payload);
        return { ok: true };
      case 'assets': {
        // Keep the latest botc.app image list for the dashboard's grimoires; fetch the token art to go with it.
        const { assetMap } = await chrome.storage.local.get('assetMap');
        if (!assetMap || assetMap.source !== msg.payload.source) {
          await chrome.storage.local.set({ assetMap: { source: msg.payload.source, map: msg.payload.map, tokenStyle: null, at: 0 } });
        }
        if (!assetMap || assetMap.source !== msg.payload.source || !assetMap.tokenStyle) refreshAssetMap(true).catch(() => {});
        return { ok: true };
      }
      case 'roles': {
        // Night order / reminders / setup / edition per character, for the tokens' leaves and art.
        const { roleMeta } = await chrome.storage.local.get('roleMeta');
        await chrome.storage.local.set({ roleMeta: { ...(roleMeta || {}), ...msg.payload.roles } });
        uploadMeta().catch(() => {});
        return { ok: true };
      }
      case 'assets:refresh':
        return refreshAssetMap(!!msg.force);
      case 'skip:get':
        return { ok: true, ...(await skipState(msg.room, msg.gameId, msg.inGame)) };
      case 'skip:set':
        return { ok: true, ...(await setSkip(msg.room, msg.gameId, msg.inGame, !!msg.on)) };
      case 'game:void':
        await voidGame(msg.payload.id);
        return { ok: true };
      case 'community:set': {
        // Pick the community for a room. It applies to the game being played and future games, plus
        // the game that just ended there (so a choice made during the reveal still counts for it).
        // Earlier games keep their community.
        const { room, choice } = msg;
        await locked(async () => {
          const { settings = {} } = await chrome.storage.local.get('settings');
          const next = withRoomChoice(settings, room, choice);
          const games = await getGames();
          const last = Object.values(games)
            .filter((g) => String(g.room).toLowerCase() === String(room).toLowerCase())
            .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
          if (last && !last.communityManual && Date.now() - (last.capturedAt || 0) < 20 * 60e3) {
            last.community = communityForRoom(next, room);
            last.communityChosen = true;
            last.syncedAt = null;
          }
          await chrome.storage.local.set({ settings: next, games });
        });
        syncPending().catch(recordSyncError);
        return { ok: true };
      }
      case 'sync:all':
        try { return { ok: true, ...(await syncPending(true)) }; } catch (e) { await recordSyncError(e); return { ok: false, error: String(e.message || e) }; }
      case 'sync:pending':
        try { return { ok: true, ...(await syncPending()) }; } catch (e) { await recordSyncError(e); return { ok: false, error: String(e.message || e) }; }
      default:
        return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// Retry unsynced games periodically (e.g. after being offline).
chrome.alarms.create('sync', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'sync') syncPending().catch(recordSyncError); });
chrome.runtime.onStartup.addListener(() => { syncPending().catch(recordSyncError); uploadMeta().catch(() => {}); });

// Keep botc.app's image list fresh without needing a botc.app tab open: read its homepage to find the
// current app script, then pull the image file names out of it (same parsing as page-hook.js).
let refreshing = null;
async function refreshAssetMap(force = false) {
  const { assetMap } = await chrome.storage.local.get('assetMap');
  // v2 added the reveal font (Sorts Mill Goudy); older saved art is fetched again, as is a list without the avatars.
  const complete = assetMap && assetMap.tokenStyle && assetMap.tokenStyle.v >= 2 && !!(assetMap.map && assetMap.map['cosmetics/avatar0.webp']);
  if (!force && complete && Date.now() - (assetMap.at || 0) < 24 * 3600e3) return { ok: true, fresh: true };
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const html = await (await fetch('https://botc.app/', { cache: 'no-cache' })).text();
      const m = html.match(/\/assets\/index-[^"']+\.js/);
      if (!m) throw new Error('botc.app script not found');
      const source = new URL(m[0], 'https://botc.app').href;
      if (complete && assetMap.source === source) {
        await chrome.storage.local.set({ assetMap: { ...assetMap, at: Date.now() } });
        return { ok: true, unchanged: true };
      }
      // Reuse the saved image list for the same release, unless it's from a version that didn't keep the shroud.
      let map = assetMap && assetMap.source === source && assetMap.map && assetMap.map['shroud.webp'] && assetMap.map['cosmetics/avatar0.webp'] ? assetMap.map : null;
      if (!map) {
        const code = await (await fetch(source)).text();
        const files = {};
        for (const f of code.matchAll(/(?:^|[,;{ ])([A-Za-z_$][\w$]*)=`(\/assets\/[^`]+?\.webp)`/g)) files[f[1]] = f[2];
        map = {};
        for (const f of code.matchAll(/"\/src\/assets\/([^"]+?\.webp)":([A-Za-z_$][\w$]*)/g)) {
          if (files[f[2]] && /^(icons|editions|background|shroud|death|cosmetics\/avatar)/.test(f[1])) map[f[1]] = new URL(files[f[2]], 'https://botc.app').href;
        }
        if (Object.keys(map).length < 50) throw new Error('image list looked wrong');
      }
      // The token art (parchment, leaves, reminder disc) and fonts live in botc.app's stylesheet.
      let tokenStyle = null;
      const cssPath = html.match(/\/assets\/index-[^"']+\.css/);
      let styleError = cssPath ? '' : 'botc.app stylesheet not found';
      if (cssPath) {
        try {
          tokenStyle = parseTokenStyle(await (await fetch(new URL(cssPath[0], 'https://botc.app').href)).text());
          if (!tokenStyle) styleError = "couldn't find the token art in botc.app's stylesheet";
        } catch (e) { styleError = `couldn't load botc.app's stylesheet (${e.message || e})`; }
      }
      await chrome.storage.local.set({ assetMap: { source, map, tokenStyle, styleError, at: Date.now() } });
      uploadMeta().catch(() => {});
      return { ok: !!tokenStyle, count: Object.keys(map).length, tokenStyle: !!tokenStyle, error: styleError || undefined };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Reads the token look from botc.app's CSS: the parchment for each edition (and for travellers/fabled),
// the night-order and setup leaves, the purple reminder disc, and the Dumbledor / Trade Gothic fonts.
// The rule names carry a per-release scope id ([data-v-…]), so it's found first rather than hard-coded.
export function parseTokenStyle(css) {
  const abs = (u) => (u.startsWith('data:') ? u : new URL(u.replace(/^["']|["']$/g, ''), 'https://botc.app').href);
  const scope = (css.match(/\.token \.name \.label\[(data-v-[\w-]+)\]/) || [])[1];
  if (!scope) return null;
  const esc = scope.replace(/-/g, '\\-');
  const variants = {};
  const rule = new RegExp(`((?:[^{}]*?\\.token[^{},]*\\[${esc}\\],?)+)\\{background-image:url\\(([^)]+)\\)\\}`, 'g');
  for (const r of css.matchAll(rule)) {
    for (const sel of r[1].split(',')) {
      if (!sel.includes(scope) || /:hover|#app|#grimoire/.test(sel)) continue;
      const variant = (sel.match(/\.token\.(?:edition|team)-([\w-]+)/) || [])[1] || 'default';
      const kind = (sel.match(/^\.token\.team-/) ? 'team-' : sel.match(/^\.token\.edition-/) ? 'edition-' : '') + variant;
      const part = (sel.match(/span\.(leaf-[\w-]+)/) || [])[1] || 'token';
      (variants[kind] = variants[kind] || {})[part] = abs(r[2]);
    }
  }
  const reminder = (css.match(/\.reminder\[data-v-[\w-]+\]\{[^}]*?background:url\(([^)]+)\)/) || [])[1];
  const fonts = {};
  for (const f of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const family = (f[1].match(/font-family:([^;]+);/) || [])[1];
    const woff2 = (f[1].match(/url\(([^)]+?\.woff2)\)/) || [])[1];
    const weight = (f[1].match(/font-weight:(\d+)/) || [])[1];
    if (!family || !woff2) continue;
    if (/dumbledor/i.test(family)) fonts.name = abs(woff2);
    if (/trade gothic/i.test(family) && weight === '700') fonts.reminder = abs(woff2);
    if (/sorts mill goudy/i.test(family)) fonts.result = abs(woff2);
  }
  if (!variants.default || !variants.default.token) return null;
  return { v: 2, variants, reminder: reminder ? abs(reminder) : null, fonts };
}

// Chrome only runs content scripts on pages loaded after install/update, so connect to
// botc.app tabs that were already open (otherwise they'd need a manual reload).
export async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://botc.app/*' });
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/bridge.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/page-hook.js'], world: 'MAIN' });
    } catch (e) {
      console.warn('Clockwise: could not connect to tab', tab.id, e);
    }
  }));
}
// On install/update: connect to open botc.app tabs, fetch the art, and upload any games recorded before sharing
// was set up (or before this update).
chrome.runtime.onInstalled.addListener(() => { injectIntoOpenTabs(); refreshAssetMap(true); syncPending().catch(recordSyncError); });
chrome.runtime.onStartup.addListener(() => refreshAssetMap());
