// Clockwise shared store: request handling, kept apart from storage so the same code runs in Apps Script (with
// the Google Sheet store in sheets-store.js) and in local tests (with an in-memory store).
//
// Every request is a POST with a JSON body { action, key, ... }. Keys:
//   VIEW_PASSWORD  read games (the community password)
//   WRITE_KEY      upload recorded games and botc.app art info (built into the extension)
//   EDITOR_KEY     everything, including edits and deletes
// Several people can record the same game: its id ("room:start time") is the same for everyone in the room, so
// uploads of one game are merged into a single record (see mergeGame_).

// Fields a viewer can change after the fact. Kept separately from the recorded data so a later upload of the same
// game never undoes a fix.
var EDITABLE_ = ['community', 'communityManual', 'excluded', 'notes', 'storytellers', 'names'];

function handle_(body, store, keys, now) {
  var key = String((body && body.key) || '');
  var is = function (k) { return !!k && key === k; };
  // A signed-in account can read, like the community password (accounts are only created with it).
  var account = body && body.token ? accountFromToken_(store, body.token, now) : null;
  var canRead = is(keys.view) || is(keys.editor) || !!account;
  var canWrite = is(keys.write) || is(keys.editor);
  var canEdit = is(keys.editor);
  var deny = function (what) { return { ok: false, error: 'not-allowed', message: 'That key or password can\'t ' + what + '.' }; };

  var accountReply = body && body.action ? handleAccount_(body, store, { viewKey: is(keys.view) || is(keys.editor), canRead: canRead, canEdit: canEdit, account: account }, now) : null;
  if (accountReply) return accountReply;

  switch (body && body.action) {
    case 'ping':
      return { ok: true, canRead: canRead, canWrite: canWrite, canEdit: canEdit, now: now, account: account ? publicAccount_(account) : null, signedOut: !!(body.token && !account) };

    case 'record': {
      if (!canWrite) return deny('upload games');
      var games = Array.isArray(body.games) ? body.games : [];
      var saved = [], skipped = [];
      store.batch(function () {
        games.forEach(function (raw) {
          var g = cleanGame_(raw);
          if (!g || !g.id) return;
          if (store.isDeleted(g.id)) { skipped.push(g.id); return; }
          var merged = mergeGame_(store.getRecord(g.id), g);
          store.putRecord(g.id, merged, now);
          saved.push(g.id);
        });
        if (saved.length) store.refreshTables(saved);
      });
      return { ok: true, saved: saved, skipped: skipped, now: now };
    }

    case 'void': {
      // A recorder taking back a game whose ending the storyteller cancelled. Only removes it if nobody else
      // recorded it, and doesn't stop it being recorded again when the game really ends.
      if (!canWrite) return deny('withdraw games');
      var rec = store.getRecord(body.id);
      var who = String(body.recorder || '');
      if (!rec) return { ok: true, removed: false };
      var others = (rec.recorders || []).filter(function (r) { return r !== who; });
      if (others.length) return { ok: true, removed: false };
      store.batch(function () { store.removeRecord(body.id); store.refreshTables([body.id]); });
      return { ok: true, removed: true };
    }

    case 'meta': {
      if (!canWrite) return deny('upload artwork');
      var meta = body.meta || {};
      var old = store.getMeta() || {};
      // Each part is kept until a newer one arrives; the character list grows as people see more characters.
      var next = {
        assetMap: meta.assetMap && meta.assetMap.map ? meta.assetMap : old.assetMap || null,
        tokenStyle: meta.tokenStyle && meta.tokenStyle.variants ? meta.tokenStyle : old.tokenStyle || null,
        roleMeta: Object.assign({}, old.roleMeta || {}, meta.roleMeta || {}),
      };
      store.putMeta(next, now);
      return { ok: true, now: now };
    }

    case 'edit': {
      if (!canEdit) return deny('change games');
      if (!body.id || !store.getRecord(body.id)) return { ok: false, error: 'not-found' };
      var patch = {};
      EDITABLE_.forEach(function (f) { if (body.patch && f in body.patch) patch[f] = body.patch[f]; });
      var prev = store.getEdit(body.id) || {};
      if (patch.names) patch.names = Object.assign({}, prev.names || {}, patch.names);
      store.putEdit(body.id, Object.assign({}, prev, patch), now);
      store.refreshTables([body.id]);
      return { ok: true, now: now };
    }

    case 'delete': {
      if (!canEdit) return deny('delete games');
      var ids = [].concat(body.ids || body.id || []);
      store.batch(function () { ids.forEach(function (id) { store.markDeleted(id, now); }); store.refreshTables(ids); });
      return { ok: true, deleted: ids, now: now };
    }

    case 'read': {
      if (!canRead) return deny('see games');
      var since = Number(body.since) || 0;
      // Who sees what changed since then (someone's communities or claim): send everything again.
      var full = since > 0 && since < visibilityAt_(store);
      if (full) since = 0;
      var out = [], hidden = [];
      var ids = store.changedSince(since);
      var recs = store.getRecords(ids);
      var byPlayer = accountsByPlayer_(store);
      var viewer = account && account.claim ? account.claim.player : null;
      ids.forEach(function (id) {
        if (!recs[id]) return;
        var seen = viewGame_(recs[id], store.getEdit(id), byPlayer, viewer);
        if (seen) out.push(seen); else hidden.push(id);
      });
      var metaInfo = store.getMetaInfo();
      return {
        ok: true, now: now, since: since, full: full,
        games: out,
        hidden: hidden,
        deleted: store.deletedSince(since),
        meta: metaInfo && metaInfo.at > since ? store.getMeta() : null,
        privatePlayers: privatePlayers_(store),
        canEdit: canEdit,
      };
    }

    default:
      return { ok: false, error: 'unknown-action' };
  }
}

// What a recorder uploads, minus things that are personal to their browser or can be worked out again.
function cleanGame_(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || /^sample-/.test(raw.id)) return null;
  var g = JSON.parse(JSON.stringify(raw));
  ['syncedAt', 'excluded', 'notes', 'communityManual', 'filedBy', 'recorders', 'remindersFrom'].forEach(function (f) { delete g[f]; });
  var botcArt = function (u) { return typeof u === 'string' && /^https:\/\/botc\.app\/assets\//.test(u); };
  (g.players || []).forEach(function (p) {
    if (botcArt(p.icon)) delete p.icon;
    (p.reminders || []).forEach(function (r) { if (botcArt(r.icon)) delete r.icon; });
  });
  ['bluffs', 'fabled'].forEach(function (k) { (g[k] || []).forEach(function (x) { if (botcArt(x.icon)) delete x.icon; }); });
  return g;
}

// How complete a recording is: someone who was there from the start, saw more nominations and deaths, and has more
// names and characters filled in wins.
function completeness_(g) {
  var players = g.players || [];
  return [
    -(Number(g.joinedAtPhase) || 0),
    (g.nominations || []).length + (g.deaths || []).length,
    players.reduce(function (n, p) { return n + (p.reminders || []).length; }, 0),
    players.filter(function (p) { return p.username; }).length + players.filter(function (p) { return p.roleId; }).length,
    (g.storytellers || []).filter(function (s) { return s.username; }).length,
  ];
}

function better_(a, b) {
  var x = completeness_(a), y = completeness_(b);
  for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false; // a tie keeps what's already stored
}

// Two recordings of one game → one record: the more complete one, with gaps filled from the other.
function mergeGame_(stored, incoming) {
  if (!stored) return Object.assign({}, incoming, { recorders: recorderList_([], incoming), filedBy: withFiling_({}, incoming), remindersFrom: byStoryteller_(incoming) ? 'storyteller' : undefined });
  var main = better_(incoming, stored) ? incoming : stored;
  var other = main === incoming ? stored : incoming;
  var out = JSON.parse(JSON.stringify(main));
  var bySeat = {};
  (other.players || []).forEach(function (p) { bySeat[p.seat] = p; });
  (out.players || []).forEach(function (p) {
    var o = bySeat[p.seat];
    if (!o) return;
    ['username', 'userId', 'roleId', 'roleName', 'team', 'alignment', 'startingRoleId', 'startingRoleName'].forEach(function (f) {
      if ((p[f] === null || p[f] === undefined || p[f] === '') && o[f]) p[f] = o[f];
    });
    if (!(p.reminders || []).length && (o.reminders || []).length) p.reminders = o.reminders;
  });
  // Reminder tokens: the storyteller's own recording has their grimoire as it was; a player's can include notes
  // they kept for themselves. Once a storyteller's recording is in, its tokens stay, whatever arrives later.
  var stCopy = byStoryteller_(incoming) ? incoming : (stored.remindersFrom === 'storyteller' || byStoryteller_(stored)) ? stored : null;
  if (stCopy) {
    var stSeat = {};
    (stCopy.players || []).forEach(function (p) { stSeat[p.seat] = p; });
    (out.players || []).forEach(function (p) { p.reminders = ((stSeat[p.seat] || {}).reminders || []).slice(); });
    out.remindersFrom = 'storyteller';
  }
  if (!(out.storytellers || []).some(function (s) { return s.username; }) && (other.storytellers || []).length) out.storytellers = other.storytellers;
  ['bluffs', 'fabled', 'background'].forEach(function (k) {
    var empty = !out[k] || (Array.isArray(out[k]) && !out[k].length);
    if (empty && other[k]) out[k] = other[k];
  });
  // A community the recorder picked for this game in the extension's popup beats the automatic one.
  if (incoming.communityChosen && incoming.community) out.community = incoming.community;
  out.recorders = recorderList_(stored.recorders || recorderList_([], stored), incoming);
  out.filedBy = withFiling_(filedBy_(stored), incoming);
  return out;
}

function byStoryteller_(g) { return !!(g && g.capturedBy && g.capturedBy.asStoryteller); }

function recorderList_(list, g) {
  var name = g && g.capturedBy && (g.capturedBy.username || g.capturedBy.userId);
  var out = list.slice();
  if (name && out.indexOf(name) === -1) out.push(name);
  return out;
}

// A record as viewers see it: the recording with any fixes applied on top.
function withEdits_(rec, edit) {
  if (!edit) return rec;
  var g = JSON.parse(JSON.stringify(rec));
  ['community', 'communityManual', 'excluded', 'notes', 'storytellers'].forEach(function (f) { if (f in edit) g[f] = edit[f]; });
  if (edit.names) {
    (g.players || []).forEach(function (p) {
      var n = edit.names[p.seat];
      if (n && n.username) { p.username = n.username; if (n.userId) p.userId = n.userId; }
    });
  }
  return g;
}
