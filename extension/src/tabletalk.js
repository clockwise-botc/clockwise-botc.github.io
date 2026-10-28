// "Around the grimoire": how loud or quiet each player is, how often they're nominated, how often they vote, how long they
// live, and who they nominate (and get nominated by) most. Pure functions (no DOM).
//
// Everything is per DAY ALIVE, so someone killed on Night 1 isn't counted as quiet. A player is alive on day d if they
// survived, or died later than day d. Night deaths show up at the start of the next day in the recordings, so a death
// on day d counts as day d alive only if it was an execution (they were nominated that day with enough votes) or
// they nominated someone that day; otherwise they're taken to have died the night before.
//
// Only games recorded from the start count (earlier days are missing otherwise), and travellers are left out.
// The alignment split (as good / as evil) uses only games where the player kept one alignment the whole game: the
// character they started with and the one they ended with both belong to the side they ended on. A change within one
// side (a Scarlet Woman becoming the Imp) still counts; a Snake Charmer swap or a Pit-Hag turning them evil doesn't.
//
// Rates are pulled toward the table-wide rate by a few pretend days/votes/games (SHRINK), so players with little data
// don't look extreme by luck. Each rate is shown next to the table-wide average for the same games and side, as a gap
// (percentiles exaggerate tiny differences when most players sit close together).

import { playerKey, displayName } from './stats.js';
import { ALL_CHARACTERS } from './characters.js';

// Games a player needs to be listed: 3 everywhere for now, while there aren't many games yet.
export const MIN_GAMES = { all: 3, good: 3, evil: 3 };
const SHRINK = { perDay: 8, votes: 20, life: 3, other: 5 }; // pretend days, vote chances, games, nominations
const TEAM_OF = new Map(ALL_CHARACTERS.map(([id, , team]) => [id, team]));
const homeSide = (team) => (team === 'townsfolk' || team === 'outsider' ? 'good' : team === 'minion' || team === 'demon' ? 'evil' : null);
const dayOf = (n) => n.day || (n.phase ? Math.ceil(n.phase / 2) : null);
const enoughVotes = (n) => typeof n.votes !== 'number' || !n.majority || n.votes >= n.majority;

// The last day each seat was alive for, in one game.
function lastDays(g) {
  const out = new Map();
  const days = g.days || 0;
  const noms = (g.nominations || []).filter((n) => n.type !== 'exile');
  for (const p of g.players) {
    if (p.survived) { out.set(p.seat, days); continue; }
    if (!p.diedPhase) { out.set(p.seat, null); continue; } // died before recording started
    const d = Math.ceil(p.diedPhase / 2);
    if (p.diedPhase % 2 === 1) { out.set(p.seat, d - 1); continue; } // died at night
    const executed = noms.some((n) => dayOf(n) === d && n.nomineeSeat === p.seat && n.completed !== false && enoughVotes(n));
    const spoke = noms.some((n) => dayOf(n) === d && n.nominatorSeat === p.seat);
    out.set(p.seat, executed || spoke ? d : d - 1);
  }
  return out;
}

// One record per seat in each usable game.
export function seatRecords(games) {
  const out = [];
  for (const g of games) {
    if (g.joinedAtPhase || !g.days) continue;
    const last = lastDays(g);
    const noms = (g.nominations || []).filter((n) => n.type !== 'exile');
    const bySeat = new Map(g.players.map((x) => [x.seat, x]));
    const sideOf = (seat) => { const x = bySeat.get(seat); return x && (x.alignment === 'good' || x.alignment === 'evil') ? x.alignment : null; };
    for (const p of g.players) {
      const key = playerKey(p);
      const alive = last.get(p.seat);
      if (!key || p.isTraveller || alive === null || alive === undefined || (p.alignment !== 'good' && p.alignment !== 'evil')) continue;
      // A starting character we don't know the team of (a homebrew one) can't be checked, so that game is left out.
      const changed = p.startingRoleId && p.startingRoleId !== p.roleId;
      const steady = homeSide(p.team) === p.alignment && (!changed || homeSide(TEAM_OF.get(p.startingRoleId)) === p.alignment);
      // madeOn / votedOn: nominations they made (or voted on) where the nominee's alignment is known; …Other: of those,
      // on a player of the other team (by the alignments both ended the game with).
      const r = { g, p, key, side: p.alignment, steady, days: Math.max(alive, 0), gameDays: g.days, made: 0, received: 0, votes: 0, chances: 0,
        madeOn: 0, madeOther: 0, votedOn: 0, votedOther: 0 };
      for (const n of noms) {
        const d = dayOf(n);
        const target = sideOf(n.nomineeSeat);
        if (n.nominatorSeat === p.seat) {
          r.made++;
          if (target) { r.madeOn++; if (target !== p.alignment) r.madeOther++; }
        }
        if (n.nomineeSeat === p.seat) r.received++;
        if (d && d <= alive && n.completed !== false) {
          r.chances++;
          if ((n.voters || []).some((v) => v.seat === p.seat)) {
            r.votes++;
            if (target && n.nomineeSeat !== p.seat) { r.votedOn++; if (target !== p.alignment) r.votedOther++; }
          }
        }
      }
      out.push(r);
    }
  }
  return out;
}

const blank = () => ({ games: 0, days: 0, made: 0, received: 0, votes: 0, chances: 0, life: 0, madeOn: 0, madeOther: 0, votedOn: 0, votedOther: 0 });
function add(t, r) {
  t.games++; t.days += r.days; t.made += r.made; t.received += r.received; t.votes += r.votes; t.chances += r.chances;
  t.madeOn += r.madeOn; t.madeOther += r.madeOther; t.votedOn += r.votedOn; t.votedOther += r.votedOther;
  t.life += r.days / r.gameDays;
}
// The measures: how to get [count, exposure] from a tally, how much to shrink, and how to show values and gaps.
const perDay = { fmt: (v) => v.toFixed(2), gap: (d) => d.toFixed(2), unit: '' };
const share = { fmt: (v) => `${Math.round(v * 100)}%`, gap: (d) => (Math.round(d * 100) === 1 ? '1 pt' : `${Math.round(d * 100)} pts`), unit: '' };
export const MEASURES = {
  loud: { label: 'Nominations per day alive', get: (t) => [t.made, t.days], shrink: SHRINK.perDay, ...perDay,
    counts: (t) => `${t.made} nominations in ${t.days} days alive` },
  nominated: { label: 'Times nominated per day alive', get: (t) => [t.received, t.days], shrink: SHRINK.perDay, ...perDay,
    counts: (t) => `nominated ${t.received} times in ${t.days} days alive` },
  voter: { label: 'Votes on nominations while alive', get: (t) => [t.votes, t.chances], shrink: SHRINK.votes, ...share,
    counts: (t) => `voted on ${t.votes} of ${t.chances} nominations while alive` },
  nomOther: { label: 'Nominations on the other team', get: (t) => [t.madeOther, t.madeOn], shrink: SHRINK.other, ...share,
    counts: (t) => `${t.madeOther} of ${t.madeOn} nominations were on the other team` },
  voteOther: { label: 'Votes on the other team', get: (t) => [t.votedOther, t.votedOn], shrink: SHRINK.votes, ...share,
    counts: (t) => `${t.votedOther} of ${t.votedOn} votes were on the other team` },
  life: { label: 'Share of the game alive', get: (t) => [t.life, t.games], shrink: SHRINK.life, ...share,
    counts: (t) => `alive for ${Math.round((t.life / (t.games || 1)) * 100)}% of the days on average, over ${t.games} games` },
};
// The gap as shown, rounded the way the values are, so "0.35 vs. 0.35" never reads as a gap.
export function gapOf(id, value, avg) {
  const m = MEASURES[id];
  const shown = Number(m.fmt(value).replace('%', '')) - Number(m.fmt(avg).replace('%', ''));
  return { d: value - avg, shown, about: shown === 0 };
}

// For each side ('all', 'good', 'evil'): every player's totals, raw and shrunk rates and gap from the table average.
// `listed`: has enough games on that side to be shown in the all-player chart and table.
// minGames: games a player needs to be listed (the Playstyles tab's "Min. games"); MIN_GAMES by default.
export function tableTalk(games, { minGames = null } = {}) {
  const recs = seatRecords(games);
  const out = {};
  for (const side of ['all', 'good', 'evil']) {
    const use = side === 'all' ? recs : recs.filter((r) => r.side === side && r.steady);
    const by = new Map(), pooled = blank();
    for (const r of use) {
      if (!by.has(r.key)) by.set(r.key, { key: r.key, name: displayName(r.key, r.p.username), t: blank() });
      add(by.get(r.key).t, r);
      add(pooled, r);
    }
    const table = Object.fromEntries(Object.entries(MEASURES).map(([id, m]) => { const [c, n] = m.get(pooled); return [id, n ? c / n : null]; }));
    const players = [...by.values()].map((pl) => {
      const rates = {};
      for (const [id, m] of Object.entries(MEASURES)) {
        const [c, n] = m.get(pl.t);
        const value = table[id] === null ? null : (c + m.shrink * table[id]) / (n + m.shrink);
        rates[id] = { raw: n ? c / n : null, n, value, gap: value === null ? null : gapOf(id, value, table[id]) };
      }
      return { ...pl, games: pl.t.games, rates, listed: pl.t.games >= (minGames ?? MIN_GAMES[side]) };
    });
    out[side] = { players: players.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)), table, listed: players.filter((p) => p.listed).length, minGames: minGames ?? MIN_GAMES[side], seats: pooled.games };
  }
  return out;
}

// Who `key` nominates most, and who nominates them most, with how many games they sat in together.
// Every recorded nomination counts (also from games joined part-way).
export function nominationPairs(games, key) {
  const made = new Map(), got = new Map(), together = new Map();
  const bump = (m, k, name) => { const r = m.get(k) || { key: k, name, n: 0 }; r.n++; m.set(k, r); };
  for (const g of games) {
    const me = g.players.find((p) => playerKey(p) === key);
    if (!me) continue;
    for (const p of g.players) { const k = playerKey(p); if (k && k !== key) together.set(k, (together.get(k) || 0) + 1); }
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    for (const n of g.nominations || []) {
      if (n.type === 'exile') continue;
      const from = bySeat.get(n.nominatorSeat), to = bySeat.get(n.nomineeSeat);
      if (!from || !to) continue;
      if (n.nominatorSeat === me.seat && playerKey(to) && playerKey(to) !== key) bump(made, playerKey(to), displayName(playerKey(to), to.username));
      if (n.nomineeSeat === me.seat && playerKey(from) && playerKey(from) !== key) bump(got, playerKey(from), displayName(playerKey(from), from.username));
    }
  }
  const finish = (m) => [...m.values()].map((r) => ({ ...r, games: together.get(r.key) || 0, perGame: r.n / (together.get(r.key) || 1) }))
    .sort((a, b) => b.n - a.n || b.perGame - a.perGame || a.name.localeCompare(b.name));
  return { nominates: finish(made), nominatedBy: finish(got) };
}

// Who `key` votes against most (votes on nominations of each player), and who votes against them most.
// A chance is a nomination of the target on a day the voter was alive (the target is alive, being nominated), in
// games recorded from the start. Each pair's rate is set against the voter's usual voting rate (every nomination they
// could vote on), since some people vote on almost everything. Rates are pulled toward that usual rate by a few
// pretend chances (VOTE_SHRINK), and pairs with fewer than `minChances` chances are left out.
const VOTE_SHRINK = 3;
export function votePairs(games, key, { minChances = 3 } = {}) {
  // Everyone's usual voting rate, over all usable games.
  const usual = new Map();
  for (const r of seatRecords(games)) {
    const u = usual.get(r.key) || { votes: 0, chances: 0 };
    u.votes += r.votes; u.chances += r.chances;
    usual.set(r.key, u);
  }
  const baseOf = (k) => { const u = usual.get(k); return u && u.chances ? u.votes / u.chances : null; };
  const against = new Map(), by = new Map(); // other → { key, name, votes, chances }
  const bump = (m, p, voted) => {
    const k = playerKey(p);
    const r = m.get(k) || { key: k, name: displayName(k, p.username), votes: 0, chances: 0 };
    r.chances++; if (voted) r.votes++;
    m.set(k, r);
  };
  for (const g of games) {
    if (g.joinedAtPhase || !g.days) continue;
    const me = g.players.find((p) => playerKey(p) === key);
    if (!me || me.isTraveller) continue;
    const last = lastDays(g);
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    for (const n of g.nominations || []) {
      if (n.type === 'exile' || n.completed === false) continue;
      const d = dayOf(n);
      const target = bySeat.get(n.nomineeSeat);
      if (!d || !target) continue;
      const voters = new Set((n.voters || []).map((v) => v.seat));
      const alive = (p) => { const l = last.get(p.seat); return l !== null && l !== undefined && d <= l; };
      if (target.seat !== me.seat) {
        if (playerKey(target) && !target.isTraveller && alive(me)) bump(against, target, voters.has(me.seat));
      } else {
        for (const p of g.players) {
          if (p.seat === me.seat || p.isTraveller || !playerKey(p) || !alive(p)) continue;
          bump(by, p, voters.has(p.seat));
        }
      }
    }
  }
  const finish = (m, baseKey) => [...m.values()].filter((r) => r.chances >= minChances).map((r) => {
    const base = baseOf(baseKey(r));
    const rate = r.votes / r.chances;
    const shrunk = base === null ? rate : (r.votes + VOTE_SHRINK * base) / (r.chances + VOTE_SHRINK);
    return { ...r, rate, base, shrunk, gap: base === null ? null : shrunk - base };
  }).sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1) || b.chances - a.chances || a.name.localeCompare(b.name));
  // Against: my votes, so my usual rate. By: their votes, so each voter's own usual rate.
  return { against: finish(against, () => key), by: finish(by, (r) => r.key), usual: baseOf(key) };
}

// Worst enemy: the player `key` has the most friction with, from four things between the two of them:
//   they nominate `key`   (weight ENEMY_WEIGHTS.theyNominate)
//   `key` nominates them  (iNominate)
//   they vote on `key`'s nominations  (theyVote)
//   `key` votes on their nominations  (iVote)
// Nominations weigh a little more than votes, and being targeted a little more than targeting.
// Each part is what happened next to what you'd expect, so playing lots of games together doesn't by itself make an
// enemy:
//   nominations: games where one nominated the other at least once, next to the games you'd expect if nominators
//     picked anyone at the table (per game, so one heated game counts once);
//   votes: votes on the other's nominations, next to the voter's usual rate times their chances (votePairs).
// Each part's lean, log((observed + 0.5) / (expected + 0.5)), is weighted by games together: n / (n + ENEMY_PRIOR_GAMES).
// So a pair's own numbers count for half at ENEMY_PRIOR_GAMES games together, less before and more after, and a
// steady lean over many games outweighs a burst over a few. (The 0.5 only keeps zero counts finite.)
// The four are then put on the same scale (standardised across everyone they've played at least `minGames` games
// with) and averaged with the weights. The top score is the worst enemy; the bottom one is the best ally.
export const ENEMY_WEIGHTS = { theyNominate: 1.5, iNominate: 1.25, theyVote: 1.25, iVote: 1 };
export const ENEMY_MIN_GAMES = 3;
export const ENEMY_PRIOR_GAMES = 10;
export function enemies(games, key, { minGames = ENEMY_MIN_GAMES, priorGames = ENEMY_PRIOR_GAMES } = {}) {
  const rows = new Map();
  const row = (p) => {
    const k = playerKey(p);
    if (!rows.has(k)) rows.set(k, { key: k, name: displayName(k, p.username), games: 0, last: 0, iNom: { n: 0, exp: 0 }, theyNom: { n: 0, exp: 0 } });
    return rows.get(k);
  };
  for (const g of games) {
    const me = g.players.find((p) => playerKey(p) === key);
    if (!me) continue;
    const others = g.players.filter((p) => playerKey(p) && playerKey(p) !== key);
    for (const p of others) { const r = row(p); r.games++; r.last = Math.max(r.last, g.endedAt || 0); }
    const seated = g.players.filter((p) => !p.isTraveller);
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    // Per game: whether each pair nominated at least once, and the chance of that if every pick were random
    // (1 minus the chance that none of the nominator's nominations landed on them).
    const iMiss = new Map(), iHit = new Set(), theyMiss = new Map(), theyHit = new Set();
    for (const n of g.nominations || []) {
      if (n.type === 'exile') continue;
      const from = bySeat.get(n.nominatorSeat), to = bySeat.get(n.nomineeSeat);
      if (!from || !to) continue;
      const pool = seated.filter((p) => p.seat !== from.seat);
      if (!pool.length) continue;
      if (from.seat === me.seat) {
        for (const q of pool) {
          const k = playerKey(q);
          if (!k || k === key) continue;
          iMiss.set(k, (iMiss.has(k) ? iMiss.get(k) : 1) * (1 - 1 / pool.length));
          if (q.seat === to.seat) iHit.add(k);
        }
      } else if (playerKey(from) && pool.some((q) => q.seat === me.seat)) {
        const k = playerKey(from);
        theyMiss.set(k, (theyMiss.has(k) ? theyMiss.get(k) : 1) * (1 - 1 / pool.length));
        if (to.seat === me.seat) theyHit.add(k);
      }
    }
    for (const [k, miss] of iMiss) { const r = rows.get(k); if (r) { r.iNom.exp += 1 - miss; if (iHit.has(k)) r.iNom.n++; } }
    for (const [k, miss] of theyMiss) { const r = rows.get(k); if (r) { r.theyNom.exp += 1 - miss; if (theyHit.has(k)) r.theyNom.n++; } }
  }
  const { against, by } = votePairs(games, key, { minChances: 1 });
  const voteOf = (list) => new Map(list.filter((r) => r.base > 0).map((r) => [r.key, r]));
  const iVoteOf = voteOf(against), theyVoteOf = voteOf(by);
  const list = [...rows.values()].filter((r) => r.games >= minGames).map((r) => {
    const iVote = iVoteOf.get(r.key) || null, theyVote = theyVoteOf.get(r.key) || null;
    const w = r.games / (r.games + priorGames);
    const lean = (obs, exp) => w * Math.log((obs + 0.5) / (exp + 0.5));
    const votes = (v) => (v ? lean(v.votes, v.base * v.chances) : 0);
    return { ...r, iVote, theyVote, weight: w, parts: {
      theyNominate: lean(r.theyNom.n, r.theyNom.exp),
      iNominate: lean(r.iNom.n, r.iNom.exp),
      theyVote: votes(theyVote),
      iVote: votes(iVote),
    } };
  });
  const wsum = Object.values(ENEMY_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const r of list) r.z = {};
  for (const id of Object.keys(ENEMY_WEIGHTS)) {
    const xs = list.map((r) => r.parts[id]);
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1));
    for (const r of list) r.z[id] = sd > 0 ? (r.parts[id] - mean) / sd : 0;
  }
  for (const r of list) r.score = Object.entries(ENEMY_WEIGHTS).reduce((s, [id, w]) => s + w * r.z[id], 0) / wsum;
  // Ties go to more games together, then the most recent game together, then the name.
  return list.sort((a, b) => b.score - a.score || tieBreak(a, b));
}
const tieBreak = (a, b) => b.games - a.games || b.last - a.last || a.name.localeCompare(b.name);
// Best ally: the lowest scores first, with the same tie-breaks as enemies().
export const allies = (list) => [...list].sort((a, b) => a.score - b.score || tieBreak(a, b));
