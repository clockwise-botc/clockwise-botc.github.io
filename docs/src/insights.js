// Stats for an arbitrary selection of players, characters and character types. Pure functions (no DOM).
//
// Selection model:
//   - Selected players and characters narrow the GAMES: a game counts only if every selected player
//     sat in it and every selected character was in play.
//   - Selected players and types pick the SEATS we describe in those games (e.g. "ash as demon").
//     With both selected, games also narrow to those where each selected player held one of the types.
//     With only characters selected, the seats are whoever held those characters.

import { playerKey, displayName } from './stats.js?v=276bfa0b3c';

export const TYPES = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
const rate = (w, n) => (n ? w / n : null);

export function emptySelection() {
  return { players: [], characters: [], types: [] };
}

export function hasSelection(sel) {
  return sel.players.length + sel.characters.length + sel.types.length > 0;
}

// Did this seat hold one of these characters, at the start or by the end?
export const holds = (p, chars) => chars.includes(p.roleId) || (!!p.startingRoleId && chars.includes(p.startingRoleId));

// With players picked, characters and types describe what those players held ("liatfiat as the Scarlet Woman").
// With no players, characters mean "in play" and types only narrow the seats looked at.
export function selectGames(base, sel) {
  return base.filter((g) =>
    sel.players.every((k) => g.players.some((p) => playerKey(p) === k
      && (!sel.characters.length || holds(p, sel.characters))
      && (!sel.types.length || sel.types.includes(p.team)))) &&
    (sel.players.length > 0 || sel.characters.every((r) => g.players.some((p) => p.roleId === r))));
}

export function focusSeats(games, sel) {
  const seats = [];
  const onlyChars = !sel.players.length && !sel.types.length && sel.characters.length;
  for (const g of games) {
    for (const p of g.players) {
      if (onlyChars ? sel.characters.includes(p.roleId)
        : (!sel.players.length || sel.players.includes(playerKey(p))) && (!sel.types.length || sel.types.includes(p.team))) {
        seats.push({ g, p });
      }
    }
  }
  return seats;
}

export function outcome(games) {
  const good = games.filter((g) => g.winner === 'good').length;
  return {
    n: games.length, good, evil: games.length - good, goodRate: rate(good, games.length),
    avgDays: games.length ? games.reduce((s, g) => s + (g.days || 0), 0) / games.length : null,
  };
}

function tally(map, key, init, won) {
  const r = map.get(key) || init();
  r.plays++;
  if (won) r.wins++;
  map.set(key, r);
  return r;
}

const finish = (rows) => rows.map((r) => ({ ...r, winRate: rate(r.wins, r.plays) })).sort((a, b) => b.plays - a.plays || (b.winRate || 0) - (a.winRate || 0));

// Summary of a set of seats: how those seats fared, split several ways.
export function seatStats(seats) {
  const s = { plays: seats.length, wins: 0, survived: 0, good: { plays: 0, wins: 0 }, evil: { plays: 0, wins: 0 } };
  const byTeam = new Map(), byChar = new Map(), byPlayer = new Map(), byScript = new Map(), byCommunity = new Map(), death = new Map();
  for (const { g, p } of seats) {
    if (p.won) s.wins++;
    if (p.survived) s.survived++;
    if (p.alignment === 'good' || p.alignment === 'evil') { s[p.alignment].plays++; if (p.won) s[p.alignment].wins++; }
    tally(byTeam, p.team || 'unknown', () => ({ team: p.team, plays: 0, wins: 0 }), p.won);
    tally(byChar, p.roleId, () => ({ roleId: p.roleId, name: p.roleName, team: p.team, plays: 0, wins: 0 }), p.won);
    const key = playerKey(p);
    if (key) {
      const r = tally(byPlayer, key, () => ({ key, name: displayName(key, p.username), plays: 0, wins: 0, survived: 0 }), p.won);
      if (p.survived) r.survived++;
      r.name = displayName(key, p.username || r.name);
    }
    tally(byScript, g.script.name || 'Unknown script', () => ({ key: g.script.name || 'Unknown script', plays: 0, wins: 0 }), p.won);
    if (g.community) tally(byCommunity, g.community, () => ({ key: g.community, plays: 0, wins: 0 }), p.won);
    const when = p.survived ? 'survived' : p.diedPhase ? `${p.diedPhase % 2 ? 'Night' : 'Day'} ${Math.ceil(p.diedPhase / 2)}` : 'unknown';
    death.set(when, (death.get(when) || 0) + 1);
  }
  return {
    ...s,
    winRate: rate(s.wins, s.plays),
    survivalRate: rate(s.survived, s.plays),
    goodWinRate: rate(s.good.wins, s.good.plays),
    evilWinRate: rate(s.evil.wins, s.evil.plays),
    byTeam: finish([...byTeam.values()]).sort((a, b) => TYPES.indexOf(a.team) - TYPES.indexOf(b.team)),
    byCharacter: finish([...byChar.values()]),
    byPlayer: finish([...byPlayer.values()]).map((r) => ({ ...r, survivalRate: rate(r.survived, r.plays) })),
    byScript: finish([...byScript.values()]),
    byCommunity: finish([...byCommunity.values()]),
    deathTiming: orderDeaths(death),
  };
}

function orderDeaths(map) {
  const order = (k) => (k === 'survived' ? 1e6 : k === 'unknown' ? 1e6 + 1 : (Number(k.split(' ')[1]) * 2 - (k.startsWith('Night') ? 1 : 0)));
  return [...map.entries()].map(([when, n]) => ({ when, n })).sort((a, b) => order(a.when) - order(b.when));
}

// For each character in play across `games`: holder record, and good's win rate when it's in play.
export function characterTable(games, baseGoodRate) {
  const m = new Map();
  for (const g of games) {
    const seen = new Set();
    for (const p of g.players) {
      if (!p.roleId) continue;
      const r = m.get(p.roleId) || { roleId: p.roleId, name: p.roleName, team: p.team, plays: 0, wins: 0, survived: 0, games: 0, goodWins: 0 };
      r.plays++;
      if (p.won) r.wins++;
      if (p.survived) r.survived++;
      if (!seen.has(p.roleId)) { seen.add(p.roleId); r.games++; if (g.winner === 'good') r.goodWins++; }
      m.set(p.roleId, r);
    }
  }
  return [...m.values()].map((r) => {
    const goodRate = rate(r.goodWins, r.games);
    return { ...r, winRate: rate(r.wins, r.plays), survivalRate: rate(r.survived, r.plays), goodRate, delta: goodRate === null || baseGoodRate === null ? null : goodRate - baseGoodRate };
  }).sort((a, b) => b.plays - a.plays);
}

// Characters that most change the result when they're in play alongside `games` (already narrowed).
export function companions(games, exclude, minGames = 3) {
  const base = outcome(games).goodRate;
  return characterTable(games, base)
    .filter((r) => !exclude.includes(r.roleId) && r.games >= minGames && r.games < games.length)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// Good's win rate by how many characters of the selected types were in play.
export function countEffect(games, types) {
  const m = new Map();
  for (const g of games) {
    const k = g.players.filter((p) => types.includes(p.team)).length;
    const r = m.get(k) || { key: k, games: 0, good: 0, evil: 0 };
    r.games++;
    r[g.winner]++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.key - b.key);
}

// How one player does with/against everyone else.
export function relations(games, key, minGames = 3) {
  const m = new Map();
  for (const g of games) {
    const me = g.players.find((p) => playerKey(p) === key);
    if (!me || !me.alignment) continue;
    for (const o of g.players) {
      const k = playerKey(o);
      if (!k || k === key || !o.alignment) continue;
      const r = m.get(k) || { key: k, name: displayName(k, o.username), together: 0, same: 0, sameWins: 0, opposite: 0, oppositeWins: 0 };
      r.together++;
      if (o.alignment === me.alignment) { r.same++; if (me.won) r.sameWins++; } else { r.opposite++; if (me.won) r.oppositeWins++; }
      m.set(k, r);
    }
  }
  const rows = [...m.values()].map((r) => ({ ...r, sameRate: rate(r.sameWins, r.same), oppositeRate: rate(r.oppositeWins, r.opposite) }));
  return {
    teammates: rows.filter((r) => r.same >= minGames).sort((a, b) => b.sameRate - a.sameRate || b.same - a.same),
    rivals: rows.filter((r) => r.opposite >= minGames).sort((a, b) => a.oppositeRate - b.oppositeRate || b.opposite - a.opposite),
  };
}

// Two or more players: how they do when all on the same side (overall, as good, as evil),
// how each does when they're split up, and pair-by-pair records.
export function groupRelations(games, keys) {
  const seat = (g, k) => g.players.find((p) => playerKey(p) === k);
  const same = { games: 0, wins: 0, good: { games: 0, wins: 0 }, evil: { games: 0, wins: 0 } };
  const split = { games: 0, players: keys.map((key) => ({ key, plays: 0, wins: 0 })) };
  const pairs = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) pairs.push({ a: keys[i], b: keys[j], same: 0, sameWins: 0, opposite: 0, aWins: 0, bWins: 0 });
  for (const g of games) {
    const seats = keys.map((k) => seat(g, k));
    if (seats.some((s) => !s || !s.alignment)) continue;
    if (seats.every((s) => s.alignment === seats[0].alignment)) {
      same.games++;
      same[seats[0].alignment].games++;
      if (seats[0].won) { same.wins++; same[seats[0].alignment].wins++; }
    } else {
      split.games++;
      seats.forEach((s, i) => { split.players[i].plays++; if (s.won) split.players[i].wins++; });
    }
    for (const pr of pairs) {
      const a = seat(g, pr.a), b = seat(g, pr.b);
      if (a.alignment === b.alignment) { pr.same++; if (a.won) pr.sameWins++; } else { pr.opposite++; if (a.won) pr.aWins++; else pr.bWins++; }
    }
  }
  return {
    same: { ...same, rate: rate(same.wins, same.games), goodRate: rate(same.good.wins, same.good.games), evilRate: rate(same.evil.wins, same.evil.games) },
    split: { games: split.games, players: split.players.map((p) => ({ ...p, winRate: rate(p.wins, p.plays) })) },
    // kept for callers that only need the totals
    allSame: same.games, allSameWins: same.wins, allSameRate: rate(same.wins, same.games),
    pairs: pairs.map((p) => ({ ...p, sameRate: rate(p.sameWins, p.same) })),
  };
}

// Nomination behaviour for a set of players: how often their nominations and votes landed on evil players.
export function nominationStats(games, keys) {
  const s = { made: 0, onEvil: 0, received: 0, executed: 0, votes: 0, votesOnEvil: 0 };
  for (const g of games) {
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    for (const n of g.nominations || []) {
      const from = bySeat.get(n.nominatorSeat), to = bySeat.get(n.nomineeSeat);
      if (!to) continue;
      if (from && keys.includes(playerKey(from))) { s.made++; if (to.alignment === 'evil') s.onEvil++; }
      if (keys.includes(playerKey(to))) { s.received++; if (to.diedPhase === n.phase) s.executed++; }
      for (const v of n.voters || []) {
        const vp = bySeat.get(v.seat);
        if (vp && keys.includes(playerKey(vp))) { s.votes++; if (to.alignment === 'evil') s.votesOnEvil++; }
      }
    }
  }
  return { ...s, accuracy: rate(s.onEvil, s.made), voteAccuracy: rate(s.votesOnEvil, s.votes) };
}

// Overall leaderboard of players (no selection).
export function playerTable(games) {
  const all = [];
  for (const g of games) for (const p of g.players) all.push({ g, p });
  return seatStats(all).byPlayer;
}

// ---------- predicting the result for a set of characters ----------
// Ridge-regularised logistic regression of "good won" on which characters were in play (travellers
// excluded). Character columns are centred, so the prediction describes a typical game that also
// includes the selected characters. The penalty pulls characters with little data toward "no effect";
// the likely range comes from the Laplace approximation (posterior covariance = inverse Hessian).
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(p / (1 - p));

function cholesky(A) {
  const n = A.length, L = A.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  }
  return L;
}
function cholSolve(L, b) {
  const n = L.length, y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

export function fitOutcomeModel(games, { lambda = 2 } = {}) {
  const roles = [...new Set(games.flatMap((g) => g.players.filter((p) => p.roleId && p.team !== 'traveller').map((p) => p.roleId)))];
  const col = new Map(roles.map((r, i) => [r, i + 1]));
  const n = games.length, k = roles.length + 1;
  const raw = games.map((g) => { const row = new Float64Array(k); row[0] = 1; for (const p of g.players) if (col.has(p.roleId)) row[col.get(p.roleId)] = 1; return row; });
  const mean = new Float64Array(k);
  for (const r of raw) for (let j = 1; j < k; j++) mean[j] += r[j] / n;
  const X = raw.map((r) => r.map((v, j) => (j === 0 ? 1 : v - mean[j])));
  const y = games.map((g) => (g.winner === 'good' ? 1 : 0));
  const goodRate = (y.reduce((a, b) => a + b, 0) + 1) / (n + 2);
  const beta = new Float64Array(k);
  beta[0] = logit(goodRate);
  let L = null;
  for (let it = 0; it < 30; it++) {
    const H = Array.from({ length: k }, () => new Float64Array(k));
    const grad = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let z = 0; for (let j = 0; j < k; j++) z += xi[j] * beta[j];
      const p = sigmoid(z), w = p * (1 - p), r = y[i] - p;
      for (let a = 0; a < k; a++) {
        if (!xi[a]) continue;
        grad[a] += xi[a] * r;
        const wa = w * xi[a];
        for (let b = 0; b <= a; b++) if (xi[b]) H[a][b] += wa * xi[b];
      }
    }
    for (let a = 0; a < k; a++) { for (let b = 0; b < a; b++) H[b][a] = H[a][b]; }
    for (let j = 1; j < k; j++) { H[j][j] += lambda; grad[j] -= lambda * beta[j]; }
    H[0][0] += 1e-6;
    L = cholesky(H);
    const step = cholSolve(L, grad);
    let max = 0;
    for (let j = 0; j < k; j++) { beta[j] += step[j]; max = Math.max(max, Math.abs(step[j])); }
    if (max < 1e-7) break;
  }
  return { roles, col, mean, beta, L, n, goodRate: y.reduce((a, b) => a + b, 0) / n, k };
}

// How much to pull characters toward "no effect" is picked by 5-fold cross-validation on the games
// themselves, and the same test says whether the model beats simply guessing the overall rate.
export function tuneOutcomeModel(games, lambdas = [2, 4, 8, 16, 32, 64]) {
  const folds = 5;
  const ll = (p, y) => -(y ? Math.log(p) : Math.log(1 - p));
  const scores = lambdas.map((lambda) => {
    let loss = 0, right = 0, baseLoss = 0, baseRight = 0;
    for (let f = 0; f < folds; f++) {
      const train = games.filter((_, i) => i % folds !== f), test = games.filter((_, i) => i % folds === f);
      if (!test.length || train.length < 6) continue;
      const m = fitOutcomeModel(train, { lambda });
      const rate = train.filter((g) => g.winner === 'good').length / train.length;
      const b = Math.min(Math.max(rate, 0.02), 0.98);
      for (const g of test) {
        const y = g.winner === 'good' ? 1 : 0;
        let z = 0;
        const seen = new Set();
        z += m.beta[0];
        for (const [r, j] of m.col) z -= m.beta[j] * m.mean[j];
        for (const p of g.players) if (m.col.has(p.roleId) && !seen.has(p.roleId)) { seen.add(p.roleId); z += m.beta[m.col.get(p.roleId)]; }
        const p = Math.min(Math.max(sigmoid(z), 0.01), 0.99);
        loss += ll(p, y); baseLoss += ll(b, y);
        if ((p > 0.5) === !!y) right++;
        if ((b >= 0.5) === !!y) baseRight++;
      }
    }
    return { lambda, loss: loss / games.length, baseLoss: baseLoss / games.length, accuracy: right / games.length, baseAccuracy: baseRight / games.length };
  });
  const best = scores.reduce((a, b) => (b.loss < a.loss ? b : a));
  // Only call it a real prediction if it clearly beats guessing the overall rate on held-out games.
  return { ...best, skill: best.loss < best.baseLoss * 0.99 && best.accuracy > best.baseAccuracy };
}

// Predicted chance that good wins with all of `roleIds` in play, an ~80% likely range, and each
// character's own push (percentage points vs. a typical game).
export function predictOutcome(games, roleIds, opts = {}) {
  if (games.length < 8) return null;
  const tune = opts.tune || (opts.lambda ? null : tuneOutcomeModel(games));
  const m = fitOutcomeModel(games, { lambda: opts.lambda || tune.lambda });
  const x = new Float64Array(m.k);
  x[0] = 1;
  for (const r of roleIds) if (m.col.has(r)) { const j = m.col.get(r); x[j] = 1 - m.mean[j]; }
  let eta = 0; for (let j = 0; j < m.k; j++) eta += x[j] * m.beta[j];
  const z = cholSolve(m.L, x);
  let v = 0; for (let j = 0; j < m.k; j++) v += x[j] * z[j];
  const sd = Math.sqrt(Math.max(v, 0));
  const base = sigmoid(m.beta[0]);
  const counts = new Map();
  for (const g of games) for (const r of new Set(g.players.map((p) => p.roleId))) counts.set(r, (counts.get(r) || 0) + 1);
  return {
    good: sigmoid(eta),
    low: sigmoid(eta - 1.2816 * sd),
    high: sigmoid(eta + 1.2816 * sd),
    base,
    gamesUsed: m.n,
    check: tune,
    contributions: roleIds.map((r) => {
      const j = m.col.get(r);
      return { roleId: r, games: counts.get(r) || 0, push: j ? sigmoid(m.beta[0] + m.beta[j] * (1 - m.mean[j])) - base : 0 };
    }),
  };
}
