import { communityConfig, communityForRoom, automaticCommunity, isManual, communityName, NONE } from './communities.js';

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
    note.textContent = 'Chosen automatically from the room name. Click it to switch it off, or pick the other community.';
  }
  const reset = $('reset');
  if (reset) reset.addEventListener('click', () => choose(room, null));
  $('community-box').hidden = false;
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

(async () => {
  const { games = {} } = await chrome.storage.local.get('games');
  const list = Object.values(games).sort((a, b) => b.endedAt - a.endedAt);
  $('games').textContent = list.length;
  $('games-label').textContent = list.length === 1 ? 'game recorded' : 'games recorded';
  $('last').textContent = list[0] ? `${list[0].winner === 'evil' ? 'Evil' : 'Good'} won` : '–';
  $('open').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));

  const tabs = await chrome.tabs.query({ url: 'https://botc.app/*' });
  if (!tabs.length) return show('', 'botc.app is not open. Open it to start recording.');

  // Prefer the tab you're looking at, then any other botc.app tab that's in a game.
  tabs.sort((a, b) => Number(b.active) - Number(a.active));
  const results = await Promise.all(tabs.map(statusOf));
  const live = results.map((r) => r && r.status).filter((s) => s && s.attached);
  const best = live.find((s) => s.inGame) || live.find((s) => s.room) || live[0];

  if (best && best.room) await showCommunity(best.room);

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
})();
