// Playstyles: how each player's games tend to end (killed early, executed, survived…) and how often their
// nominations get the other team executed. Pure functions (no DOM), so it can be checked in Node.
//
// Every seat in every game gets one "fate" (FATES below) from its death phase, the deaths and the nominations. Each
// player's rates on one side (as good, as evil, or both) are also pulled toward the table-wide rate by SHRINK pretend
// games, so the awards on the main page can't go to someone with a lucky handful of games.

import { playerKey, displayName } from './stats.js?v=605a0b1f3e';

export const SIDES = ['good', 'evil', 'all'];
const SHRINK = 5; // pretend games at the table-wide rate added to every player's own
// Games a player needs on a side to be included: 3 everywhere for now, while there aren't many games yet.
export const MIN_GAMES = { good: 3, evil: 3, all: 3 };

// One per seat, in the order a game unfolds. "Early" means by the end of Day 2.
export const FATES = [
  { id: 'killedEarly', label: 'Killed early', tip: 'Died at night (or to an ability) by the end of Day 2' },
  { id: 'execEarly', label: 'Executed early', tip: 'Executed on Day 1 or Day 2' },
  { id: 'diedLater', label: 'Died later on', tip: 'Died after Day 2, other than being executed on the final day' },
  { id: 'execFinal', label: 'Executed on the final day', tip: 'Executed on the last day of the game. As good in a game evil won, this is the frame' },
  { id: 'survivedLost', label: 'Survived, lost', tip: 'Alive at the end, on the losing team' },
  { id: 'survivedWon', label: 'Survived, won', tip: 'Alive at the end, on the winning team' },
];

// ---------- per game ----------
const majorityMet = (n) => typeof n.votes !== 'number' || !n.majority || n.votes >= n.majority;
// Seat → the nomination that executed them (the last one that day with enough votes), for players who died in the
// day right after being nominated. Day deaths with no such nomination (Slayer shots, Virgin…) aren't executions.
function executions(g) {
  const out = new Map();
  for (const d of g.deaths || []) {
    if (d.atNight || !d.phase) continue;
    const noms = (g.nominations || []).filter((n) => n.phase === d.phase && n.nomineeSeat === d.seat && n.type !== 'exile' && n.completed !== false && majorityMet(n));
    if (noms.length) out.set(d.seat, { phase: d.phase, by: noms[noms.length - 1].nominatorSeat });
  }
  return out;
}

export function seatFate(g, p, exec = executions(g)) {
  if (p.survived) return p.won ? 'survivedWon' : 'survivedLost';
  if (!p.diedPhase) return null; // died before anyone was recording
  const day = Math.ceil(p.diedPhase / 2);
  const night = p.diedPhase % 2 === 1;
  const e = exec.get(p.seat);
  const executed = !night && e && e.phase === p.diedPhase;
  if (executed && day >= (g.days || day)) return 'execFinal';
  if (day <= 2) return executed ? 'execEarly' : 'killedEarly';
  return 'diedLater';
}

// Everything per seat the rates are built from.
function seatRecords(games) {
  const out = [];
  for (const g of games) {
    const exec = executions(g);
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    // Nominations and votes only count for games recorded from the start, since earlier days are missing otherwise.
    const tracked = !g.joinedAtPhase;
    for (const p of g.players) {
      const key = playerKey(p);
      if (!key || p.isTraveller || (p.alignment !== 'good' && p.alignment !== 'evil')) continue;
      const r = { g, p, key, side: p.alignment, fate: seatFate(g, p, exec), won: !!p.won, tracked, noms: 0, nomsOnEvil: 0, enemyExecs: 0, votes: 0, votesOnEvil: 0 };
      if (tracked) {
        for (const n of g.nominations || []) {
          if (n.type === 'exile') continue;
          const nominee = bySeat.get(n.nomineeSeat);
          const onEvil = nominee && nominee.alignment === 'evil';
          if (n.nominatorSeat === p.seat) { r.noms++; if (onEvil) r.nomsOnEvil++; }
          if ((n.voters || []).some((v) => v.seat === p.seat)) { r.votes++; if (onEvil) r.votesOnEvil++; }
        }
        for (const [seat, e] of exec) {
          const nominee = bySeat.get(seat);
          if (e.by === p.seat && nominee && nominee.alignment && nominee.alignment !== p.alignment && !nominee.isTraveller) r.enemyExecs++;
        }
      }
      out.push(r);
    }
  }
  return out;
}

// ---------- per player ----------
const blank = () => ({ games: 0, wins: 0, known: 0, fates: Object.fromEntries(FATES.map((f) => [f.id, 0])), tracked: 0, noms: 0, nomsOnEvil: 0, enemyExecs: 0, votes: 0, votesOnEvil: 0 });
function add(t, r) {
  t.games++;
  if (r.won) t.wins++;
  if (r.fate) { t.known++; t.fates[r.fate]++; }
  if (r.tracked) { t.tracked++; t.noms += r.noms; t.nomsOnEvil += r.nomsOnEvil; t.enemyExecs += r.enemyExecs; t.votes += r.votes; t.votesOnEvil += r.votesOnEvil; }
}

// Rates per player: what each counts and what it's out of (`of`), and the sides it applies to.
const FEATURES = {
  killedEarly: { label: 'Killed early', of: 'known', count: (t) => t.fates.killedEarly, pct: true, sides: ['good', 'evil', 'all'] },
  execEarly: { label: 'Executed early', of: 'known', count: (t) => t.fates.execEarly, pct: true, sides: ['good', 'evil', 'all'] },
  execFinal: { label: 'Executed on the final day', of: 'known', count: (t) => t.fates.execFinal, pct: true, sides: ['good', 'evil', 'all'] },
  survived: { label: 'Survived to the end', of: 'known', count: (t) => t.fates.survivedWon + t.fates.survivedLost, pct: true, sides: ['good', 'evil', 'all'] },
  winRate: { label: 'Win rate', of: 'games', count: (t) => t.wins, pct: true, sides: ['good', 'evil', 'all'] },
  noms: { label: 'Nominations per game', of: 'tracked', count: (t) => t.noms, pct: false, sides: ['good', 'evil', 'all'] },
  nomAccuracy: { label: 'Nominations on evil players', of: 'noms', count: (t) => t.nomsOnEvil, pct: true, sides: ['good'] },
  enemyExecs: { label: 'Evil executed from their nominations, per game', evilLabel: 'Good executed from their nominations, per game', allLabel: 'Other team executed from their nominations, per game', of: 'tracked', count: (t) => t.enemyExecs, pct: false, sides: ['good', 'evil', 'all'] },
  voteAccuracy: { label: 'Votes on evil players', of: 'votes', count: (t) => t.votesOnEvil, pct: true, sides: ['good'] },
};
export const featureLabel = (id, side) => (side === 'evil' && FEATURES[id].evilLabel) || (side === 'all' && FEATURES[id].allLabel) || FEATURES[id].label;
export const featureIsPct = (id) => FEATURES[id].pct;

// Raw and shrunk value of one feature for one tally, given the table-wide (pooled) rate.
function value(id, t, pooled) {
  const f = FEATURES[id];
  const n = t[f.of], x = f.count(t);
  return { raw: n ? x / n : null, n, shrunk: (x + SHRINK * pooled) / (n + SHRINK) };
}

// ---------- the whole analysis ----------
// side: 'good' | 'evil' | 'all'. Returns everyone with enough games on that side (fates, counts and rates), the
// table-wide totals, and how many players were left out for having fewer games.
export function playstyles(games, side = 'good', { minGames = MIN_GAMES[side] } = {}) {
  const recs = seatRecords(games).filter((r) => side === 'all' || r.side === side);
  const byPlayer = new Map();
  const pooled = blank();
  for (const r of recs) {
    if (!byPlayer.has(r.key)) byPlayer.set(r.key, { key: r.key, name: displayName(r.key, r.p.username), t: blank() });
    add(byPlayer.get(r.key).t, r);
    add(pooled, r);
  }
  const featureIds = Object.keys(FEATURES).filter((id) => FEATURES[id].sides.includes(side) && pooled[FEATURES[id].of] > 0);
  const poolRate = Object.fromEntries(featureIds.map((id) => [id, FEATURES[id].count(pooled) / pooled[FEATURES[id].of]]));
  const everyone = [...byPlayer.values()].map((pl) => ({
    ...pl,
    games: pl.t.games,
    values: Object.fromEntries(featureIds.map((id) => [id, value(id, pl.t, poolRate[id])])),
  })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const players = everyone.filter((pl) => pl.games >= minGames);
  return { side, minGames, pooled, poolRate, featureIds, players, others: everyone.length - players.length };
}
