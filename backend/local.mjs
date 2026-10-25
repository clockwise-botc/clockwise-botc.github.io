// Runs the generated google-sheets/Code.gs locally against an in-memory store, for tests and for trying the
// website without Google. `loadBackend()` gives { handle(body, keys, now), store }; `serve()` starts a mock web app.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function memoryStore() {
  const records = new Map(), edits = new Map(), gone = new Map();
  let meta = null, metaAt = 0;
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const store = {
    tables: null,
    batch: (fn) => fn(),
    isDeleted: (id) => gone.has(id),
    getRecord: (id) => clone((records.get(id) || {}).rec || null),
    getRecords: (ids) => Object.fromEntries(ids.filter((id) => records.has(id)).map((id) => [id, clone(records.get(id).rec)])),
    putRecord: (id, rec, now) => { records.set(id, { rec: clone(rec), at: now }); },
    getEdit: (id) => clone((edits.get(id) || {}).edit || null),
    putEdit: (id, edit, now) => { edits.set(id, { edit: clone(edit), at: now }); },
    markDeleted: (id, now) => { gone.set(id, now); records.delete(id); },
    removeRecord: (id) => { records.delete(id); },
    changedSince: (since) => [...new Set([...[...records].filter(([, r]) => r.at > since).map(([id]) => id),
      ...[...edits].filter(([id, e]) => e.at > since && records.has(id)).map(([id]) => id)])],
    deletedSince: (since) => [...gone].filter(([, at]) => at > since).map(([id]) => id),
    getMetaInfo: () => (meta ? { at: metaAt } : null),
    getMeta: () => clone(meta),
    putMeta: (m, now) => { meta = clone(m); metaAt = now; },
    refreshTables: () => {},
    count: () => records.size,
    ...accountStore(),
  };
  return store;
}

// Accounts for the in-memory store (the Sheet store has its own, in sheets-store.js).
function accountStore() {
  const accounts = new Map(), tries = new Map(), values = new Map();
  const secret = crypto.randomBytes(16).toString('hex');
  return {
    getAccount: (k) => (accounts.has(k) ? JSON.parse(JSON.stringify(accounts.get(k))) : null),
    putAccount: (k, a) => { accounts.set(k, JSON.parse(JSON.stringify(a))); },
    deleteAccount: (k) => { accounts.delete(k); },
    listAccounts: () => [...accounts.values()].map((a) => JSON.parse(JSON.stringify(a))),
    secret: () => secret,
    hmac: (key, value) => crypto.createHmac('sha256', String(key)).update(String(value)).digest('base64url'),
    randomId: () => crypto.randomUUID(),
    getTries: (k) => tries.get(k) || null,
    setTries: (k, v) => { if (v) tries.set(k, v); else tries.delete(k); },
    getValue: (k) => (values.has(k) ? values.get(k) : null),
    setValue: (k, v) => { values.set(k, String(v)); },
  };
}

export function loadBackend(store = memoryStore()) {
  const code = fs.readFileSync(path.join(root, 'google-sheets/Code.gs'), 'utf8');
  const ctx = vm.createContext({ console, JSON, Math, Date, Object, Array, String, Number, encodeURIComponent, decodeURIComponent });
  vm.runInContext(code, ctx);
  // Exercise the real tidy-table code too, so a bad record can't break the Sheet.
  store.refreshTables = (ids) => { store.tables = ctx.toTables(ids.map((id) => store.getRecord(id)).filter(Boolean), {}); };
  return { store, handle: (body, keys, now = Date.now()) => ctx.handle_(JSON.parse(JSON.stringify(body)), store, keys, now), ctx };
}

// The same code with its real Google Sheet store, running on a fake spreadsheet (enough of SpreadsheetApp,
// Utilities and LockService for sheets-store.js), so the storage code is tested too.
export function loadSheetsBackend() {
  const sheets = new Map();
  const makeSheet = (name) => {
    const cells = []; // cells[r][c], 0-based
    let maxCols = 26;
    const lastRow = () => { for (let r = cells.length - 1; r >= 0; r--) if ((cells[r] || []).some((v) => v !== '' && v != null)) return r + 1; return 0; };
    const lastCol = () => cells.reduce((m, row) => { for (let c = (row || []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) return Math.max(m, c + 1); return m; }, 0);
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (cells[r - 1 + i] || [])[c - 1 + j]; return v == null ? '' : v; })),
      setValues: (vals) => { if (vals.length !== nr || vals.some((row) => row.length !== nc)) throw new Error(`setValues size mismatch on ${name}`);
        vals.forEach((row, i) => row.forEach((v, j) => { cells[r - 1 + i] = cells[r - 1 + i] || []; if (typeof v === 'string' && v.length > 50000) throw new Error('cell over 50000 characters'); cells[r - 1 + i][c - 1 + j] = v; })); return range(r, c, nr, nc); },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; },
      setFontWeight: () => range(r, c, nr, nc),
    });
    const sh = { getRange: range, getLastRow: lastRow, getLastColumn: lastCol, getMaxColumns: () => maxCols,
      insertColumnsAfter: (_, n) => { maxCols += n; }, setFrozenRows: () => {}, appendRow: (row) => range(lastRow() + 1, 1, 1, row.length).setValues([row]) };
    sheets.set(name, sh);
    return sh;
  };
  const blob = (bytes, type) => ({ bytes: Buffer.from(bytes), type, getBytes: () => Buffer.from(bytes), getDataAsString: () => Buffer.from(bytes).toString('utf8') });
  const props = new Map(), cacheMap = new Map();
  const ctx = vm.createContext({
    console, JSON, Math, Date, Object, Array, String, Number, encodeURIComponent, decodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheMap.get(k) || null, put: (k, v) => cacheMap.set(k, v), remove: (k) => cacheMap.delete(k) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets.get(n) || null, insertSheet: makeSheet }), flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      newBlob: (data, type) => blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : data, type),
      gzip: (b) => blob(zlib.gzipSync(b.bytes), 'application/x-gzip'),
      ungzip: (b) => blob(zlib.gunzipSync(b.bytes), 'application/octet-stream'),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', key).update(value, 'utf8').digest()],
      getUuid: () => crypto.randomUUID(),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'google-sheets/Code.gs'), 'utf8'), ctx);
  const count = () => { const sh = sheets.get('records'); return sh ? sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().filter((r) => r[0]).length : 0; };
  // Each request gets a fresh store, like each Apps Script execution.
  const tableRows = (name) => { const sh = sheets.get(name); return sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().filter((r) => r[0]) : []; };
  const store = { count, get tables() { return { games: tableRows('games'), game_players: tableRows('game_players') }; } };
  return { handle: (body, keys, now = Date.now()) => ctx.handle_(JSON.parse(JSON.stringify(body)), ctx.sheetStore_(), keys, now), store, sheets };
}

// A stand-in for the deployed web app: POST JSON (sent as text/plain, like the real one), CORS open.
export function serve({ port = 8787, keys = { view: 'view-pass', write: 'write-key', editor: 'editor-key' } } = {}) {
  const backend = loadSheetsBackend();
  let clock = Date.now();
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, service: 'clockwise', ready: true })); return; }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(data); } catch { body = null; }
      clock = Math.max(clock + 1, Date.now());
      const out = body ? backend.handle(body, keys, clock) : { ok: false, error: 'bad-request' };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, backend, url: `http://localhost:${port}/exec` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve({ port: Number(process.env.PORT) || 8787 });
  console.log(`mock Clockwise backend at ${url} (view-pass / write-key / editor-key)`);
}
