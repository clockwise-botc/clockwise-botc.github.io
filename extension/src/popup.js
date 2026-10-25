import { communityConfig, communityForRoom, automaticCommunity, isManual, communityName, NONE } from './communities.js';
import { call } from './shared.js';
import { BACKEND_URL, SITE_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Community buttons: one is on by default (from the room name). Clicking the one that's on switches it
// off, and the game is then recorded without a community.
async function showCommunity(room) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const cfg = communityConfig(settings);
  const current = communityForRoom(settings, room);
  const auto = automaticCommunity(settings, room);
  $('room').textContent = room;
  $('community').innerHTML = cfg.communities
    .map((c) => `<button class="choice" data-community="${esc(c.id)}" aria-pressed="${c.id === current}">${esc(c.name)}</button>`).join('');
  $('community').querySelectorAll('[data-community]').forEach((b) => b.addEventListener('click', () => {
    const wanted = b.dataset.community === current ? null : b.dataset.community;
    // Matching the automatic choice clears the manual one, so the room follows its default again.
    choose(room, wanted === auto ? null : wanted === null ? NONE : wanted);
  }));
  const note = $('community-note');
  const autoName = communityName(settings, auto);
  if (!current) {
    note.innerHTML = `No community selected — games here are recorded without one.${isManual(settings, room) && auto ? ` <button class="linkish" id="reset">Use ${esc(autoName)}</button>` : ''}`;
  } else if (isManual(settings, room)) {
    note.innerHTML = `Set by you${auto ? ` (automatic: ${esc(autoName)})` : ''}. <button class="linkish" id="reset">Use automatic</button>`;
  } else {
    note.textContent = `Chosen automatically from the room name. Click it to switch it off, or pick ${cfg.communities.length > 2 ? 'another' : 'the other'} community.`;
  }
  const chosen = cfg.communities.find((c) => c.id === current);
  if (chosen && chosen.own) note.insertAdjacentHTML('beforeend', ' Only the people who recorded games here will see them.');
  const reset = $('reset');
  if (reset) reset.addEventListener('click', () => choose(room, null));
  $('community-box').hidden = false;
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
    const body = mode === 'signup'
      ? { action: 'signup', key: f.community.value, username: f.username.value.trim(), password: f.password.value }
      : { action: 'signin', username: f.username.value.trim(), password: f.password.value };
    const r = await call(storeUrl(s), body).catch((err) => ({ ok: false, message: err.message }));
    button.disabled = false;
    if (!r.ok) { $('signin-msg').textContent = r.error === 'not-allowed' ? 'That community password isn\'t right.' : r.message || 'Couldn\'t sign in. Try again in a moment.'; return; }
    await saveSettings(signedIn(r));
    form.reset();
    start();
  });
  $('signout').addEventListener('click', async () => { await saveSettings(signedOut()); start(); });
}

async function choose(room, choice) {
  await chrome.runtime.sendMessage({ type: 'community:set', room, choice });
  await showCommunity(room);
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

function show(kind, text) {
  $('dot').className = `dot ${kind}`;
  $('status').textContent = text;
}

// Show the sign-in, or (signed in) the recording status for the open botc.app tab.
async function start() {
  const gate = await needsSignIn();
  $('gate').hidden = !gate;
  $('main').hidden = gate;
  if (gate) { $('signin').reset(); setGateMode('signin'); $('signin').elements.username.focus(); return; }
  await showMain();
}

async function showMain() {
  const { games = {} } = await chrome.storage.local.get('games');
  const list = Object.values(games).sort((a, b) => b.endedAt - a.endedAt);
  $('games').textContent = list.length;
  $('games-label').textContent = list.length === 1 ? 'game recorded' : 'games recorded';
  $('last').textContent = list[0] ? `${list[0].winner === 'evil' ? 'Evil' : 'Good'} won` : '–';
  await showAccount();
  refreshAccount();

  const tabs = await chrome.tabs.query({ url: 'https://botc.app/*' });
  if (!tabs.length) return show('', 'botc.app is not open. Open it to start recording.');

  // Prefer the tab you're looking at, then any other botc.app tab that's in a game.
  tabs.sort((a, b) => Number(b.active) - Number(a.active));
  const results = await Promise.all(tabs.map(statusOf));
  const live = results.map((r) => r && r.status).filter((s) => s && s.attached);
  const best = live.find((s) => s.inGame) || live.find((s) => s.room) || live[0];

  if (best && best.room) { currentRoom = best.room; await showCommunity(best.room); }

  if (best) {
    if (!best.loggedIn) return show('', 'botc.app is open — log in to record games.');
    if (best.inGame) return show('rec', `Recording game in “${best.room}” (${best.nominations} nominations so far).`);
    if (best.room) return show('live', `Connected to “${best.room}”. The next game will be recorded.`);
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
