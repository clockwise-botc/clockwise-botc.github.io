import { communityConfig, communityForRoom, automaticCommunity, communityName } from './communities.js';
import { call } from './shared.js';
import { BACKEND_URL, SITE_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One dropdown: the communities, then "Don't record". It starts on the community the game looks like it's from (its
// room, or who's at the table: see members.js), or on "Don't record" when it fits none. "Don't record" is about the
// game being played, the one that just ended here (its upload is taken back), or the next one; picking a community
// records it after all, and is remembered for the room. Picking the room's own community clears a choice made by hand.
const SKIPPED = {
  current: 'This game won\'t be recorded.',
  last: 'The game that just ended won\'t be recorded.',
  next: 'The next game here won\'t be recorded.',
};
// Not recorded because it fits no community (nobody picked "Don't record").
const UNMATCHED = {
  current: 'This game won\'t be recorded: most of the table hasn\'t played in one of your communities, and neither has the storyteller. Pick a community to record it.',
  last: 'The game that just ended wasn\'t recorded: it doesn\'t look like one of your communities\' games. Pick a community to record it.',
  next: 'The next game here won\'t be recorded unless most of the table (or the storyteller) has played in one of your communities. Pick a community to record it anyway.',
};
async function showCommunity(room) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const cfg = communityConfig(settings);
  const own = automaticCommunity(settings, room);
  const ask = { room, gameId: liveTab && liveTab.gameId, inGame: !!(liveTab && liveTab.inGame) };
  const st = await chrome.runtime.sendMessage({ type: 'skip:get', ...ask }).catch(() => null);
  const skipped = !!(st && st.ok && st.skipped);
  const kind = (st && st.kind) || (ask.inGame ? 'current' : 'next');
  // The game that just ended: what it was saved with. Otherwise: who's at the table now.
  const def = st && st.kind === 'last' ? { community: st.community || null, why: st.autoSkipped ? null : 'saved' }
    : await chrome.runtime.sendMessage({ type: 'community:get', room, seated: (liveTab && liveTab.seated) || [], storytellers: (liveTab && liveTab.storytellers) || [] }).catch(() => ({ community: communityForRoom(settings, room), why: 'room' }));
  const current = def.community || null;
  // A room switched off in an older version: recorded, without a community.
  const legacyNone = !current && def.why === 'chosen';
  const sel = $('community-select');
  sel.innerHTML = cfg.communities.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')
    + (legacyNone ? '<option value="">No community</option>' : '')
    + '<hr><option value="skip">Don\'t record</option>';
  sel.value = skipped ? 'skip' : current || (legacyNone ? '' : 'skip');
  sel.onchange = async () => {
    const wanted = sel.value;
    sel.disabled = true;
    if (wanted === 'skip') await chrome.runtime.sendMessage({ type: 'skip:set', ...ask, on: true });
    else {
      if (skipped) await chrome.runtime.sendMessage({ type: 'skip:set', ...ask, on: false });
      if (wanted && (wanted !== current || def.why !== 'chosen')) await chrome.runtime.sendMessage({ type: 'community:set', room, choice: wanted === own ? null : wanted });
    }
    sel.disabled = false;
    await showCommunity(room);
    showStats();
  };
  $('community-box').hidden = false;
  if (skipped) show('', SKIPPED[kind]);
  else if (!current && !legacyNone) show('', UNMATCHED[kind]);
  else showStatus(communityName(settings, current));
}

// ---------- signing in ----------
// Everyone signs in (or creates an account) the first time they open the popup; the sign-in is kept and renews
// itself, so they don't have to again. (Without a shared store, as in tests, there's nothing to sign in to.)
let currentRoom = null;
const getSettings = async () => (await chrome.storage.local.get('settings')).settings || {};
const saveSettings = async (patch) => chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
const storeUrl = (s) => s.backendUrl || BACKEND_URL;
// signedOutAt: when, so the website (which shares the sign-in) follows a sign-out rather than signing back in.
const signedOut = () => ({ accountToken: '', accountName: '', accountCommunities: [], signedOutAt: Date.now() });
const signedIn = (r, token) => ({ accountToken: token || r.token, accountName: r.account.username, accountCommunities: r.account.communities || [], signedOutAt: 0 });

async function needsSignIn() {
  const s = await getSettings();
  return !!storeUrl(s) && !s.accountToken;
}

async function showAccount() {
  const s = await getSettings();
  $('acct-in').hidden = !s.accountToken;
  $('acct-name').textContent = s.accountName || '';
  if (currentRoom) await showCommunity(currentRoom);
}

// Is the saved sign-in still good (a password change elsewhere signs you out)? Picks up communities changed on the
// website, and a renewed sign-in when the store hands one back.
async function refreshAccount() {
  const s = await getSettings();
  if (!s.accountToken || !storeUrl(s)) return;
  const r = await call(storeUrl(s), { action: 'ping', token: s.accountToken }).catch(() => null);
  if (!r || !r.ok) return;
  if (r.signedOut) { await saveSettings(signedOut()); return start(); }
  if (r.account) await saveSettings(signedIn(r, r.token || s.accountToken));
  await showAccount();
}

let setGateMode = () => {};
// Claim your player for you: the botc.app account logged in on this computer, if your Clockwise account hasn't
// claimed a player yet. Tried once per Clockwise account, so removing the claim on the website sticks.
async function autoClaim(me) {
  const s = await getSettings();
  if (!me || !me.id || !s.accountToken || !storeUrl(s) || s.autoClaimedFor === s.accountName) return;
  const r = await call(storeUrl(s), { action: 'ping', token: s.accountToken }).catch(() => null);
  if (!r || !r.ok || !r.account) return;
  if (!r.account.claim) await call(storeUrl(s), { action: 'claim', token: s.accountToken, player: me.id, name: me.username || '' }).catch(() => null);
  await saveSettings({ autoClaimedFor: s.accountName });
}

function setupGate() {
  const form = $('signin');
  let mode = 'signin';
  setGateMode = (m) => {
    mode = m;
    document.querySelectorAll('[data-gate-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.gateMode === m)));
    form.querySelectorAll('[data-signup]').forEach((el) => { el.hidden = mode !== 'signup'; el.required = mode === 'signup'; });
    form.querySelector('[data-signin-only]').hidden = mode === 'signup';
    form.elements.password.placeholder = mode === 'signup' ? 'Choose a password (8+ characters)' : 'Password';
    form.elements.username.placeholder = mode === 'signup' ? 'Choose a username' : 'Username';
    $('gate-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('signin-msg').textContent = '';
  };
  document.querySelectorAll('[data-gate-mode]').forEach((b) => b.addEventListener('click', () => setGateMode(b.dataset.gateMode)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    if (mode === 'signup' && f.password.value !== f.confirm.value) { $('signin-msg').textContent = 'The two passwords don\'t match.'; return; }
    const button = $('gate-submit');
    button.disabled = true;
    const s = await getSettings();
    // Creating an account: check the community password (and get the players to pick from), then the setup questions.
    // The account is created when they're answered, so Back (or closing the popup) leaves nothing behind.
    const body = mode === 'signup'
      ? { action: 'read', key: f.community.value }
      : { action: 'signin', username: f.username.value.trim(), password: f.password.value };
    const r = await call(storeUrl(s), body).catch((err) => ({ ok: false, message: err.message }));
    button.disabled = false;
    if (!r.ok) { $('signin-msg').textContent = r.error === 'not-allowed' ? (mode === 'signup' ? 'That community password isn\'t right.' : r.message || 'That password isn\'t right.') : r.message || 'Couldn\'t sign in. Try again in a moment.'; return; }
    if (mode === 'signup') return showSetup({ username: f.username.value.trim(), password: f.password.value, community: f.community.value, games: r.games || [] });
    await saveSettings(signedIn(r));
    form.reset();
    start();
  });
  $('signout').addEventListener('click', async () => { await saveSettings(signedOut()); start(); });
}

async function ping(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'ping' });
}

// Ask a botc.app tab for its status; if the tab has no tracker yet, connect it first.
async function statusOf(tab) {
  try {
    return await ping(tab.id);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/bridge.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/page-hook.js'], world: 'MAIN' });
      await new Promise((r) => setTimeout(r, 1200)); // page-hook looks for the game every 500ms
      return await ping(tab.id);
    } catch (e) {
      return { bridge: false, error: String(e.message || e) };
    }
  }
}

// The status line, which also says where the next game goes (it follows the community picked below it).
let liveTab = null;
function showStatus(community) {
  const live = liveTab;
  if (!live || !live.loggedIn || !live.room) return;
  // Ends with "to:" so it reads on into the community picked just below.
  if (live.inGame) show('rec', `Recording the game in “${live.room}” (${live.nominations} nominations so far)${community ? ' to:' : ', without a community.'}`);
  else show('live', `Connected to “${live.room}”. The next game will be recorded ${community ? 'to:' : 'without a community.'}`);
}

function show(kind, text) {
  $('dot').className = `dot ${kind}`;
  $('status').textContent = text;
}

// "Good won" in a half-width card: shrink both numbers together until it fits, so the two cards stay matched.
function fitStats() {
  const values = [$('games'), $('last')];
  let size = 28;
  values.forEach((v) => { v.style.fontSize = `${size}px`; });
  while (size > 18 && values.some((v) => v.scrollWidth > v.clientWidth)) {
    size -= 1;
    values.forEach((v) => { v.style.fontSize = `${size}px`; });
  }
}

// Show the sign-in, or (signed in) the recording status for the open botc.app tab.
async function start() {
  const gate = await needsSignIn();
  $('gate').hidden = !gate;
  $('setup').hidden = true;
  $('main').hidden = gate;
  document.body.classList.toggle('gate-on', gate);
  if (gate) { $('signin').reset(); setGateMode('signin'); $('signin').elements.username.focus(); return; }
  await showMain();
}

// ---------- setup: creating an account, after the sign-up form ----------
const RATES_HINT = {
  '': 'Choose whether to see other players\' win rates and share your own.',
  show: 'See everyone\'s win rates and share yours.',
  hide: 'You won\'t see anyone\'s win rate, and yours won\'t be visible to others.',
};
let setupRates = '';
// Everyone in these games, by the name they use most (a number added when two share a name).
function playerList(games) {
  const names = new Map();
  for (const g of games) for (const p of g.players || []) {
    const key = p.userId || (p.username ? `name:${p.username.toLowerCase()}` : null);
    if (!key || !p.username) continue;
    const m = names.get(key) || new Map();
    m.set(p.username, (m.get(p.username) || 0) + 1);
    names.set(key, m);
  }
  const list = [...names].map(([key, m]) => ({ key, name: [...m].sort((a, b) => b[1] - a[1])[0][0] }));
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const seen = new Map();
  for (const x of list) { const n = (seen.get(x.name.toLowerCase()) || 0) + 1; seen.set(x.name.toLowerCase(), n); if (n > 1) x.label = `${x.name} (${n})`; }
  return list;
}

// Who's logged in to botc.app in an open tab, to pick them to begin with.
async function botcUser() {
  const tabs = await chrome.tabs.query({ url: 'https://botc.app/*' });
  const results = await Promise.all(tabs.map((t) => ping(t.id).catch(() => null)));
  return (results.map((r) => r && r.status && r.status.me).find(Boolean)) || null;
}

async function showSetup(draft) {
  $('gate').hidden = true;
  $('setup').hidden = false;
  $('setup-msg').textContent = '';
  // Win rates: no answer picked to begin with; Continue waits for one.
  let loaded = false;
  const setRates = (v) => {
    setupRates = v;
    document.querySelectorAll('[data-rates]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rates === v)));
    $('setup-hint').textContent = RATES_HINT[v];
    $('setup-done').disabled = !loaded || !v;
  };
  document.querySelectorAll('[data-rates]').forEach((b) => { b.onclick = () => setRates(b.dataset.rates); });
  setRates('');
  const select = $('setup-player');
  select.innerHTML = '<option value="">Loading players…</option>';
  // Continue also waits for who's on botc.app (picked to begin with), so the answer is never sent half-loaded.
  const list = playerList(draft.games);
  const me = await botcUser();
  loaded = true;
  setRates(setupRates);
  if (me && me.id && !list.some((x) => x.key === me.id)) list.unshift({ key: me.id, name: me.username || me.id, label: `${me.username || me.id} (on botc.app now)` });
  select.innerHTML = `<option value="">${list.length ? 'Choose your player…' : 'No players recorded yet'}</option>`
    + list.map((x) => `<option value="${esc(x.key)}">${esc(x.label || x.name)}</option>`).join('');
  if (me && me.id) select.value = me.id;
  // Back to the form, as it was filled in.
  $('setup-back').onclick = () => { $('setup').hidden = true; $('gate').hidden = false; $('signin-msg').textContent = ''; };
  $('setup-done').onclick = async () => {
    $('setup-done').disabled = true;
    const s = await getSettings();
    const r = await call(storeUrl(s), { action: 'signup', key: draft.community, username: draft.username, password: draft.password }).catch((err) => ({ ok: false, message: err.message }));
    if (!r.ok) {
      // A taken username, say: back to the form to fix it.
      $('setup').hidden = true; $('gate').hidden = false;
      $('signin-msg').textContent = r.error === 'not-allowed' ? 'That community password isn\'t right.' : r.message || 'Couldn\'t create the account. Try again in a moment.';
      return;
    }
    // Then the answers (the account exists now, so they can be fixed on the dashboard if one doesn't go through).
    const token = r.token;
    const pick = list.find((x) => x.key === select.value);
    if (pick) await call(storeUrl(s), { action: 'claim', token, player: pick.key, name: pick.name }).catch(() => null);
    await call(storeUrl(s), { action: 'set-private', token, private: setupRates === 'hide' }).catch(() => null);
    // Having answered, the popup won't claim a botc.app player for you later.
    await saveSettings({ ...signedIn(r), autoClaimedFor: r.account.username });
    $('signin').reset();
    start();
  };
}

// Games recorded here (not counting ones you chose not to record), and who won the last one. A game is saved when it
// ends, before the storyteller's reveal has shown who won, so the result waits until the reveal is over: `revealing`
// holds the games still being revealed in open botc.app tabs (null until the tabs have answered, when a game that
// ended in the last half hour waits too).
let revealingNow = null;
async function showStats(revealing = revealingNow) {
  const { games = {} } = await chrome.storage.local.get('games');
  const list = Object.values(games).filter((g) => !g.skipped).sort((a, b) => b.endedAt - a.endedAt);
  $('games').textContent = list.length;
  $('games-label').textContent = list.length === 1 ? 'Game recorded' : 'Games recorded';
  const last = list[0];
  const wait = last && (revealing ? revealing.has(last.id) : Date.now() - last.endedAt < 30 * 60 * 1000);
  $('last').textContent = !last ? '–' : wait ? (revealing ? 'Revealing…' : '–') : `${last.winner === 'evil' ? 'Evil' : 'Good'} won`;
  fitStats();
  document.fonts.ready.then(fitStats); // again once the serif has loaded (it's wider than the fallback)
}

async function showMain() {
  await showStats();
  await showAccount();
  refreshAccount();

  const tabs = await chrome.tabs.query({ url: 'https://botc.app/*' });
  if (!tabs.length) { revealingNow = new Set(); showStats(); return show('', 'botc.app is not open. Open it to start recording.'); }

  // Prefer the tab you're looking at, then any other botc.app tab that's in a game.
  tabs.sort((a, b) => Number(b.active) - Number(a.active));
  const results = await Promise.all(tabs.map(statusOf));
  const live = results.map((r) => r && r.status).filter((s) => s && s.attached);
  const best = live.find((s) => s.inGame) || live.find((s) => s.room) || live[0];
  revealingNow = new Set(live.filter((s) => s.revealing).map((s) => s.gameId));
  showStats();

  liveTab = best || null;
  if (best && best.me) autoClaim(best.me);
  if (best) {
    if (!best.loggedIn) return show('', 'botc.app is open — log in to record games.');
    if (best.room) { currentRoom = best.room; return showCommunity(best.room); }
    return show('live', 'Connected. Join a room and games will be recorded.');
  }
  if (results.some((r) => r && r.bridge)) {
    return show('err', 'Connected to botc.app, but the game data couldn’t be read. Reload the botc.app tab; if this keeps happening, botc.app may have changed.');
  }
  const err = (results.find((r) => r && r.error) || {}).error || '';
  show('err', `Couldn’t connect to the botc.app tab. Reload it and try again.${err ? ` (${err})` : ''}`);
}

// The dashboard is the community website (signed in for you; see site-sync.js).
$('open').addEventListener('click', () => chrome.tabs.create({ url: SITE_URL || chrome.runtime.getURL('dashboard.html') }));
setupGate();
start();
