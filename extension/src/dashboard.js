import { filterGames, overview, distinct, playerKey, displayNames, useDisplayNames, storytellerKeys } from './stats.js';
import { predictOutcome, tuneOutcomeModel } from './insights.js';
import { TYPES, emptySelection, hasSelection, selectGames, holds, focusSeats, outcome, seatStats, characterTable, companions, countEffect, relations, groupRelations, nominationStats, playerTable } from './insights.js';
import { communityConfig, communityName, gameCommunity, NONE } from './communities.js';
import { esc, pct, cap, plural, fmtDate, fmtTime, phaseLabel, teamLabel, teamOne, asType, isEvilTeam, playerLink, charLink, typeLink, rateCell, delta, splitBars, legendGE, tile, card, table, pie, rings, rangeBar } from './ui.js';
import { renderData, handleDataClick, handleImport } from './dataview.js';
import { renderGrimoire } from './grimoire.js';
import { makeImages } from './images.js';
import { characterToken, installTokenStyle } from './tokens.js';
import { multiSelect } from './multiselect.js';
import { WEB, hasChrome, kv, creds, siteUrl, loadShared, refreshShared, mergeGames, checkKey, sharedEdit, sharedDelete, webAuth, cacheClear, canReadWith, signUp, signIn, whoAmI, changePassword, listAccounts, resetPassword, deleteAccount, claimPlayer, unclaimPlayer, removeClaim } from './data.js';

// ---------- storage adapter (chrome.storage in the extension; localStorage on the website) ----------
const api = {
  get: kv.get,
  set: kv.set,
  async send(msg) {
    if (!hasChrome) return { ok: false, error: 'Not running inside the extension' };
    return chrome.runtime.sendMessage(msg);
  },
};

// ---------- state ----------
const TABS = ['stats', 'games', 'data'];
const prefs = (() => { try { return JSON.parse(localStorage.getItem('dash.prefs')) || {}; } catch { return {}; } })();
const state = {
  tab: readTab(),
  filters: { communities: Array.isArray(prefs.communities) ? prefs.communities : [], script: '', storyteller: '', days: '' },
  sel: readHash(),
  expanded: new Set(),
  sorts: {},
  gamesShown: 15,
  openGame: null,
  gameView: 'seats', // seat-by-seat table or nominations, under an open game's grimoire
  gameMenu: false, // the ••• game settings panel
  games: [],
  settings: {},
  // Shared games: is a shared store set up, can we read it (password), can we change it (editor key)?
  shared: { on: false, hasPassword: false, canEdit: true, status: null, cacheAt: null, account: null },
  profile: undefined, // the signed-in account as the store has it (e.g. their claimed player); undefined until checked
  claimPick: null, // the player picked in "Your player" before pressing Claim
  signin: { mode: 'signin', open: false }, // the website's sign-in screen: which form, and whether shown on request
};
const savePrefs = () => { try { localStorage.setItem('dash.prefs', JSON.stringify({ communities: state.filters.communities })); } catch {} };
const communityOptions = () => communityConfig(state.settings).communities.map((c) => ({ value: c.id, name: c.name }));
// On/off buttons for picking communities; `on` is the list of ids that are switched on.
const communityButtons = (attr, on, extra = '') => communityOptions().map((o) => `<button class="toggle" ${attr}="${esc(extra + o.value)}" aria-pressed="${on.includes(o.value)}">${esc(o.name)}</button>`).join('');
const $ = (sel) => document.querySelector(sel);
const ctx = { state, api, load: () => load(), communityOptions,
  tools: { WEB, creds, siteUrl, checkKey, webAuth, cacheClear, syncShared: () => syncShared(), nameOf: (key, fallback) => (playerNames.has(key) ? playerNames.get(key) : fallback || key), playerChoices: () => playerChoices() },
  // For Data & settings: is botc.app's token art in use, and if not, why.
  art: () => ({ loaded: !!images.tokenStyle, fonts: document.documentElement.classList.contains('token-font'), roles: Object.keys(roleMeta).length, error: state.artError || (images.styleError || '') }) };

// The tab and selection live in the URL, so a view can be bookmarked and survives a refresh.
function readTab() {
  const t = new URLSearchParams(location.hash.slice(1)).get('tab');
  return TABS.includes(t) ? t : 'stats';
}
function readHash() {
  const sel = emptySelection();
  const params = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(sel)) sel[k] = (params.get(k) || '').split(',').filter(Boolean);
  return sel;
}
function writeHash() {
  const params = new URLSearchParams();
  if (state.tab !== 'stats') params.set('tab', state.tab);
  for (const [k, v] of Object.entries(state.sel)) if (v.length) params.set(k, v.join(','));
  history.replaceState(null, '', params.toString() ? `#${params}` : location.pathname);
}

// ---------- lookups ----------
let playerNames = new Map(); // account → the name shown (their most-used), for players and storytellers
let playerKeys = new Set(); // accounts that have played (not only storytold)
let images = makeImages(null);
let artAsked = false;
let roleMeta = {}; // per character: [first night, other nights, reminders, setup, edition], from botc.app
let charInfo = new Map();
const nameOf = (key) => playerNames.get(key) || key;
// Everyone who has played, for "Your player": [{ key, name }] by name, with a number added when two share a name.
function playerChoices() {
  const list = [...playerKeys].map((key) => ({ key, name: nameOf(key) })).filter((x) => x.name);
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const seen = new Map();
  for (const x of list) { const n = (seen.get(x.name.toLowerCase()) || 0) + 1; seen.set(x.name.toLowerCase(), n); if (n > 1) x.name = `${x.name} (${n})`; }
  return list;
}
const charName = (id) => (charInfo.get(id) || {}).name || id;
// "the Scarlet Woman", "the Scarlet Woman or the Imp"
const asChars = (ids) => { const w = ids.map((id) => `the ${charName(id)}`); return w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`; };
const listWords = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// Excluded games are left out of the stats but still listed (dimmed) on the Games tab, so they can be un-excluded.
function baseGames() {
  return filterGames(state.games, { ...state.filters, days: Number(state.filters.days) || 0, includeExcluded: state.tab === 'games' });
}

// ---------- sections ----------
// ---------- overall view (nothing selected) ----------
function balanceCard(o) {
  const g = o.goodRate;
  const verdict = g === null ? '' : Math.abs(g - 0.5) <= 0.05 ? 'Games look balanced between both teams.' : g > 0.5 ? 'Good has had the edge.' : 'Evil has had the edge.';
  const small = o.games < 10 ? ` (only ${plural(o.games, 'game')} so far)` : '';
  // Round once so the two labels always add up to 100%.
  const gp = Math.round((o.good / o.games) * 100), ep = 100 - gp;
  const chart = pie([
    { label: 'Good won', value: o.good, color: 'var(--good)', chip: `${gp}%`, tip: `Good won ${o.good} of ${plural(o.games, 'game')} (${gp}%)` },
    { label: 'Evil won', value: o.evil, color: 'var(--evil)', chip: `${ep}%`, tip: `Evil won ${o.evil} of ${plural(o.games, 'game')} (${ep}%)` },
  ], { ariaLabel: `Good won ${gp}%, evil won ${ep}%` });
  return `<div class="card pie-card"><h3>Game balance</h3>${legendGE()}<div class="pie-wrap">${chart}</div><p class="pie-caption">${verdict}${small}</p></div>`;
}

// Player counts as an ordinal pie: one violet hue, lighter = fewer players. The validated ramp has
// 8 steps, so more than 8 different table sizes are paired up ("13–14p").
function playerCountCard(base) {
  const counts = new Map();
  for (const g of base) counts.set(g.playerCount, (counts.get(g.playerCount) || 0) + 1);
  const sizes = [...counts.keys()].sort((a, b) => a - b);
  let buckets = sizes.map((n) => ({ from: n, to: n, games: counts.get(n) }));
  if (buckets.length > 8) {
    const lo = sizes[0], m = new Map();
    for (const n of sizes) { const k = Math.floor((n - lo) / 2); const b = m.get(k) || { from: n, to: n, games: 0 }; b.to = n; b.games += counts.get(n); m.set(k, b); }
    buckets = [...m.values()];
  }
  const step = (i) => (buckets.length === 1 ? 4 : Math.round((i * 7) / (buckets.length - 1)));
  const label = (b) => (b.from === b.to ? `${b.from}p` : `${b.from}–${b.to}p`);
  const slices = buckets.map((b, i) => ({ label: label(b), value: b.games, color: `var(--pc-${step(i)})`, chip: label(b),
    tip: `${b.from === b.to ? b.from : `${b.from}–${b.to}`} players: ${plural(b.games, 'game')} (${pct(b.games / base.length)})` }));
  const legend = `<div class="legend wrap">${buckets.map((b, i) => `<span><i class="pc" style="background:var(--pc-${step(i)})"></i>${label(b)} · ${b.games}</span>`).join('')}</div>`;
  return `<div class="card pie-card"><h3>Player count</h3><p class="sub">How many players sat down (not counting travellers).</p><div class="pie-wrap">${pie(slices, { minLabel: 0.06, ariaLabel: 'Games by player count' })}</div>${legend}</div>`;
}

function frequencyCard(title, sub, rows, linkFn) {
  const max = Math.max(1, ...rows.map((r) => r.games));
  const body = rows.length ? `<table><tbody>${rows.map((r) => `<tr><td>${linkFn(r)}</td><td class="num">${plural(r.games, 'game')}</td><td style="width:40%"><div class="freq-bar" data-tip="${esc(`${r.name}: ${plural(r.games, 'game')}`)}"><i style="width:${(r.games / max) * 100}%"></i></div></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not recorded yet.</p>';
  return card(title, sub, body);
}

function storytellerTable(games) {
  const m = new Map();
  for (const g of games) for (const s of g.storytellers) {
    const key = playerKey(s);
    if (!key) continue;
    const r = m.get(key) || { key, name: nameOf(key), games: 0 };
    r.games++;
    m.set(key, r);
  }
  return [...m.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

// One gentle highlight rather than a ranking: the best record among players with a fair number of games.
function topWinRate(base) {
  const min = Math.max(5, Math.ceil(base.length * 0.1));
  return playerTable(base).filter((p) => p.plays >= min).sort((a, b) => b.winRate - a.winRate || b.plays - a.plays)[0] || null;
}

// "Characters that help good / evil": how often good wins when each is in play, against all games in the filters.
// `what` names the characters ("Characters", "Outsiders"); `keep` narrows them, e.g. to one type.
function swingCards(base, what, keep = () => true) {
  const o = outcome(base);
  const chars = characterTable(base, o.goodRate).filter((c) => c.games >= 3 && keep(c));
  const forGood = chars.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta);
  const forEvil = chars.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta);
  const cols = [colChar(), colNum('Games', (c) => c.games), colRate('Good won', (c) => c.goodRate, (c) => c.games, 'neutral', 'Good won')];
  const id = what === 'Characters' ? '' : `-${what.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return `${card(`${what} that help good`, `Good wins more often when these are in play (overall: ${pct(o.goodRate)}). At least 3 games each.`,
      sortable(`swing-good${id}`, [...cols, colDelta('vs. overall', (c) => c.delta)], forGood, { sort: 3, limit: 6, empty: 'Not enough games yet.' }))}
    ${card(`${what} that help evil`, 'Evil wins more often when these are in play.',
      sortable(`swing-evil${id}`, [...cols, { ...colDelta('vs. overall', (c) => -c.delta), cell: (r) => td(delta(r.delta), true) }], forEvil, { sort: 3, limit: 6, empty: 'Not enough games yet.' }))}`;
}

// ---------- one storyteller picked: their games next to everyone else's ----------
// Games by other storytellers under the same filters (script, community, period).
function otherStorytellerGames(st) {
  return filterGames(state.games, { ...state.filters, storyteller: '', days: Number(state.filters.days) || 0 })
    .filter((g) => !storytellerKeys(g).includes(st));
}

function storytellerCompareCard(st, mine, others) {
  const avg = (games, f) => (games.length ? games.reduce((n, g) => n + f(g), 0) / games.length : null);
  const one = (v, unit) => (v === null ? '–' : `${v.toFixed(1)}${unit}`);
  const rows = [
    ['Good won', (g) => (g.winner === 'good' ? 1 : 0), (v) => pct(v)],
    ['Game length', (g) => g.days || 0, (v) => one(v, ' days')],
    ['Deaths per game', (g) => g.deaths.length, (v) => one(v, '')],
    ['Nominations per game', (g) => g.nominations.length, (v) => one(v, '')],
  ];
  const tiles = rows.map(([label, f, fmt]) => {
    const a = avg(mine, f), b = avg(others, f);
    return `<div data-tip="${esc(`${label}: ${fmt(a)} in ${st}'s games, ${fmt(b)} in other storytellers' games`)}"><b>${fmt(a)}</b><span>${label}</span><span class="muted">${others.length ? `others: ${fmt(b)}` : 'no other games to compare'}</span></div>`;
  }).join('');
  return card(`How ${esc(st)}'s games compare`, `${esc(st)}'s ${plural(mine.length, 'game')} next to ${plural(others.length, 'game')} run by other storytellers, under the same filters.`, `<div class="mini-tiles">${tiles}</div>`);
}

function storytellerCharactersCard(st, mine, others) {
  // Characters dealt out at the start (travellers are the players' choice, so they're left out).
  const dealt = (g) => {
    const out = new Map();
    for (const p of g.players) {
      const id = p.startingRoleId || p.roleId;
      if (id && p.team !== 'traveller' && !out.has(id)) out.set(id, { roleId: id, name: (p.startingRoleId && p.startingRoleName) || p.roleName, team: p.team });
    }
    return out;
  };
  // A script decides which characters can appear at all, so each of their games is compared with
  // other storytellers' games on the same script. Games on scripts nobody else ran can't be compared.
  const scriptOf = (g) => g.script.name || 'Unknown script';
  const othersBy = new Map();
  for (const g of others) {
    const r = othersBy.get(scriptOf(g)) || { games: 0, counts: new Map() };
    r.games++;
    for (const id of dealt(g).keys()) r.counts.set(id, (r.counts.get(id) || 0) + 1);
    othersBy.set(scriptOf(g), r);
  }
  const comparable = mine.filter((g) => othersBy.has(scriptOf(g)));
  const games = comparable.length ? comparable : mine;
  const m = new Map();
  for (const g of games) {
    const ref = othersBy.get(scriptOf(g));
    const here = dealt(g);
    // Expected share: how often other storytellers had this character in play on this game's script.
    const ids = new Set([...here.keys(), ...(ref ? ref.counts.keys() : [])]);
    for (const id of ids) {
      const r = m.get(id) || { roleId: id, name: null, team: null, games: 0, expected: 0 };
      if (here.has(id)) { r.games++; Object.assign(r, { name: here.get(id).name, team: here.get(id).team }); }
      if (ref) r.expected += (ref.counts.get(id) || 0) / ref.games;
      m.set(id, r);
    }
  }
  const rows = [...m.values()].filter((r) => r.games).map((r) => {
    const share = r.games / games.length;
    const otherShare = comparable.length ? r.expected / games.length : null;
    return { ...r, share, otherShare, diff: otherShare === null ? null : share - otherShare };
  });
  const share = (label, get, tip) => ({ label, num: true, value: get, cell: (r) => `<td class="num" data-tip="${esc(tip(r))}">${pct(get(r))}</td>` });
  const cols = [colChar(),
    share('Theirs', (r) => r.share, (r) => `In play in ${r.games} of ${esc(st)}'s ${plural(games.length, 'game')}`),
    share('Others', (r) => r.otherShare, () => 'Other storytellers, same scripts'),
    colDelta('Difference', (r) => r.diff)];
  const note = !comparable.length
    ? 'No other storyteller ran the same scripts yet, so this shows how often each is in play.'
    : `Compared with other storytellers' games on the same scripts${comparable.length < mine.length ? ` (${comparable.length} of ${esc(st)}'s ${plural(mine.length, 'game')} are on scripts others also ran)` : ''}. Biggest difference first.`;
  return card(`${esc(st)}'s favourite characters`, `How often each character is in play in ${esc(st)}'s games. ${note}`,
    sortable('st-chars', cols, rows, { sort: comparable.length ? 3 : 1, limit: 8, empty: 'No characters recorded yet.' }));
}

function overallSections(base) {
  const o = overview(base);
  const frequent = playerTable(base).map((p) => ({ key: p.key, name: p.name, games: p.plays })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)).slice(0, 5);
  const sts = storytellerTable(base).slice(0, 5);
  // With one storyteller picked, the storyteller cards would only repeat them; compare them with the others instead.
  const st = state.filters.storyteller;
  const others = st ? otherStorytellerGames(st) : [];
  return `
  <div class="grid two">
    ${balanceCard(o)}
    ${playerCountCard(base)}
    ${frequencyCard('Most frequent players', 'Who has played the most games. Click a name to see their stats.', frequent, (r) => playerLink(r.key, r.name))}
    ${st ? storytellerCompareCard(nameOf(st), base, others) : frequencyCard('Most frequent storytellers', 'Who has run the most games.', sts, (r) => (playerKeys.has(r.key) ? playerLink(r.key, r.name) : esc(r.name)))}
    ${card('Who wins, by script', '', legendGE() + splitBars(o.byScript, (r) => esc(r.key)))}
    ${card('Who wins, by player count', '', legendGE() + splitBars(o.byPlayerCount, (r) => `${r.key} players`))}
    ${st ? storytellerCharactersCard(nameOf(st), base, others) : card('Who wins, by storyteller', '', legendGE() + splitBars(o.byStoryteller.slice(0, 10), (r) => esc(r.name)))}
    ${swingCards(base, 'Characters')}
  </div>`;
}

// Sortable table: click a column label to sort by it (▼); click it again to flip the order (▲).
// "▼" is the natural order for that column: biggest first for numbers, A→Z for names.
// cols: [{ label, value: (row) => sort value, cell: (row) => '<td>…</td>', num }]
const td = (html, num) => `<td${num ? ' class="num"' : ''}>${html}</td>`;
// sort: null keeps the rows in the order given (e.g. most played first, without a Plays column) until a label is clicked.
function sortable(id, cols, data, { sort = 0, limit = 8, empty } = {}) {
  const cur = state.sorts[id] && cols[state.sorts[id].col] ? state.sorts[id] : { col: sort === null ? -1 : sort, rev: false };
  const col = cols[cur.col] || { value: () => 0 };
  const missing = (v) => v === null || v === undefined || Number.isNaN(v);
  const rows = data.map((r, i) => ({ r, i, v: col.value(r) })).sort((a, b) => {
    if (missing(a.v) || missing(b.v)) return missing(a.v) - missing(b.v) || a.i - b.i;
    let d = typeof a.v === 'string' ? a.v.localeCompare(b.v) : b.v - a.v;
    if (cur.rev) d = -d;
    return d || a.i - b.i;
  });
  const isText = cur.col >= 0 && rows.length && typeof rows[0].v === 'string';
  const head = cols.map((c, i) => {
    const on = i === cur.col;
    const order = on ? ((isText !== cur.rev) ? 'ascending' : 'descending') : 'none';
    return `<th class="sortable${c.num ? ' num' : ''}${on ? ' sorted' : ''}" data-sort-table="${esc(id)}" data-sort-col="${i}" aria-sort="${order}" title="Sort by ${esc(c.label)}">${c.label}<span class="arrow" aria-hidden="true">${on ? (cur.rev ? '▲' : '▼') : '▼'}</span></th>`;
  }).join('');
  return table(id, head, rows.map(({ r }) => `<tr>${cols.map((c) => c.cell(r)).join('')}</tr>`), { limit, expanded: state.expanded.has(id), empty });
}

// Reusable columns.
const colChar = (label = 'Character') => ({ label, value: (c) => c.name || '', cell: (c) => td(charLink(c.roleId, c.name)) });
const colPlayer = (label = 'Player') => ({ label, value: (p) => p.name || '', cell: (p) => td(playerLink(p.key, p.name)) });
const colNum = (label, get) => ({ label, num: true, value: get, cell: (r) => td(get(r), true) });
const colRate = (label, get, n, cls, tip) => ({ label, value: get, cell: (r) => td(rateCell(get(r), n(r), typeof cls === 'function' ? cls(r) : cls, tip)) });
// The gap between two rates as shown (both rounded), so "▲ +1 pts vs. 46%" never sits next to a 46%.
const gap = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : (Math.round(a * 100) - Math.round(b * 100)) / 100);
const colDelta = (label, get) => ({ label, num: true, value: get, cell: (r) => td(delta(get(r)), true) });
const charCls = (c) => (isEvilTeam(c.team) ? 'evil' : c.team === 'traveller' ? 'neutral' : 'good');

function rateRows(rows) {
  return `<table class="rows"><tbody>${rows.map(([label, r, n, cls]) => `<tr><td>${label}</td><td class="num muted">${n === undefined ? '' : plural(n, 'game')}</td><td>${rateCell(r, n, cls)}</td></tr>`).join('')}</tbody></table>`;
}

function deathBars(timing, total) {
  const max = Math.max(...timing.map((t) => t.n), 1);
  return `<div class="bars">${timing.map((t) => `<div class="bar-row" data-tip="${esc(`${t.when === 'survived' ? 'Survived to the end' : t.when === 'unknown' ? 'Died, time not recorded' : t.when}: ${t.n} of ${total}`)}">
    <span>${t.when === 'survived' ? 'Survived' : t.when === 'unknown' ? 'Time unknown' : esc(t.when)}</span><div class="bar"><i class="${t.when === 'survived' ? 'alive' : ''}" style="width:${(t.n / max) * 100}%"></i></div><b>${pct(t.n / total)}</b></div>`).join('')}</div>`;
}

function seatsLabel(sel) {
  const who = sel.players.length ? listWords(sel.players.map(nameOf)) : '';
  const as = sel.types.length ? (who ? asType(sel.types) : listWords(sel.types.map(teamLabel))) : '';
  if (who && as) return `${who} as ${as}`;
  return who || as;
}

// ---------- single player: top row ----------
// "The average player" = everyone else's results in the same filtered games, pooled by alignment.
function othersRates(base, key) {
  const r = { good: { plays: 0, wins: 0 }, evil: { plays: 0, wins: 0 } };
  let games = 0;
  for (const g of base) {
    let counted = false;
    for (const p of g.players) {
      if (playerKey(p) === key || !r[p.alignment] || p.won === null || p.won === undefined) continue;
      r[p.alignment].plays++;
      if (p.won) r[p.alignment].wins++;
      counted = true;
    }
    if (counted) games++;
  }
  const all = { plays: r.good.plays + r.evil.plays, wins: r.good.wins + r.evil.wins };
  const rate = (x) => (x.plays ? x.wins / x.plays : null);
  return { good: rate(r.good), evil: rate(r.evil), overall: rate(all), counts: { good: r.good, evil: r.evil, overall: all }, games };
}

// One key row per ring: its colour and name, and how it compares with the average player.
// The ring itself shows the rate; hovering the row shows what the average is based on.
function keyRow(cls, label, rate, avg, basis, games) {
  let vs;
  if (rate === null) vs = '<span class="muted">No games yet</span>';
  else if (avg === null || avg === undefined) vs = '<span class="muted">No average yet</span>';
  else {
    const d = Math.round(gap(rate, avg) * 100);
    vs = `${d === 0 ? 'Same as' : `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts</span> vs.`} ${pct(avg)} avg`;
  }
  const side = cls === 'neutral' ? '' : ` as ${cls}`;
  const tip = basis && basis.plays ? `Average: other players won ${basis.wins} of ${basis.plays} times${side} across ${plural(games, 'game')} in your filters.` : '';
  return `<li${tip ? ` data-tip="${esc(tip)}"` : ''}><i class="sw ${cls}"></i><span class="k">${label}</span><span class="vs">${vs}</span></li>`;
}

function tokenCard(title, info, c, text) {
  const head = `<h3>${title}${info ? ` <span class="info" data-tip="${esc(info)}" aria-label="${esc(info)}">ⓘ</span>` : ''}</h3>`;
  if (!c) return `<div class="card token-card">${head}<div class="tok-body"><div class="ctok empty"></div><p class="muted">No eligible character.</p></div></div>`;
  const icon = images.character(c.roleId, c.team, null, null);
  return `<div class="card token-card">${head}<div class="tok-body">${characterToken({ id: c.roleId, name: c.name, team: c.team, icon, fallback: images.fallback(c.roleId, icon), meta: roleMeta[c.roleId] })}<p>${text}</p></div></div>`;
}

// Concentric win-rate chart (good outer, evil middle, overall centre) with a comparison to the average player.
function winCard(st, avg, title = 'Win rate', sub = '') {
  const chart = rings([
    { label: 'As good', rate: st.goodWinRate, color: 'var(--good)', tip: `As good: won ${st.good.wins} of ${plural(st.good.plays, 'game')}` },
    { label: 'As evil', rate: st.evilWinRate, color: 'var(--evil)', tip: `As evil: won ${st.evil.wins} of ${plural(st.evil.plays, 'game')}` },
    { label: 'Overall', rate: st.winRate, color: 'var(--neutral)', tip: `Overall: won ${st.wins} of ${plural(st.plays, 'game')}` },
  ], { ariaLabel: `Win rate as good ${pct(st.goodWinRate)}, as evil ${pct(st.evilWinRate)}, overall ${pct(st.winRate)}` });
  const key = `<ul class="ring-key">
    ${keyRow('good', 'Good', st.goodWinRate, avg.good, avg.counts.good, avg.games)}
    ${keyRow('evil', 'Evil', st.evilWinRate, avg.evil, avg.counts.evil, avg.games)}
    ${keyRow('neutral', 'Overall', st.winRate, avg.overall, avg.counts.overall, avg.games)}
  </ul>`;
  return `<div class="card pie-card"><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="pie-wrap">${chart}</div>${key}</div>`;
}

function playerHero(base, key, st) {
  const win = winCard(st, othersRates(base, key));

  // Best/worst need at least 2 plays, so one lucky (or unlucky) game doesn't decide it.
  const chars = st.byCharacter;
  const most = chars[0] || null;
  const eligible = chars.filter((c) => c.plays >= 2);
  const best = [...eligible].sort((a, b) => b.winRate - a.winRate || b.plays - a.plays)[0] || null;
  const worstPick = [...eligible].sort((a, b) => a.winRate - b.winRate || b.plays - a.plays)[0] || null;
  const worst = eligible.length >= 2 && worstPick !== best ? worstPick : null;
  const rule = 'Win rate among characters they have played at least twice.';
  return `<div class="span-all"><div class="grid four">
    ${win}
    ${tokenCard('Most played', '', most, most ? `Played the ${esc(most.name)} in ${plural(most.plays, 'game')}.` : '')}
    ${tokenCard('Best performing', rule, best, best ? `Won ${best.wins} of ${plural(best.plays, 'game')} as the ${esc(best.name)} (${pct(best.winRate)}).` : '')}
    ${tokenCard('Worst performing', `${rule} Needs at least two such characters.`, worst, worst ? `Won ${worst.wins} of ${plural(worst.plays, 'game')} as the ${esc(worst.name)} (${pct(worst.winRate)}).` : '')}
  </div></div>`;
}

// ---------- players + characters or types: how they do when they hold those ----------
// What the picked players held: characters ("the Scarlet Woman"), types ("Townsfolk", "a Demon"), or both.
function heldRole(sel) {
  const chars = sel.characters, types = sel.types;
  const goodTypes = ['townsfolk', 'outsider'], evilTypes = ['minion', 'demon'];
  return {
    test: (p) => (!chars.length || holds(p, chars)) && (!types.length || types.includes(p.team)),
    as: chars.length ? asChars(chars) : asType(types),
    byType: !chars.length,
    many: chars.length > 1 || !chars.length,
    cls: !chars.length && types.every((t) => goodTypes.includes(t)) ? 'good' : !chars.length && types.every((t) => evilTypes.includes(t)) ? 'evil' : null,
  };
}

function heldSections(G, sel, seats, base) {
  const role = heldRole(sel), as = esc(role.as);
  const picked = new Set(sel.players);
  const st = seatStats(seats);
  const out = [];
  // Other players who held the same, in the same filtered games.
  const others = [];
  for (const g of base) for (const p of g.players) if (role.test(p) && !picked.has(playerKey(p))) others.push({ g, p });
  const os = seatStats(others);
  if (sel.players.length === 1) {
    const key = sel.players[0], name = esc(nameOf(key));
    const all = [], otherwise = [];
    for (const g of base) {
      const me = g.players.find((p) => playerKey(p) === key);
      if (!me) continue;
      all.push({ g, p: me });
      // A character: games where someone else had it. A type: their games as any other type.
      if (role.byType ? !role.test(me) : !role.test(me) && g.players.some((p) => p !== me && role.test(p))) otherwise.push({ g, p: me });
    }
    const allSt = seatStats(all), ow = seatStats(otherwise);
    const rows = [
      [`As ${as}`, st.winRate, st.plays, role.cls || charCls(seats[0].p)],
      [`Other players as ${as}`, os.winRate, os.plays, 'neutral'],
      [role.byType ? `As any other type` : `When another player was ${as}`, ow.winRate, ow.plays, 'neutral'],
      [`All ${name}'s games`, allSt.winRate, allSt.plays, 'neutral'],
    ].filter((r) => r[2] > 0);
    out.push(card(`How ${name} does as ${as}`, `${name}'s win rate as ${as}, next to other players as ${as} and ${name}'s other games.`, rateRows(rows)));
    out.push(card(`When ${name} dies as ${as}`, `Survived to the end in ${pct(st.survivalRate)} of these games${os.plays ? `, against ${pct(os.survivalRate)} for other players as ${as}` : ''}.`, deathBars(st.deathTiming, st.plays)));
    if (role.many) {
      out.push(card(role.byType ? `Characters played as ${as}` : 'Character by character', `Click a character to see how ${name} does with it. Click a column to sort.`,
        sortable('held-chars', [colChar(), colNum('Plays', (c) => c.plays), colRate('Win rate', (c) => c.winRate, (c) => c.plays, charCls)], st.byCharacter, { sort: 1, limit: 8 })));
    }
    const noms = nominationStats(G, [key]);
    out.push(card(`Nominations and votes as ${as}`, `From recorded nominations in these games.`, `<div class="mini-tiles">
      <div><b>${noms.made}</b><span>nominations made</span></div>
      <div><b>${pct(noms.accuracy)}</b><span>of their nominations were on evil players</span></div>
      <div><b>${noms.received}</b><span>times nominated</span></div>
      <div><b>${noms.executed}</b><span>times executed</span></div>
      <div><b>${noms.votes}</b><span>votes cast</span></div>
      <div><b>${pct(noms.voteAccuracy)}</b><span>of their votes were on evil players</span></div></div>`));
    // Which Demon was in the game. When they were the Demon themselves, split by script instead.
    const vs = new Map(), byScript = new Map();
    const bump = (m, k, init, won) => { const r = m.get(k) || init(); r.plays++; if (won) r.wins++; m.set(k, r); };
    for (const { g, p } of seats) {
      if (p.team === 'demon') { bump(byScript, g.script.name || 'Unknown script', () => ({ key: g.script.name || 'Unknown script', plays: 0, wins: 0 }), p.won); continue; }
      const demons = new Map(g.players.filter((x) => x !== p && x.team === 'demon' && x.roleId).map((x) => [x.roleId, x.roleName]));
      for (const [rid, rname] of demons) bump(vs, rid, () => ({ roleId: rid, name: rname, team: 'demon', plays: 0, wins: 0 }), p.won);
    }
    const demonRows = [...vs.values()].map((r) => ({ ...r, winRate: r.wins / r.plays }));
    if (demonRows.length) {
      // Named for the side they were on in these games: facing the Demon, or on its team.
      const sideOf = seats.every((x) => x.p.alignment === 'good') ? 'good' : seats.every((x) => x.p.alignment === 'evil') ? 'evil' : null;
      const side = sideOf === 'good' ? 'Against each Demon' : sideOf === 'evil' ? 'With each Demon' : 'By Demon in play';
      out.push(card(side, `${name}'s win rate as ${as}, by which Demon was in the game. Click a column to sort.`,
        sortable('held-demons', [{ label: 'Demon', value: (r) => r.name || '', cell: (r) => td(esc(r.name || 'Unknown')) }, colNum('Games', (r) => r.plays), colRate('Win rate', (r) => r.winRate, (r) => r.plays, sideOf || 'neutral')], demonRows, { sort: 1, limit: 8 })));
    }
    if (byScript.size > 1) {
      out.push(card('By script', `${name}'s win rate as ${as} on each script.`, rateRows([...byScript.values()].sort((x, y) => y.plays - x.plays).map((r) => [esc(r.key), r.wins / r.plays, r.plays, 'evil']))));
    }
  } else {
    const names = sel.players.map(nameOf);
    out.push(card(`How they do as ${as}`, `Games where ${esc(listWords(names))} were each ${as}.`, rateRows([
      ...sel.players.map((k) => { const s2 = seatStats(seats.filter((x) => playerKey(x.p) === k)); return [playerLink(k, nameOf(k)), s2.winRate, s2.plays, 'neutral']; }),
      [`Other players as ${as}`, os.winRate, os.plays, 'neutral'],
    ].filter((r) => r[2] > 0))));
  }
  return out.join('');
}

function playerSections(G, sel, seats, base) {
  const st = seatStats(seats);
  const label = seatsLabel(sel);
  const out = [];
  if (sel.players.length === 1) {
    const key = sel.players[0];
    const rel = relations(G, key);
    const noms = nominationStats(G, [key]);
    out.push(playerHero(base, key, st));
    out.push(card(`How ${esc(label)} does`, 'Overall, and by the type of character they held. Click a type to see only those games.', rateRows([
      ['Overall', st.winRate, st.plays, 'neutral'],
      ['As good', st.goodWinRate, st.good.plays, 'good'],
      ['As evil', st.evilWinRate, st.evil.plays, 'evil'],
      ...TYPES.map((team) => st.byTeam.find((t) => t.team === team) || { team, plays: 0, winRate: null })
        .map((t) => [typeLink(t.team), t.winRate, t.plays, isEvilTeam(t.team) ? 'evil' : t.team === 'traveller' ? 'neutral' : 'good']),
    ]) + `<p class="sub" style="margin:10px 0 0">Survived to the end in ${pct(st.survivalRate)} of games.</p>`));
    out.push(card('Characters played', 'Click a character to see how this player does with it. Click a column to sort.',
      sortable('p-chars', [colChar(), { label: 'Type', value: (c) => -TYPES.indexOf(c.team), cell: (c) => td(esc(teamOne(c.team))) }, colNum('Plays', (c) => c.plays), colRate('Win rate', (c) => c.winRate, (c) => c.plays, charCls)],
        st.byCharacter, { sort: 2, limit: 8 })));
    const mateCols = [colPlayer('Teammate'), colNum('Games', (r) => r.same), colRate('Win rate', (r) => r.sameRate, (r) => r.same)];
    const rivalCols = [colPlayer('Opponent'), colNum('Games', (r) => r.opposite), { ...colRate('Win rate', (r) => r.oppositeRate, (r) => r.opposite), value: (r) => -r.oppositeRate }];
    out.push(card('Wins most with', `${esc(nameOf(key))}'s win rate when on the same team as each player (at least 3 games together). Click a name to see them together.`,
      sortable('p-mates', mateCols, rel.teammates, { sort: 2, limit: 6, empty: 'Not enough games together yet.' })));
    out.push(card('Struggles most against', `${esc(nameOf(key))}'s win rate when on the opposite team to each player (at least 3 games against).`,
      sortable('p-rivals', rivalCols, rel.rivals, { sort: 2, limit: 6, empty: 'Not enough games against each other yet.' })));
    out.push(card('Nominations and votes', 'From recorded nominations in these games.', `<div class="mini-tiles">
      <div><b>${noms.made}</b><span>nominations made</span></div>
      <div><b>${pct(noms.accuracy)}</b><span>of their nominations were on evil players</span></div>
      <div><b>${noms.received}</b><span>times nominated</span></div>
      <div><b>${noms.executed}</b><span>times executed</span></div>
      <div><b>${noms.votes}</b><span>votes cast</span></div>
      <div><b>${pct(noms.voteAccuracy)}</b><span>of their votes were on evil players</span></div></div>`));
    if (st.byScript.length > 1) out.push(card('By script', '', rateRows(st.byScript.map((s) => [esc(s.key), s.winRate, s.plays, 'neutral']))));
    if (state.filters.communities.length !== 1 && st.byCommunity.length > 1) out.push(card('By community', '', rateRows(st.byCommunity.map((s) => [esc(communityName(state.settings, s.key)), s.winRate, s.plays, 'neutral']))));
  } else {
    const grp = groupRelations(G, sel.players);
    const names = sel.players.map(nameOf);
    // Each player's win rate in these games, side by side.
    const perPlayer = sel.players.map((k) => winCard(seatStats(seats.filter((x) => playerKey(x.p) === k)), othersRates(base, k), playerLink(k, nameOf(k)), `In the ${plural(G.length, 'game')} they all played.`));
    out.push(`<div class="span-all"><div class="grid four">${perPlayer.join('')}</div></div>`);
    out.push(card('On the same team', `${plural(grp.same.games, 'game')} where ${esc(listWords(names))} were all on the same side.`, grp.same.games ? rateRows([
      ['Won together', grp.same.rate, grp.same.games, 'neutral'],
      ['Together as good', grp.same.goodRate, grp.same.good.games, 'good'],
      ['Together as evil', grp.same.evilRate, grp.same.evil.games, 'evil'],
    ]) : '<p class="muted">They haven\'t all been on the same side yet.</p>'));
    if (sel.players.length === 2) {
      const p = grp.pairs[0];
      out.push(card('On opposite teams', `${plural(p.opposite, 'game')} where ${esc(names[0])} and ${esc(names[1])} played against each other.`, p.opposite
        ? `<p class="h2h"><span>${esc(names[0])}</span> <b>${p.aWins} – ${p.bWins}</b> <span>${esc(names[1])}</span></p>`
          + rateRows(grp.split.players.map((pp) => [playerLink(pp.key, nameOf(pp.key)), pp.winRate, pp.plays, 'neutral']))
        : '<p class="muted">They haven\'t played against each other yet.</p>'));
    } else {
      out.push(card('When split up', `${plural(grp.split.games, 'game')} where they weren't all on the same side, and how each of them did.`, grp.split.games
        ? rateRows(grp.split.players.map((pp) => [playerLink(pp.key, nameOf(pp.key)), pp.winRate, pp.plays, 'neutral']))
        : '<p class="muted">They\'ve always been on the same side so far.</p>'));
      out.push(card('Pair by pair', 'How each pair does together, and who wins when they face each other.', sortable('pairs', [
        { label: 'Pair', value: (p) => `${nameOf(p.a)} ${nameOf(p.b)}`, cell: (p) => `<td class="nowrap">${esc(nameOf(p.a))} &amp; ${esc(nameOf(p.b))}</td>` },
        colNum('Same team', (p) => p.same),
        colRate('Won together', (p) => p.sameRate, (p) => p.same),
        { label: 'Head to head', value: (p) => p.opposite, cell: (p) => `<td class="nowrap">${p.opposite ? `${esc(nameOf(p.a))} ${p.aWins} – ${p.bWins} ${esc(nameOf(p.b))}` : '<span class="muted">never opposed</span>'}</td>` },
      ], grp.pairs, { sort: 1, limit: 10 }), 'wide'));
    }
    out.push(card('Each player in these games', '', sortable('grp-players', [colPlayer(), colNum('Games', (p) => p.plays), colRate('Win rate', (p) => p.winRate, (p) => p.plays), colRate('Survived', (p) => p.survivalRate, (p) => p.plays, 'neutral', 'Survived')],
      st.byPlayer, { sort: 1, limit: 10 })));
  }
  if (sel.characters.length) {
    const holding = seats.filter((s) => sel.characters.includes(s.p.roleId));
    const other = seats.filter((s) => !sel.characters.includes(s.p.roleId));
    const chars = listWords(sel.characters.map(charName));
    out.unshift(card(`${esc(listWords(sel.players.map(nameOf)))} in games with ${esc(chars)}`, '', rateRows([
      [`Holding ${esc(chars)}`, seatStats(holding).winRate, holding.length, 'neutral'],
      ['Holding another character', seatStats(other).winRate, other.length, 'neutral'],
    ])));
  }
  return out.join('');
}

function characterSections(G, base, sel) {
  const baseRate = outcome(base).goodRate;
  const out = [];
  if (sel.characters.length === 1) {
    const id = sel.characters[0];
    const row = characterTable(G, baseRate).find((c) => c.roleId === id) || {};
    const holders = focusSeats(G, { players: [], types: [], characters: [id] });
    const st = seatStats(holders);
    const evil = isEvilTeam(row.team);
    out.push(card(`${esc(row.name || charName(id))} at a glance`, `${esc(teamOne(row.team))} · in play in ${plural(row.games || 0, 'game')} · good wins ${delta(row.delta)} vs. ${pct(baseRate)} overall.`, rateRows([
      ['Holder won', st.winRate, st.plays, evil ? 'evil' : 'good'],
      ['Good won when in play', row.goodRate, row.games, 'neutral'],
      ['Holder survived to the end', st.survivalRate, st.plays, 'neutral'],
    ])));
    out.push(card('When the holder dies', 'Share of games by when the player holding it died.', deathBars(st.deathTiming, st.plays)));
    out.push(card('Who plays it', 'Click a name to see that player with this character.', sortable('c-players', [colPlayer(), colNum('Plays', (p) => p.plays), colRate('Won', (p) => p.winRate, (p) => p.plays, evil ? 'evil' : 'good')],
      st.byPlayer, { sort: 1, limit: 8 })));
  } else {
    const together = outcome(G);
    const each = characterTable(base, baseRate).filter((c) => sel.characters.includes(c.roleId));
    out.push(card(`When ${esc(listWords(sel.characters.map(charName)))} are ${sel.characters.length === 2 ? 'both' : 'all'} in play`, `Compared with each character on its own, and with all ${plural(base.length, 'game')} in your filters.`,
      legendGE() + splitBars([
        { key: sel.characters.length === 2 ? 'Both together' : 'All of them together', games: together.n, good: together.good, evil: together.evil },
        ...each.map((c) => ({ key: `${c.name} (any game)`, games: c.games, good: c.goodWins, evil: c.games - c.goodWins })),
        { key: 'All games', games: base.length, good: outcome(base).good, evil: outcome(base).evil },
      ].filter((r) => r.games), (r) => esc(r.key))));
    const holders = seatStats(focusSeats(G, { players: [], types: [], characters: sel.characters }));
    out.push(card('How each holder did in these games', '', sortable('cs-holders', [colChar(), colNum('Plays', (c) => c.plays), colRate('Holder won', (c) => c.winRate, (c) => c.plays, charCls)],
      holders.byCharacter, { sort: 1, limit: 8 })));
  }
  if (G.length >= 8) {
    const combos = companions(G, sel.characters, 3);
    const rate0 = outcome(G).goodRate;
    out.push(card('Characters that change the result alongside', `In these ${plural(G.length, 'game')} good wins ${pct(rate0)}. Here's how that shifts when another character is also in play (at least 3 games). Click one to add it.`,
      sortable('combos', [colChar('Also in play'), colNum('Games', (c) => c.games), colRate('Good won', (c) => c.goodRate, (c) => c.games, 'neutral', 'Good won'),
        { ...colDelta('Shift', (c) => c.delta), value: (c) => Math.abs(c.delta) }], combos, { sort: 3, limit: 6, empty: 'Not enough games yet.' })));
  }
  if (outcome(G).n) {
    const byScript = overview(G).byScript;
    if (byScript.length > 1) out.push(card('Who wins, by script', '', legendGE() + splitBars(byScript, (r) => esc(r.key))));
  }
  return out.join('');
}

function typeSections(G, sel, seats, base) {
  const st = seatStats(seats);
  const label = listWords(sel.types.map(teamLabel));
  const chars = characterTable(G, outcome(G).goodRate);
  const inPlay = new Map(chars.map((c) => [c.roleId, c]));
  const out = [];
  // Win rate and survival are in the cards at the top, so this is just the timing.
  out.push(card(`When ${esc(label)} die`, `How many ${esc(label)} died on each day or night, and how many survived to the end.`, deathBars(st.deathTiming, st.plays)));
  out.push(card(`${esc(label)}, one by one`, 'How often the holder won, and how much more or less often good wins when each is in play. Most played first; hover for the numbers. Click one to dig in.',
    // Plays are in the tooltips rather than a column, so the table fits without scrolling sideways. Most played first.
    sortable('t-chars', [colChar(),
      { label: 'Holder won', value: (c) => c.winRate, cell: (c) => td(rateCell(c.winRate, c.plays, charCls(c), '', `${c.name}: held ${plural(c.plays, 'time')}, the holder won ${c.wins}`)) },
      { ...colDelta('Good wins', (c) => (inPlay.get(c.roleId) || {}).delta), cell: (c) => { const r = inPlay.get(c.roleId) || {}; return `<td class="num" data-tip="${esc(`Good won ${pct(r.goodRate)} of the ${plural(r.games || 0, 'game')} with the ${c.name} in play`)}">${delta(r.delta)}</td>`; } }],
      st.byCharacter, { sort: null, limit: 8 })));
  const best = st.byPlayer.filter((p) => p.plays >= 2);
  out.push(card(`Best players as ${esc(label)}`, 'At least 2 games.', sortable('t-players', [colPlayer(), colNum('Plays', (p) => p.plays), colRate('Win rate', (p) => p.winRate, (p) => p.plays)],
    best, { sort: 2, limit: 8, empty: 'Not enough games yet.' })));
  out.push(swingCards(base, label, (c) => sel.types.includes(c.team)));
  const counts = countEffect(G, sel.types);
  if (counts.length > 1) out.push(card(`Who wins, by number of ${esc(label)} in play`, '', legendGE() + splitBars(counts, (r) => `${r.key} in play`)));
  return out.join('');
}

// ---------- predicting a set of characters that has (almost) never been together ----------
let tuneCache = { key: '', tune: null };
function tunedFor(base) {
  const key = `${base.length}:${base.map((g) => g.id).join('|')}`;
  if (tuneCache.key !== key) tuneCache = { key, tune: base.length >= 8 ? tuneOutcomeModel(base) : null };
  return tuneCache.tune;
}

function wantsPrediction(G, base, sel) {
  return sel.characters.length >= 2 && !sel.players.length && !sel.types.length && G.length < 5 && base.length >= 8;
}

function predictionSections(G, base, sel, pr) {
  const chars = listWords(sel.characters.map(charName));
  const gp = Math.round(pr.good * 100), ep = 100 - gp;
  const lo = Math.round(pr.low * 100), hi = Math.round(pr.high * 100);
  const width = hi - lo;
  const lean = Math.abs(gp - 50) < 5 ? 'a toss-up' : gp > 50 ? 'a lean toward good' : 'a lean toward evil';
  const confidence = !pr.check.skill
    ? `Your games so far don't show character effects strong enough to beat a simple guess, so treat this as close to the overall rate (${pct(pr.base)} good). It will sharpen as more games are recorded.`
    : width > 30 ? `A rough estimate: the likely range is wide (${lo}–${hi}%).` : `A fairly confident estimate: good wins somewhere between ${lo}% and ${hi}% of the time.`;
  const intro = G.length
    ? `Only ${plural(G.length, 'game')} had ${esc(chars)} all in play, too few to go on, so here's an estimate as well.`
    : `${esc(chars)} have never all been in a game together, so this is an estimate.`;
  const out = [];
  out.push(card('Predicted result', intro,
    `<div class="predict"><div class="predict-nums"><span class="g">Good <b>${gp}%</b></span> <span class="e">Evil <b>${ep}%</b></span></div>
     ${pr.check.skill ? `<p class="predict-lean">That's ${lean}.</p>` : ''}
     ${rangeBar(pr.good, pr.low, pr.high)}
     <p class="sub">${confidence}</p>
     <p class="muted small">How it works: across all ${plural(pr.gamesUsed, 'game')} in your filters, it learns how much each character tends to shift the result, accounting for which characters usually appear together, and pulls characters with few games toward "no effect". Tested on your past games, it called the winner ${pct(pr.check.accuracy)} of the time (always picking the more common winner: ${pct(pr.check.baseAccuracy)}). The range covers about 80% of likely outcomes.</p></div>`, 'wide'));
  out.push(card('What each character does', 'Its estimated shift in the good win rate on its own, compared with a typical game.',
    sortable('predict-chars', [colChar(), colNum('Games', (c) => c.games), { label: 'Shift', num: true, value: (c) => c.push, cell: (c) => td(c.games ? delta(c.push) : '<span class="muted">no games yet</span>', true) }],
      pr.contributions.map((c) => ({ ...c, name: charName(c.roleId) })), { sort: 2, limit: 10 })));
  return out.join('');
}

function gamesList(G) {
  if (!G.length) return '';
  const shown = G.slice(0, state.gamesShown);
  return `<div class="card games-card"><p class="sub">Click a game to see its grimoire: who sat where, their characters, who died and the storyteller's reminder tokens. You can also fix its details there.</p>
    ${shown.map((g) => {
      const demons = g.players.filter((p) => p.team === 'demon').map((p) => p.roleName).join(', ');
      return `<details class="game ${g.excluded ? 'excluded' : ''}" data-game="${esc(g.id)}" ${state.openGame === g.id ? 'open' : ''}>
        <summary><span>${fmtDate(g.endedAt)}<br><span class="muted">${fmtTime(g.endedAt)}</span></span>
          <span><b>${esc(g.script.name || 'Unknown script')}</b> · ${g.playerCount} players${g.travellerCount ? ` + ${plural(g.travellerCount, 'traveller')}` : ''} · ${plural(g.days, 'day')}<br><span class="muted">Demon: ${esc(demons || 'unknown')}${g.notes ? ` · ${esc(g.notes)}` : ''}</span></span>
          <span class="pills">${g.community ? `<span class="pill">${esc(communityName(state.settings, g.community))}</span>` : ''}<span class="pill ${g.winner}">${cap(g.winner)} won</span></span></summary>
        ${state.openGame === g.id ? gameDetail(g) : ''}
      </details>`;
    }).join('')}
    ${G.length > shown.length ? `<button class="btn" data-more-games>Show ${Math.min(25, G.length - shown.length)} more</button>` : ''}
  </div>`;
}

function gameDetail(g) {
  // Games everyone sees need the editor key to change; games that are only in this browser don't.
  const canEdit = state.shared.canEdit || !!g.local;
  const bySeat = new Map(g.players.map((p) => [p.seat, p]));
  const who = (seat, name) => { const p = bySeat.get(seat); const k = p && playerKey(p); return k ? playerLink(k, name || p.username || k) : esc(name || `Seat ${seat}`); };
  const missing = g.players.filter((p) => !p.username);
  const hasReminders = g.players.some((p) => (p.reminders || []).length);
  return `<div class="body">
    <div class="grim-wrap">${renderGrimoire(g, { playerLink, playerKey, images, roleMeta })}</div>
    ${hasReminders ? '' : '<p class="muted center">No reminder tokens were recorded for this game. They\'re captured when the storyteller reveals the grimoire at the end.</p>'}
    <div class="game-bar">
      <div class="toggles" role="group" aria-label="Game details">
        <button class="toggle" data-gview="seats" aria-pressed="${!state.gameMenu && state.gameView !== 'noms'}">Seat by seat${missing.length ? ` <span class="badge">${missing.length} missing</span>` : ''}</button>
        <button class="toggle" data-gview="noms" aria-pressed="${!state.gameMenu && state.gameView === 'noms'}">Nominations <span class="count">${g.nominations.length}</span></button>
      </div>
      <button class="btn icon" data-gmenu aria-expanded="${state.gameMenu}" aria-label="Game settings" title="Game settings"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.8"/><circle cx="10" cy="10" r="1.8"/><circle cx="16" cy="10" r="1.8"/></svg></button>
    </div>
    <div class="game-menu" ${state.gameMenu ? '' : 'hidden'}>
      <h4>Game settings</h4>
      ${canEdit ? '' : `<p class="sub" style="margin:0">This game is shared with everyone, so changing or deleting it needs an editor key. ${WEB ? 'Add one under Data & settings.' : 'Add one in Data & settings.'}</p>`}
      <fieldset class="gm-fields" ${canEdit ? '' : 'disabled'}>
      <div class="gm-grid">
        <div class="gm-field"><span class="field-label">Community</span><div class="toggles">${communityButtons('data-game-community', g.community ? [g.community] : [], `${g.id}|`)}</div></div>
        <label class="gm-field"><span class="field-label">Storyteller</span><input type="text" value="${esc(g.storytellers.map((s) => s.username).filter(Boolean).join(', '))}" placeholder="Not recorded — type a name" data-st="${esc(g.id)}"></label>
        <label class="gm-field gm-wide"><span class="field-label">Notes</span><textarea rows="2" placeholder="Anything to remember about this game" data-notes="${esc(g.id)}">${esc(g.notes || '')}</textarea></label>
      </div>
      <label class="gm-check"><input type="checkbox" data-exclude="${esc(g.id)}" ${g.excluded ? 'checked' : ''}><span><b>Exclude from stats</b><span>The game stays in this list but doesn't count towards anything on the Stats tab.</span></span></label>
      </fieldset>
      <div class="gm-foot">
        <span class="muted">Room “${esc(g.room)}” · recorded by ${esc((g.recorders && g.recorders.length ? g.recorders.join(', ') : (g.capturedBy && g.capturedBy.username)) || 'unknown')}${g.pending ? ' · not uploaded yet' : ''}</span>
        ${canEdit ? `<button class="btn danger" data-delete="${esc(g.id)}">Delete game</button>` : ''}
      </div>
    </div>
    <div class="gpanel" data-gpanel="seats" ${state.gameMenu || state.gameView === 'noms' ? 'hidden' : ''}>
      <div class="table-wrap"><table>
        <thead><tr><th class="num">Seat</th><th>Player</th><th>Character</th><th>Alignment</th><th>Fate</th><th>Reminders</th><th>Result</th></tr></thead>
        <tbody>${g.players.map((p) => `<tr>
          <td class="num">${p.seat}</td><td>${p.username ? playerLink(playerKey(p), p.username) : canEdit ? `<input type="text" placeholder="Who was this?" data-pname="${esc(g.id)}|${p.seat}" style="width:140px">` : '<span class="muted">Unknown</span>'}</td>
          <td>${p.startingRoleId && p.startingRoleId !== p.roleId ? `${esc(p.startingRoleName)} → ` : ''}${p.roleId ? charLink(p.roleId, p.roleName) : 'Unknown'} <span class="muted">${esc(teamOne(p.team))}</span></td>
          <td>${p.alignment ? `<span class="pill ${p.alignment}">${cap(p.alignment)}</span>` : '–'}</td>
          <td>${p.survived ? 'Survived' : `Died${p.diedPhase ? ` · ${phaseLabel(p.diedPhase)}` : ''}${p.deadVoteUsed ? ' · vote used' : ''}`}</td>
          <td>${(p.reminders || []).map((r) => esc(r.source ? `${r.source}: ${r.name}` : r.name)).join(', ') || '<span class="muted">–</span>'}</td>
          <td>${p.won === null ? '–' : p.won ? 'Won' : 'Lost'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="gpanel" data-gpanel="noms" ${!state.gameMenu && state.gameView === 'noms' ? '' : 'hidden'}>
      ${g.nominations.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Day</th><th>Nominator</th><th>Nominee</th><th class="num">Votes</th><th class="num">Needed</th><th>Voters</th></tr></thead>
      <tbody>${g.nominations.map((n) => `<tr>
        <td>${n.day}</td><td>${who(n.nominatorSeat, n.nominator)}</td><td>${who(n.nomineeSeat, n.nominee)}${n.type === 'exile' ? ' <span class="muted">(exile)</span>' : ''}</td>
        <td class="num">${n.votes === null ? '<span class="muted">hidden</span>' : n.votes}${n.completed ? '' : ' <span class="muted">(cancelled)</span>'}</td>
        <td class="num">${n.majority}</td><td>${(n.voters || []).map((v) => who(v.seat, v.username)).join(', ')}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="muted">No nominations were recorded for this game. They\'re captured live, so games joined partway through may be missing some.</p>'}
    </div>
  </div>`;
}

const anyFilter = (sel) => hasSelection(sel) || !!(state.filters.communities.length || state.filters.script || state.filters.storyteller || state.filters.days);

// How many of a type are in a typical game, e.g. "Townsfolk per game: 6.6 (73 across 11 games)".
function perGameTile(types, plays, games) {
  const label = listWords(types.map(teamLabel));
  return tile(`${esc(label)} per game`, games ? (plays / games).toFixed(1) : '–', `${plays} across ${plural(games, 'game')}`, 'hero feature');
}

// Average length, with the shortest and longest game underneath.
function lengthTile(G, o) {
  if (o.avgDays === null || !G.length) return tile('Average game length', '–');
  const days = G.map((g) => g.days || 0);
  const lo = Math.min(...days), hi = Math.max(...days);
  return tile('Average game length', `${o.avgDays.toFixed(1)} days`, lo === hi ? 'every game the same length' : `shortest ${plural(lo, 'day')} · longest ${plural(hi, 'day')}`);
}

function summaryLine(G, base, sel) {
  const parts = [];
  const who = listWords(sel.players.map((k) => `<b>${esc(nameOf(k))}</b>`));
  if (sel.players.length && (sel.characters.length || sel.types.length)) parts.push(`with ${who} as <b>${esc(heldRole(sel).as)}</b>`);
  else if (sel.players.length) parts.push(`with ${who} in the game`);
  else if (sel.characters.length) parts.push(`with ${listWords(sel.characters.map((c) => `<b>${esc(charName(c))}</b>`))} in play`);
  if (sel.types.length && !sel.players.length) parts.push(`looking at ${listWords(sel.types.map((t) => `<b>${esc(teamLabel(t))}</b>`))}`);
  const scope = [state.filters.communities.map((c) => communityName(state.settings, c)).join(' & '), state.filters.script, state.filters.storyteller && `storyteller ${nameOf(state.filters.storyteller)}`, state.filters.days && `the last ${state.filters.days} days`].filter(Boolean);
  return `<p class="summary">${hasSelection(sel) ? `<b>${G.length}</b> of ${plural(base.length, 'game')}` : `<b>${plural(base.length, 'game')}</b>`}${scope.length ? ` in ${esc(scope.join(' · '))}` : ''}${parts.length ? `, ${parts.join(', ')}` : ''}.</p>`;
}

function noGames() {
  return `<div class="empty card"><h2>No games recorded yet</h2><p>Keep botc.app open in a tab while you play. Each game is saved automatically when the storyteller reveals the grimoire.</p><p class="muted">Already have data? Import it from Data &amp; settings.</p></div>`;
}

function gamesView() {
  if (!state.games.length) return noGames();
  const base = baseGames();
  const G = selectGames(base, state.sel);
  return `${summaryLine(G, base, state.sel)}${G.length ? gamesList(G) : '<div class="card empty"><h2>No games match</h2><p>Try removing a filter.</p></div>'}`;
}

function statsView() {
  if (!state.games.length) return `<div class="empty card"><h2>No games recorded yet</h2><p>Keep botc.app open in a tab while you play. Each game is saved automatically when the storyteller reveals the grimoire.</p><p class="muted">Already have data? Import it from Data &amp; settings.</p></div>`;
  const base = baseGames();
  const sel = state.sel;
  const G = selectGames(base, sel);
  // With only characters selected, the seats described are whoever held them.
  const seatSel = hasSelection(sel);
  const seats = seatSel ? focusSeats(G, sel) : [];
  const holdersOnly = !sel.players.length && !sel.types.length;
  const severalChars = holdersOnly && sel.characters.length > 1;
  const o = outcome(G), ob = outcome(base);
  const st = seatSel ? seatStats(seats) : null;
  const top = hasSelection(sel) ? null : topWinRate(base);
  const onePlayer = sel.players.length === 1 ? sel.players[0] : null;
  const storytold = onePlayer ? (storytellerTable(base).find((r) => r.key === onePlayer) || { games: 0 }).games : 0;
  const held = sel.players.length && (sel.characters.length || sel.types.length);
  const typeOnly = sel.types.length && !sel.players.length && !sel.characters.length;
  const oneTeam = holdersOnly && sel.characters.length === 1 ? (charInfo.get(sel.characters[0]) || {}).team : null;
  const oneCharSide = ob.goodRate === null ? null : ['townsfolk', 'outsider'].includes(oneTeam) ? 'good' : ['minion', 'demon'].includes(oneTeam) ? 'evil' : null;
  const everyone = typeOnly ? seatStats(G.flatMap((g) => g.players.map((p) => ({ g, p })))) : null;
  // Each picked player's own games (whatever they held), for "vs. all their games".
  const mine = held ? focusSeats(selectGames(base, { ...sel, characters: [], types: [] }), { ...sel, characters: [], types: [] }) : [];
  const mineSt = held ? seatStats(mine) : null;
  const tiles = held ? [
    tile(`Games as ${esc(heldRole(sel).as)}`, onePlayer ? st.plays : o.n, onePlayer ? `of ${plural(mine.length, 'game')} ${esc(nameOf(onePlayer))} played` : `of ${base.length} in your filters`, 'hero feature'),
    tile('Win rate', pct(st.winRate), onePlayer ? `${delta(gap(st.winRate, mineSt.winRate))} vs. ${pct(mineSt.winRate)} in all their games` : `won ${st.wins} of ${st.plays}`),
    onePlayer ? tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`) : '',
  ] : onePlayer ? [
    tile('Games played', st.plays, `of ${base.length} in your filters`, 'hero feature'),
    tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`),
    tile('Games storytold', storytold, storytold ? '' : 'none recorded'),
  ] : typeOnly ? [
    // A type alone doesn't narrow the games (nearly every game has Townsfolk), so these describe the seats instead,
    // next to every player's results in the same games.
    perGameTile(sel.types, st.plays, new Set(seats.map((x) => x.g)).size),
    tile('Win rate', pct(st.winRate), `${delta(gap(st.winRate, everyone.winRate))} vs. ${pct(everyone.winRate)} for all players`),
    tile('Survived to the end', pct(st.survivalRate), `${delta(gap(st.survivalRate, everyone.survivalRate))} vs. ${pct(everyone.survivalRate)} for all players`),
  ] : oneCharSide ? [
    // One non-traveller character: its team is known, so "good win rate" and "holder win rate" would say the same thing.
    // Keep the holder's, compared with that team's win rate in all games.
    tile('Matching games', o.n, `of ${base.length} in your filters`, 'hero feature'),
    tile(`Holder win rate · ${esc(charName(sel.characters[0]))}`, pct(st.winRate), `${delta(gap(st.winRate, oneCharSide === 'good' ? ob.goodRate : 1 - ob.goodRate))} vs. ${pct(oneCharSide === 'good' ? ob.goodRate : 1 - ob.goodRate)} for ${oneCharSide} in all games`),
    tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`),
  ] : hasSelection(sel) ? [
    tile('Matching games', o.n, `of ${base.length} in your filters`, 'hero feature'),
    tile('Good win rate', pct(o.goodRate), `${delta(gap(o.goodRate, ob.goodRate))} vs. ${pct(ob.goodRate)} in all games`),
    // Win rate and survival pooled across several characters (on their own) don't mean much, so those are left out.
    st && !severalChars ? tile(holdersOnly ? `Holder win rate · ${esc(listWords(sel.characters.map(charName)))}` : `Win rate · ${esc(seatsLabel(sel))}`, pct(st.winRate), plural(st.plays, 'game')) : !st ? lengthTile(G, o) : '',
    // Likewise pooled survival across several players.
    st && sel.players.length < 2 && !severalChars ? tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`) : '',
  ] : [
    tile('Games', o.n, G.length ? `${fmtDate(G[G.length - 1].endedAt)} – ${fmtDate(G[0].endedAt)}` : '', 'hero'),
    lengthTile(G, o),
    top ? tile('Highest win rate', `<span style="font-size:${Math.min(1, 11 / Math.max(1, [...top.name].length)).toFixed(2)}em">${playerLink(top.key, top.name)}</span>`, `won ${pct(top.winRate)} of ${plural(top.plays, 'game')}`, 'highlight feature') : '',
  ];
  const pr = wantsPrediction(G, base, sel) ? predictOutcome(base, sel.characters, { tune: tunedFor(base) }) : null;
  if (pr) {
    tiles.splice(1, G.length ? 0 : 1, tile('Predicted good win', `${Math.round(pr.good * 100)}%`, `likely ${Math.round(pr.low * 100)}–${Math.round(pr.high * 100)}%`));
  }
  let sections = '';
  if (pr) sections = `<div class="grid two">${predictionSections(G, base, sel, pr)}${G.length ? characterSections(G, base, sel) : ''}</div>`;
  else if (!G.length && held) sections = `<div class="card empty"><h2>Not yet</h2><p>${esc(listWords(sel.players.map(nameOf)))} ${sel.players.length > 1 ? 'haven\'t each' : 'hasn\'t'} been ${esc(heldRole(sel).as)} in any recorded game${sel.players.length > 1 ? ' together' : ''} under these filters.</p></div>`;
  else if (!G.length) sections = `<div class="card empty"><h2>No games match</h2><p>No recorded game has ${hasSelection(sel) ? 'everything you selected' : 'these filters'}. Try removing a filter.</p></div>`;
  else if (!hasSelection(sel)) sections = overallSections(base);
  else {
    if (sel.characters.length && !sel.players.length) sections += characterSections(G, base, sel);
    if (sel.players.length && (sel.characters.length || sel.types.length)) sections += heldSections(G, sel, seats, base);
    else if (sel.players.length) sections += playerSections(G, sel, seats, base);
    else if (sel.types.length) sections += typeSections(G, sel, seats, base);
    sections = `<div class="grid two">${sections}</div>`;
  }
  const more = G.length ? `<p class="see-games"><button class="btn" data-tab="games">See ${G.length === 1 ? 'this game' : `these ${G.length} games`} →</button></p>` : '';
  // With no filters the Games tile already says how many games there are, so the line would only repeat it.
  const lead = anyFilter(sel) ? summaryLine(G, base, sel).replace('class="summary"', 'class="summary lead"') : '';
  return `${lead}<div class="tiles">${tiles.join('')}</div>${sections}${more}`;
}

// ---------- filters & dropdowns ----------
function populateFilters() {
  const all = state.games;
  const opts = (name, values, allLabel, label = (v) => v) => {
    const sel = $(`[data-filter="${name}"]`);
    const cur = state.filters[name];
    sel.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${esc(v.value ?? v)}" ${String(cur) === String(v.value ?? v) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  };
  state.filters.communities = state.filters.communities.filter((c) => communityOptions().some((o) => o.value === c));
  $('#community-filter').innerHTML = communityButtons('data-filter-community', state.filters.communities);
  opts('script', distinct(all, (g) => g.script.name), 'All scripts');
  opts('storyteller', distinct(all, storytellerKeys).map((k) => ({ value: k, name: nameOf(k) })).sort((a, b) => a.name.localeCompare(b.name)), 'All storytellers', (v) => v.name);
}

const dropdowns = {};
function setupDropdowns() {
  const defs = {
    players: { label: 'Players', nameOf: nameOf, options: () => [...playerKeys].map((value) => ({ value, label: nameOf(value) })).sort((a, b) => a.label.localeCompare(b.label)) },
    characters: { label: 'Characters', nameOf: charName, options: () => [...charInfo.values()].map((c) => ({ value: c.roleId, label: c.name, sub: teamOne(c.team) })).sort((a, b) => a.label.localeCompare(b.label)) },
    types: { label: 'Character type', nameOf: teamOne, options: () => TYPES.map((t) => ({ value: t, label: teamOne(t) })) },
  };
  for (const [kind, d] of Object.entries(defs)) {
    dropdowns[kind] = multiSelect($(`[data-ms="${kind}"]`), { ...d, selected: () => state.sel[kind], onChange: (values) => setSelection((s) => { s[kind] = values; }) });
  }
}

function renderPickers() {
  Object.values(dropdowns).forEach((d) => d.refresh());
  $('#clear-sel').hidden = !hasSelection(state.sel);
}

function setSelection(fn) {
  fn(state.sel);
  state.expanded.clear();
  state.gamesShown = 15;
  state.openGame = null;
  writeHash();
  renderPickers();
  render();
}

function addTo(kind, value) {
  setSelection((s) => { if (!s[kind].includes(value)) s[kind] = [...s[kind], value]; });
}

// ---------- render ----------
function render() {
  // The website shows nothing but the sign-in until someone signs in (or an older visit saved the community password).
  const gate = WEB && (!state.shared.hasPassword || state.signin.open);
  document.body.classList.toggle('signed-out', gate);
  if (gate) { $('#filters').hidden = true; $('#view').innerHTML = signInView(); return; }
  document.querySelectorAll('[data-tab]').forEach((b) => { if (b.closest('.tabs')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)); });
  $('#filters').hidden = state.tab === 'data';
  const views = { stats: statsView, games: gamesView, data: () => renderData(ctx, selectGames(baseGames(), state.sel)) };
  $('#view').innerHTML = (state.tab !== 'data' ? connectCard() : '') + views[state.tab]();
  // Editors' account list loads the first time Data & settings is opened.
  mountClaimPicker();
  if (state.tab === 'data' && state.accounts === undefined && state.shared.on && state.shared.canEdit && creds(state.settings).editorKey) { state.accounts = null; loadAccounts(); }
}

// ---------- shared games: sign-in and status ----------
function signInView() {
  const st = state.shared.status || {};
  const mode = state.signin.mode;
  const tab = (m, label) => `<button type="button" class="toggle" data-signin-mode="${m}" aria-pressed="${mode === m}">${label}</button>`;
  const remember = '<label class="check"><input type="checkbox" name="remember" checked> Remember on this device</label>';
  const error = st.error ? `<p class="msg err" role="alert">${esc(st.message || (st.error === 'not-allowed' ? 'That password isn\'t right.' : 'Couldn\'t reach the stats. Try again in a moment.'))}</p>` : '';
  const forms = {
    signin: `<form data-signin="signin">
      <input type="text" name="username" placeholder="Username" autocomplete="username" required autofocus aria-label="Username">
      <input type="password" name="password" placeholder="Your password" autocomplete="current-password" required aria-label="Your password">
      ${remember}<button class="btn primary" type="submit">Sign in</button>${error}
      <p class="sub">Forgot your password? Ask an editor to set a new one.</p></form>`,
    signup: `<form data-signin="signup">
      <input type="text" name="username" placeholder="Choose a username" autocomplete="username" required autofocus aria-label="Username" minlength="2" maxlength="24">
      <input type="password" name="password" placeholder="Choose a password (8+ characters)" autocomplete="new-password" required minlength="8" aria-label="Choose a password">
      <input type="password" name="confirm" placeholder="Type it again" autocomplete="new-password" required minlength="8" aria-label="Type the password again">
      <input type="password" name="community" placeholder="Community password" required aria-label="Community password">
      ${remember}<button class="btn primary" type="submit">Create account</button>${error}</form>`,
  };
  return `<div class="signin card">
    <img class="logo" src="icons/logo-dark.png" alt="" width="64" height="64">
    <h2>Clockwise</h2>
    <p class="sub">Blood on the Clocktower stats for our community.</p>
    <div class="toggles signin-modes" role="group" aria-label="Sign in or create an account">${tab('signin', 'Sign in')}${tab('signup', 'Create account')}</div>
    ${forms[mode] || forms.signin}
    ${state.signin.open && state.shared.hasPassword ? '<button type="button" class="linkish" data-signin-cancel>Back to the stats</button>' : ''}
  </div>`;
}


// In the extension: when sharing is set up but this browser can't read the shared games yet.
function connectCard() {
  if (WEB || !state.shared.on) return '';
  const st = state.shared.status;
  if (state.shared.hasPassword && !(st && st.error === 'not-allowed')) {
    return st && st.error ? `<p class="sync-note err">Couldn't update everyone's games: ${esc(st.message || st.error)}. Showing what was downloaded ${state.shared.cacheAt ? `on ${fmtDate(state.shared.cacheAt)} ${fmtTime(state.shared.cacheAt)}` : 'before'}.</p>` : '';
  }
  return `<div class="card connect"><div><h3>See everyone's games</h3>
    <p class="sub">${st && st.error === 'not-allowed' ? 'That password wasn\'t right. ' : ''}Enter your community's password to see the games everyone has recorded. Until then this shows only the games recorded in this browser.</p></div>
    <form data-connect><input type="password" name="password" placeholder="Community password" aria-label="Community password" required><button class="btn primary" type="submit">Connect</button></form></div>`;
}

// Download what's new from the shared store; the dashboard redraws if anything changed.
let syncing = null;
async function syncShared() {
  if (!state.shared.on || !state.shared.hasPassword) return;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const r = await refreshShared(state.settings);
      state.shared.status = r.ok ? { ok: true, at: Date.now() } : { error: r.error, message: r.message };
      if (r.ok && 'canEdit' in r && state.shared.canEdit && !r.canEdit && creds(state.settings).editorKey) state.shared.status.editorRejected = true;
      if (r.ok && (r.changed || WEB || !hasChrome)) await load(); else render();
    } catch (e) {
      state.shared.status = { error: 'unreachable', message: String(e.message || e) };
      render();
    } finally { syncing = null; }
  })();
  return syncing;
}

async function load() {
  state.settings = WEB ? await api.get('settings', {}) : await api.get('settings', {});
  const local = WEB ? {} : await api.get('games', {});
  const c = creds(state.settings);
  const cache = c.url ? await loadShared() : null;
  state.shared = { ...state.shared, on: !!c.url, hasPassword: canReadWith(c), account: c.token ? { username: c.username } : null, canEdit: !c.url || !!c.editorKey, cacheAt: cache && cache.at };
  const map = c.url ? mergeGames(local, cache) : local;
  state.games = Object.values(map).map((g) => ({ ...g, community: gameCommunity(state.settings, g) }));
  state.lastSync = WEB ? null : await api.get('lastSync', null);
  // botc.app's art: the extension reads it itself; the website gets it from the shared store.
  const meta = (cache && cache.meta) || {};
  const assetMap = WEB ? null : await api.get('assetMap', null);
  images = makeImages(assetMap && assetMap.tokenStyle ? assetMap : meta.assetMap ? { ...meta.assetMap, tokenStyle: meta.tokenStyle } : assetMap);
  roleMeta = { ...(meta.roleMeta || {}), ...((WEB ? {} : await api.get('roleMeta', {})) || {}) };
  installTokenStyle(images.tokenStyle, { death: images.asset('death.webp'), fonts: !WEB });
  // Token art missing (e.g. saved by an older version): fetch it now rather than waiting for the daily refresh.
  if ((!images.tokenStyle || !(images.tokenStyle.v >= 2)) && !artAsked && hasChrome) {
    artAsked = true;
    chrome.runtime.sendMessage({ type: 'assets:refresh', force: true }).then((r) => { if (r && !r.ok) { state.artError = r.error || 'unknown error'; render(); } }).catch(() => {});
  }
  playerNames = displayNames(state.games);
  useDisplayNames(playerNames);
  playerKeys = new Set(playerTable(state.games).map((p) => p.key));
  charInfo = new Map(characterTable(state.games, null).map((c) => [c.roleId, c]));
  populateFilters();
  if (!dropdowns.players) setupDropdowns();
  renderPickers();
  render();
}

// ---------- game edits ----------
// Link a typed name to the account it belongs to in other games, so stats don't split one person in two.
function knownId(name) {
  const n = name.toLowerCase();
  for (const g of state.games) for (const p of [...g.players, ...g.storytellers]) if (p.userId && p.username && p.username.toLowerCase() === n) return p.userId;
  return null;
}

async function updateGame(id, patch) {
  const game = state.games.find((g) => g.id === id);
  // A game everyone sees: the change goes to the shared store (needs the editor key).
  if (state.shared.on && game && !game.local) {
    try { await sharedEdit(state.settings, game, patch); } catch (e) { alert(`Couldn't save the change: ${e.message}`); return; }
    if (!WEB) await updateLocal(id, patch, false);
    await syncShared();
    return;
  }
  await updateLocal(id, patch, true);
}

// This browser's own copy (re-uploaded if `resend`).
async function updateLocal(id, patch, resend) {
  if (WEB) return;
  const map = await api.get('games', {});
  if (!map[id]) return;
  Object.assign(map[id], patch, resend ? { syncedAt: null } : {});
  await api.set('games', map);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-gview],[data-gmenu],[data-sort-table],[data-filter-community],[data-game-community],[data-add-player],[data-add-char],[data-add-type],[data-expand],[data-more-games],[data-delete],[data-action],[data-export],[data-clear-room],[data-fallback],[data-tab],#clear-sel');
  if (!t) return;
  // Under an open game: switch between seat-by-seat and nominations, or show the settings. No full redraw,
  // so the grimoire stays put.
  // The settings take the place of the table; picking a tab puts the table back.
  if (t.dataset.gview || t.dataset.gmenu !== undefined) {
    if (t.dataset.gview) { state.gameView = t.dataset.gview; state.gameMenu = false; } else state.gameMenu = !state.gameMenu;
    const body = t.closest('.body');
    body.querySelectorAll('[data-gview]').forEach((b) => b.setAttribute('aria-pressed', String(!state.gameMenu && b.dataset.gview === state.gameView)));
    body.querySelectorAll('[data-gpanel]').forEach((el) => { el.hidden = state.gameMenu || el.dataset.gpanel !== state.gameView; });
    body.querySelector('.game-menu').hidden = !state.gameMenu;
    body.querySelector('[data-gmenu]').setAttribute('aria-expanded', String(state.gameMenu));
    return;
  }
  if (t.dataset.sortTable) {
    const id = t.dataset.sortTable, col = Number(t.dataset.sortCol);
    const cur = state.sorts[id];
    state.sorts[id] = { col, rev: cur && cur.col === col ? !cur.rev : false };
    render();
    return;
  }
  if (t.dataset.filterCommunity) {
    // No community switched on = all games; switch on one or both to narrow down.
    const c = t.dataset.filterCommunity;
    const f = state.filters;
    f.communities = f.communities.includes(c) ? f.communities.filter((x) => x !== c) : [...f.communities, c];
    savePrefs();
    state.expanded.clear();
    populateFilters();
    render();
    return;
  }
  if (t.dataset.gameCommunity) {
    // Clicking the game's current community switches it off, leaving the game without one.
    const i = t.dataset.gameCommunity.lastIndexOf('|');
    const id = t.dataset.gameCommunity.slice(0, i), c = t.dataset.gameCommunity.slice(i + 1);
    const g = state.games.find((x) => x.id === id);
    await updateGame(id, { community: g && g.community === c ? null : c, communityManual: true });
    await load();
    return;
  }
  if (t.dataset.tab) { state.tab = t.dataset.tab; state.openGame = null; writeHash(); render(); window.scrollTo(0, 0); return; }
  if (t.id === 'clear-sel') { setSelection((s) => Object.assign(s, emptySelection())); return; }
  if (t.dataset.addPlayer) { state.tab = 'stats'; addTo('players', t.dataset.addPlayer); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.dataset.addChar) { state.tab = 'stats'; addTo('characters', t.dataset.addChar); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.dataset.addType) { state.tab = 'stats'; addTo('types', t.dataset.addType); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.dataset.expand) { const id = t.dataset.expand; state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); render(); return; }
  if (t.dataset.moreGames !== undefined) { state.gamesShown += 25; render(); return; }
  if (t.dataset.delete) {
    const id = t.dataset.delete;
    const game = state.games.find((g) => g.id === id);
    const everyone = state.shared.on && game && !game.local;
    if (!confirm(everyone ? 'Delete this game for everyone? It will also stop being recorded again.' : 'Delete this game permanently?')) return;
    if (everyone) { try { await sharedDelete(state.settings, id); } catch (e) { alert(`Couldn't delete it: ${e.message}`); return; } }
    if (!WEB) { const map = await api.get('games', {}); delete map[id]; await api.set('games', map); }
    if (everyone) await syncShared(); else await load();
    return;
  }
  await handleDataClick(t, ctx, selectGames(baseGames(), state.sel));
});

document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches || !d.matches('details.game')) return;
  if (d.open && state.openGame !== d.dataset.game) { state.openGame = d.dataset.game; state.gameMenu = false; render(); }
  else if (!d.open && state.openGame === d.dataset.game) state.openGame = null;
}, true);

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.filter) {
    state.filters[t.dataset.filter] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.filter === 'community') savePrefs();
    state.expanded.clear();
    render();
  } else if (t.dataset.exclude) { await updateGame(t.dataset.exclude, { excluded: t.checked }); await load(); }
  else if (t.dataset.notes) { await updateGame(t.dataset.notes, { notes: t.value }); }
  else if (t.dataset.st) {
    const names = t.value.split(',').map((n) => n.trim()).filter(Boolean);
    const g = state.games.find((x) => x.id === t.dataset.st);
    await updateGame(t.dataset.st, { storytellers: names.map((n) => (g.storytellers.find((s) => s.username === n) || { userId: knownId(n), username: n })) });
  } else if (t.dataset.pname) {
    const id = t.dataset.pname.slice(0, t.dataset.pname.lastIndexOf('|'));
    const seat = Number(t.dataset.pname.split('|').pop());
    const g = state.games.find((x) => x.id === id);
    const name = t.value.trim();
    if (!g || !name) return;
    await updateGame(id, { players: g.players.map((p) => (p.seat === seat ? { ...p, username: name, userId: p.userId || knownId(name) } : p)) });
  } else if (t.dataset.import !== undefined && t.files && t.files[0]) {
    await handleImport(t.files[0], ctx);
  }
});

// An image that won't load: try the wiki's copy, and if that fails too, show the name on a plain disc.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || !(el.classList.contains('ct-icon') || el.classList.contains('cr-icon') || el.classList.contains('g-img'))) return;
  if (el.dataset.fallback) {
    const next = el.dataset.fallback;
    delete el.dataset.fallback;
    el.src = next;
    return;
  }
  el.parentElement && el.parentElement.classList.remove('has-img');
  el.remove();
}, true);

// Tooltip for any element with data-tip
const tip = $('#tooltip');
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 16 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
});

window.addEventListener('hashchange', () => { state.sel = readHash(); state.tab = readTab(); renderPickers(); render(); });

// Make sure botc.app's image list is available (fetched in the background if missing or a day old);
// the dashboard re-renders when it arrives.
if (hasChrome) chrome.runtime.sendMessage({ type: 'assets:refresh' }).catch(() => {});

// Live refresh when a new game is captured while the dashboard is open.
if (hasChrome) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.games || changes.lastSync || changes.assetMap || changes.roleMeta || changes.sharedCache || changes.settings)) load(); });

// Signing in to an account or creating one (website), or the extension's "See everyone's games" card (community password).
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.matches('[data-signin], [data-connect]')) return;
  e.preventDefault();
  const mode = f.dataset.signin || 'password';
  const val = (n) => (f[n] ? f[n].value.trim() : '');
  const remember = f.remember ? f.remember.checked : true;
  // Show the problem under the form without redrawing it, so what was typed stays.
  const fail = (r) => {
    state.shared.status = { error: r.error || 'failed', message: r.message };
    let m = f.querySelector('.msg');
    if (!m) { m = document.createElement('p'); m.className = 'msg err'; m.setAttribute('role', 'alert'); f.querySelector('button[type=submit]').after(m); }
    m.textContent = r.message || (r.error === 'not-allowed' ? 'That password isn\'t right.' : 'Couldn\'t reach the stats. Try again in a moment.');
    if (f.matches('[data-connect]')) render();
  };
  const button = f.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    if (mode === 'signup' && f.password.value !== f.confirm.value) return fail({ error: 'invalid', message: 'The two passwords don\'t match.' });
    if (mode === 'signin' || mode === 'signup') {
      const r = mode === 'signin' ? await signIn(state.settings, val('username'), f.password.value) : await signUp(state.settings, val('community'), val('username'), f.password.value);
      if (!r.ok) return fail(r.error === 'not-allowed' ? { error: 'not-allowed', message: 'That community password isn\'t right.' } : r);
      webAuth.setAccount(r.token, r.account.username, remember);
      state.profile = r.account;
    } else {
      const pw = val('password');
      const r = await checkKey(state.settings, pw);
      if (!(r.ok && r.canRead)) return fail(r.ok ? { error: 'not-allowed', message: 'That password isn\'t right.' } : r);
      if (WEB) webAuth.set(pw, remember);
      else await api.set('settings', { ...state.settings, viewPassword: pw });
    }
    state.shared.status = null;
    state.signin.open = false;
    await load();
    await syncShared();
  } catch (err) {
    fail({ error: 'unreachable', message: err.message });
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-signin-mode]');
  if (m) { state.signin.mode = m.dataset.signinMode; state.shared.status = null; render(); return; }
  if (e.target.closest('[data-signin-cancel]')) { state.signin.open = false; state.shared.status = null; render(); return; }
  if (e.target.closest('[data-open-signin]')) { state.signin = { mode: e.target.closest('[data-open-signin]').dataset.openSignin || 'signin', open: true }; state.shared.status = null; render(); window.scrollTo(0, 0); }
});

// ---------- your account (website) and editors' account tools ----------
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.matches('[data-change-password]')) return;
  e.preventDefault();
  // Problems show inside the form; "changed" shows under the buttons once the form closes.
  const say = (text, ok) => { const m = ok ? $('#pw-msg') : f.querySelector('.msg'); if (m) { m.className = `msg ${ok ? 'ok' : 'err'}`; m.textContent = text; } };
  if (f.newPassword.value !== f.confirm.value) return say('The two new passwords don\'t match.', false);
  const r = await changePassword(state.settings, f.password.value, f.newPassword.value).catch((err) => ({ ok: false, message: err.message }));
  if (!r.ok) return say(r.message || 'Couldn\'t change it.', false);
  let remembered = false;
  try { remembered = !!localStorage.getItem('clockwise.token'); } catch {}
  webAuth.setAccount(r.token, state.shared.account.username, remembered);
  f.reset();
  f.hidden = true;
  f.closest('.card').querySelector('[data-pw-open]').hidden = false;
  say('Password changed. Your other devices are signed out.', true);
});

async function loadAccounts() {
  const r = await listAccounts(state.settings).catch((err) => ({ ok: false, message: err.message }));
  state.accounts = r.ok ? r.accounts : { error: r.message || 'Couldn\'t load the accounts.' };
  if (state.tab === 'data') render();
}

// "Change password" opens the form in place; Cancel closes and clears it.
document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('[data-pw-open]');
  const cancel = e.target.closest('[data-pw-cancel]');
  if (!openBtn && !cancel) return;
  const card = (openBtn || cancel).closest('.card');
  const form = card.querySelector('[data-change-password]');
  if (cancel) form.reset();
  form.hidden = !!cancel;
  card.querySelector('[data-pw-open]').hidden = !cancel;
  for (const m of [$('#pw-msg'), form.querySelector('.msg')]) if (m) m.textContent = '';
  if (openBtn) form.querySelector('input').focus();
});

document.addEventListener('click', async (e) => {
  const reset = e.target.closest('[data-account-reset]');
  const del = e.target.closest('[data-account-delete]');
  if (!reset && !del) return;
  const name = (reset || del).dataset[reset ? 'accountReset' : 'accountDelete'];
  const say = (text, ok) => { const m = $('#accounts-msg'); if (m) { m.className = `msg ${ok ? 'ok' : 'err'}`; m.textContent = text; } };
  if (reset) {
    const pw = prompt(`New password for ${name} (8+ characters). Tell them what it is; they can change it after signing in.`);
    if (!pw) return;
    const r = await resetPassword(state.settings, name, pw).catch((err) => ({ ok: false, message: err.message }));
    return say(r.ok ? `New password set for ${name}. They've been signed out everywhere.` : r.message || 'Couldn\'t set it.', r.ok);
  }
  if (!confirm(`Delete the account "${name}"? Their recorded games stay; only the account goes.`)) return;
  const r = await deleteAccount(state.settings, name).catch((err) => ({ ok: false, message: err.message }));
  if (!r.ok) return say(r.message || 'Couldn\'t delete it.', false);
  await loadAccounts();
  say(`Deleted ${name}.`, true);
});

// "Your player": pick yourself from the players (the same dropdown as the filters, one choice), or take it back.
function mountClaimPicker() {
  const root = $('[data-claim-picker]');
  if (!root) return;
  const choices = playerChoices();
  const names = new Map(choices.map((x) => [x.key, x.name]));
  multiSelect(root, { label: 'Your name in the games', single: true, options: () => choices.map((x) => ({ value: x.key, label: x.name })),
    selected: () => (state.claimPick ? [state.claimPick] : []), nameOf: (k) => names.get(k) || k,
    onChange: (values) => { state.claimPick = values[0] || null; const m = $('#claim-msg'); if (m) m.textContent = ''; } });
}

const claimError = (r) => (r.error === 'unknown-action' ? 'The shared store needs updating before this works.' : r.message || 'Couldn\'t do that. Try again in a moment.');

document.addEventListener('click', async (e) => {
  const claim = e.target.closest('[data-claim]');
  const un = e.target.closest('[data-unclaim]');
  const remove = e.target.closest('[data-claim-remove]');
  const say = (text) => { const m = $('#claim-msg'); if (m) { m.className = 'msg err'; m.textContent = text; } };
  if (claim) {
    const pick = playerChoices().find((x) => x.key === state.claimPick);
    if (!pick) return say('Pick yourself from the list first.');
    claim.disabled = true;
    const r = await claimPlayer(state.settings, pick.key, pick.name).catch((err) => ({ ok: false, message: err.message }));
    claim.disabled = false;
    if (!r.ok) return say(claimError(r));
    state.profile = r.account;
    state.claimPick = null;
    render();
  } else if (un) {
    un.disabled = true;
    const r = await unclaimPlayer(state.settings).catch((err) => ({ ok: false, message: err.message }));
    un.disabled = false;
    if (!r.ok) return say(claimError(r));
    state.profile = r.account;
    render();
  } else if (remove) {
    const name = remove.dataset.claimRemove;
    if (!confirm(`Remove ${name}'s player? They can pick again.`)) return;
    remove.disabled = true;
    const r = await removeClaim(state.settings, name).catch((err) => ({ ok: false, message: err.message }));
    if (r.ok && state.shared.account && r.account.username.toLowerCase() === state.shared.account.username.toLowerCase()) state.profile = r.account;
    await loadAccounts();
    const m = $('#accounts-msg');
    if (m) { m.className = `msg ${r.ok ? 'ok' : 'err'}`; m.textContent = r.ok ? `Removed ${name}'s player.` : claimError(r); }
  }
});

// A password change on another device, or an editor's reset, signs this one out.
async function checkSignedIn() {
  if (!state.shared.account) return;
  const r = await whoAmI(state.settings).catch(() => null);
  if (r && r.ok && r.account) { state.profile = r.account; if (state.tab === 'data') render(); }
  if (r && r.ok && r.signedOut) {
    webAuth.clearAccount();
    state.signin = { mode: 'signin', open: false };
    await load();
    state.shared.status = { error: 'signed-out', message: 'You were signed out (your password was changed). Please sign in again.' };
    render();
  }
}

// Show what's cached straight away, then download anything new; check again every few minutes.
load().then(() => checkSignedIn()).then(() => syncShared());
setInterval(() => { if (document.visibilityState === 'visible') syncShared(); }, 5 * 60e3);

// Chrome serves this page's files fresh from disk, but keeps running the old background (which records games
// and fetches botc.app's art) until the extension is reloaded. Spot that and say so.
if (hasChrome) {
  fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }).then((r) => r.json()).then((m) => {
    const running = chrome.runtime.getManifest().version;
    if (m.version && m.version !== running) {
      const el = $('#update-banner');
      el.textContent = `Clockwise has been updated (${running} → ${m.version}). To finish, open chrome://extensions and click the circular reload arrow on the Clockwise card.`;
      el.hidden = false;
    }
  }).catch(() => {});
}
