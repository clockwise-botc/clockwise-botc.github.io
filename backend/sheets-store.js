// Google Sheet storage for the shared store (Apps Script only). Tabs:
//   records  game_id | updated_at | ended_at | recorders | parts | data…   one row per game, JSON gzipped + base64,
//                                                                      split over cells (a cell holds 50,000 chars)
//   edits    game_id | updated_at | json                                fixes made by editors
//   deleted  game_id | deleted_at                                       so deleted games aren't uploaded again
//   meta     key | updated_at | parts | data…                           botc.app art info for the website
//   accounts username_key | username | created_at | updated_at | json  people's accounts (passwords hashed)
//   games, game_players, nominations, deaths                             tidy tables for working in the Sheet

var CHUNK_ = 45000;

function sheetStore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tab = function (name, header) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  };
  var records = tab('records', ['game_id', 'updated_at', 'ended_at', 'recorders', 'parts', 'data']);
  var edits = tab('edits', ['game_id', 'updated_at', 'json']);
  var deleted = tab('deleted', ['game_id', 'deleted_at']);
  var metaSheet = tab('meta', ['key', 'updated_at', 'parts', 'data']);
  var accountsSheet = tab('accounts', ['username_key', 'username', 'created_at', 'updated_at', 'json']);

  // Small index of every record (no game data), read once per request.
  var rows = function (sh, width) {
    var n = sh.getLastRow() - 1;
    return n > 0 ? sh.getRange(2, 1, n, width).getValues() : [];
  };
  var index = {};
  rows(records, 5).forEach(function (r, i) { if (r[0]) index[r[0]] = { row: i + 2, at: Number(r[1]) || 0, parts: Number(r[4]) || 0 }; });
  var editRows = {};
  rows(edits, 3).forEach(function (r, i) { if (r[0]) editRows[r[0]] = { row: i + 2, at: Number(r[1]) || 0, json: r[2] }; });
  var gone = {};
  rows(deleted, 2).forEach(function (r) { if (r[0]) gone[r[0]] = Number(r[1]) || 0; });
  var cache = {};
  var accountRows = null;
  var loadAccounts = function () {
    if (accountRows) return accountRows;
    accountRows = {};
    rows(accountsSheet, 5).forEach(function (r, i) { if (r[0]) accountRows[r[0]] = { row: i + 2, json: r[4] }; });
    return accountRows;
  };

  var pack = function (obj) {
    var b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
    var parts = [];
    for (var i = 0; i < b64.length; i += CHUNK_) parts.push(b64.slice(i, i + CHUNK_));
    return parts;
  };
  var unpack = function (parts) {
    var b64 = parts.join('');
    if (!b64) return null;
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString());
  };
  var writeRow = function (sh, row, lead, parts, oldParts) {
    var cells = lead.concat(parts);
    // Blank any chunk cells left over from a longer previous version.
    for (var i = parts.length; i < (oldParts || 0); i++) cells.push('');
    if (sh.getMaxColumns() < cells.length) sh.insertColumnsAfter(sh.getMaxColumns(), cells.length - sh.getMaxColumns());
    sh.getRange(row, 1, 1, cells.length).setValues([cells]);
  };

  var store = {
    batch: function (fn) {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try { fn(); SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
    },
    isDeleted: function (id) { return id in gone; },
    getRecord: function (id) {
      if (id in cache) return cache[id];
      var ix = index[id];
      if (!ix || !ix.parts) return null;
      cache[id] = unpack(records.getRange(ix.row, 6, 1, ix.parts).getValues()[0]);
      return cache[id];
    },
    // Many records at once (a dashboard's first download): one bulk read instead of a read per game.
    getRecords: function (ids) {
      var out = {};
      if (ids.length > 20 && records.getLastRow() > 1) {
        var width = Math.max(6, records.getLastColumn());
        var all = records.getRange(2, 1, records.getLastRow() - 1, width).getValues();
        var want = {};
        ids.forEach(function (id) { want[id] = true; });
        all.forEach(function (r) { if (want[r[0]] && r[4]) out[r[0]] = unpack(r.slice(5, 5 + Number(r[4]))); });
      } else ids.forEach(function (id) { var g = store.getRecord(id); if (g) out[id] = g; });
      return out;
    },
    putRecord: function (id, rec, now) {
      var parts = pack(rec);
      var ix = index[id];
      var row = ix ? ix.row : records.getLastRow() + 1;
      writeRow(records, row, [id, now, rec.endedAt || '', (rec.recorders || []).join(', '), parts.length], parts, ix && ix.parts);
      index[id] = { row: row, at: now, parts: parts.length };
      cache[id] = rec;
    },
    getEdit: function (id) {
      var e = editRows[id];
      return e && e.json ? JSON.parse(e.json) : null;
    },
    putEdit: function (id, edit, now) {
      var e = editRows[id];
      var row = e ? e.row : edits.getLastRow() + 1;
      var json = JSON.stringify(edit);
      edits.getRange(row, 1, 1, 3).setValues([[id, now, json]]);
      editRows[id] = { row: row, at: now, json: json };
    },
    markDeleted: function (id, now) {
      if (!(id in gone)) deleted.appendRow([id, now]);
      gone[id] = now;
      var ix = index[id];
      if (ix) { records.getRange(ix.row, 1, 1, Math.max(6, records.getLastColumn())).clearContent(); delete index[id]; delete cache[id]; }
    },
    removeRecord: function (id) {
      var ix = index[id];
      if (ix) { records.getRange(ix.row, 1, 1, Math.max(6, records.getLastColumn())).clearContent(); delete index[id]; delete cache[id]; }
    },
    changedSince: function (since) {
      var ids = {};
      Object.keys(index).forEach(function (id) { if (index[id].at > since) ids[id] = true; });
      Object.keys(editRows).forEach(function (id) { if (editRows[id].at > since && index[id]) ids[id] = true; });
      return Object.keys(ids).filter(function (id) { return !(id in gone); });
    },
    deletedSince: function (since) { return Object.keys(gone).filter(function (id) { return gone[id] > since; }); },
    getMetaInfo: function () {
      var r = rows(metaSheet, 3).filter(function (x) { return x[0] === 'meta'; })[0];
      return r ? { at: Number(r[1]) || 0, parts: Number(r[2]) || 0 } : null;
    },
    getMeta: function () {
      var info = store.getMetaInfo();
      if (!info || !info.parts) return null;
      return unpack(metaSheet.getRange(2, 4, 1, info.parts).getValues()[0]);
    },
    putMeta: function (meta, now) {
      var info = store.getMetaInfo();
      var parts = pack(meta);
      writeRow(metaSheet, 2, ['meta', now, parts.length], parts, info && info.parts);
    },
    // ---------- accounts ----------
    getAccount: function (k) {
      var a = loadAccounts()[k];
      return a && a.json ? JSON.parse(a.json) : null;
    },
    putAccount: function (k, acct, now) {
      var all = loadAccounts();
      var row = all[k] ? all[k].row : accountsSheet.getLastRow() + 1;
      var json = JSON.stringify(acct);
      accountsSheet.getRange(row, 1, 1, 5).setValues([[k, acct.username, acct.created || now, now, json]]);
      all[k] = { row: row, json: json };
    },
    deleteAccount: function (k) {
      var a = loadAccounts()[k];
      if (a) { accountsSheet.getRange(a.row, 1, 1, 5).clearContent(); delete accountRows[k]; }
    },
    listAccounts: function () {
      var all = loadAccounts();
      return Object.keys(all).map(function (k) { return JSON.parse(all[k].json); });
    },
    // Signs sign-in tokens. Made once and kept in Script properties.
    secret: function () {
      var p = PropertiesService.getScriptProperties();
      var s = p.getProperty('SESSION_SECRET');
      if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SESSION_SECRET', s); }
      return s;
    },
    // Small settings the store keeps for itself, in Script properties.
    getValue: function (k) { return PropertiesService.getScriptProperties().getProperty('CW_' + k); },
    setValue: function (k, v) { PropertiesService.getScriptProperties().setProperty('CW_' + k, String(v)); },
    hmac: function (key, value) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(value), String(key))); },
    randomId: function () { return Utilities.getUuid(); },
    // Wrong-password counts, kept for up to an hour in Apps Script's cache.
    getTries: function (k) { var v = CacheService.getScriptCache().get('tries:' + k); return v ? JSON.parse(v) : null; },
    setTries: function (k, v) { var c = CacheService.getScriptCache(); if (v) c.put('tries:' + k, JSON.stringify(v), 3600); else c.remove('tries:' + k); },
    // Rebuild the tidy tabs' rows for these games (so the Sheet stays handy for your own analysis).
    refreshTables: function (ids) {
      var live = [];
      ids.forEach(function (id) {
        if (id in gone) return;
        var g = store.getRecord(id);
        if (g) live.push(withEdits_(g, store.getEdit(id)));
      });
      var tables = toTables(live, {});
      var drop = {};
      ids.forEach(function (id) { drop[id] = true; });
      Object.keys(COLUMNS).forEach(function (name) {
        var sh = tab(name, COLUMNS[name]);
        var n = sh.getLastRow() - 1;
        if (n > 0) {
          var values = sh.getRange(2, 1, n, COLUMNS[name].length).getValues();
          var keep = values.filter(function (r) { return !drop[r[0]]; });
          if (keep.length !== values.length) {
            sh.getRange(2, 1, n, COLUMNS[name].length).clearContent();
            if (keep.length) sh.getRange(2, 1, keep.length, COLUMNS[name].length).setValues(keep);
          }
        }
        var add = tables[name].map(function (r) { return COLUMNS[name].map(function (c) { return r[c] === undefined || r[c] === null ? '' : r[c]; }); });
        if (add.length) {
          var start = Math.max(sh.getLastRow(), 1) + 1;
          sh.getRange(start, 1, add.length, COLUMNS[name].length).setValues(add);
        }
      });
    },
  };
  return store;
}
