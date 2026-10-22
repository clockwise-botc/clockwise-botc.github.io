// Small HTML-building helpers shared by the dashboard views.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (r) => (r === null || r === undefined ? '–' : `${Math.round(r * 100)}%`);
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
export const phaseLabel = (phase) => (phase ? `${phase % 2 ? 'Night' : 'Day'} ${Math.ceil(phase / 2)}` : 'before tracking');
export const teamLabel = (t) => ({ townsfolk: 'Townsfolk', outsider: 'Outsiders', minion: 'Minions', demon: 'Demons', traveller: 'Travellers' }[t] || cap(t || 'unknown'));
// "a Demon", "an Outsider", "Townsfolk" — for phrases like "ash as a Demon".
export const asType = (types) => {
  const one = { townsfolk: 'Townsfolk', outsider: 'Outsider', minion: 'Minion', demon: 'Demon', traveller: 'Traveller' };
  const words = types.map((t) => one[t] || cap(t));
  const article = types[0] === 'townsfolk' ? '' : types[0] === 'outsider' ? 'an ' : 'a ';
  return article + (words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);
};
export const teamOne = (t) => ({ townsfolk: 'Townsfolk', outsider: 'Outsider', minion: 'Minion', demon: 'Demon', traveller: 'Traveller' }[t] || cap(t || 'unknown'));
export const isEvilTeam = (t) => t === 'minion' || t === 'demon';

// Names that add themselves to the selection when clicked.
export const playerLink = (key, name) => `<button class="lnk" data-add-player="${esc(key)}" title="Show stats for ${esc(name)}">${esc(name)}</button>`;
export const charLink = (roleId, name) => `<button class="lnk" data-add-char="${esc(roleId)}" title="Show stats for ${esc(name)}">${esc(name || roleId)}</button>`;
export const typeLink = (team) => `<button class="lnk" data-add-type="${esc(team)}" title="Show stats for ${esc(teamLabel(team))}">${esc(teamLabel(team))}</button>`;

export function rateCell(r, n, cls = '', tipLabel = 'Win rate', fullTip = '') {
  if (r === null || r === undefined) return '<span class="muted">–</span>';
  const tip = fullTip || `${tipLabel}: ${pct(r)}${n !== undefined ? ` of ${n}` : ''}`;
  return `<div class="rate" data-tip="${esc(tip)}"><b>${pct(r)}</b><div class="meter ${cls}"><i style="width:${Math.max(r * 100, 1)}%"></i></div></div>`;
}

export function delta(d, suffix = ' pts') {
  if (d === null || d === undefined || Number.isNaN(d)) return '<span class="muted">–</span>';
  const v = Math.round(d * 100);
  if (v === 0) return `<span class="delta">±0${suffix}</span>`;
  return `<span class="delta ${v > 0 ? 'up' : 'down'}">${v > 0 ? '▲ +' : '▼ '}${v}${suffix}</span>`;
}

// Good-vs-evil 100% bars. rows: [{ key, games, good, evil }]; label(r) may return HTML.
export function splitBars(rows, label, plainLabel = label) {
  if (!rows.length) return '<p class="muted">No games.</p>';
  return rows.map((r) => {
    const g = r.good / r.games, e = r.evil / r.games;
    const tip = `${plainLabel(r)}\n${plural(r.games, 'game')}\nGood won ${r.good} (${pct(g)})\nEvil won ${r.evil} (${pct(e)})`;
    const seg = (cls, frac, count) => (count ? `<div class="${cls}" style="flex:${frac}">${frac >= 0.18 ? pct(frac) : ''}</div>` : '');
    return `<div class="split-row" data-tip="${esc(tip)}">
      <div class="name">${label(r)}</div>
      <div class="split">${seg('good', g, r.good)}${seg('evil', e, r.evil)}</div>
      <div class="n">${plural(r.games, 'game')}</div>
    </div>`;
  }).join('');
}

export const legendGE = (goodLabel = 'Good won', evilLabel = 'Evil won') =>
  `<div class="legend"><span><i class="sw good"></i>${goodLabel}</span><span><i class="sw evil"></i>${evilLabel}</span></div>`;

export const tile = (label, value, note = '', cls = '') =>
  `<div class="card tile ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;

export const card = (title, sub, body, cls = '') =>
  `<div class="card ${cls}"><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</div>`;

// A table that shows the first `limit` rows, with a button to show the rest.
export function table(id, head, rows, { limit = 8, expanded = false, empty = 'Nothing to show yet.' } = {}) {
  if (!rows.length) return `<p class="muted">${empty}</p>`;
  const shown = expanded ? rows : rows.slice(0, limit);
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${shown.join('')}</tbody></table></div>
    ${rows.length > limit ? `<button class="btn small" data-expand="${esc(id)}">${expanded ? 'Show less' : `Show all ${rows.length}`}</button>` : ''}`;
}

// Pie chart (SVG). slices: [{ label, value, color, tip, chip }] — `chip` is the text shown on the slice,
// only drawn when the slice is big enough to hold it; every slice still has a hover tooltip.
export function pie(slices, { size = 220, minLabel = 0.07, ariaLabel = '' } = {}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return '<p class="muted">No games.</p>';
  const c = size / 2, r = c - 2;
  let a0 = -Math.PI / 2;
  let paths = '', chips = '';
  const pt = (rad, a) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
  for (const s of slices) {
    if (!s.value) continue;
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const tip = esc(s.tip || `${s.label}: ${s.value}`);
    if (frac >= 0.9999) {
      paths += `<circle cx="${c}" cy="${c}" r="${r}" fill="${s.color}" data-tip="${tip}"/>`;
    } else {
      const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1);
      paths += `<path d="M${c},${c} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${s.color}" data-tip="${tip}"/>`;
    }
    if (s.chip && frac >= minLabel) {
      const [lx, ly] = frac >= 0.9999 ? [c, c] : pt(r * 0.62, (a0 + a1) / 2);
      const w = s.chip.length * 7.4 + 14;
      chips += `<g class="pie-chip" data-tip="${tip}"><rect x="${(lx - w / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${w.toFixed(1)}" height="22" rx="6"/><text x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}" text-anchor="middle">${esc(s.chip)}</text></g>`;
    }
    a0 = a1;
  }
  return `<svg class="pie" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(ariaLabel)}">${paths}${chips}</svg>`;
}

// Concentric win-rate chart (SVG). levels go outside -> inside: [{ label, rate, n, color, tip }].
// Each level is a ring (the innermost is a disc) filled clockwise from the top to its rate, over a grey track.
export function rings(levels, { size = 240, ariaLabel = '' } = {}) {
  const c = size / 2;
  const band = (c - 2) / levels.length;
  const pt = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
  const sector = (R, r, frac) => {
    const a0 = -Math.PI / 2, a1 = a0 + frac * Math.PI * 2, big = frac > 0.5 ? 1 : 0;
    if (frac >= 0.9999) {
      const outer = `M${c - R},${c} A${R},${R} 0 1 0 ${c + R},${c} A${R},${R} 0 1 0 ${c - R},${c} Z`;
      return r > 0 ? `${outer} M${c - r},${c} A${r},${r} 0 1 1 ${c + r},${c} A${r},${r} 0 1 1 ${c - r},${c} Z` : outer;
    }
    if (r <= 0) return `M${c},${c} L${pt(R, a0)} A${R},${R} 0 ${big} 1 ${pt(R, a1)} Z`;
    return `M${pt(R, a0)} A${R},${R} 0 ${big} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${big} 0 ${pt(r, a0)} Z`;
  };
  let shapes = '', chips = '';
  levels.forEach((lv, i) => {
    const R = c - 2 - i * band, r = i === levels.length - 1 ? 0 : R - band + 3;
    const tip = esc(lv.tip || `${lv.label}: ${lv.rate === null ? 'no games' : pct(lv.rate)}`);
    shapes += `<path class="ring-track" d="${sector(R, r, 1)}" fill-rule="evenodd" data-tip="${tip}"/>`;
    if (lv.rate) shapes += `<path d="${sector(R, r, lv.rate)}" fill="${lv.color}" fill-rule="evenodd" data-tip="${tip}"/>`;
    if (lv.rate !== null && lv.rate !== undefined) {
      const mid = r > 0 ? (R + r) / 2 : R * 0.45;
      const a = -Math.PI / 2 + Math.max(lv.rate, 0.12) * Math.PI;
      const [x, y] = r > 0 || lv.rate < 0.9999 ? [c + mid * Math.cos(a), c + mid * Math.sin(a)] : [c, c];
      const text = pct(lv.rate), w = text.length * 7.4 + 14;
      chips += `<g class="pie-chip" data-tip="${tip}"><rect x="${(x - w / 2).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${w.toFixed(1)}" height="22" rx="6"/><text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle">${text}</text></g>`;
    }
  });
  return `<svg class="pie rings" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(ariaLabel)}">${shapes}${chips}</svg>`;
}

// Likely-range bar for a predicted chance that good wins: 0% (evil) to 100% (good), a 50% midline,
// the ~80% range as a band and the estimate as a dot.
export function rangeBar(p, low, high) {
  const at = (v) => `${(v * 100).toFixed(1)}%`;
  return `<div class="range" role="img" aria-label="Estimated ${pct(p)} chance good wins, likely between ${pct(low)} and ${pct(high)}">
    <div class="range-track"><span class="range-band" style="left:${at(low)};width:${at(high - low)}"></span><span class="range-mid"></span><span class="range-dot" style="left:${at(p)}" data-tip="${esc(`Estimate: good wins ${pct(p)}\nLikely between ${pct(low)} and ${pct(high)}`)}"></span></div>
    <div class="range-scale"><span>Evil wins</span><span>50/50</span><span>Good wins</span></div>
  </div>`;
}
