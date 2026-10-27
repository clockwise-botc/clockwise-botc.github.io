// Character and reminder tokens drawn the way botc.app draws them: the edition's parchment disc, the
// character art filling the token (raised 10%), the night-order and setup leaves, and the name in
// Dumbledor capitals running along the bottom of the circle. Reminders are botc.app's purple discs
// with the name in white Trade Gothic along the same curve.
//
// The art and fonts come from botc.app itself (see parseTokenStyle in background.js). Until they've
// been fetched once, tokens fall back to a plain parchment disc and the dashboard's serif.
import { esc } from './ui.js?v=7739edf5ef';

// Names run along botc.app's own curve: a circle of radius 60 in a 140×140 box, starting top-left and running
// anticlockwise, so text centred at x=100% sits along the bottom of the token. The path (#ct-circle) is in dashboard.html.

// Same thresholds botc.app uses for long names.
const nameSize = (name) => (name.length > 25 ? '70%' : name.length > 17 ? '80%' : name.length > 10 ? '90%' : '110%');
const reminderSize = (name) => (name.length > 25 ? '18px' : name.length > 20 ? '20px' : name.length > 15 ? '22px' : name.length > 10 ? '24px' : '26px');

const img = (cls, url, fb) => (url ? `<img class="${cls}" src="${esc(url)}"${fb ? ` data-fallback="${esc(fb)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer">` : '');

// meta: [firstNight, otherNight, reminderCount, setup, edition] as shared by page-hook.js, or undefined.
export function characterToken({ id, name, team, icon, fallback, meta, shroud = false, voteless = false, shroudUrl = '', link = true, extraClass = '' }) {
  const label = name || id || 'Unknown';
  const [first, other, reminders, setup, edition] = meta || [];
  const cls = ['ctok', team ? `team-${team}` : '', edition ? `edition-${edition}` : '', icon ? 'has-art' : '', extraClass].filter(Boolean).join(' ');
  const leaves = [
    first ? '<span class="leaf leaf-left"></span>' : '',
    other ? '<span class="leaf leaf-right"></span>' : '',
    reminders ? `<span class="leaf leaf-top${Math.min(reminders, 6)}"></span>` : '',
    setup ? '<span class="leaf leaf-orange"></span>' : '',
  ].join('');
  return `<div class="${cls}">
    ${img('ct-icon', icon, fallback)}${leaves}
    <svg class="ct-name" viewBox="0 0 140 140" aria-hidden="true"><text x="100%" text-anchor="middle" font-size="${nameSize(label)}"><textPath href="#ct-circle">${esc(label)}</textPath></text></svg>
    ${shroud ? `<span class="ct-shroud${shroudUrl ? ' art' : ''}"${shroudUrl ? ` style="background-image:url('${esc(shroudUrl)}')"` : ''} aria-label="Died"></span>` : ''}
    ${voteless ? '<span class="ct-voteless" aria-label="Used their dead vote"></span>' : ''}
    ${link && id ? `<button class="ct-hit" data-add-char="${esc(id)}" title="Show stats for ${esc(label)}" aria-label="${esc(label)}"></button>` : `<span class="sr-only">${esc(label)}</span>`}
  </div>`;
}

export function reminderToken({ name, icon, fallback, custom = false }) {
  const text = name || '';
  // Like botc.app: a custom note (or any reminder without art) is written across the middle instead of round the edge.
  const plain = custom || !icon;
  return `<div class="crem${plain ? ' plain' : ''}">
    ${plain ? '' : img('cr-icon', icon, fallback)}
    ${plain ? `<span class="cr-text">${esc(text)}</span>` : `<svg class="cr-name" viewBox="0 0 140 140" aria-hidden="true"><text x="100%" text-anchor="middle" font-size="${reminderSize(text)}"><textPath href="#ct-circle">${esc(text)}</textPath></text></svg><span class="sr-only">${esc(text)}</span>`}
  </div>`;
}

// Turns the art found in botc.app's stylesheet into CSS for .ctok / .crem, and loads its fonts (token names,
// reminders, and the grimoire reveal's "has won!").
// Rules go default → editions → teams, the same order botc.app uses, so a traveller's parchment wins.
let installed = '';
export function installTokenStyle(style, extra = {}) {
  const key = JSON.stringify([style && Object.keys(style.variants || {}), extra.death]);
  if (!style || installed === key) return;
  installed = key;
  const url = (u) => `url("${String(u).replace(/"/g, '%22')}")`;
  const order = Object.keys(style.variants).sort((a, b) => rank(a) - rank(b));
  let css = '';
  for (const v of order) {
    const sel = v === 'default' ? '.ctok' : `.ctok.${v}`;
    for (const [part, u] of Object.entries(style.variants[v])) {
      css += part === 'token' ? `${sel}{background-image:${url(u)}}\n` : `${sel} .${part}{background-image:${url(u)}}\n`;
    }
  }
  if (style.reminder) css += `.crem{background-image:${url(style.reminder)}}\n`;
  if (extra.death) css += `.ct-voteless{background-image:${url(extra.death)}}\n`;
  let el = document.getElementById('token-art');
  if (!el) { el = document.createElement('style'); el.id = 'token-art'; document.head.append(el); }
  el.textContent = css;
  document.documentElement.classList.add('token-art');
  // Fonts are fetched directly (the extension may read botc.app), then registered under our own names. Other sites
  // aren't allowed to load botc.app's fonts, so the community website uses the bundled look-alikes instead.
  if (extra.fonts === false) return;
  const fonts = style.fonts || {};
  for (const [family, src, flag] of [['Clockwise Token', fonts.name, 'token-font'], ['Clockwise Reminder', fonts.reminder, 'reminder-font'], ['Clockwise Result', fonts.result, 'result-font']]) {
    if (!src) continue;
    fetch(src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((buf) => new FontFace(family, buf, { weight: family === 'Clockwise Reminder' ? '700' : '400' }).load())
      .then((face) => { document.fonts.add(face); document.documentElement.classList.add(flag); })
      .catch(() => {});
  }
}
const rank = (v) => (v === 'default' ? 0 : v.startsWith('edition-') ? 1 : 2);
