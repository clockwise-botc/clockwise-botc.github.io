import { filterGames, overview, distinct, playerKey, displayNames, useDisplayNames, storytellerKeys } from './stats.js';
import { predictOutcome, tuneOutcomeModel } from './insights.js';
import { TYPES, emptySelection, hasSelection, selectGames, holds, focusSeats, outcome, seatStats, characterTable, companions, countEffect, relations, groupRelations, nominationStats, playerTable, tokenDraws } from './insights.js';
import { communityConfig, communityName, gameCommunity, NONE, DEFAULTS } from './communities.js';
import { communityMembers, communityHistory, suggestCommunity, setByChoice, whoOf, MIN_MEMBER_GAMES } from './members.js';
import { esc, pct, cap, plural, fmtDate, fmtTime, phaseLabel, teamLabel, teamOne, asType, isEvilTeam, playerLink as uiPlayerLink, charLink, typeLink, rateCell, delta, splitBars, legendGE, tile, card, table, pie, rings, rangeBar, fitted } from './ui.js';
import { renderData, handleDataClick, handleImport } from './dataview.js';
import { playstyles } from './playstyles.js';
import { tableTalk, nominationPairs, votePairs, enemies, allies, ENEMY_MIN_GAMES, MEASURES } from './tabletalk.js';
import { talkCell, playstyleBars, talkChartCard, talkChartBody, talkChartSub, talkCandidates, TOP_N, scatterCard, scatterSvg, scatterPick, SCATTER_MAX, SCATTER_DEFAULT, madlib, ASKED_SIDES } from './tabletalkview.js';
import { renderGrimoire } from './grimoire.js';
import { makeImages } from './images.js';
import { characterToken, installTokenStyle } from './tokens.js';
import { multiSelect } from './multiselect.js';
import { ALL_CHARACTERS } from './characters.js';
import { WEB, hasChrome, kv, creds, siteUrl, loadShared, refreshShared, mergeGames, dropLocalTwins, checkKey, sharedEdit, sharedDelete, webAuth, cacheClear, canReadWith, signUp, signIn, peekGames, whoAmI, changePassword, listAccounts, resetPassword, deleteAccount, claimPlayer, unclaimPlayer, removeClaim, setPrivate, saveCommunities } from './data.js';

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
const TABS = ['stats', 'me', 'styles', 'games', 'data'];
const prefs = (() => { try { return JSON.parse(localStorage.getItem('dash.prefs')) || {}; } catch { return {}; } })();
const state = {
  tab: readTab(),
  talkView: { measure: 'loud', side: 'all', extra: [] }, // Around the grimoire chart: measure, games, players always shown
  scatterView: { kind: 'noms', side: 'all', mode: 'spread', chosen: null }, // Playstyles scatter: nominations or votes, games, who's shown (spread, all, choose) and the chosen
  playstyleSide: 'all', // a player's "How you play" card: all games, as good or as evil
  statsView: null, // the Stats tab's view last picked: 'stats' (Overview) or 'styles' (Playstyles)
  minGames: 5, // Playstyles: games a player needs to be on the charts
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
  profile: !WEB || webAuth.account().token ? webAuth.profile() : undefined, // the signed-in account as the store has it (claimed player, own communities); undefined until checked
  claimPick: null, // the player picked in "Your player" before pressing Claim
  signin: { mode: 'signin', open: false }, // the website's sign-in screen: which form, and whether shown on request
};
const savePrefs = () => { try { localStorage.setItem('dash.prefs', JSON.stringify({ communities: state.filters.communities })); } catch {} };
const communityOptions = () => communityConfig(state.settings).communities.map((c) => ({ value: c.id, name: c.name }));
// On the website your own communities are only for filtering; a game itself goes under Escape or Rhap.
const gameCommunityOptions = () => (WEB ? communityOptions().filter((o) => DEFAULTS.communities.some((d) => d.id === o.value)) : communityOptions());
// The signed-in account (website): remembered on this device, and its own communities join Escape and Rhap.
function setProfile(p) {
  state.profile = p;
  webAuth.setProfile(p);
  // The extension records with your own communities too (the popup and background read them from settings).
  if (!WEB && p && JSON.stringify(p.communities || []) !== JSON.stringify(state.settings.accountCommunities || [])) {
    state.settings = { ...state.settings, accountCommunities: p.communities || [] };
    api.set('settings', state.settings);
  }
}
// Where the sign-in lives: the website keeps it in this browser's storage; the extension in its settings (shared
// with the popup, where people sign in).
async function keepToken(token) {
  if (WEB) { let remembered = false; try { remembered = !!localStorage.getItem('clockwise.token'); } catch {} webAuth.setAccount(token, state.shared.account.username, remembered); return; }
  state.settings = { ...state.settings, accountToken: token };
  await api.set('settings', state.settings);
}
async function forgetAccount() {
  webAuth.clearAccount();
  if (!WEB) { state.settings = { ...state.settings, accountToken: '', accountName: '', accountCommunities: [] }; await api.set('settings', state.settings); }
}
const withMyCommunities = (settings) => (WEB ? { ...settings, communities: [...DEFAULTS.communities, ...((state.profile && state.profile.communities) || [])] } : settings);
// On/off buttons for picking communities; `on` is the list of ids that are switched on.
const communityButtons = (attr, on, extra = '', options = communityOptions()) => options.map((o) => `<button class="toggle" ${attr}="${esc(extra + o.value)}" aria-pressed="${on.includes(o.value)}">${esc(o.name)}</button>`).join('');
const $ = (sel) => document.querySelector(sel);
const ctx = { state, api, load: () => load(), communityOptions,
  tools: { WEB, creds, siteUrl, checkKey, webAuth, cacheClear, forgetAccount: () => forgetAccount(), syncShared: () => syncShared(), nameOf: (key, fallback) => (playerNames.has(key) ? playerNames.get(key) : fallback || key), playerChoices: () => playerChoices() },
  // For Settings: is botc.app's token art in use, and if not, why.
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
// Each community's members (members.js), and players from games without a community. Rankings and player
// lists only show members of the communities being looked at, so people from another group's lobby who
// sat down with one of us don't turn up there (the games they played with us still count for us).
let members = new Map();
let freeKeys = new Set();
let images = makeImages(null);
let artAsked = false;
let roleMeta = {}; // per character: [first night, other nights, reminders, setup, edition], from botc.app
let charInfo = new Map();
const nameOf = (key) => playerNames.get(key) || key;
// "Hide player win rates" (the account's `private` setting): nobody sees these players' own win rates (their pages
// show other stats instead), and they're left out of rankings by win rate. Someone who turned it on sees no player's
// win rate at all. Win rates that aren't about a player (characters, types, good and evil, storytellers) stay.
let quietPlayers = new Set();
const myPlayer = () => (state.profile && state.profile.claim ? state.profile.claim.player : null);
const iAmQuiet = () => !!(state.profile && state.profile.claim && state.profile.profile && state.profile.profile.private);
const ratesHidden = (key) => iAmQuiet() || quietPlayers.has(key);
// A ranking of players by win rate, without those who hide theirs (and none at all for someone who hides them).
const ranked = (rows, keyOf = (r) => r.key) => (iAmQuiet() ? [] : rows.filter((r) => !quietPlayers.has(keyOf(r)) && isMember(keyOf(r))));
// A member of any of the communities picked in the filter (all of them when none is picked). You always are.
function isMember(key) {
  if (key === myPlayer() || freeKeys.has(key)) return true;
  const ids = state.filters.communities.length ? state.filters.communities : [...members.keys()];
  return ids.some((c) => members.has(c) && members.get(c).has(key));
}
const memberRows = (rows, keyOf = (r) => r.key) => rows.filter((r) => isMember(keyOf(r)));
const playerLink = uiPlayerLink;
// Everyone who has played, for "Your player": [{ key, name }] by name, with a number added when two share a name.
function playerChoices() {
  // While setting up a new account (not signed in yet), the players come from the games the community password shows.
  const list = state.setup ? state.setup.players.map((x) => ({ ...x })) : [...playerKeys].map((key) => ({ key, name: nameOf(key) })).filter((x) => x.name);
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

function frequencyCard(id, title, sub, rows, linkFn) {
  const max = Math.max(1, ...rows.map((r) => r.games));
  const body = rows.length ? fitted(id, rows.map((r) => `<tr><td>${linkFn(r)}</td><td class="num">${plural(r.games, 'game')}</td><td style="width:40%"><div class="freq-bar" data-tip="${esc(`${r.name}: ${plural(r.games, 'game')}`)}"><i style="width:${(r.games / max) * 100}%"></i></div></td></tr>`), { expanded: state.expanded.has(id), wrap: (inner) => `<table><tbody>${inner}</tbody></table>` }) : '<p class="muted">Not recorded yet.</p>';
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

// A name as a tile's big value, shrunk to fit long names.
const tileName = (key, name) => `<span style="font-size:${Math.min(1, 11 / Math.max(1, [...name].length)).toFixed(2)}em">${playerLink(key, name)}</span>`;

// Whoever drew the most evil tokens (Minion or Demon, the character they started with) in these games. A tie goes to
// whoever drew them in fewer games, then the name.
function mostEvilDrawn(base) {
  const seats = new Map();
  for (const g of base) for (const p of g.players) { const k = playerKey(p); if (k && isMember(k)) (seats.get(k) || seats.set(k, []).get(k)).push({ g, p }); }
  let best = null;
  for (const [key, list] of seats) {
    const d = tokenDraws(list);
    const r = { key, name: nameOf(key), n: d.evil.n, games: d.games };
    if (r.n > 0 && (!best || r.n > best.n || (r.n === best.n && (r.games < best.games || (r.games === best.games && r.name.localeCompare(best.name) < 0))))) best = r;
  }
  return best;
}

// The win rate spotlights: the best record over the last 30 days, overall, as good and as evil, among players with
// enough games in that time: at least SPOTLIGHT_MIN (fewer as evil, since evil comes up less often), or 30% of the
// most anyone played on that side in the window, whichever is more. The window moves with each day,
// so who's featured changes over time. A tie goes to whoever has more games behind the rate, then whoever played
// most recently, then the name. Players who hide their win rates, and players who aren't members of the communities
// being looked at (members.js), are left out; someone who hides theirs sees none.
const SPOTLIGHT_DAYS = 30;
const SPOTLIGHT_MIN = { all: 5, good: 4, evil: 3 };
function spotlightTiles(base) {
  if (iAmQuiet()) return '';
  const since = Date.now() - SPOTLIGHT_DAYS * 864e5;
  const recs = new Map();
  for (const g of base) {
    if (!(g.endedAt >= since)) continue;
    for (const p of g.players) {
      const k = playerKey(p);
      if (!k || quietPlayers.has(k) || !isMember(k) || (p.won !== true && p.won !== false)) continue;
      const r = recs.get(k) || recs.set(k, { key: k, name: nameOf(k), last: 0, all: { plays: 0, wins: 0 }, good: { plays: 0, wins: 0 }, evil: { plays: 0, wins: 0 } }).get(k);
      r.last = Math.max(r.last, g.endedAt);
      for (const side of ['all', p.alignment]) if (r[side]) { r[side].plays++; if (p.won) r[side].wins++; }
    }
  }
  const minFor = (side) => Math.max(SPOTLIGHT_MIN[side], Math.ceil(0.3 * Math.max(0, ...[...recs.values()].map((r) => r[side].plays))));
  const best = (side) => [...recs.values()].filter((r) => r[side].plays >= minFor(side) && r[side].wins > 0)
    .sort((a, b) => b[side].wins / b[side].plays - a[side].wins / a[side].plays || b[side].plays - a[side].plays || b.last - a.last || a.name.localeCompare(b.name))[0];
  // The overall one carries the page's highlight.
  const spot = (side, label, as) => {
    const r = best(side);
    const cls = `highlight spot spot-${side}${side === 'all' ? ' feature' : ''}`;
    const tip = `Over the last ${SPOTLIGHT_DAYS} days, among players with at least ${minFor(side)} games${as ? ` ${as}` : ''} in that time.`;
    const title = `${label} <span class="info" data-tip="${esc(tip)}" aria-label="${esc(tip)}">ⓘ</span>`;
    return r ? tile(title, tileName(r.key, r.name), `won ${pct(r[side].wins / r[side].plays)} of ${plural(r[side].plays, 'game')}${as ? ` ${as}` : ''} · last ${SPOTLIGHT_DAYS} days`, cls)
      : tile(title, '–', `no one with ${minFor(side)}+ games${as ? ` ${as}` : ''} in the last ${SPOTLIGHT_DAYS} days`, cls);
  };
  return `<div class="tiles spotlights">${spot('all', 'Highest win rate', '')}${spot('good', 'Highest win rate as good', 'as good')}${spot('evil', 'Highest win rate as evil', 'as evil')}</div>`;
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
      sortable(`swing-good${id}`, [...cols, colDelta('vs. overall', (c) => c.delta)], forGood, { sort: 3, empty: 'Not enough games yet.' }))}
    ${card(`${what} that help evil`, 'Evil wins more often when these are in play.',
      sortable(`swing-evil${id}`, [...cols, { ...colDelta('vs. overall', (c) => -c.delta), cell: (r) => td(delta(r.delta), true) }], forEvil, { sort: 3, empty: 'Not enough games yet.' }))}`;
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
    sortable('st-chars', cols, rows, { sort: comparable.length ? 3 : 1, empty: 'No characters recorded yet.' }));
}

// Cards about a set of games that make sense on any stats page. The overview uses them, and every page keeps the
// ones it isn't showing as spares to fill out its last row (fillRows). Each returns '' when it has nothing to compare.
const gamesCards = {
  balance: (G) => balanceCard(overview(G)),
  playerCount: (G) => playerCountCard(G),
  players: (G) => {
    const rows = memberRows(playerTable(G)).map((p) => ({ key: p.key, name: p.name, games: p.plays })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    return rows.length > 1 ? frequencyCard('freq-players', 'Most frequent players', 'Who has played the most games. Click a name to see their stats.', rows, (r) => playerLink(r.key, r.name)) : '';
  },
  storytellers: (G) => {
    const rows = storytellerTable(G);
    return rows.length > 1 ? frequencyCard('freq-sts', 'Most frequent storytellers', 'Who has run the most games.', rows, (r) => (playerKeys.has(r.key) ? playerLink(r.key, r.name) : esc(r.name))) : '';
  },
  scripts: (G) => { const rows = overview(G).byScript; return rows.length > 1 ? card('Who wins, by script', '', legendGE() + bars('o-scripts', rows, (r) => esc(r.key))) : ''; },
  counts: (G) => { const rows = overview(G).byPlayerCount; return rows.length > 1 ? card('Who wins, by player count', '', legendGE() + bars('o-counts', rows, (r) => `${r.key} players`)) : ''; },
  storytellerWins: (G) => { const rows = overview(G).byStoryteller; return rows.length > 1 ? card('Who wins, by storyteller', '', legendGE() + bars('o-sts', rows, (r) => esc(r.name))) : ''; },
  communities: (G) => {
    const rows = overview(G).byCommunity.filter((r) => r.key);
    return rows.length > 1 ? card('Who wins, by community', 'Good and evil win rates in each community.', legendGE() + bars('o-communities', rows, (r) => esc(communityName(state.settings, r.key)))) : '';
  },
  characters: (G) => {
    const m = new Map();
    for (const g of G) for (const p of g.players) if (p.roleId) { const r = m.get(p.roleId) || { key: p.roleId, name: charName(p.roleId), games: 0 }; r.games++; m.set(p.roleId, r); }
    const rows = [...m.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    return rows.length > 1 ? frequencyCard('freq-chars', 'Most played characters', 'The characters that came up most. Click one to see how it does.', rows, (r) => charLink(r.key, r.name)) : '';
  },
  nominations: (G) => {
    const keys = [...new Set(G.flatMap((g) => g.players.map(playerKey)).filter(Boolean))];
    const n = nominationStats(G, keys);
    return n.made ? card('Nominations and votes', 'Averages per game, from every recorded nomination.', `<div class="mini-tiles">
      <div><b>${(n.made / G.length).toFixed(1)}</b><span>nominations per game</span></div>
      <div><b>${pct(n.accuracy)}</b><span>of nominations were on evil players</span></div>
      <div><b>${(n.votes / n.made).toFixed(1)}</b><span>votes per nomination</span></div>
      <div><b>${pct(n.voteAccuracy)}</b><span>of votes were on evil players</span></div>
      <div><b>${n.executed}</b><span>executions</span></div>
      <div><b>${(n.executed / G.length).toFixed(1)}</b><span>executions per game</span></div></div>`) : '';
  },
  demons: (G) => {
    const m = new Map();
    for (const g of G) for (const d of new Set(g.players.filter((p) => p.team === 'demon' && p.roleId).map((p) => p.roleId))) {
      const r = m.get(d) || { key: d, games: 0, good: 0, evil: 0 }; r.games++; r[g.winner === 'evil' ? 'evil' : 'good']++; m.set(d, r);
    }
    const rows = [...m.values()].sort((a, b) => b.games - a.games);
    return rows.length > 1 ? card('Who wins, by Demon', 'Which side won, by which Demon was in play.', legendGE() + bars('o-demons', rows, (r) => charLink(r.key, charName(r.key)))) : '';
  },
};
// The order spares are used in: the most useful first.
const SPARES = ['communities', 'characters', 'nominations', 'demons', 'scripts', 'counts', 'storytellerWins', 'players', 'storytellers', 'balance', 'playerCount'];

// Cards about the picked seats (a player's, a character's holders', a type's), for pages with a selection: how they
// do by storyteller, player count, script and Demon in play, their recent games, and (players) who they play with.
function seatCards(G, sel, seats) {
  const who = sel.players.length ? esc(seatsLabel(sel)) : sel.characters.length === 1 ? `The ${esc(charName(sel.characters[0]))} holder` : sel.characters.length ? 'The holders' : esc(seatsLabel(sel));
  const byKey = (keyOf, labelOf) => {
    const m = new Map();
    for (const x of seats) for (const k of [].concat(keyOf(x)).filter((v) => v !== null && v !== undefined)) {
      const r = m.get(k) || { key: k, plays: 0, wins: 0 }; r.plays++; if (x.p.won) r.wins++; m.set(k, r);
    }
    return [...m.values()].map((r) => [labelOf(r.key), r.wins / r.plays, r.plays, 'neutral', r.key]);
  };
  // Players who hide win rates get the number of games instead.
  const quiet = sel.players.some(ratesHidden);
  const rateCard = (id, title, sub, rows, sortBy = (a, b) => b[2] - a[2], countSub = sub) => (rows.length < 2 ? ''
    : quiet ? frequencyCard(id, title, countSub, rows.sort(sortBy).map((r) => ({ label: r[0], name: r[0].replace(/<[^>]*>/g, ''), games: r[2] })), (r) => r.label)
      : card(title, sub, rateRows(rows.sort(sortBy).map((r) => r.slice(0, 4)), id)));
  const out = {};
  out.storytellers = rateCard('s-sts', 'By storyteller', `${who}'s win rate with each storyteller.`,
    byKey((x) => storytellerKeys(x.g), (k) => esc(nameOf(k))), undefined, `${who}'s games with each storyteller.`);
  out.counts = rateCard('s-counts', 'By player count', `${who}'s win rate by how many players sat down.`,
    byKey((x) => x.g.playerCount, (k) => `${k} players`), (a, b) => a[4] - b[4], `${who}'s games by how many players sat down.`);
  out.scripts = rateCard('s-scripts', 'By script', `${who}'s win rate on each script.`, byKey((x) => x.g.script.name || 'Unknown script', esc), undefined, `${who}'s games on each script.`);
  // Which Demon was in the game (not when they were the Demon themselves).
  const facing = seats.filter((x) => x.p.team !== 'demon');
  const side = facing.length && facing.every((x) => x.p.alignment === 'good') ? 'Against each Demon' : facing.length && facing.every((x) => x.p.alignment === 'evil') ? 'With each Demon' : 'By Demon in play';
  const demonRows = (() => { const m = new Map(); for (const x of facing) for (const d of x.g.players) if (d !== x.p && d.team === 'demon' && d.roleId) { const r = m.get(d.roleId) || { key: d.roleId, plays: 0, wins: 0 }; r.plays++; if (x.p.won) r.wins++; m.set(d.roleId, r); } return [...m.values()].map((r) => [charLink(r.key, charName(r.key)), r.wins / r.plays, r.plays, 'neutral']); })();
  out.demons = rateCard('s-demons', quiet ? 'Demons in their games' : side, `${who}'s win rate by which Demon was in the game.`, demonRows, undefined, `How often each Demon was in ${who}'s games.`);
  // Who a player plays with most (only with players picked). One player's own page shows when they die instead,
  // unless they hide win rates (their page already has that card in place of their win rates).
  const ownPage = sel.players.length === 1 && !sel.characters.length && !sel.types.length && !ratesHidden(sel.players[0]);
  if (sel.players.length && !ownPage) {
    const picked = new Set(sel.players), m = new Map();
    for (const g of new Set(seats.map((x) => x.g))) for (const p of g.players) { const k = playerKey(p); if (k && !picked.has(k)) { const r = m.get(k) || { key: k, name: nameOf(k), games: 0 }; r.games++; m.set(k, r); } }
    const rows = [...m.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    out.with = rows.length > 1 ? frequencyCard('s-with', 'Played with most', `Who was in the most games with ${esc(listWords(sel.players.map(nameOf)))}.`, rows, (r) => playerLink(r.key, r.name)) : '';
  }
  if (!quiet) out.alignment = rateCard('s-alignment', 'As good and as evil', `${who}'s win rate on each side.`,
    byKey((x) => x.p.alignment || null, (k) => (k === 'evil' ? 'As evil' : 'As good')).map((r) => [r[0], r[1], r[2], r[4] === 'evil' ? 'evil' : 'good', r[4]]));
  return ['with', 'demons', 'alignment', 'storytellers', 'counts', 'scripts'].map((k) => out[k]).filter(Boolean);
}

// Spare cards for a page, hidden until fillRows needs them; leaves out any whose title the page already shows. The
// overview's are about the games; a page with players, characters or types picked gets ones about those seats.
function spareCards(G, sel, seats, shown) {
  const titles = new Set([...shown.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]));
  const pool = hasSelection(sel) ? seatCards(G, sel, seats) : SPARES.map((k) => gamesCards[k](G));
  return pool.filter((html) => html && !titles.has((html.match(/<h3>([^<]*)<\/h3>/) || [])[1]))
    .map((html) => html.replace('<div class="card', '<div data-spare hidden class="card')).join('');
}

function overallSections(base) {
  // With one storyteller picked, the storyteller cards would only repeat them; compare them with the others instead.
  const st = state.filters.storyteller;
  const others = st ? otherStorytellerGames(st) : [];
  return `
    ${gamesCards.balance(base)}
    ${gamesCards.playerCount(base)}
    ${gamesCards.players(base)}
    ${stylesTeaser(base)}
    ${st ? storytellerCompareCard(nameOf(st), base, others) : gamesCards.storytellers(base)}
    ${gamesCards.scripts(base)}
    ${gamesCards.counts(base)}
    ${st ? storytellerCharactersCard(nameOf(st), base, others) : gamesCards.storytellerWins(base)}
    ${swingCards(base, 'Characters')}
    ${gamesCards.communities(base)}
    ${gamesCards.characters(base)}
    ${gamesCards.nominations(base)}`;
}

// Sortable table: click a column label to sort by it (▼); click it again to flip the order (▲).
// "▼" is the natural order for that column: biggest first for numbers, A→Z for names.
// cols: [{ label, value: (row) => sort value, cell: (row) => '<td>…</td>', num }]
const td = (html, num) => `<td${num ? ' class="num"' : ''}>${html}</td>`;
// sort: null keeps the rows in the order given (e.g. most played first, without a Plays column) until a label is clicked.
// Rows marked `unplayed` always go last, greyed out. `more`: the button's label when it shows something besides the
// hidden rows (it then shows even when every row fits).
function sortable(id, cols, data, { sort = 0, limit, empty, more = null } = {}) {
  const cur = state.sorts[id] && cols[state.sorts[id].col] ? state.sorts[id] : { col: sort === null ? -1 : sort, rev: false };
  const col = cols[cur.col] || { value: () => 0 };
  const missing = (v) => v === null || v === undefined || Number.isNaN(v);
  const rows = data.map((r, i) => ({ r, i, v: col.value(r) })).sort((a, b) => {
    if (!!a.r.unplayed !== !!b.r.unplayed) return a.r.unplayed ? 1 : -1;
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
  return table(id, head, rows.map(({ r }) => `<tr${r.unplayed ? ' class="unplayed"' : ''}>${cols.map((c) => c.cell(r)).join('')}</tr>`), { limit, expanded: state.expanded.has(id), empty, more });
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

// With an `id`, only the first LIST_LIMIT rows show until "Show all" is clicked.
const bars = (id, rows, label) => splitBars(rows, label, label, { id, expanded: state.expanded.has(id) });
function rateRows(rows, id = null) {
  const html = rows.map(([label, r, n, cls]) => `<tr><td>${label}</td><td class="num muted">${n === undefined ? '' : plural(n, 'game')}</td><td>${rateCell(r, n, cls)}</td></tr>`);
  const wrap = (inner) => `<table class="rows"><tbody>${inner}</tbody></table>`;
  return id ? fitted(id, html, { expanded: state.expanded.has(id), wrap }) : wrap(html.join(''));
}

// Shares of the tokens drawn, each with a line at the chance of drawing it. Rows: [label, {n, share, chance}, cls, plain label].
function drawRows(rows, games) {
  return `<table class="rows"><tbody>${rows.map(([label, r, cls, plain = label]) => `<tr><td>${label}</td><td class="num muted">${r.n} of ${games}</td><td>${r.share === null ? '<span class="muted">–</span>'
    : `<div class="rate" data-tip="${esc(`${plain}: ${r.n} of ${plural(games, 'game')} (${pct(r.share)})\nBy chance: ${pct(r.chance)}`)}"><b>${pct(r.share)}</b><div class="meter at ${cls}"><i style="width:${Math.max(r.share * 100, 1)}%"></i><em style="left:${r.chance * 100}%"></em></div></div>`}</td></tr>`).join('')}</tbody></table>`;
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

// winCard's counterpart for a player who hides win rates: how often they were good and evil, and survived.
function sidesCard(st, title, sub = '') {
  const share = (n) => (st.plays ? n / st.plays : null);
  const chart = rings([
    { label: 'Good', rate: share(st.good.plays), color: 'var(--good)', tip: `Good in ${st.good.plays} of ${plural(st.plays, 'game')}` },
    { label: 'Evil', rate: share(st.evil.plays), color: 'var(--evil)', tip: `Evil in ${st.evil.plays} of ${plural(st.plays, 'game')}` },
    { label: 'Survived', rate: st.survivalRate, color: 'var(--neutral)', tip: `Survived ${st.survived} of ${plural(st.plays, 'game')}` },
  ], { ariaLabel: `Good in ${pct(share(st.good.plays))} of games, evil in ${pct(share(st.evil.plays))}, survived ${pct(st.survivalRate)}` });
  const row = (cls, label, n) => `<li><i class="sw ${cls}"></i><span class="k">${label}</span><span class="vs">${n} of ${plural(st.plays, 'game')}</span></li>`;
  return `<div class="card pie-card"><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="pie-wrap">${chart}</div><ul class="ring-key">${row('good', 'Good', st.good.plays)}${row('evil', 'Evil', st.evil.plays)}${row('neutral', 'Survived', st.survived)}</ul></div>`;
}

function playerHero(base, key, st) {
  return `<div class="span-all"><div class="grid four">${winCard(st, othersRates(base, key))}${heroTokens(st)}</div></div>`;
}

// The top row's character cards: most played, and best and worst performing. Best and worst are about characters,
// not the player's own win rate, so players who hide win rates keep them too.
function heroTokens(st) {
  // Best/worst need at least 2 plays, so one lucky (or unlucky) game doesn't decide it.
  const chars = st.byCharacter;
  const most = chars[0] || null;
  const eligible = chars.filter((c) => c.plays >= 2);
  const best = [...eligible].sort((a, b) => b.winRate - a.winRate || b.plays - a.plays)[0] || null;
  const worstPick = [...eligible].sort((a, b) => a.winRate - b.winRate || b.plays - a.plays)[0] || null;
  const worst = eligible.length >= 2 && worstPick !== best ? worstPick : null;
  const rule = 'Win rate among characters they have played at least twice.';
  return `
    ${tokenCard('Most played', '', most, most ? `Played the ${esc(most.name)} in ${plural(most.plays, 'game')}.` : '')}
    ${tokenCard('Best performing', rule, best, best ? `Won ${best.wins} of ${plural(best.plays, 'game')} as the ${esc(best.name)} (${pct(best.winRate)}).` : '')}
    ${tokenCard('Worst performing', `${rule} Needs at least two such characters.`, worst, worst ? `Won ${worst.wins} of ${plural(worst.plays, 'game')} as the ${esc(worst.name)} (${pct(worst.winRate)}).` : '')}`;
}

// Every character on botc.app by type, alphabetically, the ones they've played in full colour and the rest faded, so
// players can see which they haven't had yet. The tooltips leave out win rates when they're hidden.
function collectionCard(key, st) {
  const { all } = collection(st);
  const played = new Map(st.byCharacter.map((c) => [c.roleId, c]));
  const quiet = ratesHidden(key);
  const cols = TYPES.map((t) => {
    const list = all.filter((c) => c[2] === t).map(([roleId, name, team]) => ({ roleId, name, team, plays: 0, winRate: null, ...(played.get(roleId) || {}) })).sort((a, b) => a.name.localeCompare(b.name));
    const n = list.filter((c) => c.plays).length;
    const toks = list.map((c) => {
      const icon = images.character(c.roleId, c.team, null, null);
      const tip = !c.plays ? `${c.name}: not played yet` : quiet ? `${c.name}: played ${plural(c.plays, 'time')}` : `${c.name}: played ${plural(c.plays, 'time')}, won ${c.wins} (${pct(c.winRate)})`;
      return `<div class="coll-tok${c.plays ? '' : ' no'}" data-tip="${esc(tip)}">${characterToken({ id: c.roleId, name: c.name, team: c.team, icon, fallback: images.fallback(c.roleId, icon), meta: roleMeta[c.roleId] })}</div>`;
    }).join('');
    return `<div class="coll-col coll-${t}"><h4>${esc(teamLabel(t))} <span>(${n}/${list.length})</span></h4><div class="coll-grid">${toks}</div></div>`;
  }).join('');
  const sub = key === myPlayer()
    ? 'Every character in Blood on the Clocktower. The ones you\'ve played are highlighted. Hover to see your plays, or click to explore your stats.'
    : 'Every character in Blood on the Clocktower. The ones they\'ve played are highlighted. Hover to see their plays, or click to explore their stats.';
  return `<div class="card collection"><h3>Character collection</h3><p class="sub">${sub}</p><div class="coll">${cols}</div></div>`;
}

// Their three most played characters of each type, a card each: the most played large, the next two either side.
function mostPlayedByType(st) {
  const tok = (c, cls) => {
    if (!c) return `<div class="bt-tok ${cls}"><div class="ctok bt-blank"></div></div>`;
    const icon = images.character(c.roleId, c.team, null, null);
    return `<div class="bt-tok ${cls}" data-tip="${esc(`${c.name}: ${plural(c.plays, 'game')}`)}">${characterToken({ id: c.roleId, name: c.name, team: c.team, icon, fallback: images.fallback(c.roleId, icon), meta: roleMeta[c.roleId] })}<span class="bt-n">${c.plays}</span></div>`;
  };
  const cols = TYPES.map((t) => {
    const [a, b, c] = st.byCharacter.filter((x) => x.team === t);
    return `<div class="card bt-col" data-tip="${esc(`Most played ${teamLabel(t)}`)}"><h3>${esc(teamLabel(t))}</h3><div class="bt-toks">${tok(b, 'bt-l')}${tok(a, 'bt-big')}${tok(c, 'bt-r')}</div></div>`;
  }).join('');
  // A card per type, side by side across the page.
  return `<div class="span-all"><div class="bytype">${cols}</div></div>`;
}

// Every character on botc.app, split into the ones these seats have played and the ones they haven't yet.
function collection(st) {
  const playedIds = new Set(st.byCharacter.map((c) => c.roleId));
  const onBotc = Object.keys(roleMeta).length > 20 ? (cid) => cid in roleMeta : () => true;
  const all = ALL_CHARACTERS.filter(([cid]) => playedIds.has(cid) || onBotc(cid));
  const unplayed = all.filter(([cid]) => !playedIds.has(cid)).map(([roleId, name, team]) => ({ roleId, name, team, plays: 0, winRate: null, unplayed: true }));
  return { playedIds, all, unplayed };
}

// The top row for a player who hides win rates: how many characters they've played (good, evil and all) in place of
// their win rate.
function quietHero(st) {
  const { playedIds, all } = collection(st);
  const side = (teams) => { const ids = all.filter((c) => teams.includes(c[2])).map((c) => c[0]); return { n: ids.filter((id) => playedIds.has(id)).length, of: ids.length }; };
  const good = side(['townsfolk', 'outsider']), evil = side(['minion', 'demon']), every = { n: playedIds.size, of: all.length };
  const frac = (x) => (x.of ? x.n / x.of : 0);
  const chart = rings([
    { label: 'Good', rate: frac(good), color: 'var(--good)', tip: `Good characters: played ${good.n} of ${good.of}` },
    { label: 'Evil', rate: frac(evil), color: 'var(--evil)', tip: `Evil characters: played ${evil.n} of ${evil.of}` },
    { label: 'All', rate: frac(every), color: 'var(--neutral)', tip: `All characters: played ${every.n} of ${every.of}` },
  ], { ariaLabel: `Played ${good.n} of ${good.of} good characters, ${evil.n} of ${evil.of} evil, ${every.n} of ${every.of} in all` });
  const row = (cls, label, x) => `<li><i class="sw ${cls}"></i><span class="k">${label}</span><span class="vs">${x.n} of ${x.of}</span></li>`;
  const ring = `<div class="card pie-card"><h3>Characters collected</h3><div class="pie-wrap">${chart}</div><ul class="ring-key">${row('good', 'Good', good)}${row('evil', 'Evil', evil)}${row('neutral', 'All', every)}</ul></div>`;
  return `<div class="span-all"><div class="grid four">${ring}${heroTokens(st)}</div></div>`;
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
    const quiet = ratesHidden(key);
    if (quiet) {
      // How often they hold it, next to how often other players do (their seats in the same games).
      const otherSeats = base.reduce((n, g) => n + g.players.filter((p) => playerKey(p) && !picked.has(playerKey(p)) && p.team !== 'traveller').length, 0);
      const share = (label, n, of, cls) => `<tr><td>${label}</td><td class="num muted">${n} of ${of}</td><td>${rateCell(of ? n / of : null, of, `${cls} at`, 'Share', `${n} of ${plural(of, 'game')}`)}</td></tr>`;
      out.push(card(`How often ${name} is ${as}`, `Share of ${name}'s games as ${as}, next to other players' games in the same filters.`,
        `<table class="rows"><tbody>${share(name, st.plays, allSt.plays, role.cls || charCls(seats[0].p))}${share(`Other players`, os.plays, otherSeats, 'neutral')}</tbody></table>`));
    }
    const rows = [
      [`As ${as}`, st.winRate, st.plays, role.cls || charCls(seats[0].p)],
      [`Other players as ${as}`, os.winRate, os.plays, 'neutral'],
      [role.byType ? `As any other type` : `When another player was ${as}`, ow.winRate, ow.plays, 'neutral'],
      [`All ${name}'s games`, allSt.winRate, allSt.plays, 'neutral'],
    ].filter((r) => r[2] > 0);
    if (!quiet) out.push(card(`How ${name} does as ${as}`, `${name}'s win rate as ${as}, next to other players as ${as} and ${name}'s other games.`, rateRows(rows)));
    out.push(card(`When ${name} dies as ${as}`, `Survived to the end in ${pct(st.survivalRate)} of these games${os.plays ? `, against ${pct(os.survivalRate)} for other players as ${as}` : ''}.`, deathBars(st.deathTiming, st.plays)));
    if (role.many) {
      out.push(card(role.byType ? `Characters played as ${as}` : 'Character by character', `Click a character to see how ${name} does with it. Click a column to sort.`,
        sortable('held-chars', [colChar(), colNum('Plays', (c) => c.plays), ...(quiet ? [] : [colRate('Win rate', (c) => c.winRate, (c) => c.plays, charCls)])], st.byCharacter, { sort: 1 })));
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
      out.push(card(quiet ? 'Demons in these games' : side, quiet ? `Which Demon was in the game when ${name} was ${as}. Click a column to sort.` : `${name}'s win rate as ${as}, by which Demon was in the game. Click a column to sort.`,
        sortable('held-demons', [{ label: 'Demon', value: (r) => r.name || '', cell: (r) => td(esc(r.name || 'Unknown')) }, colNum('Games', (r) => r.plays), ...(quiet ? [] : [colRate('Win rate', (r) => r.winRate, (r) => r.plays, sideOf || 'neutral')])], demonRows, { sort: 1 })));
    }
    if (byScript.size > 1) {
      const scriptRows = [...byScript.values()].sort((x, y) => y.plays - x.plays);
      out.push(quiet ? frequencyCard('held-scripts', 'By script', `${name}'s games as ${as} on each script.`, scriptRows.map((r) => ({ name: r.key, games: r.plays })), (r) => esc(r.name))
        : card('By script', `${name}'s win rate as ${as} on each script.`, rateRows(scriptRows.map((r) => [esc(r.key), r.wins / r.plays, r.plays, 'evil']), 'held-scripts')));
    }
  } else {
    const names = sel.players.map(nameOf);
    if (iAmQuiet()) {
      out.push(frequencyCard('held-each', `How often they were ${as}`, `Games where ${esc(listWords(names))} were each ${as}.`,
        sel.players.map((k) => ({ key: k, name: nameOf(k), games: seats.filter((x) => playerKey(x.p) === k).length })), (r) => playerLink(r.key, r.name)));
      return out.join('');
    }
    out.push(card(`How they do as ${as}`, `Games where ${esc(listWords(names))} were each ${as}.`, rateRows([
      ...sel.players.map((k) => { const s2 = seatStats(seats.filter((x) => playerKey(x.p) === k)); return [playerLink(k, nameOf(k)), quietPlayers.has(k) ? null : s2.winRate, s2.plays, 'neutral']; }),
      [`Other players as ${as}`, os.winRate, os.plays, 'neutral'],
    ].filter((r) => r[2] > 0))));
  }
  return out.join('');
}

// ---------- around the grimoire (per day alive, next to the average) ----------
// Worked out once per set of games: the main page's chart and the player page both use it.
let talkCache = { games: null, min: null, out: null };
function talk(base, min = null) {
  if (talkCache.games !== base || talkCache.min !== min) talkCache = { games: base, min, out: tableTalk(base, { minGames: min }) };
  return talkCache.out;
}
// The Around the grimoire chart and the scatter redraw in place (so the scatter's picker stays open while picking).
// width: the scatter's room (so it's drawn at its real size); the last one measured until the card is on the page.
let scatterWidth = 0;
const talkHelpers = () => { const b = $('#sc-body'); if (b && b.clientWidth) scatterWidth = b.clientWidth; return { playerLink, me: myPlayer(), width: scatterWidth || 680 }; };
function refreshTalkChart() {
  const body = $('#tt-chart');
  if (!body) return;
  const T = talk(baseGames(), state.minGames);
  body.innerHTML = talkChartBody(T, state.talkView, talkHelpers());
  const sub = $('.tt-chart-card > .sub');
  if (sub) sub.textContent = talkChartSub(T, state.talkView);
  if (alwaysPicker) alwaysPicker.refresh();
}
// "Always show" on the Around the grimoire chart: players added to its top and bottom 10. You're always on it (ticked,
// and can't be unticked).
let alwaysPicker = null;
function mountAlwaysPicker() {
  const root = $('[data-ms-always]');
  alwaysPicker = null;
  if (!root) return;
  const me = myPlayer();
  const extra = () => state.talkView.extra.filter((k) => k !== me);
  alwaysPicker = multiSelect(root, {
    label: `Show top & bottom ${TOP_N}, plus`, nameOf, noAll: true,
    summary: () => { const n = extra().length; return me ? (n ? `You + ${plural(n, 'player')}` : 'You') : (n ? plural(n, 'player') : 'No one'); },
    options: () => talkCandidates(talk(baseGames(), state.minGames), state.talkView, me)
      .map((p) => ({ value: p.key, label: p.name, sub: p.key === me ? 'You' : '', locked: p.key === me }))
      .sort((a, b) => (b.value === me) - (a.value === me) || a.label.localeCompare(b.label)),
    selected: () => [...(me ? [me] : []), ...extra()],
    onChange: (values) => { state.talkView.extra = values.filter((k) => k !== me); refreshTalkChart(); },
  });
}
let scatterPicker = null;
// Redraw the scatter at its new width when the window changes size.
let scatterResize = 0;
window.addEventListener('resize', () => { clearTimeout(scatterResize); scatterResize = setTimeout(() => { if ($('#sc-body')) refreshScatter(); }, 150); });
function refreshScatter(message = '') {
  const body = $('#sc-body'), note = $('#sc-note');
  if (!body) return;
  const T = talk(baseGames(), state.minGames);
  body.innerHTML = scatterSvg(T, state.scatterView, talkHelpers());
  // The line under the heading only says something when a pick couldn't be made.
  note.hidden = !message;
  note.innerHTML = message ? `<b class="sc-warn">${esc(message)}</b>` : '';
  if (scatterPicker) scatterPicker.refresh();
}
// "Show players" on the scatter, one dropdown: 20 across the chart, all players, or "Choose players…", which turns the
// same list into everyone who can be on it, ticked if they are (starting from whoever is shown). Ticking adds,
// unticking removes, up to SCATTER_MAX.
function mountScatterPicker() {
  const root = $('[data-ms-scatter]');
  scatterPicker = null;
  if (!root) return;
  const pick = () => scatterPick(talk(baseGames(), state.minGames), state.scatterView, talkHelpers());
  const presets = [{ value: 'spread', label: `${SCATTER_DEFAULT} players spread across the chart` }, { value: 'all', label: 'All players' }];
  scatterPicker = multiSelect(root, {
    label: 'Show', nameOf, noAll: true, presets, chooseLabel: 'Choose players…',
    preset: () => (state.scatterView.mode === 'choose' ? null : state.scatterView.mode || 'spread'),
    onPreset: (v) => { state.scatterView.mode = v; refreshScatter(); },
    onChoose: () => { state.scatterView.chosen = pick().shown.map((p) => p.key); state.scatterView.mode = 'choose'; refreshScatter(); },
    summary: () => (state.scatterView.mode === 'choose' ? plural(pick().shown.length, 'selected player') : presets.find((o) => o.value === (state.scatterView.mode || 'spread')).label),
    options: () => pick().cands.map((p) => ({ value: p.key, label: p.name, sub: p.key === myPlayer() ? 'You' : plural(p.games, 'game') })).sort((a, b) => a.label.localeCompare(b.label)),
    selected: () => pick().shown.map((p) => p.key),
    onChange: (values) => {
      if (values.length > SCATTER_MAX) { refreshScatter(`Up to ${SCATTER_MAX} players at once.`); return; }
      state.scatterView.chosen = values;
      refreshScatter();
    },
  });
}

// "How you play [across all games]" (another player's: "How wren plays"): the six Around the grimoire measures as bars,
// each next to the average player in the same games, for all games, as good or as evil (the dropdown in the heading,
// like the Playstyles charts' questions).
const PLAYSTYLE_LABELS = { loud: 'Nominations per day alive', nominated: 'Times nominated per day alive', voter: 'Votes on nominations while alive', nomOther: 'Nominations targeting the opposing team', voteOther: 'Votes targeting the opposing team', life: 'Share of the game spent alive' };
function talkCard(base, key) {
  const T = talk(base);
  if (!T.all.players.some((p) => p.key === key)) return '';
  const side = state.playstyleSide || 'all';
  const mine = key === myPlayer();
  const name = esc(nameOf(key));
  const how = `As good and as evil only count games where ${mine ? 'you' : 'they'} kept one alignment the whole game. Only games recorded from the start count. With few games, values are pulled slightly toward the average.`;
  const question = `How ${mine ? 'you play' : `${name} plays`} ${madlib('data-playstyle-side', ASKED_SIDES, side, 'Which games')} <span class="info" data-tip="${esc(how)}" aria-label="${esc(how)}">ⓘ</span>`;
  return card(question, `${mine ? 'Your' : 'Their'} nominations, voting, and survival compared with the average player in the same games.`,
    `<div class="ps-legend" aria-hidden="true"><span><i class="ps-key-you side-${side}"></i>${mine ? 'You' : name}</span><span><i class="ps-key-avg"></i>Average player</span></div>${playstyleBars(T, key, side, { you: mine ? 'You' : nameOf(key), labels: PLAYSTYLE_LABELS })}`, 'wide playstyle-card');
}
// A player's botc.app avatar, from their most recent recorded game that has one: one of botc.app's own pictures
// (a number or a name), or their own upload (a negative number, on img.botc.app). Without one, their initial.
function avatarHtml(key, name, cls = '') {
  let a = null;
  for (const g of state.games) {
    const p = g.players.find((x) => playerKey(x) === key);
    if (p && p.avatar !== null && p.avatar !== undefined && (!a || g.endedAt > a.at)) a = { v: p.avatar, at: g.endedAt, id: p.userId };
  }
  const url = !a ? null : typeof a.v === 'number' && a.v < 0 ? (a.id ? `https://img.botc.app/avatars/${encodeURIComponent(a.id)}.webp?c${a.v}` : null) : images.asset(`cosmetics/avatar${a.v}.webp`);
  const initial = esc(([...String(name || '?').trim()][0] || '?').toUpperCase());
  return `<span class="avatar ${cls}" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<b>${initial}</b></span>`;
}

// The bars behind Best ally / Worst enemy, for one pair (a row of tabletalk.js `enemies`), in columns of
// [heading, nomination label, nominations, vote label, votes]. Nominations: games with one (the bar is out of the
// games together), next to what random picks would give. Votes: how often one voted when the other was nominated,
// next to how often the voter usually votes.
function relationBars(r, groups) {
  const at = (v) => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
  const bar = (label, value, typical, fill, tick) => `<div class="ps-row">
      <div class="ps-head"><span class="ps-label">${label}</span><span class="ps-vals"><b>${value}</b><span class="ps-avg-val">${typical}</span></span></div>
      <div class="ps-track"><i class="ps-fill" style="width:${at(fill)}"></i><b class="ps-dot" style="left:${at(fill)}"></b><s class="ps-avg" style="left:${at(tick)}"></s></div></div>`;
  const nom = (label, x) => bar(label, x.n, `${x.exp.toFixed(1)} expected`, x.n / (r.games || 1), x.exp / (r.games || 1));
  const vote = (label, x) => x && bar(label, pct(x.rate), `usually ${pct(x.base)}`, x.rate, x.base);
  return `<div class="rel-bars">${groups.map(([title, nl, n, vl, v]) => { const rows = [nom(nl, n), vote(vl, v)].filter(Boolean); return `<div class="rel-group"><h4>${title}</h4>${rows.join('')}</div>`; }).join('')}</div>`;
}
const relLegend = '<div class="ps-legend rel-legend" aria-hidden="true"><span><i class="ps-key-you"></i>Actual</span><span><i class="ps-key-avg"></i>Typical</span></div>';

// With several players picked: the same bars for each pair of them, from every game the two played together (up to
// four players, so six pairs).
const PAIR_MAX_PLAYERS = 4;
function pairRelationCards(base, players) {
  if (players.length < 2 || players.length > PAIR_MAX_PLAYERS) return '';
  const cards = [];
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    const r = enemies(base, a, { minGames: 1 }).find((x) => x.key === b);
    const A = esc(nameOf(a)), B = esc(nameOf(b));
    const how = 'Nominations and votes between the two, each next to what\'s typical (the tick). Nominations: how many of their games together had one, next to what random picks would give. Votes: how often one voted when the other was nominated, next to how often they usually vote.';
    const head = `<div class="enemy-who"><span class="pair-avatars">${avatarHtml(a, nameOf(a), 'big')}${avatarHtml(b, nameOf(b), 'big')}</span><p class="enemy-name"><span>${playerLink(a, nameOf(a))} <span class="amp">and</span> ${playerLink(b, nameOf(b))}</span> <span class="muted">${r ? `${plural(r.games, 'game')} together` : 'No games together yet'}</span></p>${r ? relLegend : ''}</div>`;
    cards.push(card(`How they treat each other <span class="info" data-tip="${esc(how)}" aria-label="${esc(how)}">ⓘ</span>`, '',
      head + (r ? relationBars(r, [[`How ${A} treats ${B}`, `Nominated ${B}`, r.iNom, `Voted against ${B}`, r.iVote], [`How ${B} treats ${A}`, `Nominated ${A}`, r.theyNom, `Voted against ${A}`, r.theyVote]]) : ''), 'relation-card'));
  }
  return `<div class="span-all"><div class="grid pair-row">${cards.join('')}</div></div>`;
}

// Worst enemy and best ally (tabletalk.js `enemies`): the highest friction score and the lowest, with the four
// things behind it as bars (each with a tick at what's typical), grouped by who did it to whom, and the next two. An enemy needs a score above the
// middle, an ally one below it.
function relationCard(base, key, kind) {
  const all = enemies(base, key);
  const list = (kind === 'ally' ? allies(all) : all).filter((r) => (kind === 'ally' ? r.score < 0 : r.score > 0));
  const [top, ...rest] = list;
  if (!top) return '';
  const mine = key === myPlayer();
  const me = mine ? 'you' : esc(nameOf(key)), Me = mine ? 'You' : me;
  const bars = relationBars(top, [
    [`How they treat ${me}`, `Nominated ${me}`, top.theyNom, `Voted against ${me}`, top.theyVote],
    [`How ${me} ${mine ? 'treat' : 'treats'} them`, `${Me} nominated them`, top.iNom, `${Me} voted against them`, top.iVote]]);
  const why = `${kind === 'ally' ? 'Less' : 'More'} likely than usual to nominate ${me} or vote against ${me}.`;
  const how = `Out of everyone with at least ${ENEMY_MIN_GAMES} games together. Nominations and votes between the two, each next to what's typical (the tick)${kind === 'ally' ? ': the player they clash with least' : ''}. Being nominated or voted on by them counts more than nominating or voting on them, and nominations count more than votes. The more games together, the more their numbers count.`;
  const next = rest.slice(0, 2).map((r) => `<span class="enemy-next">${avatarHtml(r.key, r.name, 'small')}${playerLink(r.key, r.name)}</span>`);
  return card(`${kind === 'ally' ? 'Best ally' : 'Worst enemy'} <span class="info" data-tip="${esc(how)}" aria-label="${esc(how)}">ⓘ</span>`, '',
    `<div class="enemy-who">${avatarHtml(top.key, top.name, 'big')}<p class="enemy-name">${playerLink(top.key, top.name)} <span class="muted">${why}</span></p>${relLegend}</div>
    ${bars}${next.length ? `<p class="enemy-more"><span class="muted">Next</span>${next.join('')}</p>` : ''}`, 'relation-card');
}

function pairsCards(base, key) {
  const { nominates, nominatedBy } = nominationPairs(base, key);
  const name = esc(nameOf(key));
  // Each count as a bar, out of the most in that table (like the vote tables' rate bars, without a usual tick).
  const countCol = (rows, tip) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return { label: 'Nominations', value: (r) => r.n, cell: (r) => td(`<div class="rate" data-tip="${esc(tip(r))}"><b>${r.n}</b><div class="meter at"><i style="width:${(r.n / max) * 100}%"></i></div></div>`) };
  };
  const cols = (who, rows, tip) => [colPlayer(who), countCol(rows, tip), colNum('Games together', (r) => r.games)];
  const tipMade = (r) => `${nameOf(key)} nominated ${r.name} ${r.n === 1 ? 'once' : `${r.n} times`} in ${plural(r.games, 'game')} together`;
  const tipGot = (r) => `${r.name} nominated ${nameOf(key)} ${r.n === 1 ? 'once' : `${r.n} times`} in ${plural(r.games, 'game')} together`;
  return card('Nominates most', `Who ${name} nominates most, out of every recorded nomination.`, sortable('p-nominates', cols('Nominee', nominates, tipMade), nominates, { sort: 1, empty: 'No nominations recorded yet.' }))
    + card('Nominated most by', `Who nominates ${name} most.`, sortable('p-nominated-by', cols('Nominator', nominatedBy, tipGot), nominatedBy, { sort: 1, empty: 'Never nominated in a recorded game yet.' }));
}

// Who they vote against most, and who votes against them most: each pair's rate next to the voter's usual rate.
function votePairCards(base, key) {
  const { against, by, usual } = votePairs(base, key);
  const name = nameOf(key);
  const pts = (d) => { const v = Math.round(d * 100); return v === 0 ? '<span class="muted">±0</span>' : `<span class="delta ps-dir">${v > 0 ? '▲' : '▼'} ${Math.abs(v)} pts</span>`; };
  // Rate bar with a tick at the voter's usual rate.
  const rateCol = (tip) => ({ label: 'Voted', value: (r) => r.rate, cell: (r) => td(`<div class="rate" data-tip="${esc(tip(r))}"><b>${pct(r.rate)}</b><div class="meter at"><i style="width:${Math.max(r.rate * 100, 1)}%"></i>${r.base === null ? '' : `<em style="left:${r.base * 100}%"></em>`}</div></div>`) });
  const cols = (who, tip) => [colPlayer(who), colNum('Chances', (r) => r.chances), rateCol(tip), { label: 'vs. usual', num: true, value: (r) => r.gap, cell: (r) => td(r.gap === null ? '–' : pts(r.gap), true) }];
  const tipAgainst = (r) => `${name} voted on ${r.votes} of ${plural(r.chances, 'nomination')} of ${r.name} while alive (${pct(r.rate)})\nUsually votes on ${pct(r.base)} of nominations\nThe tick marks the usual rate`;
  const tipBy = (r) => `${r.name} voted on ${r.votes} of ${plural(r.chances, 'nomination')} of ${name} while alive (${pct(r.rate)})\n${r.name} usually votes on ${pct(r.base)} of nominations\nThe tick marks their usual rate`;
  return card('Votes against most', `How often ${esc(name)} votes on each player's nominations, next to their usual ${pct(usual)} (the tick). Chances: nominations of that player while ${esc(name)} was alive (at least 3). Hover for counts.`,
    sortable('p-votes-against', cols('Nominee', tipAgainst), against, { sort: 3, empty: 'Not enough nominations together yet.' }))
    + card('Voted against most by', `How often each player votes on ${esc(name)}'s nominations, next to how often that player usually votes (the tick). Chances: nominations of ${esc(name)} while they were alive (at least 3).`,
      sortable('p-voted-by', cols('Voter', tipBy), by, { sort: 3, empty: 'Not nominated often enough yet.' }));
}

function playerSections(G, sel, seats, base) {
  const st = seatStats(seats);
  const label = seatsLabel(sel);
  const out = [];
  if (sel.players.length === 1) {
    const key = sel.players[0];
    const rel = relations(G, key);
    // Players who hide their win rates aren't ranked on anyone else's page either.
    rel.teammates = rel.teammates.filter((r) => !quietPlayers.has(r.key) && isMember(r.key));
    rel.rivals = rel.rivals.filter((r) => !quietPlayers.has(r.key) && isMember(r.key));
    const noms = nominationStats(G, [key]);
    const quiet = ratesHidden(key);
    // How they do: results, then when they die, by script and by community.
    out.push(quiet ? quietHero(st) : playerHero(base, key, st));
    if (quiet) out.push(card(`When ${esc(label)} dies`, `Survived to the end in ${pct(st.survivalRate)} of games.`, deathBars(st.deathTiming, st.plays)));
    else out.push(card(`How ${esc(label)} does`, 'Overall, and by the type of character they held. Click a type to see only those games.', rateRows([
      ['Overall', st.winRate, st.plays, 'neutral'],
      ['As good', st.goodWinRate, st.good.plays, 'good'],
      ['As evil', st.evilWinRate, st.evil.plays, 'evil'],
      ...TYPES.map((team) => st.byTeam.find((t) => t.team === team) || { team, plays: 0, winRate: null })
        .map((t) => [typeLink(t.team), t.winRate, t.plays, isEvilTeam(t.team) ? 'evil' : t.team === 'traveller' ? 'neutral' : 'good']),
    ]) + `<p class="sub" style="margin:10px 0 0">Survived to the end in ${pct(st.survivalRate)} of games.</p>`));
    if (!quiet) out.push(card(`When ${esc(label)} dies`, `Survived to the end in ${pct(st.survivalRate)} of games.`, deathBars(st.deathTiming, st.plays)));
    const counts = (rows, name) => rows.map((r) => ({ name: name(r), games: r.plays })).sort((a, b) => b.games - a.games);
    if (st.byScript.length > 1) out.push(quiet ? frequencyCard('sel-scripts', 'By script', '', counts(st.byScript, (r) => r.key), (r) => esc(r.name)) : card('By script', '', rateRows(st.byScript.map((s) => [esc(s.key), s.winRate, s.plays, 'neutral']), 'sel-scripts')));
    if (state.filters.communities.length !== 1 && st.byCommunity.length > 1) out.push(quiet ? frequencyCard('sel-communities', 'By community', '', counts(st.byCommunity, (r) => communityName(state.settings, r.key)), (r) => esc(r.name)) : card('By community', '', rateRows(st.byCommunity.map((s) => [esc(communityName(state.settings, s.key)), s.winRate, s.plays, 'neutral']), 'sel-communities')));
    // What they play.
    out.push(mostPlayedByType(st));
    // Only what they've played; the collection at the bottom of the page shows the rest.
    const { playedIds, all } = collection(st);
    out.push(card('Characters played', `Played ${playedIds.size} of ${all.length} characters. Click a character to see how this player does with it. Click a column to sort.`,
      sortable('p-chars', [colChar(), { label: 'Type', value: (c) => -TYPES.indexOf(c.team), cell: (c) => td(esc(teamOne(c.team))) }, colNum('Plays', (c) => c.plays), ...(quiet ? [] : [colRate('Win rate', (c) => c.winRate, (c) => c.plays, charCls)])],
        st.byCharacter, { sort: 2 })));
    const draws = tokenDraws(seats);
    if (draws.games) out.push(card('Tokens drawn', `How often ${esc(nameOf(key))} drew each kind of token (the character they started with; travellers left out). The line on each bar marks the chance, from the setups of these games.`, drawRows([
      ['Good', draws.good, 'good'], ['Evil', draws.evil, 'evil'],
      ...draws.byType.map((r) => [typeLink(r.key), r, isEvilTeam(r.key) ? 'evil' : 'good', teamOne(r.key)]),
    ], draws.games)));
    // How they play: nominations and votes, and next to everyone else.
    out.push(card('Nominations and votes', 'From recorded nominations in these games.', `<div class="mini-tiles">
      <div><b>${noms.made}</b><span>nominations made</span></div>
      <div><b>${pct(noms.accuracy)}</b><span>of their nominations were on evil players</span></div>
      <div><b>${noms.received}</b><span>times nominated</span></div>
      <div><b>${noms.executed}</b><span>times executed</span></div>
      <div><b>${noms.votes}</b><span>votes cast</span></div>
      <div><b>${pct(noms.voteAccuracy)}</b><span>of their votes were on evil players</span></div></div>`));
    out.push(talkCard(base, key));
    // Who with: ally and enemy side by side, then teammates and opponents, then nominations and votes pair by pair.
    const peopleCards = [];
    if (quiet) {
      const byCount = (rows, n) => rows.map((r) => ({ key: r.key, name: r.name, games: n(r) })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
      peopleCards.push(frequencyCard('p-mates', 'Most often on the same team', `Who has been on ${esc(nameOf(key))}'s side most often (at least 3 games together). Click a name to see them together.`, byCount(rel.teammates, (r) => r.same), (r) => playerLink(r.key, r.name)));
      peopleCards.push(frequencyCard('p-rivals', 'Most often on the other team', `Who has been on the opposite side to ${esc(nameOf(key))} most often (at least 3 games).`, byCount(rel.rivals, (r) => r.opposite), (r) => playerLink(r.key, r.name)));
    } else {
      const mateCols = [colPlayer('Teammate'), colNum('Games', (r) => r.same), colRate('Win rate', (r) => r.sameRate, (r) => r.same)];
      const rivalCols = [colPlayer('Opponent'), colNum('Games', (r) => r.opposite), { ...colRate('Win rate', (r) => r.oppositeRate, (r) => r.opposite), value: (r) => -r.oppositeRate }];
      peopleCards.push(card('Wins most with', `${esc(nameOf(key))}'s win rate when on the same team as each player (at least 3 games together). Click a name to see them together.`,
        sortable('p-mates', mateCols, rel.teammates, { sort: 2, empty: 'Not enough games together yet.' })));
      peopleCards.push(card('Struggles most against', `${esc(nameOf(key))}'s win rate when on the opposite team to each player (at least 3 games against).`,
        sortable('p-rivals', rivalCols, rel.rivals, { sort: 2, empty: 'Not enough games against each other yet.' })));
      const beatCols = [colPlayer('Opponent'), colNum('Games', (r) => r.opposite), colRate('Win rate', (r) => r.oppositeRate, (r) => r.opposite)];
      peopleCards.push(card('Wins most against', `${esc(nameOf(key))}'s win rate when on the opposite team to each player (at least 3 games against).`,
        sortable('p-beats', beatCols, rel.rivals, { sort: 2, empty: 'Not enough games against each other yet.' })));
    }
    // Who with, in full-width rows that stay together at any width: ally and enemy, teammates and opponents (above),
    // then nominations pair by pair and votes pair by pair.
    const together = (...cards) => { const c = cards.filter(Boolean); return c.length ? `<div class="span-all"><div class="grid pair-row">${c.join('')}</div></div>` : ''; };
    out.push(together(relationCard(base, key, 'ally'), relationCard(base, key, 'enemy')));
    out.push(together(...peopleCards));
    out.push(together(pairsCards(base, key)));
    out.push(together(votePairCards(base, key)));
  } else {
    const grp = groupRelations(G, sel.players);
    const names = sel.players.map(nameOf);
    // Each player's win rate in these games, side by side (or, for those who hide it, the sides they were on).
    const perPlayer = sel.players.map((k) => {
      const sk = seatStats(seats.filter((x) => playerKey(x.p) === k));
      return ratesHidden(k) ? sidesCard(sk, playerLink(k, nameOf(k)), `In the ${plural(G.length, 'game')} they all played.`) : winCard(sk, othersRates(base, k), playerLink(k, nameOf(k)), `In the ${plural(G.length, 'game')} they all played.`);
    });
    out.push(`<div class="span-all"><div class="grid four">${perPlayer.join('')}</div></div>`);
    // With anyone who hides win rates picked, the cards about winning together or against each other become counts.
    if (sel.players.some(ratesHidden)) {
      out.push(card('Sides', `Which side ${esc(listWords(names))} were on in these ${plural(G.length, 'game')}.`, `<div class="mini-tiles">
        <div><b>${grp.same.games}</b><span>games all on the same side</span></div>
        <div><b>${grp.split.games}</b><span>games on opposite sides</span></div>
        <div><b>${grp.same.good.games}</b><span>games together as good</span></div>
        <div><b>${grp.same.evil.games}</b><span>games together as evil</span></div></div>`));
      if (sel.players.length > 2) out.push(card('Pair by pair', 'How often each pair was on the same side, and on opposite sides.', sortable('pairs', [
        { label: 'Pair', value: (p) => `${nameOf(p.a)} ${nameOf(p.b)}`, cell: (p) => `<td class="nowrap">${esc(nameOf(p.a))} &amp; ${esc(nameOf(p.b))}</td>` },
        colNum('Same team', (p) => p.same), colNum('Opposite teams', (p) => p.opposite)], grp.pairs, { sort: 1 })));
      out.push(card('Each player in these games', '', sortable('grp-players', [colPlayer(), colNum('Games', (p) => p.plays),
        ...(iAmQuiet() ? [] : [colRate('Win rate', (p) => (quietPlayers.has(p.key) ? null : p.winRate), (p) => p.plays)]), colRate('Survived', (p) => p.survivalRate, (p) => p.plays, 'neutral', 'Survived')],
        st.byPlayer, { sort: 1 })));
      out.push(pairRelationCards(base, sel.players));
      return out.join('');
    }
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
      ], grp.pairs, { sort: 1 }), 'wide'));
    }
    out.push(card('Each player in these games', '', sortable('grp-players', [colPlayer(), colNum('Games', (p) => p.plays), colRate('Win rate', (p) => p.winRate, (p) => p.plays), colRate('Survived', (p) => p.survivalRate, (p) => p.plays, 'neutral', 'Survived')],
      st.byPlayer, { sort: 1 })));
    out.push(pairRelationCards(base, sel.players));
  }
  if (sel.characters.length && !sel.players.some(ratesHidden)) {
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

// One character's third row: how its holder takes part in the day, what it's in play with most, and how it does by
// the Demon in play (by the Minions with it, for a Demon). Each card is about one holder per game, so it reads like
// a single game.
function characterExtras(id, row, holders, evil) {
  const name = esc(row.name || charName(id));
  const out = [];
  const n = holders.length;
  if (n) {
    const t = { made: 0, onEvil: 0, received: 0, executed: 0, votes: 0, votesOnEvil: 0 };
    for (const { g, p } of holders) { const k = playerKey(p); if (!k) continue; const s = nominationStats([g], [k]); for (const f of Object.keys(t)) t[f] += s[f] || 0; }
    const per = (x) => (x / n).toFixed(1);
    if (t.made + t.received + t.votes) out.push(card(`Nominations and votes as the ${name}`, `Per game, for the player holding it (${plural(n, 'game')}).`, `<div class="mini-tiles">
      <div><b>${per(t.made)}</b><span>nominations made</span></div>
      <div><b>${pct(t.made ? t.onEvil / t.made : null)}</b><span>of their nominations were on evil players</span></div>
      <div><b>${per(t.received)}</b><span>times nominated</span></div>
      <div><b>${pct(t.executed / n)}</b><span>of games they were executed</span></div>
      <div><b>${per(t.votes)}</b><span>votes cast</span></div>
      <div><b>${pct(t.votes ? t.votesOnEvil / t.votes : null)}</b><span>of their votes were on evil players</span></div></div>`));
  }
  // The characters most often in play alongside it, and how good did in those games.
  const m = new Map();
  for (const { g, p } of holders) for (const o of g.players) if (o !== p && o.roleId && o.roleId !== id) {
    const r = m.get(o.roleId) || { roleId: o.roleId, name: charName(o.roleId), team: o.team, games: 0, good: 0 }; r.games++; if (g.winner === 'good') r.good++; m.set(o.roleId, r);
  }
  const along = [...m.values()].map((r) => ({ ...r, goodRate: r.good / r.games }));
  if (along.length > 1) out.push(card('Most often in play with it', `The characters that came up most in games with the ${name}. Click a column to sort.`,
    sortable('c-along', [colChar(), colNum('Games', (r) => r.games), colRate('Good won', (r) => r.goodRate, (r) => r.games, 'neutral', 'Good won')], along, { sort: 1 })));
  // A Demon: its Minions. Anything else: the Demon it faced (or served).
  const team = (t) => (x) => x.team === t && x.roleId;
  const pairs = new Map();
  for (const { g, p } of holders) for (const o of new Set(g.players.filter(row.team === 'demon' ? team('minion') : team('demon')).filter((x) => x !== p).map((x) => x.roleId))) {
    const r = pairs.get(o) || { roleId: o, name: charName(o), plays: 0, wins: 0 }; r.plays++; if (p.won) r.wins++; pairs.set(o, r);
  }
  const prs = [...pairs.values()].map((r) => ({ ...r, winRate: r.wins / r.plays }));
  if (prs.length > 1) {
    const title = row.team === 'demon' ? 'With each Minion' : evil ? 'With each Demon' : 'Against each Demon';
    out.push(card(title, `How the ${name} did, by which ${row.team === 'demon' ? 'Minions were' : 'Demon was'} in the game.`,
      sortable('c-pairs', [colChar(row.team === 'demon' ? 'Minion' : 'Demon'), colNum('Games', (r) => r.plays), colRate('Holder won', (r) => r.winRate, (r) => r.plays, evil ? 'evil' : 'good')], prs, { sort: 1 })));
  }
  return out;
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
    // Players who hide win rates are listed without theirs (and someone who hides them sees only the plays).
    out.push(card('Who plays it', 'Click a name to see that player with this character.', sortable('c-players', [colPlayer(), colNum('Plays', (p) => p.plays),
      ...(iAmQuiet() ? [] : [colRate('Won', (p) => (quietPlayers.has(p.key) ? null : p.winRate), (p) => p.plays, evil ? 'evil' : 'good')])],
      st.byPlayer, { sort: 1 })));
    out.push(...characterExtras(id, row, holders, evil));
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
      holders.byCharacter, { sort: 1 })));
  }
  if (G.length >= 8) {
    const combos = companions(G, sel.characters, 3);
    const rate0 = outcome(G).goodRate;
    out.push(card('Characters that change the result alongside', `In these ${plural(G.length, 'game')} good wins ${pct(rate0)}. Here's how that shifts when another character is also in play (at least 3 games). Click one to add it.`,
      sortable('combos', [colChar('Also in play'), colNum('Games', (c) => c.games), colRate('Good won', (c) => c.goodRate, (c) => c.games, 'neutral', 'Good won'),
        { ...colDelta('Shift', (c) => c.delta), value: (c) => Math.abs(c.delta) }], combos, { sort: 3, empty: 'Not enough games yet.' })));
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
      st.byCharacter, { sort: null })));
  if (iAmQuiet()) {
    const rows = st.byPlayer.map((p) => ({ key: p.key, name: p.name, games: p.plays })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    out.push(frequencyCard('t-players', `Most often ${esc(label)}`, `Who has been ${esc(label)} the most.`, rows, (r) => playerLink(r.key, r.name)));
  } else {
    const best = ranked(st.byPlayer).filter((p) => p.plays >= 2);
    out.push(card(`Best players as ${esc(label)}`, 'At least 2 games.', sortable('t-players', [colPlayer(), colNum('Plays', (p) => p.plays), colRate('Win rate', (p) => p.winRate, (p) => p.plays)],
      best, { sort: 2, empty: 'Not enough games yet.' })));
  }
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
      pr.contributions.map((c) => ({ ...c, name: charName(c.roleId) })), { sort: 2 })));
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
          <span class="pills">${reviewing(g) ? `<span class="pill review" data-tip="${esc(reviewWhy(g))}">Review</span>` : ''}${g.community ? `<span class="pill">${esc(communityName(state.settings, g.community))}</span>` : ''}<span class="pill ${g.winner}">${cap(g.winner)} won</span></span></summary>
        ${state.openGame === g.id ? gameDetail(g) : ''}
      </details>`;
    }).join('')}
    ${G.length > shown.length ? `<button class="btn" data-more-games>Show ${Math.min(25, G.length - shown.length)} more</button>` : ''}
  </div>`;
}

// Games an editor should check (members.js): filed under a community nobody picked by hand, outside its own rooms,
// where neither the storyteller nor half the table has played in that community before. Only editors see the flag;
// they can confirm the community (it's then picked by hand) or exclude or delete the game.
const reviewing = (g) => !!g.review && state.shared.on && state.shared.canEdit;
const aOrAn = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
function reviewWhy(g) {
  const name = communityName(state.settings, g.community);
  return `This may not be ${aOrAn(name)} ${name} game: its storyteller hasn't played ${MIN_MEMBER_GAMES}+ ${name} games, and fewer than half the players have played another ${name} game.`;
}
function reviewBox(g) {
  const name = esc(communityName(state.settings, g.community));
  return `<div class="gm-review"><p><b>Check this game</b> ${esc(reviewWhy(g))} If it isn't, exclude it from stats or delete it.</p><button class="btn small" data-confirm-community="${esc(g.id)}">Yes, it's ${aOrAn(name)} ${name} game</button></div>`;
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
      ${canEdit ? '' : `<p class="sub" style="margin:0">This game is shared with everyone, so changing or deleting it needs an editor key. ${WEB ? 'Add one under Settings.' : 'Add one in Settings.'}</p>`}
      <fieldset class="gm-fields" ${canEdit ? '' : 'disabled'}>
      <div class="gm-grid">
        <div class="gm-field"><span class="field-label">Community</span><div class="toggles">${communityButtons('data-game-community', g.community ? [g.community] : [], `${g.id}|`, gameCommunityOptions())}</div></div>
        <label class="gm-field"><span class="field-label">Storyteller</span><input type="text" value="${esc(g.storytellers.map((s) => s.username).filter(Boolean).join(', '))}" placeholder="Not recorded — type a name" data-st="${esc(g.id)}"></label>
        <label class="gm-field gm-wide"><span class="field-label">Notes</span><textarea rows="2" placeholder="Anything to remember about this game" data-notes="${esc(g.id)}">${esc(g.notes || '')}</textarea></label>
      </div>
      ${reviewing(g) ? reviewBox(g) : ''}
      <label class="gm-check"><input type="checkbox" data-exclude="${esc(g.id)}" ${g.excluded ? 'checked' : ''}><span><b>Exclude from stats</b><span>The game stays in this list but doesn't count towards any stats.</span></span></label>
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
        </tr>`).join('')}${(g.departedTravellers || []).map((t) => `<tr class="left">
          <td class="num muted">–</td><td>${t.username ? (playerKeys.has(playerKey(t)) ? playerLink(playerKey(t), t.username) : esc(t.username)) : '<span class="muted">Unknown</span>'}</td>
          <td>${t.roleId ? charLink(t.roleId, t.roleName) : 'Unknown'} <span class="muted">${esc(teamOne(t.team))}</span></td>
          <td>${t.alignment ? `<span class="pill ${t.alignment}">${cap(t.alignment)}</span>` : '–'}</td>
          <td>Left the game${t.survived ? '' : ` · died${t.diedPhase ? ` ${phaseLabel(t.diedPhase)}` : ''}`}</td><td><span class="muted">–</span></td><td>–</td>
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
// How many different people have played in these games (travellers included), and how many sit down in a typical game.

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

// Clears the community, script and storyteller filters (Clear on Playstyles and My stats, and "← Playstyles").
function clearScope() {
  Object.assign(state.filters, { communities: [], script: '', storyteller: '' });
  savePrefs();
  populateFilters();
  setSelection(() => {});
}

// Clears every filter (Clear on the Overview and Games, and "← Community").
function clearAll() {
  Object.assign(state.filters, { communities: [], script: '', storyteller: '', days: '' });
  savePrefs();
  populateFilters();
  setSelection((s) => Object.assign(s, emptySelection()));
}

// The community, script and storyteller filters, as words for a phrase. The script names the games ("Bad Moon Rising
// games"); the community is where they were played and the storyteller who ran them: "in Escape, storytold by kaz".
const scopeOn = () => !!(state.filters.communities.length || state.filters.script || state.filters.storyteller);
function scopeWords() {
  const f = state.filters;
  return [f.communities.length ? `in ${listWords(f.communities.map((c) => communityName(state.settings, c)))}` : '',
    f.storyteller ? `storytold by ${nameOf(f.storyteller)}` : ''].filter(Boolean).join(', ');
}
// "Games", or "Bad Moon Rising games" with a script picked, then where and by whom: "Bad Moon Rising games in Escape".
const gamesPhrase = () => [state.filters.script ? `${state.filters.script} games` : 'Games', scopeWords()].filter(Boolean).join(' ');

// Where you are on the Community tab, once anything is picked: "← Community › wren as the Amnesiac in Escape". One phrase
// for everything picked, not a path, since the filters don't nest. "← Community" goes back to the overview with every
// filter cleared. Playstyles starts from itself: "← Playstyles › Games in Rhap" ("← Playstyles" clears its filters).
function crumbs(G, base, sel) {
  const styles = state.tab === 'styles';
  // My stats is its own tab (always your page), so it has no breadcrumb.
  if (state.tab === 'me' || !(styles ? scopeOn() : anyFilter(sel))) return '';
  const who = listWords(sel.players.map(nameOf));
  const what = sel.players.length && (sel.characters.length || sel.types.length) ? `${who} as ${heldRole(sel).as}`
    : sel.players.length ? who
    // Several characters picked: games where all of them were in play.
    : sel.characters.length ? `${state.filters.script ? `${state.filters.script} games` : 'Games'} with ${listWords(sel.characters.map((c) => `the ${charName(c)}`))} in play${sel.types.length ? `, looking at ${listWords(sel.types.map(teamLabel))}` : ''}`
    : sel.types.length ? listWords(sel.types.map(teamLabel))
    : '';
  // With nothing picked, the games themselves ("Bad Moon Rising games in Escape"); otherwise what's picked, then
  // which games ("wren as Townsfolk in Bad Moon Rising games in Escape").
  // (A character on its own already starts with the games: "Bad Moon Rising games with the Imp in play, in Escape".)
  const gamesFirst = sel.characters.length && !sel.players.length;
  const which = state.filters.script && !gamesFirst ? `in ${state.filters.script} games${scopeWords() ? ` ${scopeWords()}` : ''}` : scopeWords();
  const phrase = !what ? gamesPhrase() : [what, which].filter(Boolean).join(what.endsWith('in play') || what.includes(', looking at') ? ', ' : ' ');
  const sep = '<span class="crumb-sep" aria-hidden="true">›</span>';
  if (styles) return `<nav class="crumbs" aria-label="Where you are"><button type="button" class="crumb-back" data-crumb-styles title="Playstyles, with no filters"><span aria-hidden="true">←</span> Playstyles</button>${sep}<span class="crumb-here">${esc(gamesPhrase())}</span></nav>`;
  const back = '<button type="button" class="crumb-back" data-crumb-back title="Back to the community overview, with no filters"><span aria-hidden="true">←</span> Community</button>';
  return `<nav class="crumbs" aria-label="Where you are">${back}${sep}<span class="crumb-here">${esc(phrase)}</span></nav>`;
}

function noGames() {
  return `<div class="empty card"><h2>No games recorded yet</h2><p>Keep botc.app open in a tab while you play. Each game is saved automatically when the storyteller reveals the grimoire.</p><p class="muted">Already have data? Import it from Settings.</p></div>`;
}

function gamesView() {
  if (!state.games.length) return noGames();
  const base = baseGames();
  const G = selectGames(base, state.sel);
  return `${summaryLine(G, base, state.sel)}${G.length ? gamesList(G) : '<div class="card empty"><h2>No games match</h2><p>Try removing a filter.</p></div>'}`;
}

// Awards: whose nominations get the most evil players executed (as good), the most good players executed (as evil),
// and who most often survives to the end. Once a player has enough games (3 on that side, or overall) it's their
// own rate that counts, not how many games they've played: a tie is shared rather than going to whoever plays more.
// Only games recorded from the start count for the nomination awards.
function awardTiles(base) {
  // The minimum applies to the games each award is worked out from: games recorded from the start for the nomination
  // awards, games with a known end for the survivor.
  const best = (side, id, counted) => {
    const R = playstyles(base, side);
    if (!R.featureIds.includes(id)) return [];
    const rated = R.players.filter((p) => p.values[id].raw !== null && counted(p) >= R.minGames);
    const top = Math.max(...rated.map((p) => p.values[id].raw));
    if (!(top > 0)) return [];
    // One winner. A tie goes to whoever has more games behind the rate, then whoever played most recently, then the name.
    const tied = rated.filter((p) => Math.abs(p.values[id].raw - top) < 1e-9);
    return [tied.sort((a, b) => counted(b) - counted(a) || (lastPlayed.get(b.key) || 0) - (lastPlayed.get(a.key) || 0) || a.name.localeCompare(b.name))[0]];
  };
  const lastPlayed = new Map();
  for (const g of base) for (const p of g.players) { const k = playerKey(p); if (k) lastPlayed.set(k, Math.max(lastPlayed.get(k) || 0, g.endedAt || 0)); }
  const names = (ps) => {
    const p = ps[0];
    return `<span style="font-size:${Math.min(1, 11 / Math.max(1, [...p.name].length)).toFixed(2)}em">${playerLink(p.key, p.name)}</span>`;
  };
  const info = (text) => ` <span class="info" data-tip="${esc(text)}" aria-label="${esc(text)}">ⓘ</span>`;
  const out = [];
  const detective = best('good', 'enemyExecs', (p) => p.t.tracked);
  if (detective.length) {
    const p = detective[0];
    out.push(tile(`Best detective${info('As good: the most evil players executed from their nominations, per game (3+ games as good).')}`, names(detective),
      `${plural(p.t.enemyExecs, 'evil player')} executed from ${plural(p.t.noms, 'nomination')} in ${plural(p.t.tracked, 'game')}`, 'award'));
  }
  const framer = best('evil', 'enemyExecs', (p) => p.t.tracked);
  if (framer.length) {
    const p = framer[0];
    out.push(tile(`Best framer${info('As evil: the most good players executed from their nominations, per game (3+ games as evil).')}`, names(framer),
      `${plural(p.t.enemyExecs, 'good player')} executed from ${plural(p.t.noms, 'nomination')} in ${plural(p.t.tracked, 'game')}`, 'award'));
  }
  const survivor = best('all', 'survived', (p) => p.t.known);
  if (survivor.length) {
    const p = survivor[0], alive = p.t.fates.survivedWon + p.t.fates.survivedLost;
    out.push(tile(`Best survivor${info('Alive at the end of the largest share of their games (3+ games).')}`, names(survivor),
      `alive at the end of ${alive} of ${plural(p.t.known, 'game')}`, 'award feature'));
  }
  return out.length ? `<div class="tiles awards">${out.join('')}</div>` : '';
}

// The Overview's way into Playstyles: whoever leads four of its measures, each as a bar next to the average player
// (the same bars as "How you play"). "See all playstyles" at the bottom opens Playstyles.
const TEASER = [['loud', 'Most nominations per day'], ['nominated', 'Most nominated per day'], ['voter', 'Votes on the most nominations'], ['nomOther', 'Most nominations on the opposing team']];
function stylesTeaser(base) {
  const T = talk(base, state.minGames).all;
  const tops = TEASER.map(([id, kicker]) => {
    const p = T.players.filter((x) => x.listed && isMember(x.key) && x.rates[id].value !== null).sort((a, b) => b.rates[id].value - a.rates[id].value || b.games - a.games)[0];
    return p && T.table[id] !== null ? { id, kicker, p, value: p.rates[id].value, avg: T.table[id] } : null;
  }).filter(Boolean);
  if (tops.length < 2) return '';
  const perDay = tops.filter((r) => r.id === 'loud' || r.id === 'nominated');
  const perDayMax = Math.ceil((Math.max(0.1, ...perDay.flatMap((r) => [r.value, r.avg])) * 1.1) / 0.1) * 0.1;
  const at = (r, v) => `${Math.max(0, Math.min(100, (v / (r.id === 'loud' || r.id === 'nominated' ? perDayMax : 1)) * 100)).toFixed(1)}%`;
  const rows = tops.map((r) => { const m = MEASURES[r.id]; return `<div class="ps-row">
      <h4 class="teaser-kicker">${r.kicker}</h4>
      <div class="ps-head"><span class="teaser-who">${esc(r.p.name)}</span><span class="ps-vals"><b>${m.fmt(r.value)}</b><span class="ps-avg-val">avg ${m.fmt(r.avg)}</span></span></div>
      <div class="ps-track"><i class="ps-fill" style="width:${at(r, r.value)}"></i><b class="ps-dot" style="left:${at(r, r.value)}"></b><s class="ps-avg" style="left:${at(r, r.avg)}"></s></div></div>`; }).join('');
  return `<div class="card wide styles-teaser"><h3>Playstyles</h3>
    <p class="sub">Who leads each measure, next to the average player.</p>
    <div class="ps-bars side-all">${rows}</div><p class="teaser-more"><button type="button" data-go-styles>See all playstyles <span aria-hidden="true">→</span></button></p></div>`;
}

// "My stats": your own player page, without having to find yourself first.
function myView() {
  const me = myPlayer();
  if (!me) {
    const signedIn = !!state.profile;
    return `<div class="card my-pick"><h3>Which player are you?</h3>${signedIn
      ? '<p class="sub">Pick yourself once and this tab will show your stats.</p><div class="toolbar claim-form"><div class="claim-picker" data-claim-picker></div><button class="btn primary" type="button" data-claim>Claim</button></div><p class="msg" id="claim-msg"></p>'
      : `<p class="sub">${WEB ? 'Sign in' : 'Sign in from the extension\'s popup'} and pick yourself, and this tab will show your stats.</p>`}</div>`;
  }
  const keep = state.sel;
  state.sel = { ...emptySelection(), players: [me] };
  try { return statsView(); } finally { state.sel = keep; }
}

function stylesView() {
  if (!state.games.length) return noGames();
  const base = baseGames();
  const T = talk(base, state.minGames);
  return `${crumbs(base, base, state.sel)}${awardTiles(base)}<div class="grid stack">${talkChartCard(T, state.talkView, talkHelpers())}${scatterCard(T, state.scatterView, talkHelpers())}</div>`;
}

function statsView() {
  if (!state.games.length) return `<div class="empty card"><h2>No games recorded yet</h2><p>Keep botc.app open in a tab while you play. Each game is saved automatically when the storyteller reveals the grimoire.</p><p class="muted">Already have data? Import it from Settings.</p></div>`;
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
  // Players whose win rates this page leaves out.
  const quietPick = sel.players.some(ratesHidden);
  const evilDrawn = hasSelection(sel) ? null : mostEvilDrawn(base);
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
    quietPick ? tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`)
      : tile('Win rate', pct(st.winRate), onePlayer ? `${delta(gap(st.winRate, mineSt.winRate))} vs. ${pct(mineSt.winRate)} in all their games` : `won ${st.wins} of ${st.plays}`),
    quietPick ? (heldRole(sel).many ? tile('Different characters', new Set(seats.map((x) => x.p.roleId).filter(Boolean)).size, `as ${esc(heldRole(sel).as)}`) : tile('Times executed', nominationStats(G, sel.players).executed, `in ${plural(st.plays, 'game')}`))
      : onePlayer ? tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`) : '',
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
    st && !severalChars && !quietPick ? tile(holdersOnly ? `Holder win rate · ${esc(listWords(sel.characters.map(charName)))}` : `Win rate · ${esc(seatsLabel(sel))}`, pct(st.winRate), plural(st.plays, 'game')) : !st ? lengthTile(G, o) : '',
    quietPick && sel.players.length > 1 && !sel.characters.length && !sel.types.length ? lengthTile(G, o) : '',
    // Likewise pooled survival across several players.
    st && sel.players.length < 2 && !severalChars ? tile('Survived to the end', pct(st.survivalRate), `${st.survived} of ${st.plays}`) : '',
  ] : [
    // Without the win rate spotlights (for someone who hides win rates), the highlight goes on the games.
    tile('Games', o.n, G.length ? `${fmtDate(G[G.length - 1].endedAt)} – ${fmtDate(G[0].endedAt)}` : '', iAmQuiet() ? 'hero feature' : 'hero'),
    lengthTile(G, o),
    evilDrawn ? tile('Most evil tokens drawn', tileName(evilDrawn.key, evilDrawn.name), `${plural(evilDrawn.n, 'evil token')} in ${plural(evilDrawn.games, 'game')}`, 'highlight') : '',
  ];
  const pr = wantsPrediction(G, base, sel) ? predictOutcome(base, sel.characters, { tune: tunedFor(base) }) : null;
  if (pr) {
    tiles.splice(1, G.length ? 0 : 1, tile('Predicted good win', `${Math.round(pr.good * 100)}%`, `likely ${Math.round(pr.low * 100)}–${Math.round(pr.high * 100)}%`));
  }
  let sections = '';
  if (pr) sections = `<div class="grid two">${predictionSections(G, base, sel, pr)}${G.length ? characterSections(G, base, sel) : ''}</div>`;
  else if (!G.length && held) sections = `<div class="card empty"><h2>Not yet</h2><p>${esc(listWords(sel.players.map(nameOf)))} ${sel.players.length > 1 ? 'haven\'t each' : 'hasn\'t'} been ${esc(heldRole(sel).as)} in any recorded game${sel.players.length > 1 ? ' together' : ''} under these filters.</p></div>`;
  else if (!G.length) sections = `<div class="card empty"><h2>No games match</h2><p>No recorded game has ${hasSelection(sel) ? 'everything you selected' : 'these filters'}. Try removing a filter.</p></div>`;
  else if (!hasSelection(sel)) sections = `<div class="grid two">${overallSections(base)}</div>`;
  else {
    if (sel.characters.length && !sel.players.length) sections += characterSections(G, base, sel);
    if (sel.players.length && (sel.characters.length || sel.types.length)) sections += heldSections(G, sel, seats, base);
    else if (sel.players.length) sections += playerSections(G, sel, seats, base);
    else if (sel.types.length) sections += typeSections(G, sel, seats, base);
    sections = `<div class="grid two">${sections}</div>`;
  }
  // Spares to fill out the last row (see fillRows): cards about these games the page doesn't already show.
  if (G.length && sections.includes('<div class="grid two">')) sections = sections.replace(/<\/div>\s*$/, `${spareCards(G, sel, seats, sections)}</div>`);
  // One player: their character collection, below the cards (it's the full page width, and never a spare).
  if (G.length && onePlayer && !held) sections += collectionCard(onePlayer, st);
  const more = G.length ? `<p class="see-games"><button class="btn" data-tab="games">See ${G.length === 1 ? 'this game' : `these ${G.length} games`} →</button></p>` : '';
  // With no filters the Games tile already says how many games there are, so there's no breadcrumb.
  const lead = crumbs(G, base, sel);
  // With no filters: the 30-day win rate spotlights under the first row.
  const spots = !hasSelection(sel) && G.length ? spotlightTiles(base) : '';
  return `${lead}<div class="tiles">${tiles.join('')}</div>${spots}${sections}${more}`;
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
  renderCommunityFilter();
  opts('script', distinct(all, (g) => g.script.name), 'All scripts');
  opts('storyteller', distinct(all, storytellerKeys).map((k) => ({ value: k, name: nameOf(k) })).sort((a, b) => a.name.localeCompare(b.name)), 'All storytellers', (v) => v.name);
}

const dropdowns = {};
// Communities: a dropdown like the other filters (several at once; none picked means all).
let communityDropdown = null;
function renderCommunityFilter() {
  if (communityDropdown) { communityDropdown.refresh(); return; }
  communityDropdown = multiSelect($('#community-filter'), {
    label: 'All communities', nameOf: (v) => communityName(state.settings, v),
    options: () => communityOptions().map((o) => ({ value: o.value, label: o.name })),
    selected: () => state.filters.communities,
    onChange: (values) => { state.filters.communities = values; savePrefs(); state.expanded.clear(); communityDropdown.refresh(); render(); },
  });
}

function setupDropdowns() {
  const defs = {
    // Your own player (if you've claimed one) comes first.
    players: { label: 'Players', nameOf: nameOf, options: () => [...playerKeys].filter((k) => isMember(k) || state.sel.players.includes(k)).map((value) => ({ value, label: nameOf(value), sub: value === myPlayer() ? 'You' : '' }))
      .sort((a, b) => (b.value === myPlayer()) - (a.value === myPlayer()) || a.label.localeCompare(b.label)) },
    characters: { label: 'Characters', nameOf: charName, options: () => [...charInfo.values()].map((c) => ({ value: c.roleId, label: c.name, sub: teamOne(c.team) })).sort((a, b) => a.label.localeCompare(b.label)) },
    types: { label: 'Character type', nameOf: teamOne, options: () => TYPES.map((t) => ({ value: t, label: teamOne(t) })) },
  };
  for (const [kind, d] of Object.entries(defs)) {
    dropdowns[kind] = multiSelect($(`[data-ms="${kind}"]`), { ...d, selected: () => state.sel[kind], onChange: (values) => setSelection((s) => { s[kind] = values; }) });
  }
}

function renderPickers() {
  Object.values(dropdowns).forEach((d) => d.refresh());
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
  // Creating an account: the setup questions after the form (shown like the sign-in, without the tabs and filters).
  document.body.classList.toggle('signed-out', gate || !!state.setup);
  if (state.setup) { $('#filters').hidden = true; $('#view').innerHTML = setupView(); mountClaimPicker(); return; }
  if (gate) { $('#filters').hidden = true; $('#view').innerHTML = signInView(); refillSignUp(); return; }
  // Playstyles is a view of the Stats tab (picked in the tabs at the start of the filters).
  const tabShown = state.tab === 'styles' ? 'stats' : state.tab;
  document.querySelectorAll('[data-tab]').forEach((b) => { if (b.closest('.tabs')) b.setAttribute('aria-selected', String(b.dataset.tab === tabShown)); });
  const viewShown = state.tab === 'styles' ? 'styles' : 'stats';
  document.querySelectorAll('[data-stats-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.statsView === viewShown)));
  document.body.classList.toggle('tab-stats', tabShown === 'stats');
  $('#filters').hidden = state.tab === 'data';
  document.body.classList.toggle('tab-styles', state.tab === 'styles');
  // On Playstyles and My stats, Clear clears the filters they have (community, script, storyteller).
  const scopeOnly = state.tab === 'styles' || state.tab === 'me';
  $('#clear-sel').hidden = scopeOnly ? !scopeOn() : !anyFilter(state.sel);
  document.body.classList.toggle('tab-me', state.tab === 'me');
  const views = { stats: statsView, me: myView, styles: stylesView, games: gamesView, data: () => renderData(ctx, selectGames(baseGames(), state.sel)) };
  keepOpenForms(() => { $('#view').innerHTML = (state.tab !== 'data' ? connectCard() : '') + views[state.tab](); });
  // Editors' account list loads the first time Settings is opened.
  mountClaimPicker();
  mountAlwaysPicker();
  mountScatterPicker();
  // The scatter was drawn before its card was on the page; redraw it at the card's width if that's different.
  const sc = $('#sc-body .sc');
  if (sc && Math.abs(Number(sc.getAttribute('width')) - $('#sc-body').clientWidth) > 2) refreshScatter();
  fillRows();
  fitLists();
  if (state.tab === 'data' && state.accounts === undefined && state.shared.on && state.shared.canEdit && creds(state.settings).editorKey) { state.accounts = null; loadAccounts(); }
}

// Every row of cards should be full. The page brings spare cards (data-spare, hidden); this shows as many as the last
// row needs, in order. If it runs out, the last card in the row is widened to close the gap. Works for however many
// columns the window has room for.
function fillRows() {
  for (const grid of document.querySelectorAll('#view .grid.two')) {
    const spares = [...grid.querySelectorAll(':scope > [data-spare]')];
    spares.forEach((c) => { c.hidden = true; });
    grid.querySelectorAll(':scope > [data-widened]').forEach((c) => { c.style.gridColumn = ''; c.removeAttribute('data-widened'); });
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (cols < 2) continue;
    // Empty slots in any row, from where the cards sit. (The grid packs densely, so a spare added at the end moves
    // up into an earlier hole, e.g. one left before a wide card.)
    const free = () => {
      const cards = [...grid.children].filter((c) => !c.hidden);
      const g = grid.getBoundingClientRect(), gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      const slot = (g.width - gap * (cols - 1)) / cols + gap;
      let n = 0;
      for (const top of new Set(cards.map((c) => c.offsetTop))) {
        const row = cards.filter((c) => c.offsetTop === top);
        n += Math.round((g.width - row.reduce((w, c) => w + c.getBoundingClientRect().width, 0) - gap * (row.length - 1)) / slot);
      }
      return n;
    };
    for (const c of spares) {
      if (free() <= 0) break;
      c.hidden = false;
    }
    // Out of spares. One gap: the last card goes two wide. A lone card on the last row (three columns): pair the last
    // two rows as wide + normal instead, by widening the card three from the end as well as the last one.
    const widen = (c) => { c.style.gridColumn = 'span 2'; c.setAttribute('data-widened', ''); };
    const left = free();
    if (left > 0) {
      const cards = [...grid.children].filter((c) => !c.hidden);
      const last = cards[cards.length - 1];
      if (left === 2 && cols === 3 && cards.length >= 4) { widen(cards[cards.length - 3]); widen(last); }
      if (left === 1 || free() > 0) {
        grid.querySelectorAll(':scope > [data-widened]').forEach((c) => { c.style.gridColumn = ''; c.removeAttribute('data-widened'); });
        last.style.gridColumn = `span ${Math.min(cols, left + 1)}`;
        last.setAttribute('data-widened', '');
      }
    }
  }
}

// Cards side by side should end level, without empty space under the shorter ones. Lists (data-fit) show as many
// rows as fit their row of cards, with "Show all" for the rest. Next to cards that can't change length (a pie
// chart, an opened list), lists fill that height; in a row of only lists, they all trim to the shortest one's
// natural height (up to 8 rows). Lists show at least 3 rows. On one column (phones), lists show 8.
const MIN_ROWS = 3, START_ROWS = 8;
function fitLists() {
  const cards = [...document.querySelectorAll('#view .grid > .card')].filter((c) => !c.hidden);
  if (!cards.some((c) => c.querySelector('[data-fit]:not([data-expanded])'))) return;
  const lists = new Map(); // card → { fit, rows, button, n }
  for (const c of cards) {
    const fit = c.querySelector('[data-fit]');
    if (!fit || fit.hasAttribute('data-expanded')) continue;
    const rows = [...fit.querySelectorAll('tr, .split-row')].filter((r) => !r.closest('thead'));
    if (rows.length > MIN_ROWS) lists.set(c, { rows, button: fit.querySelector('.show-all'), n: rows.length });
  }
  const show = (l, k) => {
    l.k = k;
    l.rows.forEach((r, i) => r.toggleAttribute('data-fold', i >= k));
    if (l.button && !l.button.hasAttribute('data-more')) l.button.hidden = k >= l.n;
  };
  // Measure each card's own height rather than the row's (grid rows stretch their cards).
  cards.forEach((c) => { c.style.alignSelf = 'start'; });
  lists.forEach((l) => show(l, Math.min(l.n, START_ROWS)));
  const height = (c) => c.getBoundingClientRect().height;
  const rowsOfCards = new Map();
  for (const c of cards) {
    const key = `${[...document.querySelectorAll('#view .grid')].indexOf(c.parentElement)}:${Math.round(c.offsetTop)}`;
    if (!rowsOfCards.has(key)) rowsOfCards.set(key, []);
    rowsOfCards.get(key).push(c);
  }
  for (const row of rowsOfCards.values()) {
    const flexible = row.filter((c) => lists.has(c));
    if (!flexible.length || row.length === 1) continue;
    const fixed = row.filter((c) => !lists.has(c));
    const target = fixed.length ? Math.max(...fixed.map(height)) : Math.min(...flexible.map(height));
    for (const c of flexible) {
      const l = lists.get(c);
      while (l.k > MIN_ROWS && height(c) > target + 1) show(l, l.k - 1);
      while (l.k < l.n) {
        show(l, l.k + 1);
        if (height(c) > target + 1) { show(l, l.k - 1); break; }
      }
    }
  }
  cards.forEach((c) => { c.style.alignSelf = ''; });
}
let fitTimer;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fillRows(); fitLists(); }, 120); });
document.fonts.ready.then(() => { fillRows(); fitLists(); });

// A redraw (new games arriving, the account check finishing) mustn't close a form someone is filling in: forms
// marked data-keep stay open with what was typed, and the button that opened them (data-opens) stays hidden.
function keepOpenForms(redraw) {
  const kept = [...document.querySelectorAll('#view form[data-keep]:not([hidden])')].map((f) => ({
    key: f.dataset.keep,
    values: [...f.elements].filter((el) => el.name).map((el) => [el.name, el.value]),
    focus: f.contains(document.activeElement) ? document.activeElement.name : null,
  }));
  redraw();
  for (const k of kept) {
    const f = document.querySelector(`#view form[data-keep="${k.key}"]`);
    if (!f) continue;
    f.hidden = false;
    document.querySelectorAll(`#view [data-opens="${k.key}"]`).forEach((b) => { b.hidden = true; });
    for (const [name, value] of k.values) if (f.elements[name]) f.elements[name].value = value;
    if (k.focus && f.elements[k.focus]) f.elements[k.focus].focus();
  }
}

// ---------- shared games: sign-in and status ----------
// Creating an account on the website, after the sign-up form: which player you are, and whether to see player win
// rates (no answer picked to begin with). The account is only created on Continue, so Back leaves nothing behind.
// Both can be changed later in Settings.
const RATES_HINT = {
  '': 'Choose whether to see other players\' win rates and share your own.',
  show: 'See everyone\'s win rates and share yours.',
  hide: 'You won\'t see anyone\'s win rate, and yours won\'t be visible to others.',
};
function setupView() {
  const rates = state.setupRates || '';
  const opt = (v, label) => `<button type="button" class="toggle setup-opt" data-setup-rates="${v}" aria-pressed="${rates === v}">${label}</button>`;
  const picker = playerChoices().length
    ? '<div class="claim-picker" data-claim-picker></div>'
    : '<p class="sub small">No games have been recorded yet, so there\'s no one to pick. You can do this later in Settings.</p>';
  return `<div class="signin card setup">
    <img class="logo" src="icons/logo-dark.png" alt="" width="64" height="64">
    <h2>Welcome</h2>
    <p class="sub">Two quick things before you start.</p>
    <div class="setup-q">
      <div class="field-head">Which player are you?</div>
      ${picker}
    </div>
    <div class="setup-q">
      <div class="field-head">Would you like to see player win rates?</div>
      <div class="setup-opts" role="group" aria-label="Player win rates">${opt('show', 'Show win rates')}${opt('hide', 'Hide win rates')}</div>
      <p class="sub small" id="rates-hint">${RATES_HINT[rates]}</p>
    </div>
    <button type="button" class="btn primary" data-setup-done ${rates ? '' : 'disabled'}>Continue</button>
    <p class="msg" id="claim-msg" role="alert"></p>
    <button type="button" class="linkish" data-setup-back>Back</button>
  </div>`;
}

// Back from the setup: the sign-up form again, filled in as it was.
function refillSignUp() {
  const d = state.signupDraft;
  const f = $('[data-signin="signup"]');
  if (!d || !f) return;
  for (const k of ['username', 'password', 'community']) if (f[k]) f[k].value = d[k];
  if (f.confirm) f.confirm.value = d.password;
  if (f.remember) f.remember.checked = d.remember;
  state.signupDraft = null;
}

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
    <p class="sub">Click the Clockwise icon in Chrome's toolbar and sign in to see the games everyone has recorded. You only need to do it once. Until then this shows only the games recorded in this browser.</p></div></div>`;
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
  state.settings = withMyCommunities(await api.get('settings', {}));
  if (!WEB && !state.settings.accountToken) state.profile = undefined;
  // This browser's games, minus ones you chose not to record (popup: "Don't record").
  const local = WEB ? {} : Object.fromEntries(Object.entries(await api.get('games', {})).filter(([, g]) => !g.skipped));
  const c = creds(state.settings);
  const cache = c.url ? await loadShared() : null;
  state.shared = { ...state.shared, on: !!c.url, hasPassword: canReadWith(c), account: c.token ? { username: c.username } : null, canEdit: !c.url || !!c.editorKey, cacheAt: cache && cache.at };
  const map = dropLocalTwins(c.url ? mergeGames(local, cache) : { ...local });
  state.games = Object.values(map).map((g) => ({ ...g, community: gameCommunity(state.settings, g) }));
  // Each community's members (members.js), for the player lists and rankings, and games for an editor to check.
  const counted = state.games.filter((g) => !g.excluded);
  members = communityMembers(counted, state.settings).members;
  const cfg = communityConfig(state.settings), hist = communityHistory(counted);
  for (const g of state.games) {
    const c = cfg.communities.find((x) => x.id === g.community);
    g.review = !!c && !setByChoice(cfg, g) && !suggestCommunity({ communities: [c] }, whoOf(g), hist, { self: g.id });
  }
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
  quietPlayers = new Set((cache && cache.privatePlayers) || []);
  playerNames = displayNames(state.games);
  useDisplayNames(playerNames);
  playerKeys = new Set(playerTable(state.games).map((p) => p.key));
  freeKeys = new Set(playerTable(state.games.filter((g) => !g.community && !g.excluded)).map((p) => p.key));
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
  const t = e.target.closest('[data-gview],[data-gmenu],[data-sort-table],[data-game-community],[data-add-player],[data-add-char],[data-add-type],[data-expand],[data-more-games],[data-delete],[data-action],[data-export],[data-clear-room],[data-fallback],[data-tab],[data-crumb-back],[data-crumb-styles],[data-go-styles],[data-stats-view],[data-confirm-community],#clear-sel');
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
  if (t.dataset.gameCommunity) {
    // Clicking the game's current community switches it off, leaving the game without one.
    const i = t.dataset.gameCommunity.lastIndexOf('|');
    const id = t.dataset.gameCommunity.slice(0, i), c = t.dataset.gameCommunity.slice(i + 1);
    const g = state.games.find((x) => x.id === id);
    await updateGame(id, { community: g && g.community === c ? null : c, communityManual: true });
    await load();
    return;
  }
  if (t.dataset.tab) {
    // The Stats tab opens the stats view picked last (Overview or Playstyles).
    if (t.dataset.tab === 'stats' && t.closest('.tabs')) state.tab = state.statsView || 'stats';
    else state.tab = t.dataset.tab;
    state.openGame = null; writeHash(); render(); window.scrollTo(0, 0); return;
  }
  if (t.id === 'clear-sel' && (state.tab === 'styles' || state.tab === 'me')) { clearScope(); return; }
  if (t.id === 'clear-sel') { clearAll(); return; }
  if (t.dataset.crumbStyles !== undefined) { clearScope(); return; }
  // An editor confirms a flagged game's community: it's then picked by hand, so it isn't flagged again.
  if (t.dataset.confirmCommunity) { const g = state.games.find((x) => x.id === t.dataset.confirmCommunity); if (g) { await updateGame(g.id, { community: g.community, communityManual: true }); await load(); } return; }
  // The Community view tabs (Overview, Playstyles).
  if (t.dataset.statsView) { state.tab = state.statsView = t.dataset.statsView; writeHash(); render(); return; }
  // "See all playstyles" on the Overview's Playstyles card.
  if (t.dataset.goStyles !== undefined) { state.tab = state.statsView = 'styles'; writeHash(); render(); window.scrollTo(0, 0); return; }
  // "← Community": the overview, with every filter cleared.
  if (t.dataset.crumbBack !== undefined) { state.tab = state.statsView = 'stats'; clearAll(); window.scrollTo(0, 0); return; }
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
  if (t.dataset.scatterKind !== undefined || t.dataset.scatterSide !== undefined) {
    if (t.dataset.scatterKind !== undefined) state.scatterView.kind = t.value; else state.scatterView.side = t.value;
    render();
    return;
  }
  if (t.dataset.playstyleSide !== undefined) { state.playstyleSide = t.value; render(); return; }
  // The dropdowns in each chart's question.
  if (t.dataset.talkMeasure !== undefined || t.dataset.talkSide !== undefined) {
    if (t.dataset.talkMeasure !== undefined) state.talkView.measure = t.value; else state.talkView.side = t.value;
    refreshTalkChart();
    return;
  }
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
if (hasChrome) chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Signed in or out in the popup: who you are decides which games you get, so start the download afresh.
  const s = changes.settings;
  if (s && ((s.oldValue || {}).accountName || '') !== ((s.newValue || {}).accountName || '') && !WEB) {
    state.profile = undefined;
    cacheClear().then(load).then(() => checkSignedIn()).then(() => syncShared());
    return;
  }
  if (changes.games || changes.lastSync || changes.assetMap || changes.roleMeta || changes.sharedCache || changes.settings) load();
});

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
    if (mode === 'signup') {
      // Check the community password (and get the players to pick from), then ask the setup questions. The account
      // is created when they're answered.
      const r = await peekGames(state.settings, val('community'));
      if (!r.ok) return fail(r.error === 'not-allowed' ? { error: 'not-allowed', message: 'That community password isn\'t right.' } : r);
      const names = displayNames(r.games || []);
      const players = playerTable(r.games || []).map((p) => ({ key: p.key, name: names.get(p.key) || p.name })).filter((x) => x.name);
      state.setup = { username: val('username'), password: f.password.value, community: val('community'), remember, players };
      state.setupRates = '';
      state.claimPick = null;
      state.shared.status = null;
      render();
      return;
    }
    if (mode === 'signin') {
      const r = await signIn(state.settings, val('username'), f.password.value);
      if (!r.ok) return fail(r);
      webAuth.setAccount(r.token, r.account.username, remember);
      setProfile(r.account);
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
  await keepToken(r.token);
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

// "Hide player win rates".
document.addEventListener('change', async (e) => {
  const box = e.target.closest('[data-private]');
  if (!box) return;
  box.disabled = true;
  const r = await setPrivate(state.settings, box.checked).catch((err) => ({ ok: false, message: err.message }));
  box.disabled = false;
  if (!r.ok) { box.checked = !box.checked; const m = $('#claim-msg'); if (m) { m.className = 'msg err'; m.textContent = claimError(r); } return; }
  setProfile(r.account);
  // Everyone else's copy of the list catches up on its next refresh; this page follows straight away.
  if (myPlayer()) { if (box.checked) quietPlayers.add(myPlayer()); else quietPlayers.delete(myPlayer()); }
  const m = $('#claim-msg'); if (m) { m.className = 'msg ok'; m.textContent = box.checked ? 'Player win rates are hidden now.' : 'Player win rates are showing again.'; }
});

// "Your communities" (website): a list with Remove buttons, and "+ Add community" opening a small form in place.
async function saveMyCommunities(list, done, form) {
  const say = (text, ok) => { const m = $('#mc-msg'); if (m) { m.className = `msg ${ok ? 'ok' : 'err'}`; m.textContent = text; } };
  const r = await saveCommunities(state.settings, list).catch((err) => ({ ok: false, message: err.message }));
  if (!r.ok) return say(claimError(r), false);
  if (form) { form.reset(); form.hidden = true; } // saved: the form closes (a redraw would otherwise keep it open)
  setProfile(r.account);
  await load();
  // Who sees what may have changed: download again (this redraws), then say so.
  await syncShared();
  say(done, true);
}
const myCommunities = () => (state.profile && state.profile.communities) || [];

document.addEventListener('click', async (e) => {
  const add = e.target.closest('[data-mc-add]');
  const cancel = e.target.closest('[data-mc-cancel]');
  const remove = e.target.closest('[data-mc-remove]');
  if (add || cancel) {
    const card = (add || cancel).closest('.card');
    const form = card.querySelector('[data-mc-form]');
    if (cancel) form.reset();
    form.hidden = !!cancel;
    card.querySelector('[data-mc-add]').hidden = !cancel;
    const m = $('#mc-msg'); if (m) m.textContent = '';
    if (add) form.querySelector('input').focus();
  } else if (remove) {
    const c = myCommunities().find((x) => x.id === remove.dataset.mcRemove);
    if (!c) return;
    remove.disabled = true;
    await saveMyCommunities(myCommunities().filter((x) => x !== c), `Removed ${c.name}.`);
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.matches('[data-mc-form]')) return;
  e.preventDefault();
  const name = f.elements.name.value.trim(); // (f.name would be the form's own name)
  const rooms = f.elements.rooms.value.split(',').map((x) => x.trim()).filter(Boolean);
  const button = f.querySelector('button[type=submit]');
  button.disabled = true;
  await saveMyCommunities([...myCommunities(), { name, rooms }], `Added ${name}.`, f);
  button.disabled = false;
});

const claimError = (r) => (r.error === 'unknown-action' ? 'The shared store needs updating before this works.' : r.message || 'Couldn\'t do that. Try again in a moment.');

document.addEventListener('click', async (e) => {
  // The setup after signing up: pick an answer, finish, or skip.
  const rates = e.target.closest('[data-setup-rates]');
  if (rates) {
    state.setupRates = rates.dataset.setupRates;
    document.querySelectorAll('[data-setup-rates]').forEach((b) => b.setAttribute('aria-pressed', String(b === rates)));
    $('#rates-hint').textContent = RATES_HINT[state.setupRates];
    $('[data-setup-done]').disabled = false;
    return;
  }
  // Back to the sign-up form (nothing has been created yet).
  if (e.target.closest('[data-setup-back]')) { state.signupDraft = state.setup; state.setup = null; state.claimPick = null; state.signin.mode = 'signup'; render(); return; }
  const done = e.target.closest('[data-setup-done]');
  if (done) {
    const d = state.setup;
    const pick = playerChoices().find((x) => x.key === state.claimPick);
    const hide = state.setupRates === 'hide';
    done.disabled = true;
    // Create the account. If that fails (a taken username, say), go back to the form to fix it.
    const r = await signUp(state.settings, d.community, d.username, d.password).catch((err) => ({ ok: false, message: err.message }));
    if (!r.ok) {
      state.shared.status = { error: r.error || 'failed', message: r.error === 'not-allowed' ? 'That community password isn\'t right.' : r.message };
      state.signupDraft = d; state.setup = null; state.signin.mode = 'signup';
      render();
      return;
    }
    webAuth.setAccount(r.token, r.account.username, d.remember);
    setProfile(r.account);
    state.setup = null;
    // Then the answers. The account exists now, so a problem here is shown in Settings rather than undone.
    let problem = null;
    if (pick) {
      const c = await claimPlayer(state.settings, pick.key, pick.name).catch((err) => ({ ok: false, message: err.message }));
      if (c.ok) setProfile(c.account); else problem = claimError(c);
    }
    const p = await setPrivate(state.settings, hide).catch((err) => ({ ok: false, message: err.message }));
    if (p.ok) setProfile(p.account); else problem = problem || claimError(p);
    if (myPlayer() && hide) quietPlayers.add(myPlayer());
    state.claimPick = null;
    state.shared.status = null;
    state.signin.open = false;
    if (problem) state.tab = 'data';
    await load();
    await syncShared();
    if (problem) { const m = $('#claim-msg'); if (m) { m.className = 'msg err'; m.textContent = problem; } }
    return;
  }
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
    setProfile(r.account);
    state.claimPick = null;
    render();
    syncShared();
  } else if (un) {
    un.disabled = true;
    const r = await unclaimPlayer(state.settings).catch((err) => ({ ok: false, message: err.message }));
    un.disabled = false;
    if (!r.ok) return say(claimError(r));
    setProfile(r.account);
    render();
    syncShared();
  } else if (remove) {
    const name = remove.dataset.claimRemove;
    if (!confirm(`Remove ${name}'s player? They can pick again.`)) return;
    remove.disabled = true;
    const r = await removeClaim(state.settings, name).catch((err) => ({ ok: false, message: err.message }));
    if (r.ok && state.shared.account && r.account.username.toLowerCase() === state.shared.account.username.toLowerCase()) setProfile(r.account);
    await loadAccounts();
    const m = $('#accounts-msg');
    if (m) { m.className = `msg ${r.ok ? 'ok' : 'err'}`; m.textContent = r.ok ? `Removed ${name}'s player.` : claimError(r); }
  }
});

// A password change on another device, or an editor's reset, signs this one out.
async function checkSignedIn() {
  if (!state.shared.account) return;
  const r = await whoAmI(state.settings).catch(() => null);
  // The store renews a sign-in that's been in use a while: keep the fresh one, where the old one was kept.
  if (r && r.ok && r.token) await keepToken(r.token);
  if (r && r.ok && r.account) { setProfile(r.account); await load(); }
  if (r && r.ok && r.signedOut) {
    await forgetAccount();
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
