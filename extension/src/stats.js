// Pure stats over captured game records. No DOM, so it can be unit-tested in Node.

export const TEAM_ORDER = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
const rate = (wins, n) => (n ? wins / n : null);
export const playerKey = (p) => p.userId || (p.username ? `name:${p.username.toLowerCase()}` : null);

// ---------- names ----------
// People rename themselves on botc.app (often as a joke for one game), but their account stays the same, so their
// games are already counted together. Each account is shown under the name it has used most, as a player or a
// storyteller. Names made only of invisible characters don't count; a tie goes to the most recent game.
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g;
export const cleanName = (name) => String(name || '').replace(INVISIBLE, '').trim();

export function displayNames(games) {
  const counts = new Map(); // key → Map(name → { n, last })
  for (const g of games) {
    for (const p of [...(g.players || []), ...(g.storytellers || [])]) {
      const key = playerKey(p);
      const name = cleanName(p.username);
      if (!key || !name) continue;
      const m = counts.get(key) || new Map();
      const c = m.get(name) || { n: 0, last: 0 };
      c.n++;
      c.last = Math.max(c.last, g.endedAt || 0);
      m.set(name, c);
      counts.set(key, m);
    }
  }
  const out = new Map();
  for (const [key, m] of counts) {
    const [best] = [...m].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last);
    out.set(key, best[0]);
  }
  return out;
}

// The names the dashboard is currently using (set from all recorded games), for code that only sees some of them.
let NAMES = null;
export function useDisplayNames(map) { NAMES = map; }
export const displayName = (key, fallback) => (NAMES && NAMES.get(key)) || cleanName(fallback) || fallback || key;
// Everyone who storytold a game, as account keys.
export const storytellerKeys = (g) => (g.storytellers || []).map(playerKey).filter(Boolean);

export function filterGames(all, f = {}) {
  const since = f.days ? Date.now() - f.days * 864e5 : 0;
  return all
    .filter((g) => (f.includeExcluded || (!g.excluded && !g.outside))
      && (!(f.communities && f.communities.length) || f.communities.includes(g.community))
      && (!f.script || g.script.name === f.script)
      && (!f.storyteller || storytellerKeys(g).includes(f.storyteller))
      && (!f.player || g.players.some((p) => playerKey(p) === f.player))
      && (g.endedAt || 0) >= since)
    .sort((a, b) => b.endedAt - a.endedAt);
}

function splitBy(games, keyFn) {
  const m = new Map();
  for (const g of games) {
    const k = keyFn(g);
    if (k === null || k === undefined) continue;
    const row = m.get(k) || { key: k, games: 0, good: 0, evil: 0 };
    row.games++;
    row[g.winner]++;
    m.set(k, row);
  }
  return [...m.values()];
}

export function overview(games) {
  const good = games.filter((g) => g.winner === 'good').length;
  const avg = (fn) => (games.length ? games.reduce((s, g) => s + fn(g), 0) / games.length : null);
  return {
    games: games.length,
    good,
    evil: games.length - good,
    goodRate: rate(good, games.length),
    avgDays: avg((g) => g.days || 0),
    avgPlayers: avg((g) => g.playerCount || 0),
    byCommunity: splitBy(games, (g) => g.community || null).sort((a, b) => b.games - a.games),
    byScript: splitBy(games, (g) => g.script.name || 'Unknown script').sort((a, b) => b.games - a.games),
    byPlayerCount: splitBy(games, (g) => g.playerCount).sort((a, b) => a.key - b.key),
    // Grouped by account; `name` is how to show them (co-storytellers joined with "&").
    byStoryteller: splitBy(games, (g) => storytellerKeys(g).join('|') || null)
      .map((r) => ({ ...r, name: r.key.split('|').map((k) => displayName(k, (games.flatMap((g) => g.storytellers).find((s) => playerKey(s) === k) || {}).username)).join(' & ') }))
      .sort((a, b) => b.games - a.games),
  };
}

// Per character: how the player holding it fared, and how the good team fared when it was in play.
export function characters(games) {
  const base = overview(games).goodRate;
  const m = new Map();
  for (const g of games) {
    const seen = new Set();
    for (const p of g.players) {
      if (!p.roleId) continue;
      const r = m.get(p.roleId) || { roleId: p.roleId, name: p.roleName, team: p.team, plays: 0, wins: 0, survived: 0, gamesInPlay: 0, goodWinsInPlay: 0, good: 0, evil: 0 };
      r.plays++;
      if (p.won) r.wins++;
      if (p.survived) r.survived++;
      if (p.alignment) r[p.alignment]++;
      if (!seen.has(p.roleId)) {
        seen.add(p.roleId);
        r.gamesInPlay++;
        if (g.winner === 'good') r.goodWinsInPlay++;
      }
      m.set(p.roleId, r);
    }
  }
  return [...m.values()].map((r) => {
    const goodRateInPlay = rate(r.goodWinsInPlay, r.gamesInPlay);
    return {
      ...r,
      alignment: r.evil > r.good ? 'evil' : 'good',
      winRate: rate(r.wins, r.plays),
      survivalRate: rate(r.survived, r.plays),
      goodRateInPlay,
      goodRateDelta: goodRateInPlay === null || base === null ? null : goodRateInPlay - base,
    };
  }).sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
}

export function players(games) {
  const m = new Map();
  const get = (key, name) => {
    let r = m.get(key);
    if (!r) {
      r = { key, name, games: 0, wins: 0, goodGames: 0, goodWins: 0, evilGames: 0, evilWins: 0, demonGames: 0, demonWins: 0, minionGames: 0, travellerGames: 0,
        survived: 0, nominationsMade: 0, timesNominated: 0, votesCast: 0, storytold: 0, roles: new Map(), lastPlayed: 0 };
      m.set(key, r);
    }
    return r;
  };
  for (const g of games) {
    for (const p of g.players) {
      const key = playerKey(p);
      if (!key) continue;
      const r = get(key, p.username || key);
      if (g.endedAt >= r.lastPlayed) r.lastPlayed = g.endedAt;
      r.name = displayName(key, p.username || r.name);
      r.games++;
      if (p.won) r.wins++;
      if (p.survived) r.survived++;
      if (p.alignment === 'good') { r.goodGames++; if (p.won) r.goodWins++; }
      if (p.alignment === 'evil') { r.evilGames++; if (p.won) r.evilWins++; }
      if (p.team === 'demon') { r.demonGames++; if (p.won) r.demonWins++; }
      if (p.team === 'minion') r.minionGames++;
      if (p.isTraveller) r.travellerGames++;
      const role = r.roles.get(p.roleId) || { roleId: p.roleId, name: p.roleName, team: p.team, plays: 0, wins: 0 };
      role.plays++;
      if (p.won) role.wins++;
      r.roles.set(p.roleId, role);
    }
    for (const n of g.nominations) {
      const from = g.players.find((p) => p.seat === n.nominatorSeat);
      const to = g.players.find((p) => p.seat === n.nomineeSeat);
      if (from && playerKey(from) && m.has(playerKey(from))) m.get(playerKey(from)).nominationsMade++;
      if (to && playerKey(to) && m.has(playerKey(to))) m.get(playerKey(to)).timesNominated++;
      for (const v of n.voters || []) {
        const vp = g.players.find((p) => p.seat === v.seat);
        if (vp && playerKey(vp) && m.has(playerKey(vp))) m.get(playerKey(vp)).votesCast++;
      }
    }
    for (const s of g.storytellers) {
      const key = playerKey(s);
      if (key) get(key, s.username || key).storytold++;
    }
  }
  return [...m.values()].map((r) => ({
    ...r,
    winRate: rate(r.wins, r.games),
    goodWinRate: rate(r.goodWins, r.goodGames),
    evilWinRate: rate(r.evilWins, r.evilGames),
    demonWinRate: rate(r.demonWins, r.demonGames),
    survivalRate: rate(r.survived, r.games),
    roles: [...r.roles.values()].sort((a, b) => b.plays - a.plays),
  })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

export function distinct(games, fn) {
  return [...new Set(games.flatMap((g) => [].concat(fn(g))).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}
