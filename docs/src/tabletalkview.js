// Drawing the "Around the grimoire" stats: one value next to the table average (for the player page and the Playstyles
// table), and a chart of every player on one measure (main page). The numbers come from tabletalk.js.

import { MEASURES } from './tabletalk.js?v=57a62a3c74';
import { esc, plural, card } from './ui.js?v=57a62a3c74';

const sideWords = (side) => (side === 'all' ? '' : `as ${side}`);

// "▲ 0.05 above average (0.35)" / "about average (0.35)". Direction only, in neutral ink: more isn't better or worse.
export function gapLine(id, gap, avg) {
  const m = MEASURES[id];
  if (gap.about) return `about average (${m.fmt(avg)})`;
  return `${gap.d > 0 ? '▲' : '▼'} ${m.gap(Math.abs(gap.d))} ${gap.d > 0 ? 'above' : 'below'} average (${m.fmt(avg)})`;
}

const tipFor = (id, pl, T, side) => {
  const r = pl.rates[id], m = MEASURES[id];
  return `${pl.name}${side === 'all' ? '' : `, ${sideWords(side)}`}\n${m.label}: ${m.fmt(r.value)}\n${m.counts(pl.t)}\n${gapLine(id, r.gap, T.table[id])}`
    + (pl.listed ? '' : `\nFew games (${pl.games}); fewer than ${T.minGames}`) + '\n(pulled slightly toward the average when there\'s little data)';
};

// One cell: the value, and under it how far from the average player it is.
export function talkCell(T, pl, id, side) {
  if (!pl || !pl.t.games || pl.rates[id].value === null) return '<span class="muted">–</span>';
  const r = pl.rates[id], m = MEASURES[id];
  return `<div class="tt-cell" data-tip="${esc(tipFor(id, pl, T, side))}"><b>${m.fmt(r.value)}</b><span class="small">${esc(gapLine(id, r.gap, T.table[id]))}</span>${pl.listed ? '' : '<span class="small muted">few games</span>'}</div>`;
}

// A player's six measures as bars ("Your playstyle"): their value as a bar with a dot, and a mark at the average player
// in the same games. Shares run 0–100%; the two per-day measures share one scale, wide enough for anyone in any of the
// three views, so switching Overall / As good / As evil doesn't move the axis. Values are written out, not only drawn.
const PER_DAY = ['loud', 'nominated'];
export function playstyleBars(talk, key, side, { you, labels }) {
  const T = talk[side], pl = T.players.find((p) => p.key === key);
  if (!pl || !pl.t.games) return `<p class="muted">No games ${side === 'good' ? 'as good' : 'as evil'} yet where ${esc(you === 'You' ? 'you' : you)} kept one alignment the whole game.</p>`;
  const vals = [];
  for (const s of ['all', 'good', 'evil']) for (const id of PER_DAY) { vals.push(talk[s].table[id]); for (const p of talk[s].players) if (p.listed || p.key === key) vals.push(p.rates[id].value); }
  const top = Math.max(0.1, ...vals.filter((v) => v !== null && v !== undefined));
  const perDayMax = Math.ceil((top * 1.1) / 0.1) * 0.1;
  const rows = Object.keys(MEASURES).map((id) => {
    const m = MEASURES[id], r = pl.rates[id], avg = T.table[id];
    const max = PER_DAY.includes(id) ? perDayMax : 1;
    const at = (v) => Math.max(0, Math.min(100, (v / max) * 100));
    const val = r.value === null ? null : r.value;
    const tip = tipFor(id, pl, T, side);
    const bar = val === null || avg === null ? '<div class="ps-track"></div>'
      : `<div class="ps-track" data-tip="${esc(tip)}"><i class="ps-fill" style="width:${at(val).toFixed(1)}%"></i><b class="ps-dot" style="left:${at(val).toFixed(1)}%"></b><s class="ps-avg" style="left:${at(avg).toFixed(1)}%"></s></div>`;
    return `<div class="ps-row">
      <div class="ps-head"><span class="ps-label">${esc(labels[id] || m.label)}</span><span class="ps-vals"><b>${val === null ? '–' : m.fmt(val)}</b><span class="ps-avg-val">avg ${avg === null ? '–' : m.fmt(avg)}</span></span></div>
      ${bar}<div class="ps-scale" aria-hidden="true"><span>${m.fmt(0)}</span><span>${m.fmt(max)}</span></div>
    </div>`;
  }).join('');
  const few = pl.listed ? '' : `<p class="small muted ps-few">Only ${plural(pl.games, 'game')}${side === 'all' ? '' : ` ${sideWords(side)}`}, so these may change a lot.</p>`;
  return `<div class="ps-bars side-${side}">${rows}</div>${few}`;
}

// The Around the grimoire chart: players on one measure, as a bar from the average (the line) to their value, highest first.
// With more than 2 × TOP_N players it shows the top and bottom TOP_N, plus you and anyone picked to always show.
// view: { measure, side, extra }   h: { playerLink, me }
export const TOP_N = 10;
// What the number on the right of each bar is.
const VALUE_HEAD = { loud: 'Nominations / day', nominated: 'Nominated / day', voter: 'Voted on', nomOther: 'On other team', voteOther: 'On other team', life: 'Of game alive' };

function chartRows(talk, view, h) {
  const T = talk[view.side];
  const id = view.measure;
  const has = (p) => p.rates[id].value !== null;
  const listed = T.players.filter((p) => p.listed && has(p)).sort((a, b) => b.rates[id].value - a.rates[id].value);
  const rank = new Map(listed.map((p, i) => [p.key, i + 1]));
  const folded = listed.length > 2 * TOP_N;
  // Always shown, wherever they rank: you, and anyone picked in "Always show".
  const always = new Set([h.me, ...(view.extra || [])]);
  const keep = folded ? listed.filter((p, i) => i < TOP_N || i >= listed.length - TOP_N || always.has(p.key)) : listed;
  // You are shown even with few games (marked), in value order.
  const me = T.players.find((p) => p.key === h.me && !rank.has(p.key) && has(p));
  const shown = [...keep, ...(me ? [me] : [])].sort((a, b) => b.rates[id].value - a.rates[id].value);
  return { T, id, listed, rank, shown, folded, meShown: shown.some((p) => p.key === h.me) };
}

export function talkChartBody(talk, view, h) {
  const { T, id, listed, rank, shown, folded } = chartRows(talk, view, h);
  const m = MEASURES[id];
  const avg = T.table[id];
  if (avg === null || !shown.length) return '<p class="muted">Not enough games yet.</p>';
  // Symmetric scale around the average (over everyone shown), so left and right read the same.
  const reach = Math.max(...shown.map((p) => Math.abs(p.rates[id].value - avg)), 1e-9) * 1.08;
  const at = (v) => 50 + ((v - avg) / reach) * 50;
  const row = (p) => {
    const r = p.rates[id], x = at(r.value);
    const [l, w] = x >= 50 ? [50, x - 50] : [x, 50 - x];
    const k = rank.get(p.key);
    const me = p.key === h.me;
    return `<div class="tt-row${me ? ' sel' : ''}" data-tip="${esc(tipFor(id, p, T, view.side) + (k ? `\nNumber ${k} of ${listed.length}` : ''))}">
      <div class="name"><span class="rk">${k || ''}</span>${h.playerLink(p.key, p.name)}${me ? ' <span class="tt-tag">you</span>' : ''}${p.listed ? '' : ' <span class="tt-tag muted">few games</span>'}</div>
      <div class="tt-track"><i class="tt-bar ${x >= 50 ? 'up' : 'down'}" style="left:${l.toFixed(2)}%;width:${Math.max(w, 0.4).toFixed(2)}%"></i><b class="tt-dot" style="left:${x.toFixed(2)}%"></b></div>
      <div class="v"><b>${m.fmt(r.value)}</b></div>
    </div>`;
  };
  // Where players are left out between two shown ones, a marker saying how many ("Show top & bottom 10, plus" adds
  // anyone wanted).
  const skip = (n) => (n > 0 ? `<div class="tt-row tt-skip"><div></div><div class="tt-track bare"><span>⋯ ${plural(n, 'more player')}</span></div><div></div></div>` : '');
  const avgTip = `Average for everyone${view.side === 'all' ? '' : ` ${sideWords(view.side)}`}: ${m.fmt(avg)} (${m.label.toLowerCase()})`;
  let html = `<div class="tt-side side-${view.side}"><div class="tt-row tt-axis"><div></div><div class="tt-track bare"><span style="left:0" aria-hidden="true">${m.fmt(avg - reach)}</span><span class="avg" style="left:50%" data-tip="${esc(avgTip)}" tabindex="0">average</span><span style="right:0" aria-hidden="true">${m.fmt(avg + reach)}</span></div><div class="v head">${esc(VALUE_HEAD[id] || m.label)}</div></div>`;
  let last = 0;
  for (const p of shown) {
    const k = rank.get(p.key);
    if (k) { html += skip(k - last - 1); last = k; }
    html += row(p);
  }
  html += skip(listed.length - last);
  html += '</div>';
  return html;
}

// Each chart's heading is the question it answers, with dropdowns in it, e.g.
// "Which players have the most [nominations per day] [across all games]?"
export const ASKED_SIDES = [['all', 'across all games'], ['good', 'as good'], ['evil', 'as evil']];
export const madlib = (attr, options, cur, label) => `<span class="madlib"><select ${attr} aria-label="${label}">${options.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span>`;
const ASKED = { loud: 'nominations per day', nominated: 'times nominated per day', voter: 'votes on nominations', nomOther: 'nominations on the other team', voteOther: 'votes on the other team', life: 'time alive' };
const RANKED_BY = { loud: 'average nominations per day', nominated: 'average times nominated per day', voter: 'share of nominations voted on', nomOther: 'share of nominations on the other team', voteOther: 'share of votes on the other team', life: 'share of each game spent alive' };
export const talkChartSub = (talk, view) => `Players ranked by their ${RANKED_BY[view.measure]}. The center line shows the overall player average.`;

// Who can be picked in "Always show": everyone on the chart (enough games, a value for this measure).
export const talkCandidates = (talk, view, me) => talk[view.side].players.filter((p) => (p.listed || p.key === me) && p.rates[view.measure].value !== null);

export function talkChartCard(talk, view, h) {
  const question = `Which players have the most ${madlib('data-talk-measure', Object.keys(MEASURES).map((k) => [k, ASKED[k]]), view.measure, 'What to rank by')} ${madlib('data-talk-side', ASKED_SIDES, view.side, 'Which games')}?`;
  // "Show top & bottom 10, plus [You + 2 players]": players added to the top and bottom TOP_N (you're always on it).
  const control = `<div class="ctl-row"><span class="ctl-label">Show top &amp; bottom ${TOP_N}, plus</span><div class="ctl-ms" data-ms-always></div></div>`;
  return card(question, talkChartSub(talk, view), `${control}<div class="tt-chart" id="tt-chart">${talkChartBody(talk, view, h)}</div>`, 'wide tt-chart-card');
}

// ---------- nominations / votes scatter ----------
// Each player as a dot: how much they nominate (or vote) across, and what share of it lands on the other team up.
// Dashed lines mark the averages.
// view: { kind: 'noms' | 'votes', side }   h: { me }
export const SCATTER_KINDS = [['noms', 'Nominations'], ['votes', 'Votes']];
const SCATTER = {
  noms: { x: 'loud', y: 'nomOther', xTitle: 'Nominations per day alive', yTitle: '% targeting the opposing team' },
  votes: { x: 'voter', y: 'voteOther', xTitle: 'Votes on nominations while alive', yTitle: '% targeting the opposing team' },
};
// Round tick steps (1, 2, 2.5, 5 × 10ⁿ) covering [lo, hi].
function ticks(lo, hi, want = 5) {
  const raw = (hi - lo) / want, mag = 10 ** Math.floor(Math.log10(raw || 1));
  // 1, 2 or 5 steps (no 2.5), so ticks shown to two places are exact (0.20, 0.25, 0.30 rather than 0.23, 0.28).
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// Who's on the scatter. Everyone with enough games can be. By default SCATTER_DEFAULT of them: you first, then each
// next pick is the player furthest from everyone picked so far (both axes scaled to their range), so the chart covers
// the spread. view.chosen (set from "Players shown") replaces the default with exactly those players, up to
// SCATTER_MAX.
export const SCATTER_DEFAULT = 20;
export const SCATTER_MAX = 50;
export function scatterPick(talk, view, h) {
  const T = talk[view.side], S = SCATTER[view.kind];
  const cands = T.players.filter((p) => (p.listed || p.key === h.me) && p.rates[S.x].value !== null && p.rates[S.y].n > 0);
  let picked = cands;
  if (cands.length > SCATTER_DEFAULT) {
    const xs = cands.map((p) => p.rates[S.x].value), ys = cands.map((p) => p.rates[S.y].value);
    const rx = Math.max(...xs) - Math.min(...xs) || 1, ry = Math.max(...ys) - Math.min(...ys) || 1;
    const pt = (p) => [p.rates[S.x].value / rx, p.rates[S.y].value / ry];
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const mid = [xs.reduce((a, b) => a + b, 0) / xs.length / rx, ys.reduce((a, b) => a + b, 0) / ys.length / ry];
    const me = cands.find((p) => p.key === h.me);
    picked = [me || cands.reduce((best, p) => (d2(pt(p), mid) > d2(pt(best), mid) ? p : best))];
    const near = new Map(cands.map((p) => [p.key, d2(pt(p), pt(picked[0]))]));
    while (picked.length < SCATTER_DEFAULT) {
      const next = cands.filter((p) => !picked.includes(p)).reduce((best, p) => (!best || near.get(p.key) > near.get(best.key) || (near.get(p.key) === near.get(best.key) && p.games > best.games) ? p : best), null);
      picked.push(next);
      for (const p of cands) near.set(p.key, Math.min(near.get(p.key), d2(pt(p), pt(next))));
    }
  }
  const def = new Set(picked.map((p) => p.key));
  // "Show players": 20 across the chart (the default), all players, or the ones chosen.
  const mode = view.mode || 'spread';
  const keys = mode === 'all' ? new Set(cands.map((p) => p.key)) : mode === 'choose' && view.chosen ? new Set(view.chosen) : def;
  return { cands, def, shown: cands.filter((p) => keys.has(p.key)), custom: mode === 'choose', mode };
}

export function scatterSvg(talk, view, h) {
  const T = talk[view.side], S = SCATTER[view.kind];
  const mx = MEASURES[S.x], my = MEASURES[S.y];
  const { shown: pts, custom } = scatterPick(talk, view, h);
  if (custom && !pts.length) return '<p class="muted">No players picked. Tick some in the list above.</p>';
  if (pts.length < 2 && !custom) return '<p class="muted">Not enough games yet.</p>';
  // Drawn at the card's real width (h.width), so text and lines keep their size rather than being scaled up.
  const W = Math.max(260, Math.round(h.width || 680)), H = Math.round(Math.min(520, Math.max(320, W * 0.46)));
  const L = 72, R = 20, TOP = 18, B = 52;
  // A wide chart gets slightly bigger dots and names (k), so it doesn't feel sparse.
  const k = W >= 900 ? 1.15 : 1;
  const xs = pts.map((p) => p.rates[S.x].value), ys = pts.map((p) => p.rates[S.y].value);
  const ax = T.table[S.x], ay = T.table[S.y];
  const pad = (lo, hi) => { const m = (hi - lo) * 0.12 || 0.05; return [lo - m, hi + m]; };
  let [x0, x1] = pad(Math.min(...xs, ax), Math.max(...xs, ax));
  let [y0, y1] = pad(Math.min(...ys, ay), Math.max(...ys, ay));
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); y1 = Math.min(1, y1); if (S.x === 'voter') x1 = Math.min(1, x1);
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - TOP - B);
  const f1 = (n) => n.toFixed(1);
  let g = '';
  // The two axes, with their values; no lines behind the dots.
  for (const t of ticks(x0, x1, Math.max(3, Math.round(W / 180)))) g += `<line class="sc-axis" x1="${f1(sx(t))}" x2="${f1(sx(t))}" y1="${H - B}" y2="${H - B + 5}"/><text class="sc-tick" x="${f1(sx(t))}" y="${H - B + 22}" text-anchor="middle">${mx.fmt(t)}</text>`;
  for (const t of ticks(y0, y1, 4)) g += `<line class="sc-axis" x1="${L - 5}" x2="${L}" y1="${f1(sy(t))}" y2="${f1(sy(t))}"/><text class="sc-tick" x="${L - 10}" y="${f1(sy(t) + 4.5)}" text-anchor="end">${my.fmt(t)}</text>`;
  g += `<line class="sc-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="sc-axis" x1="${L}" x2="${L}" y1="${TOP}" y2="${H - B}"/>`;
  // Axis titles: across under the chart; up the left side, turned on its side.
  g += `<text class="sc-title" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${esc(S.xTitle)} →</text>`;
  g += `<text class="sc-title" transform="translate(16 ${(TOP + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(S.yTitle)} →</text>`;
  // The averages, labelled with their values at the ends, each with a wide invisible line on top to hover.
  const avgX = `Average for everyone${view.side === 'all' ? '' : ` ${sideWords(view.side)}`}: ${mx.fmt(ax)} (${mx.label.toLowerCase()})`;
  const avgY = `Average for everyone${view.side === 'all' ? '' : ` ${sideWords(view.side)}`}: ${my.fmt(ay)} (${my.label.toLowerCase()})`;
  g += `<line class="sc-avg" x1="${f1(sx(ax))}" x2="${f1(sx(ax))}" y1="${TOP}" y2="${H - B}"/><line class="sc-avg" x1="${L}" x2="${W - R}" y1="${f1(sy(ay))}" y2="${f1(sy(ay))}"/>`;
  g += `<text class="sc-avg-label" x="${f1(sx(ax) + 7)}" y="${TOP + 12}">avg ${mx.fmt(ax)}</text><text class="sc-avg-label" x="${W - R - 4}" y="${f1(sy(ay) - 7)}" text-anchor="end">avg ${my.fmt(ay)}</text>`;
  g += `<line class="sc-avg-hit" x1="${f1(sx(ax))}" x2="${f1(sx(ax))}" y1="${TOP}" y2="${H - B}" data-tip="${esc(avgX)}"/><line class="sc-avg-hit" x1="${L}" x2="${W - R}" y1="${f1(sy(ay))}" y2="${f1(sy(ay))}" data-tip="${esc(avgY)}"/>`;
  // Dots, then names where there's room (you always); hover any dot for the numbers.
  const P = pts.map((p) => ({ p, x: sx(p.rates[S.x].value), y: sy(p.rates[S.y].value), me: p.key === h.me })).sort((a, b) => a.me - b.me);
  const boxes = P.map((q) => ({ x0: q.x - 8, x1: q.x + 8, y0: q.y - 8, y1: q.y + 8 }));
  // The average labels take their room first.
  boxes.push({ x0: sx(ax) + 4, x1: sx(ax) + 84, y0: TOP, y1: TOP + 16 }, { x0: W - R - 84, x1: W - R, y0: sy(ay) - 21, y1: sy(ay) - 2 });
  const hit = (b) => b.x0 < L || b.x1 > W - R || b.y0 < TOP || b.y1 > H - B || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  let dots = '', names = '';
  for (const q of [...P].sort((a, b) => b.me - a.me || b.p.games - a.p.games)) {
    const w = ([...q.p.name].length * (q.me ? 8.6 : 7.9) + 2) * k;
    for (const [tx, ty, an] of [[q.x + 12 * k, q.y + 5 * k, 'start'], [q.x - 12 * k, q.y + 5 * k, 'end'], [q.x, q.y - 13 * k, 'middle'], [q.x, q.y + 23 * k, 'middle']]) {
      const bx = an === 'start' ? tx : an === 'end' ? tx - w : tx - w / 2;
      const b = { x0: bx, x1: bx + w, y0: ty - 12 * k, y1: ty + 4 * k };
      if (!q.me && hit(b)) continue;
      boxes.push(b);
      names += `<text class="sc-name${q.me ? ' me' : ''}" x="${f1(tx)}" y="${f1(ty)}" text-anchor="${an}">${esc(q.p.name)}</text>`;
      break;
    }
  }
  for (const q of P) {
    const tip = `${q.p.name}${q.me ? ' (you)' : ''}${view.side === 'all' ? '' : `, ${sideWords(view.side)}`}\n${mx.label}: ${mx.fmt(q.p.rates[S.x].value)} (${mx.counts(q.p.t)})\n${my.label}: ${my.fmt(q.p.rates[S.y].value)} (${my.counts(q.p.t)})\n${plural(q.p.games, 'game')}${q.p.listed ? '' : ', few games'}`;
    dots += `<g class="sc-pt${q.me ? ' me' : ''}" data-add-player="${esc(q.p.key)}" data-tip="${esc(tip)}"><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="${13 * k}" fill="transparent"/><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="${f1((q.me ? 8 : 6.5) * k)}"/></g>`;
  }
  const aria = `${S.xTitle} against ${S.yTitle.toLowerCase()} for ${plural(pts.length, 'player')}${view.side === 'all' ? '' : ` ${sideWords(view.side)}`}`;
  return `<svg class="sc side-${view.side}${k > 1 ? ' big' : ''}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${g}${dots}${names}</svg>`;
}

export function scatterCard(talk, view, h) {
  const sub = view.kind === 'noms'
    ? 'Each dot represents a player. Further right means they nominate more often; higher means a larger share of their nominations target the opposing team.'
    : 'Each dot represents a player. Further right means they vote more often; higher means a larger share of their votes target the opposing team.';
  // "Show players": one dropdown with 20 across the chart, all of them, or "Choose players…" (the same dropdown
  // then lists players to tick).
  const control = '<div class="ctl-row"><span class="ctl-label">Show</span><div class="ctl-ms wide" data-ms-scatter></div></div>';
  // "How often do players [nominate] the opposing team [across all games]?"
  const sides = [['all', 'across all games'], ['good', 'when good'], ['evil', 'when evil']];
  const question = `How often do players ${madlib('data-scatter-kind', [['noms', 'nominate'], ['votes', 'vote for']], view.kind, 'Nominations or votes')} the opposing team ${madlib('data-scatter-side', sides, view.side, 'Which games')}?`;
  return card(question, sub, `${control}<p class="tt-note small muted" id="sc-note" hidden></p><div class="sc-wrap" id="sc-body">${scatterSvg(talk, view, h)}</div>`, 'wide sc-card');
}
