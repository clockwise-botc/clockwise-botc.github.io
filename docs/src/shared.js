// Talking to the shared store (google-sheets/Code.gs). Used by the extension's background (uploads) and by the
// dashboard, in the extension and on the community website (reading, edits).

// Apps Script can't answer a CORS preflight, so requests are sent as text/plain with a JSON body.
export async function call(url, body) {
  if (!url) throw new Error('No shared store is set up.');
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  } catch (e) {
    throw new Error(`Couldn't reach the shared store (${e.message || e}).`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected reply from the shared store (${res.status}). Check its address, and that it's deployed with access for "Anyone".`);
  }
}

// Brings a local copy of the shared games up to date: only what changed since the last download.
// cache: { games: {id: game}, since, meta, at, privatePlayers } — kept in chrome.storage (extension) or IndexedDB (website).
// auth: { key } (community password or editor key) and/or { token } (a signed-in account).
export async function pull(url, auth, cache) {
  const res = await call(url, { action: 'read', ...auth, since: cache && cache.since ? cache.since : 0 });
  if (!res.ok) return { ok: false, error: res.error, message: res.message, cache };
  // full: who sees what changed, so this is everything you can see now. hidden: games you can no longer see.
  const next = { games: res.full ? {} : { ...((cache && cache.games) || {}) }, since: res.now, meta: (cache && cache.meta) || null, at: Date.now(),
    privatePlayers: Array.isArray(res.privatePlayers) ? res.privatePlayers : (cache && cache.privatePlayers) || [] };
  for (const g of res.games || []) next.games[g.id] = g;
  for (const id of [...(res.deleted || []), ...(res.hidden || [])]) delete next.games[id];
  if (res.meta) next.meta = res.meta;
  return { ok: true, cache: next, changed: (res.games || []).length + (res.deleted || []).length + (res.hidden || []).length + (res.full ? 1 : 0), deletedIds: res.deleted || [], canEdit: !!res.canEdit };
}

export const ping = (url, key, token) => call(url, { action: 'ping', key, token });

// An editor's fix to a shared game. Turns a dashboard patch into the store's edit fields.
export function editPatch(game, patch) {
  const out = {};
  for (const f of ['community', 'communityManual', 'excluded', 'notes', 'storytellers']) if (f in patch) out[f] = patch[f];
  if (patch.players && game) {
    // Only names that were filled in: { seat: { username, userId } }.
    const names = {};
    for (const p of patch.players) {
      const before = (game.players || []).find((x) => x.seat === p.seat) || {};
      if (p.username && p.username !== before.username) names[p.seat] = { username: p.username, userId: p.userId || null };
    }
    if (Object.keys(names).length) out.names = names;
  }
  return out;
}
