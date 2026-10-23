// Tests for the shared store, run against the generated Code.gs.  node backend/test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend as loadMemory, loadSheetsBackend } from './local.mjs';

// Every test runs twice: against the in-memory store and the real Google Sheet store (on a fake spreadsheet).
const STORES = { memory: loadMemory, sheet: loadSheetsBackend };
let loadBackend = loadMemory;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'sample-data/botc-sample-games.json'), 'utf8'));
const games = (sample.games || sample).map((g) => ({ ...g, id: g.id.replace(/^sample-/, 'room:') }));
const keys = { view: 'view-pass', write: 'write-key', editor: 'editor-key' };
let passed = 0, failed = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Two people in the same room: one joined on night 3 and missed the early nominations and some names.
const full = clone(games[0]);
full.capturedBy = { username: 'ash' };
full.players[0].icon = 'https://botc.app/assets/imp-abc.webp';
full.players[1].icon = 'https://example.com/custom-art.png';
const late = clone(games[0]);
late.capturedBy = { username: 'wren' };
late.joinedAtPhase = 3;
late.nominations = late.nominations.slice(-1);
late.players[2].username = null;
full.players[3].username = null; // the full recording is missing a name the late one has
full.excluded = true; full.notes = 'my private note'; full.syncedAt = 123;

check('permissions: nothing without a key', () => {
  const { handle } = loadBackend();
  for (const action of ['record', 'read', 'edit', 'delete', 'meta']) assert.equal(handle({ action }, keys).ok, false, action);
  assert.deepEqual(handle({ action: 'ping', key: 'wrong' }, keys, 1), { ok: true, canRead: false, canWrite: false, canEdit: false, now: 1, account: null, signedOut: false });
});

check('permissions: password reads only, write key uploads only, editor key does everything', () => {
  const { handle } = loadBackend();
  assert.equal(handle({ action: 'record', key: 'view-pass', games: [full] }, keys).ok, false);
  assert.equal(handle({ action: 'record', key: 'write-key', games: [full] }, keys).ok, true);
  assert.equal(handle({ action: 'read', key: 'write-key' }, keys).ok, false);
  assert.equal(handle({ action: 'read', key: 'view-pass' }, keys).ok, true);
  assert.equal(handle({ action: 'edit', key: 'view-pass', id: full.id, patch: { excluded: true } }, keys).ok, false);
  assert.equal(handle({ action: 'edit', key: 'write-key', id: full.id, patch: { excluded: true } }, keys).ok, false);
  assert.equal(handle({ action: 'delete', key: 'write-key', id: full.id }, keys).ok, false);
  assert.equal(handle({ action: 'edit', key: 'editor-key', id: full.id, patch: { excluded: true } }, keys).ok, true);
  assert.equal(handle({ action: 'read', key: 'editor-key' }, keys).ok, true);
});

check('an empty key never matches an unset property', () => {
  const { handle } = loadBackend();
  assert.equal(handle({ action: 'read', key: '' }, { view: '', write: '', editor: '' }).ok, false);
});

for (const order of [['full', 'late'], ['late', 'full']]) {
  check(`same game recorded twice (${order.join(' then ')}) → one complete record`, () => {
    const { handle, store } = loadBackend();
    const byName = { full, late };
    order.forEach((n, i) => assert.equal(handle({ action: 'record', key: 'write-key', games: [byName[n]] }, keys, 100 + i).ok, true));
    assert.equal(store.count(), 1);
    const g = handle({ action: 'read', key: 'view-pass' }, keys, 200).games[0];
    assert.equal(g.nominations.length, full.nominations.length, 'kept the recording that saw every nomination');
    assert.equal(g.joinedAtPhase, full.joinedAtPhase);
    assert.equal(g.players[3].username, games[0].players[3].username, 'filled a missing name from the other recording');
    assert.equal(g.players[2].username, games[0].players[2].username);
    assert.deepEqual([...g.recorders].sort(), ['ash', 'wren']);
    assert.equal(g.excluded, undefined, 'personal fields are not uploaded');
    assert.equal(g.notes, undefined);
    assert.equal(g.syncedAt, undefined);
    assert.equal(g.players[0].icon, undefined, 'botc.app image addresses are dropped (worked out again by the dashboard)');
    assert.equal(g.players[1].icon, 'https://example.com/custom-art.png', 'custom art is kept');
  });
}

check('uploading the same recording again changes nothing', () => {
  const { handle, store } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [full] }, keys, 1);
  handle({ action: 'record', key: 'write-key', games: [full, full] }, keys, 2);
  assert.equal(store.count(), 1);
  assert.deepEqual(handle({ action: 'read', key: 'view-pass' }, keys, 3).games[0].recorders, ['ash']);
});

check('sample games are never stored', () => {
  const { handle, store } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [{ ...full, id: 'sample-1' }] }, keys);
  assert.equal(store.count(), 0);
});

check('edits show to everyone and survive later uploads', () => {
  const { handle } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [full] }, keys, 1);
  handle({ action: 'edit', key: 'editor-key', id: full.id, patch: { community: 'rhap', communityManual: true, excluded: true, notes: 'fixed', names: { 4: { username: 'thistle' } }, storytellers: [{ username: 'hollis' }] } }, keys, 2);
  handle({ action: 'record', key: 'write-key', games: [late] }, keys, 3);
  const g = handle({ action: 'read', key: 'view-pass' }, keys, 4).games[0];
  assert.equal(g.community, 'rhap');
  assert.equal(g.excluded, true);
  assert.equal(g.notes, 'fixed');
  assert.equal(g.players.find((p) => p.seat === 4).username, 'thistle');
  assert.deepEqual(g.storytellers, [{ username: 'hollis' }]);
  assert.equal(handle({ action: 'edit', key: 'editor-key', id: 'nope', patch: {} }, keys).ok, false);
});

check('deleted games stay deleted, and readers are told', () => {
  const { handle, store } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [full, games[1]] }, keys, 1);
  handle({ action: 'delete', key: 'editor-key', id: full.id }, keys, 2);
  const r = handle({ action: 'record', key: 'write-key', games: [late] }, keys, 3);
  assert.deepEqual(r.skipped, [full.id]);
  assert.equal(store.count(), 1);
  const read = handle({ action: 'read', key: 'view-pass', since: 1 }, keys, 4);
  assert.deepEqual(read.deleted, [full.id]);
  assert.ok(!read.games.some((g) => g.id === full.id));
});

check('reads are incremental', () => {
  const { handle } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: games.slice(0, 5) }, keys, 10);
  const first = handle({ action: 'read', key: 'view-pass', since: 0 }, keys, 11);
  assert.equal(first.games.length, 5);
  assert.equal(handle({ action: 'read', key: 'view-pass', since: first.now }, keys, 12).games.length, 0);
  handle({ action: 'record', key: 'write-key', games: games.slice(5, 7) }, keys, 13);
  handle({ action: 'edit', key: 'editor-key', id: games[0].id, patch: { notes: 'x' } }, keys, 14);
  const next = handle({ action: 'read', key: 'view-pass', since: first.now }, keys, 15);
  assert.deepEqual(next.games.map((g) => g.id).sort(), [games[0].id, games[5].id, games[6].id].sort());
});

check('a recorder can withdraw a cancelled game only if nobody else recorded it', () => {
  const { handle, store } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [full] }, keys, 1);
  assert.equal(handle({ action: 'void', key: 'view-pass', id: full.id, recorder: 'ash' }, keys, 2).ok, false);
  assert.equal(handle({ action: 'void', key: 'write-key', id: full.id, recorder: 'ash' }, keys, 3).removed, true);
  assert.equal(store.count(), 0);
  handle({ action: 'record', key: 'write-key', games: [full] }, keys, 4);
  assert.equal(store.count(), 1, 'can be recorded again');
  handle({ action: 'record', key: 'write-key', games: [late] }, keys, 5);
  assert.equal(handle({ action: 'void', key: 'write-key', id: full.id, recorder: 'ash' }, keys, 6).removed, false, 'wren recorded it too');
  assert.equal(store.count(), 1);
});

check('a community picked in the popup wins over the stored one', () => {
  const { handle } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [{ ...full, community: 'escape' }] }, keys, 1);
  handle({ action: 'record', key: 'write-key', games: [{ ...late, community: 'rhap', communityChosen: true }] }, keys, 2);
  assert.equal(handle({ action: 'read', key: 'view-pass' }, keys, 3).games[0].community, 'rhap');
});

check('artwork info: kept per part, character list grows', () => {
  const { handle } = loadBackend();
  handle({ action: 'meta', key: 'write-key', meta: { assetMap: { map: { a: 1 } }, tokenStyle: { variants: { default: {} } }, roleMeta: { imp: [0, 1, 0, 0, 'tb'] } } }, keys, 1);
  handle({ action: 'meta', key: 'write-key', meta: { roleMeta: { chef: [1, 0, 0, 0, 'tb'] } } }, keys, 2);
  const m = handle({ action: 'read', key: 'view-pass' }, keys, 3).meta;
  assert.deepEqual(Object.keys(m.roleMeta).sort(), ['chef', 'imp']);
  assert.deepEqual(m.assetMap, { map: { a: 1 } });
  assert.ok(m.tokenStyle.variants);
  assert.equal(handle({ action: 'read', key: 'view-pass', since: 5 }, keys, 6).meta, null, 'not resent when unchanged');
});

check('big artwork info is split across cells and read back intact', () => {
  const { handle } = loadBackend();
  // Random data barely compresses, so this is well over one 50,000-character cell.
  const noise = Array.from({ length: 300000 }, () => Math.random().toString(36)[2] || 'x').join('');
  const tokenStyle = { variants: { default: { token: `data:image/webp;base64,${noise}` } } };
  handle({ action: 'meta', key: 'write-key', meta: { tokenStyle } }, keys, 1);
  handle({ action: 'meta', key: 'write-key', meta: { roleMeta: { imp: [0, 1, 0, 0, 'tb'] } } }, keys, 2);
  const m = handle({ action: 'read', key: 'view-pass' }, keys, 3).meta;
  assert.equal(m.tokenStyle.variants.default.token.length, noise.length + 'data:image/webp;base64,'.length);
});

// ---------- accounts ----------
const signup = (handle, username, password, key = 'view-pass', now = 1000) => handle({ action: 'signup', key, username, password }, keys, now);

check('accounts: signing up needs the community password', () => {
  const { handle } = loadBackend();
  assert.equal(signup(handle, 'oddish', 'correct horse', 'wrong').ok, false);
  assert.equal(signup(handle, 'oddish', 'correct horse', 'write-key').ok, false, 'the upload key is not enough');
  const r = signup(handle, 'oddish', 'correct horse');
  assert.equal(r.ok, true);
  assert.ok(r.token);
  assert.equal(r.account.username, 'oddish');
  assert.equal(r.account.salt, undefined, 'never sends password details back');
  assert.equal(r.account.hash, undefined);
});

check('accounts: usernames are unique (ignoring case and spaces) and passwords at least 8 characters', () => {
  const { handle } = loadBackend();
  signup(handle, 'Liat W', 'password1');
  assert.equal(signup(handle, ' liat  w ', 'password2').error, 'taken');
  assert.equal(signup(handle, 'x', 'password3').error, 'invalid');
  assert.equal(signup(handle, 'bob', 'short').error, 'invalid');
  assert.equal(signup(handle, 'bob<script>', 'password4').error, 'invalid');
});

check('accounts: sign in with the right password; a token can read games', () => {
  const { handle } = loadBackend();
  handle({ action: 'record', key: 'write-key', games: [full] }, keys, 1);
  signup(handle, 'oddish', 'correct horse');
  assert.equal(handle({ action: 'signin', username: 'oddish', password: 'nope nope' }, keys, 2000).ok, false);
  assert.equal(handle({ action: 'signin', username: 'nobody', password: 'correct horse' }, keys, 2000).ok, false);
  const r = handle({ action: 'signin', username: 'ODDISH', password: 'correct horse' }, keys, 2000);
  assert.equal(r.ok, true);
  const read = handle({ action: 'read', token: r.token }, keys, 2001);
  assert.equal(read.ok, true);
  assert.equal(read.games.length, 1);
  assert.equal(handle({ action: 'me', token: r.token }, keys, 2002).account.username, 'oddish');
  assert.equal(handle({ action: 'record', token: r.token, games: [full] }, keys, 2003).ok, false, 'an account can\'t upload as the extension');
  assert.equal(handle({ action: 'edit', token: r.token, id: full.id, patch: { notes: 'x' } }, keys, 2004).ok, false, 'or edit');
});

check('accounts: a forged or tampered token is refused', () => {
  const { handle } = loadBackend();
  const r = signup(handle, 'oddish', 'correct horse');
  const [k, issued, pwv, sig] = r.token.split('.');
  for (const bad of [`${k}.${issued}.${pwv}.AAAA`, `${encodeURIComponent('liat')}.${issued}.${pwv}.${sig}`, `${k}.${Number(issued) + 1}.${pwv}.${sig}`, 'nonsense']) {
    assert.equal(handle({ action: 'read', token: bad }, keys, 2000).ok, false, bad);
  }
  assert.equal(handle({ action: 'ping', token: 'nonsense' }, keys, 2000).signedOut, true);
});

check('accounts: tokens expire after 180 days', () => {
  const { handle } = loadBackend();
  const r = signup(handle, 'oddish', 'correct horse', 'view-pass', 1000);
  assert.equal(handle({ action: 'read', token: r.token }, keys, 1000 + 179 * 864e5).ok, true);
  assert.equal(handle({ action: 'read', token: r.token }, keys, 1000 + 181 * 864e5).ok, false);
});

check('accounts: 10 wrong passwords lock the account for 15 minutes', () => {
  const { handle } = loadBackend();
  signup(handle, 'oddish', 'correct horse');
  for (let i = 0; i < 10; i++) handle({ action: 'signin', username: 'oddish', password: 'guess' + i }, keys, 5000 + i);
  assert.equal(handle({ action: 'signin', username: 'oddish', password: 'correct horse' }, keys, 6000).error, 'locked');
  assert.equal(handle({ action: 'signin', username: 'oddish', password: 'correct horse' }, keys, 6000 + 16 * 60e3).ok, true);
});

check('accounts: changing your password signs out other devices', () => {
  const { handle } = loadBackend();
  const a = signup(handle, 'oddish', 'correct horse');
  const b = handle({ action: 'signin', username: 'oddish', password: 'correct horse' }, keys, 2000);
  assert.equal(handle({ action: 'change-password', token: a.token, password: 'wrong one', newPassword: 'new password' }, keys, 3000).ok, false);
  const c = handle({ action: 'change-password', token: a.token, password: 'correct horse', newPassword: 'new password' }, keys, 3000);
  assert.equal(c.ok, true);
  assert.equal(handle({ action: 'read', token: b.token }, keys, 3001).ok, false, 'old device signed out');
  assert.equal(handle({ action: 'read', token: c.token }, keys, 3001).ok, true, 'this device keeps going');
  assert.equal(handle({ action: 'signin', username: 'oddish', password: 'new password' }, keys, 3002).ok, true);
});

check('accounts: editors list accounts, reset passwords and delete accounts; nobody else can', () => {
  const { handle } = loadBackend();
  const a = signup(handle, 'oddish', 'correct horse');
  signup(handle, 'wren', 'another one');
  assert.equal(handle({ action: 'accounts', key: 'view-pass' }, keys).ok, false);
  assert.equal(handle({ action: 'accounts', token: a.token }, keys, 2000).ok, false);
  assert.deepEqual(handle({ action: 'accounts', key: 'editor-key' }, keys).accounts.map((x) => x.username), ['oddish', 'wren']);
  assert.equal(handle({ action: 'reset-password', token: a.token, username: 'wren', newPassword: 'hijacked!!' }, keys, 2000).ok, false);
  assert.equal(handle({ action: 'reset-password', key: 'editor-key', username: 'oddish', newPassword: 'fresh start' }, keys, 3000).ok, true);
  assert.equal(handle({ action: 'read', token: a.token }, keys, 3001).ok, false, 'reset signs the account out');
  assert.equal(handle({ action: 'signin', username: 'oddish', password: 'fresh start' }, keys, 3002).ok, true);
  assert.equal(handle({ action: 'delete-account', key: 'editor-key', username: 'wren' }, keys).ok, true);
  assert.equal(handle({ action: 'signin', username: 'wren', password: 'another one' }, keys, 4000).ok, false);
  assert.equal(signup(handle, 'wren', 'brand new one').ok, true, 'the name is free again');
});

check('accounts: passwords are stored hashed, not as typed', () => {
  const { handle, store, sheets } = loadBackend();
  signup(handle, 'oddish', 'correct horse');
  const raw = sheets ? JSON.stringify(sheets.get('accounts').getRange(1, 1, 3, 5).getValues()) : JSON.stringify(store.listAccounts());
  assert.ok(!raw.includes('correct horse'));
});

check('every sample game uploads and builds the Sheet tables', () => {
  const { handle, store } = loadBackend();
  const r = handle({ action: 'record', key: 'write-key', games }, keys);
  assert.equal(r.saved.length, games.length);
  assert.equal(store.tables.games.length, games.length);
  assert.ok(store.tables.game_players.length > games.length * 5);
});

for (const [storeName, load] of Object.entries(STORES)) {
  loadBackend = load;
  for (const [name, fn] of tests) {
    try { fn(); passed++; console.log('PASS', `[${storeName}]`, name); } catch (e) { failed++; console.log('FAIL', `[${storeName}]`, name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); }
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
