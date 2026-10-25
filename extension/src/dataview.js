// The "Data & settings" view: export/import, Google Sheets, communities, stored data.
import { toTables, toCSV, COLUMNS } from './tables.js';
import { communityConfig, communityName, slug, NONE } from './communities.js';
import { esc, fmtDate, fmtTime } from './ui.js';

export function renderData(ctx, filteredGames) {
  const { state } = ctx;
  const all = state.games;
  const s = state.settings;
  const ls = state.lastSync;
  const samples = all.filter((g) => g.id.startsWith('sample-')).length;
  return `<div class="grid two">
    <div class="card">
      <h3>Export</h3>
      <p class="sub">CSV files are one row per game, per player-in-game, per nomination and per death, ready for Google Sheets, Excel or Looker Studio. Exports include the ${filteredGames.length} games matching your current dashboard filters.</p>
      <div class="toolbar">
        <button class="btn" data-export="games">games.csv</button>
        <button class="btn" data-export="game_players">game_players.csv</button>
        <button class="btn" data-export="nominations">nominations.csv</button>
        <button class="btn" data-export="deaths">deaths.csv</button>
        <button class="btn primary" data-export="json">Full backup (JSON)</button>
      </div>
      ${ctx.tools.WEB ? '' : `<h3 style="margin-top:18px">Import</h3>
      <p class="sub">Merge a JSON backup — yours, or a friend's who also runs the tracker. Games already here are matched by ID, so nothing is duplicated.</p>
      <input type="file" accept="application/json,.json" data-import>
      <p class="msg" id="import-msg"></p>`}
    </div>
    ${sharedCard(ctx)}
    ${ctx.tools.WEB ? '' : `${communitiesCard(ctx)}
    <div class="card">
      <h3>Stored data</h3>
      <p class="sub">${all.length} games stored in this browser (${all.filter((g) => g.excluded).length} excluded). Data stays on this computer unless you export it or turn on Sheets sync.</p>
      ${artLine(ctx)}
      <div class="toolbar">
        ${samples ? `<button class="btn" data-action="delete-sample">Remove sample data (${samples} games)</button>` : ''}
        <button class="btn danger" data-action="delete-all">Delete all games…</button>
        <button class="btn" data-action="reload-art">Reload artwork from botc.app</button>
      </div>
    </div>`}
  </div>`;
}

// Whether the tokens are using botc.app's own artwork, fonts and character list.
function artLine({ art }) {
  if (!art) return '';
  const a = art();
  const status = a.loaded
    ? `Token artwork: loaded from botc.app${a.fonts ? '' : ' (fonts still loading)'}. ${a.roles ? `Night-order leaves: ${a.roles} characters known.` : 'Night-order leaves appear after you next open botc.app with the extension running.'}`
    : `<span class="err">Token artwork: not loaded${a.error ? ` (${esc(a.error)})` : ''}.</span> Tokens use a plain style until it loads.`;
  return `<p class="sub" id="art-status">${status}</p>`;
}

// Sharing: everyone's games in one place. In the extension: uploads, the community password and editor key.
// On the website: sign-out and the editor key.
function sharedCard(ctx) {
  const { state, tools } = ctx;
  const sh = state.shared;
  const c = tools.creds(state.settings);
  const when = (ms) => (ms ? `${fmtDate(ms)} ${fmtTime(ms)}` : 'not yet');
  const st = sh.status || {};
  const download = sh.hasPassword
    ? (st.error ? `<span class="err">Couldn't download the latest games: ${esc(st.message || st.error)}.</span>` : `Everyone's games, last downloaded ${when(sh.cacheAt)}.`)
    : 'Enter the community password to see everyone\'s games.';
  // Editor keys look like cw-edit- plus 20 letters and numbers.
  const editor = `<label class="key-field">Editor key <span class="hint">Lets you fix or delete games for everyone.</span>
      <input type="password" data-shared-field="editorKey" value="${esc(c.editorKey)}" placeholder="cw-edit-XXXXXXXXXXXXXXXXXXXX" autocomplete="off"></label>`;
  const site = tools.siteUrl();
  if (tools.WEB) {
    const who = sh.account
      ? `<p class="sub">Signed in as <b>${esc(sh.account.username)}</b>.</p>
        <div class="toolbar account-row"><button class="btn" type="button" data-pw-open data-opens="pw">Change password</button><button class="btn" data-action="sign-out">Sign out</button></div>
        <p class="msg" id="pw-msg" role="status"></p>
        <form class="form change-pw" data-change-password data-keep="pw" hidden>
          <div class="field-head">Change password <span class="hint">Saving signs you out on your other devices.</span></div>
          <input type="password" name="password" placeholder="Current password" autocomplete="current-password" required aria-label="Current password">
          <input type="password" name="newPassword" placeholder="New password (8+ characters)" autocomplete="new-password" minlength="8" required aria-label="New password">
          <input type="password" name="confirm" placeholder="New password again" autocomplete="new-password" minlength="8" required aria-label="New password again">
          <div class="toolbar"><button class="btn primary" type="submit">Save new password</button><button class="btn" type="button" data-pw-cancel>Cancel</button></div>
          <p class="msg" role="alert"></p>
        </form>`
      : `<p class="sub">You're using the community password. With an account you'll get your own settings, like claiming your player.</p>
        <div class="toolbar account-row"><button class="btn primary" data-open-signin="signup">Create an account</button><button class="btn" data-open-signin="signin">Sign in</button><button class="btn" data-action="sign-out">Sign out</button></div>`;
    return `<div class="card account">
      <h3>Your account</h3>
      ${who}
      ${sh.account ? playerSection(ctx) : ''}
      ${st.error ? `<p class="sub">${download}</p>` : ''}
    </div>
    ${sh.account ? myCommunitiesCard(ctx) : ''}
    <div class="card editor-card">
      <h3>Editor key</h3>
      <p class="sub">Lets you fix or delete games for everyone.</p>
      <div class="form">
        <input type="password" data-shared-field="editorKey" value="${esc(c.editorKey)}" placeholder="cw-edit-XXXXXXXXXXXXXXXXXXXX" autocomplete="off" aria-label="Editor key">
        ${sh.canEdit && c.editorKey ? '<p class="sub small">You can change and delete games.</p>' : ''}
        <div class="toolbar"><button class="btn primary" data-action="save-editor-key">Save editor key</button></div>
        <p class="msg" id="shared-msg"></p></div>
    </div>
    ${accountsCard(ctx)}`;
  }
  const pending = state.games.filter((g) => g.pending).length;
  const ls = state.lastSync;
  const upload = !sh.on ? '' : `${pending ? `${pending} game${pending === 1 ? '' : 's'} waiting to upload. ` : 'All your games are uploaded. '}${ls ? (ls.ok ? `Last upload ${when(ls.at)}.` : `<span class="err">Last upload failed: ${esc(ls.error)}</span>`) : ''}`;
  return `<div class="card">
    <h3>Shared games</h3>
    ${sh.on ? `<p class="sub">Games recorded in this browser are uploaded to your community's shared stats, so everyone sees the same dashboard. ${upload}</p>
      <p class="sub">${download}${site ? ` Everyone can also see it at <a href="${esc(site)}" target="_blank" rel="noopener">the community dashboard</a>.` : ''}</p>
      <div class="form">
        <label class="key-field">Community password <input type="password" data-shared-field="viewPassword" value="${esc(c.password)}" placeholder="The password your community shared" autocomplete="off"></label>
        ${editor}
        <div class="toolbar"><button class="btn primary" data-action="save-shared">Save</button><button class="btn" data-action="upload-now">Upload now</button><button class="btn" data-action="download-now">Download now</button></div>
        <p class="msg" id="shared-msg"></p>
      </div>`
    : '<p class="sub">This copy of Clockwise isn\'t set up to share games, so they stay in this browser.</p>'}
    <details class="advanced"><summary>Advanced</summary>
      <p class="sub">For testing a different shared store. Leave empty to use the built-in one.</p>
      <div class="form">
        <label>Shared store address <input type="url" data-shared-field="backendUrl" value="${esc(state.settings.backendUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label>Upload key <input type="password" data-shared-field="writeKey" value="${esc(state.settings.writeKey || '')}" autocomplete="off"></label>
        <div class="toolbar"><button class="btn" data-action="save-advanced">Save</button></div>
      </div>
    </details>
  </div>`;
}

// Editors: everyone's accounts, with a way to set a new password (for someone who forgot theirs) or delete one.
// "Your player": which player in the games is you. People pick themselves; editors can remove a wrong claim.
function playerSection({ state, tools }) {
  const pl = state.profile;
  const claim = pl && pl.claim;
  const head = (hint) => `<div class="field-head">Your player <span class="hint">${hint}</span></div>`;
  let body;
  if (pl === undefined) body = head('Loading…');
  else if (claim) {
    const priv = !!(pl.profile && pl.profile.private);
    body = `${head('This is you in the games.')}
      <div class="claim-line"><b>${esc(tools.nameOf(claim.player, claim.name))}</b><button class="btn small" type="button" data-unclaim>Not you? Remove</button></div>
      <label class="private-check"><span>Keep my stats private <span class="hint">Only you can see your player page.</span></span>
        <span class="switch"><input type="checkbox" role="switch" data-private ${priv ? 'checked' : ''}><span class="knob" aria-hidden="true"></span></span></label>`;
  } else {
    body = `${head('Which player in the games is you?')}
      <div class="toolbar claim-form"><div class="claim-picker" data-claim-picker></div><button class="btn primary" type="button" data-claim>Claim</button></div>`;
  }
  return `<div class="player-claim">${body}<p class="msg" id="claim-msg"></p></div>`;
}

// Your own communities (website): only you see them. Games you record in their rooms are filed there.
function myCommunitiesCard({ state }) {
  const pl = state.profile;
  if (pl === undefined) return '';
  return `<div class="card my-communities">
    <h3>Your communities</h3>
    <p class="sub">Group games by the rooms you play in. Only you see these. Games you record in these rooms go here instead of Rhap, and only the people who recorded them can see them, unless someone else put the game under Escape or Rhap.</p>
    ${pl.claim ? '' : '<p class="sub">Claim your player first, so the games you recorded count as yours.</p>'}
    ${(pl.communities || []).map((c) => `<div class="my-community">
      <div><b>${esc(c.name)}</b><div class="hint">${c.rooms.length ? `Rooms: ${esc(c.rooms.join(', '))}` : 'No rooms yet'}</div></div>
      <button class="btn small" type="button" data-mc-remove="${esc(c.id)}">Remove</button></div>`).join('')}
    <button class="btn" type="button" data-mc-add data-opens="mc">+ Add community</button>
    <form class="form mc-form" data-mc-form data-keep="mc" hidden>
      <input type="text" name="name" placeholder="Name" required maxlength="40" aria-label="Community name">
      <input type="text" name="rooms" placeholder="Rooms, separated by commas" aria-label="Rooms">
      <div class="toolbar"><button class="btn primary" type="submit">Save community</button><button class="btn" type="button" data-mc-cancel>Cancel</button></div>
    </form>
    <p class="msg" id="mc-msg"></p>
  </div>`;
}

function accountsCard({ state, tools }) {
  if (!(state.shared.on && state.shared.canEdit && tools.creds(state.settings).editorKey)) return '';
  const list = state.accounts;
  const rows = !list ? '<p class="sub">Loading…</p>' : list.error ? `<p class="sub err">${esc(list.error)}</p>` : !list.length ? '<p class="sub">Nobody has made an account yet.</p>'
    : `<table class="accounts"><thead><tr><th>Username</th><th>Player</th><th></th></tr></thead><tbody>${list.map((a) => `<tr>
        <td>${esc(a.username)}<div class="joined">Joined ${fmtDate(a.created)}</div></td><td>${claimCell(a, tools)}</td>
        <td class="num"><div class="acct-actions"><button class="btn small" data-account-reset="${esc(a.username)}">Set new password</button><button class="btn small danger" data-account-delete="${esc(a.username)}">Delete</button></div></td></tr>`).join('')}</tbody></table>`;
  return `<div class="card span-all">
    <h3>Accounts</h3>
    <p class="sub">Only editors see this. If someone forgets their password, set a new one here and tell them what it is; they can change it afterwards. If someone claimed the wrong player, remove it and they can pick again.</p>
    ${rows}
    <p class="msg" id="accounts-msg"></p>
  </div>`;
}

// An account's claimed player, for editors, who can remove one that's wrong.
function claimCell(a, tools) {
  const c = a.claim;
  if (!c) return '<span class="muted">None</span>';
  return `${esc(tools.nameOf(c.player, c.name))} <button class="btn small" data-claim-remove="${esc(a.username)}">Remove</button>`;
}

function communitiesCard({ state, communityOptions }) {
  const cfg = communityConfig(state.settings);
  const overrides = Object.entries(cfg.overrides);
  return `<div class="card">
    <h3>Communities</h3>
    <p class="sub">Every game is tagged with a community so you can filter stats by group. A room listed here always belongs to that community; any other room gets the default below. You can change a room's community from the extension popup while you play, or fix a single game from the games list on the dashboard.</p>
    <div class="form" id="communities">
      ${cfg.communities.map((c) => `<div class="toolbar community-row" data-id="${esc(c.id)}" style="margin:0">
        <input type="text" class="c-name" value="${esc(c.name)}" placeholder="Name" style="width:130px">
        <input type="text" class="c-rooms" value="${esc((c.rooms || []).join(', '))}" placeholder="Rooms (comma separated)" style="flex:1;min-width:160px">
        <button class="btn danger" data-action="remove-community">Remove</button>
      </div>`).join('')}
      <div><button class="btn" data-action="add-community">+ Add community</button></div>
      <div class="field"><span class="field-label">Every other room belongs to (click again to switch off)</span>
        <div class="toggles" id="fallback-community">${communityOptions().map((o) => `<button class="toggle" data-fallback="${esc(o.value)}" aria-pressed="${cfg.fallback === o.value}">${esc(o.name)}</button>`).join('')}</div></div>
      ${overrides.length ? `<div><span class="muted">Rooms you've set by hand:</span> ${overrides.map(([room, id]) => `<span class="pill">${esc(room)} → ${id === NONE ? 'switched off' : esc(communityName(state.settings, id))} <button class="linkish" data-clear-room="${esc(room)}" aria-label="Clear">×</button></span>`).join(' ')}</div>` : ''}
      <div class="toolbar"><button class="btn primary" data-action="save-communities">Save communities</button><span class="msg" id="communities-msg"></span></div>
    </div>
  </div>`;
}

function readCommunities() {
  const taken = [];
  return [...document.querySelectorAll('.community-row')].map((row) => {
    const name = row.querySelector('.c-name').value.trim();
    if (!name) return null;
    const id = row.dataset.id || slug(name, taken);
    taken.push(id);
    const rooms = row.querySelector('.c-rooms').value.split(',').map((r) => r.trim()).filter(Boolean);
    return { id, name, rooms };
  }).filter(Boolean);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Returns true when the click was handled here.
export async function handleDataClick(t, ctx, filteredGames) {
  const { state, api, load } = ctx;
  const $ = (sel) => document.querySelector(sel);
  const a = t.dataset.action;
  if (t.dataset.fallback) {
    // Only one default at a time; clicking the one that's on switches it off.
    const on = t.getAttribute('aria-pressed') === 'true';
    document.querySelectorAll('[data-fallback]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    t.setAttribute('aria-pressed', String(!on));
    return true;
  }
  if (a === 'reload-art') {
    t.disabled = true; t.textContent = 'Loading…';
    const r = await chrome.runtime.sendMessage({ type: 'assets:refresh', force: true }).catch((e) => ({ ok: false, error: String(e.message || e) }));
    state.artError = r && r.ok ? '' : ((r && r.error) || 'unknown error');
    await load();
    return true;
  }
  if (a === 'add-community') {
    const row = document.createElement('div');
    row.className = 'toolbar community-row';
    row.style.margin = '0';
    row.innerHTML = `<input type="text" class="c-name" placeholder="Name" style="width:130px"><input type="text" class="c-rooms" placeholder="Rooms (comma separated)" style="flex:1;min-width:160px"><button class="btn danger" data-action="remove-community">Remove</button>`;
    t.parentElement.before(row);
    row.querySelector('.c-name').focus();
  } else if (a === 'remove-community') {
    t.closest('.community-row').remove();
  } else if (a === 'save-communities') {
    const communities = readCommunities();
    const fb = (document.querySelector('[data-fallback][aria-pressed="true"]') || {}).dataset;
    const fallbackCommunity = fb && communities.some((c) => c.id === fb.fallback) ? fb.fallback : NONE;
    await api.set('settings', { ...state.settings, communities, fallbackCommunity });
    await load();
    const msg = $('#communities-msg');
    if (msg) { msg.className = 'msg ok'; msg.textContent = 'Saved. Games keep the community they were recorded with.'; }
  } else if (t.dataset.clearRoom) {
    const roomCommunity = { ...(state.settings.roomCommunity || {}) };
    delete roomCommunity[t.dataset.clearRoom];
    await api.set('settings', { ...state.settings, roomCommunity });
    await load();
  } else if (t.dataset.export) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (t.dataset.export === 'json') download(`botc-games-${stamp}.json`, JSON.stringify({ format: 'botc-tracker', version: 1, exportedAt: Date.now(), games: filteredGames }, null, 1), 'application/json');
    else download(`${t.dataset.export}-${stamp}.csv`, toCSV(toTables(filteredGames, state.settings)[t.dataset.export], COLUMNS[t.dataset.export]), 'text/csv');
  } else if (['save-shared', 'save-advanced', 'save-editor-key', 'upload-now', 'download-now', 'sign-out'].includes(a)) {
    return sharedAction(a, ctx);
  } else if (a === 'delete-sample') {
    const map = await api.get('games', {});
    for (const id of Object.keys(map)) if (id.startsWith('sample-')) delete map[id];
    await api.set('games', map);
    await load();
  } else if (a === 'delete-all') {
    if (!confirm(`Delete all ${state.games.length} games from this browser? Export a JSON backup first if you might want them back.`)) return true;
    await api.set('games', {});
    await load();
  } else {
    return false;
  }
  return true;
}

export async function handleImport(file, ctx) {
  const { api, load } = ctx;
  const msg = () => document.querySelector('#import-msg');
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.games;
    if (!Array.isArray(incoming)) throw new Error('Not a Clockwise export');
    const map = await api.get('games', {});
    // A new sample file replaces the old sample games rather than adding to them.
    if (incoming.length && incoming.every((g) => g && String(g.id).startsWith('sample-'))) {
      for (const id of Object.keys(map)) if (id.startsWith('sample-')) delete map[id];
    }
    let added = 0, updated = 0;
    for (const g of incoming) {
      if (!g || !g.id || !Array.isArray(g.players)) continue;
      if (map[g.id]) { if ((g.capturedAt || 0) > (map[g.id].capturedAt || 0)) { map[g.id] = { ...g, excluded: map[g.id].excluded, notes: map[g.id].notes, syncedAt: null }; updated++; } }
      else { map[g.id] = { ...g, syncedAt: null }; added++; }
    }
    await api.set('games', map);
    await load();
    msg().className = 'msg ok';
    msg().textContent = `Imported ${added} new games, updated ${updated}.`;
  } catch (err) {
    msg().className = 'msg err';
    msg().textContent = `Import failed: ${err.message}`;
  }
}

async function sharedAction(a, ctx) {
  const { state, api, load, tools } = ctx;
  const msg = document.querySelector('#shared-msg');
  const say = (text, ok) => { if (msg) { msg.className = `msg ${ok === undefined ? '' : ok ? 'ok' : 'err'}`; msg.textContent = text; } };
  const field = (f) => { const el = document.querySelector(`[data-shared-field="${f}"]`); return el ? el.value.trim() : undefined; };
  if (a === 'sign-out') {
    tools.webAuth.clear();
    await tools.cacheClear();
    location.reload();
    return true;
  }
  if (a === 'download-now') {
    say('Downloading…');
    await tools.syncShared();
    const st = state.shared.status || {};
    say(st.error ? `Couldn't download: ${st.message || st.error}` : 'Up to date.', !st.error);
    return true;
  }
  if (a === 'upload-now') {
    say('Uploading…');
    const r = await api.send({ type: 'sync:pending' });
    say(r && r.ok ? (r.skipped ? 'Sharing isn\'t set up.' : `Uploaded ${r.synced} game${r.synced === 1 ? '' : 's'}.`) : `Upload failed: ${r && r.error}`, !!(r && r.ok));
    return true;
  }
  if (a === 'save-advanced') {
    await api.set('settings', { ...state.settings, backendUrl: field('backendUrl'), writeKey: field('writeKey') });
    await load();
    return true;
  }
  // Check keys with the store before saving them, so a typo is caught here rather than later.
  const editorKey = field('editorKey');
  const password = a === 'save-shared' ? field('viewPassword') : undefined;
  say('Checking…');
  if (password) {
    const r = await tools.checkKey(state.settings, password).catch((e) => ({ ok: false, message: e.message }));
    if (!(r.ok && r.canRead)) { say(r.ok ? 'That community password isn\'t right.' : `Couldn't check it: ${r.message || r.error}`, false); return true; }
  }
  if (editorKey) {
    const r = await tools.checkKey(state.settings, editorKey).catch((e) => ({ ok: false, message: e.message }));
    if (!(r.ok && r.canEdit)) { say(r.ok ? 'That editor key isn\'t right.' : `Couldn't check it: ${r.message || r.error}`, false); return true; }
  }
  if (tools.WEB) tools.webAuth.setEditorKey(editorKey);
  else await api.set('settings', { ...state.settings, ...(password !== undefined ? { viewPassword: password } : {}), editorKey });
  await load();
  await tools.syncShared();
  say(editorKey ? 'Saved. You can change and delete games.' : 'Saved.', true);
  return true;
}
