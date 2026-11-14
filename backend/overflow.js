// A backup for uploads while the Google Sheet can't be written (say the owner's Google storage is full, which makes
// it read-only). Each upload that can't be saved is kept in Script properties, which don't count towards Google
// storage: as it arrived, one per game and recorder (the latest). Reads include those games meanwhile, so nobody misses
// them, and editors are told. Once the Sheet takes writes again (the next upload that works, or a read at most every
// OVERFLOW_RETRY_MS_), the uploads are replayed into it in the order they came, as if they'd arrived then, and the
// backup is cleared. Script properties hold 500 KB in all and 9 KB each; a game is 2–4 KB packed.

var OVERFLOW_MAX_BYTES_ = 400000;
var OVERFLOW_MAX_ITEM_ = 8500;
var OVERFLOW_RETRY_MS_ = 10 * 60 * 1000;

// { since: when the first upload was kept, triedAt: last try at the Sheet, error, items: { key: { id, bytes, at } } }
function overflowIndex_(store) {
  try { var ix = JSON.parse(store.getValue('overflow') || '{}'); ix.items = ix.items || {}; return ix; } catch (e) { return { items: {} }; }
}

function overflowBytes_(ix) {
  return Object.keys(ix.items).reduce(function (n, k) { return n + (ix.items[k].bytes || 0); }, 0);
}

// Keep these uploads (cleaned games). { queued: ids, refused: ids that didn't fit }.
function overflowPut_(store, games, now, error) {
  return store.locked(function () {
    var ix = overflowIndex_(store), total = overflowBytes_(ix), queued = [], refused = [];
    games.forEach(function (g) {
      var key = 'ov:' + g.id + '|' + recorderId_(g);
      var packed = store.packValue(g), before = ix.items[key] ? ix.items[key].bytes : 0;
      if (packed.length > OVERFLOW_MAX_ITEM_ || total - before + packed.length > OVERFLOW_MAX_BYTES_) { refused.push(g.id); return; }
      store.setValue(key, packed);
      ix.items[key] = { id: g.id, bytes: packed.length, at: now };
      total += packed.length - before;
      queued.push(g.id);
    });
    if (!ix.since) ix.since = now;
    ix.triedAt = now;
    ix.error = String((error && error.message) || error || '').slice(0, 200);
    store.setValue('overflow', JSON.stringify(ix));
    return { queued: queued, refused: refused };
  });
}

// The kept uploads, { id: [games, in the order they arrived] }.
function overflowUploads_(store, ix) {
  var out = {};
  Object.keys(ix.items).sort(function (a, b) { return ix.items[a].at - ix.items[b].at; }).forEach(function (key) {
    var raw = store.getValue(key);
    if (!raw) return;
    var g = store.unpackValue(raw);
    (out[g.id] = out[g.id] || []).push(g);
  });
  return out;
}

// A game's record with its kept uploads applied, as if they'd been saved.
function overflowRecord_(store, id, uploads) {
  var rec = store.getRecord(id);
  uploads.forEach(function (g) { rec = mergeGame_(rec, g); });
  return rec;
}

// Move the kept uploads into the Sheet, if there are any and it's time to try (or `force`). True if it worked.
function overflowFlush_(store, now, force) {
  var ix = overflowIndex_(store);
  if (!Object.keys(ix.items).length || (!force && now - (ix.triedAt || 0) < OVERFLOW_RETRY_MS_)) return false;
  return store.locked(function () {
    ix = overflowIndex_(store);
    if (!Object.keys(ix.items).length) return false;
    ix.triedAt = now;
    store.setValue('overflow', JSON.stringify(ix));
    var uploads = overflowUploads_(store, ix);
    var ids = Object.keys(uploads).filter(function (id) { return !store.isDeleted(id); });
    try {
      ids.forEach(function (id) { store.putRecord(id, overflowRecord_(store, id, uploads[id]), now); });
      if (ids.length) store.refreshTables(ids);
      store.flushSheet();
    } catch (e) {
      ix.error = String((e && e.message) || e).slice(0, 200);
      store.setValue('overflow', JSON.stringify(ix));
      return false;
    }
    Object.keys(ix.items).forEach(function (key) { store.deleteValue(key); });
    store.deleteValue('overflow');
    return true;
  });
}

// What a read adds: the waiting games as this viewer would see them, and (for editors) how full the backup is.
function overflowView_(store, byPlayer, viewer) {
  var ix = overflowIndex_(store);
  if (!Object.keys(ix.items).length) return null;
  var uploads = overflowUploads_(store, ix), games = [];
  Object.keys(uploads).forEach(function (id) {
    if (store.isDeleted(id)) return;
    var seen = viewGame_(overflowRecord_(store, id, uploads[id]), store.getEdit(id), byPlayer, viewer);
    if (seen) games.push(seen);
  });
  return {
    games: games,
    status: { games: Object.keys(uploads).length, bytes: overflowBytes_(ix), maxBytes: OVERFLOW_MAX_BYTES_, since: ix.since || null, error: ix.error || '' },
  };
}
