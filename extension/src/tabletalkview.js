// Drawing the "At the table" stats: one value next to the table average (for the player page and the Playstyles
// table), and a chart of every player on one measure (main page). The numbers come from tabletalk.js.

import { MEASURES } from './tabletalk.js';
import { esc, plural, card } from './ui.js';

export const TALK_SIDES = [['all', 'All games'], ['good', 'As good'], ['evil', 'As evil']];
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

// The At the table chart: players on one measure, as a bar from the average (the line) to their value, highest first.
// With more than 2 × TOP_N players it shows the top and bottom TOP_N (plus you), with "Show all" to expand.
// view: { measure, side, expanded }   h: { playerLink, me }
export const TOP_N = 10;
// What the number on the right of each bar is.
const VALUE_HEAD = { loud: 'Nominations / day', nominated: 'Nominated / day', voter: 'Voted on', nomOther: 'On other team', voteOther: 'On other team', life: 'Of game alive' };

function chartRows(talk, view, h) {
  const T = talk[view.side];
  const id = view.measure;
  const has = (p) => p.rates[id].value !== null;
  const listed = T.players.filter((p) => p.listed && has(p)).sort((a, b) => b.rates[id].value - a.rates[id].value);
  const rank = new Map(listed.map((p, i) => [p.key, i + 1]));
  const folded = listed.length > 2 * TOP_N && !view.expanded;
  const keep = folded ? listed.filter((p, i) => i < TOP_N || i >= listed.length - TOP_N || p.key === h.me) : listed;
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
  // Where players are left out between two shown ones: a marker that also expands the list.
  const skip = (n) => (n > 0 ? `<div class="tt-row tt-skip"><div></div><div class="tt-track bare"><button type="button" class="lnk" data-talk-expand>⋯ ${plural(n, 'more player')}</button></div><div></div></div>` : '');
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
  if (listed.length > 2 * TOP_N) html += `<button type="button" class="btn small show-all" data-talk-expand>${folded ? `Show all ${listed.length}` : `Show top and bottom ${TOP_N}`}</button>`;
  return html;
}

// What's shown, in words, under the controls.
export function talkChartNote(talk, view, h) {
  const { listed, folded, meShown, rank } = chartRows(talk, view, h);
  const base = folded ? `the top and bottom ${TOP_N} of ${listed.length} players` : `all ${plural(listed.length, 'player')}`;
  // Only mention you when you're there because you're you (not already in the top or bottom).
  const extraMe = folded && meShown && !(rank.get(h.me) <= TOP_N || rank.get(h.me) > listed.length - TOP_N);
  return `Showing ${base}${extraMe ? ' and you' : ''}.`;
}

export const talkChartSub = (talk, view) => `Players with ${talk[view.side].minGames}+ games${view.side === 'all' ? '' : ` ${sideWords(view.side)} (games where they kept one alignment)`}. The line is the average; hover a bar for the counts.`;

export function talkChartCard(talk, view, h) {
  const select = (attr, options, cur, label) => `<select ${attr} aria-label="${label}">${options.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const controls = `<div class="tt-controls">${select('data-talk-measure', Object.entries(MEASURES).map(([k, x]) => [k, x.label]), view.measure, 'Measure')}</div>`;
  return card('At the table', talkChartSub(talk, view), `${controls}<p class="tt-note small muted" id="tt-note">${esc(talkChartNote(talk, view, h))}</p><div class="tt-chart" id="tt-chart">${talkChartBody(talk, view, h)}</div>`, 'wide tt-chart-card');
}

// ---------- nominations / votes scatter ----------
// Each player as a dot: how much they nominate (or vote) across, and what share of it lands on the other team up.
// Dashed lines mark the averages.
// view: { kind: 'noms' | 'votes', side }   h: { me }
export const SCATTER_KINDS = [['noms', 'Nominations'], ['votes', 'Votes']];
const SCATTER = {
  noms: { x: 'loud', y: 'nomOther', xTitle: 'Nominations per day alive', yTitle: 'Share on the other team' },
  votes: { x: 'voter', y: 'voteOther', xTitle: 'Votes on nominations while alive', yTitle: 'Share on the other team' },
};
// Round tick steps (1, 2, 2.5, 5 × 10ⁿ) covering [lo, hi].
function ticks(lo, hi, want = 5) {
  const raw = (hi - lo) / want, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// Who's on the scatter. Everyone with enough games can be; by default at most SCATTER_MAX, picked to cover the spread
// (each next pick is the player furthest from everyone picked so far, on both axes scaled to their range), starting
// with you. Players added by hand (view.added) come on top of those.
export const SCATTER_MAX = 20;
export function scatterPick(talk, view, h) {
  const T = talk[view.side], S = SCATTER[view.kind];
  const cands = T.players.filter((p) => (p.listed || p.key === h.me) && p.rates[S.x].value !== null && p.rates[S.y].n > 0);
  let picked = cands;
  if (cands.length > SCATTER_MAX) {
    const xs = cands.map((p) => p.rates[S.x].value), ys = cands.map((p) => p.rates[S.y].value);
    const rx = Math.max(...xs) - Math.min(...xs) || 1, ry = Math.max(...ys) - Math.min(...ys) || 1;
    const pt = (p) => [p.rates[S.x].value / rx, p.rates[S.y].value / ry];
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const mid = [xs.reduce((a, b) => a + b, 0) / xs.length / rx, ys.reduce((a, b) => a + b, 0) / ys.length / ry];
    const me = cands.find((p) => p.key === h.me);
    picked = [me || cands.reduce((best, p) => (d2(pt(p), mid) > d2(pt(best), mid) ? p : best))];
    const near = new Map(cands.map((p) => [p.key, d2(pt(p), pt(picked[0]))]));
    while (picked.length < SCATTER_MAX) {
      const next = cands.filter((p) => !picked.includes(p)).reduce((best, p) => (!best || near.get(p.key) > near.get(best.key) || (near.get(p.key) === near.get(best.key) && p.games > best.games) ? p : best), null);
      picked.push(next);
      for (const p of cands) near.set(p.key, Math.min(near.get(p.key), d2(pt(p), pt(next))));
    }
  }
  const def = new Set(picked.map((p) => p.key));
  const added = new Set((view.added || []).filter((k) => !def.has(k)));
  return { cands, def, shown: cands.filter((p) => def.has(p.key) || added.has(p.key)), added };
}

export function scatterNote(talk, view, h) {
  const { cands, def, added } = scatterPick(talk, view, h);
  if (cands.length <= SCATTER_MAX) return `Showing all ${plural(cands.length, 'player')}.`;
  const names = cands.filter((p) => added.has(p.key)).map((p) => p.name);
  return `Showing ${def.size} of ${cands.length} players, picked to cover the spread.${names.length ? ` Added: ${names.join(', ')}.` : ''}`;
}

export function scatterSvg(talk, view, h) {
  const T = talk[view.side], S = SCATTER[view.kind];
  const mx = MEASURES[S.x], my = MEASURES[S.y];
  const pts = scatterPick(talk, view, h).shown;
  if (pts.length < 2) return '<p class="muted">Not enough games yet.</p>';
  const W = 680, H = 440, L = 56, R = 16, TOP = 16, B = 46;
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
  for (const t of ticks(x0, x1)) g += `<line class="sc-grid" x1="${f1(sx(t))}" x2="${f1(sx(t))}" y1="${TOP}" y2="${H - B}"/><text class="sc-tick" x="${f1(sx(t))}" y="${H - B + 16}" text-anchor="middle">${mx.fmt(t)}</text>`;
  for (const t of ticks(y0, y1)) g += `<line class="sc-grid" x1="${L}" x2="${W - R}" y1="${f1(sy(t))}" y2="${f1(sy(t))}"/><text class="sc-tick" x="${L - 8}" y="${f1(sy(t) + 4)}" text-anchor="end">${my.fmt(t)}</text>`;
  g += `<text class="sc-title" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(S.xTitle)} →</text>`;
  g += `<text class="sc-title" transform="translate(14 ${(TOP + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(S.yTitle)} →</text>`;
  // The averages.
  g += `<line class="sc-avg" x1="${f1(sx(ax))}" x2="${f1(sx(ax))}" y1="${TOP}" y2="${H - B}"/><line class="sc-avg" x1="${L}" x2="${W - R}" y1="${f1(sy(ay))}" y2="${f1(sy(ay))}"/>`;
  // Dots, then names where there's room (you always); hover any dot for the numbers.
  const P = pts.map((p) => ({ p, x: sx(p.rates[S.x].value), y: sy(p.rates[S.y].value), me: p.key === h.me })).sort((a, b) => a.me - b.me);
  const boxes = P.map((q) => ({ x0: q.x - 6, x1: q.x + 6, y0: q.y - 6, y1: q.y + 6 }));
  const hit = (b) => b.x0 < L || b.x1 > W - R || b.y0 < TOP || b.y1 > H - B || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  let dots = '', names = '';
  for (const q of [...P].sort((a, b) => b.me - a.me || b.p.games - a.p.games)) {
    const w = [...q.p.name].length * 6.4 + 2;
    for (const [tx, ty, an] of [[q.x + 9, q.y + 4, 'start'], [q.x - 9, q.y + 4, 'end'], [q.x, q.y - 10, 'middle'], [q.x, q.y + 17, 'middle']]) {
      const bx = an === 'start' ? tx : an === 'end' ? tx - w : tx - w / 2;
      const b = { x0: bx, x1: bx + w, y0: ty - 10, y1: ty + 3 };
      if (!q.me && hit(b)) continue;
      boxes.push(b);
      names += `<text class="sc-name${q.me ? ' me' : ''}" x="${f1(tx)}" y="${f1(ty)}" text-anchor="${an}">${esc(q.p.name)}</text>`;
      break;
    }
  }
  for (const q of P) {
    const tip = `${q.p.name}${q.me ? ' (you)' : ''}${view.side === 'all' ? '' : `, ${sideWords(view.side)}`}\n${mx.label}: ${mx.fmt(q.p.rates[S.x].value)} (${mx.counts(q.p.t)})\n${my.label}: ${my.fmt(q.p.rates[S.y].value)} (${my.counts(q.p.t)})\n${plural(q.p.games, 'game')}${q.p.listed ? '' : ', few games'}`;
    dots += `<g class="sc-pt${q.me ? ' me' : ''}" data-add-player="${esc(q.p.key)}" data-tip="${esc(tip)}"><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="11" fill="transparent"/><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="${q.me ? 6.5 : 5}"/></g>`;
  }
  const aria = `${S.xTitle} against ${S.yTitle.toLowerCase()} for ${plural(pts.length, 'player')}${view.side === 'all' ? '' : ` ${sideWords(view.side)}`}`;
  return `<svg class="sc side-${view.side}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${g}${dots}${names}</svg>`;
}

export function scatterCard(talk, view, h) {
  const T = talk[view.side];
  const select = (attr, options, cur, label) => `<select ${attr} aria-label="${label}">${options.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const what = view.kind === 'noms' ? 'nominations per day alive' : 'share of nominations they voted on while alive';
  const sub = `Across: ${what}. Up: share on the other team. Dashed lines: the average. Players with ${T.minGames}+ games${view.side === 'all' ? '' : ` ${sideWords(view.side)}`}; hover a dot for the counts.`;
  // The picker only appears when some players aren't on the chart, and only lists those.
  const more = scatterPick(talk, view, h).cands.length > SCATTER_MAX ? '<div data-ms-scatter></div>' : '';
  return card(view.kind === 'noms' ? 'Who they nominate' : 'Who they vote for', sub, `<div class="tt-controls">${select('data-scatter-kind', SCATTER_KINDS, view.kind, 'Chart')}${more}</div><p class="tt-note small muted" id="sc-note">${esc(scatterNote(talk, view, h))}</p><div class="sc-wrap" id="sc-body">${scatterSvg(talk, view, h)}</div>`, 'wide sc-card');
}
