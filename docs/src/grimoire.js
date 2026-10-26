// Draws a finished game's grimoire like botc.app's end-of-game reveal: the game's background,
// seats in a circle with botc.app's character tokens, death shrouds, nameplates, and the
// storyteller's reminder tokens. Images come from botc.app (see images.js); if one can't load,
// the token falls back to its name on a plain disc.
import { esc, cap, teamOne, phaseLabel } from './ui.js?v=1ce00c94af';
import { characterToken, reminderToken } from './tokens.js?v=1ce00c94af';

const GOOD_TEAMS = ['townsfolk', 'outsider'];
const EVIL_TEAMS = ['minion', 'demon'];

function seatTip(p) {
  const bits = [
    `Seat ${p.seat} · ${p.username || 'unknown player'}`,
    `${p.roleName || 'Unknown'} (${teamOne(p.team)})${p.startingRoleId && p.startingRoleId !== p.roleId ? `, started as ${p.startingRoleName}` : ''}`,
    `${cap(p.alignment || 'unknown alignment')} · ${p.won === null ? '' : p.won ? 'won' : 'lost'}`,
    p.survived ? 'Survived' : `Died${p.diedPhase ? ` ${phaseLabel(p.diedPhase)}` : ''}${p.deadVoteUsed ? ' · used dead vote' : ''}`,
    ...(p.reminders || []).map((r) => `Reminder: ${r.source ? `${r.source} – ` : ''}${r.name}`),
  ];
  return bits.filter(Boolean).join('\n');
}

const pos = (x, y) => `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`;
export function renderGrimoire(g, { playerLink, playerKey, images, roleMeta = {} }) {
  const seats = g.players;
  const n = Math.max(seats.length, 1);
  const R = 37; // token centres, % of the width from the middle
  const tok = Math.max(7.5, Math.min(14.5, ((2 * Math.PI * R) / n) * 0.6));
  const rem = tok * 0.56;
  const step = rem * 1.08;
  const teamOf = new Map(seats.map((p) => [p.roleId, p.team]));
  let html = '';

  seats.forEach((p, i) => {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    const cx = 50 + R * Math.cos(a), cy = 50 + R * Math.sin(a);
    const align = p.alignment || (EVIL_TEAMS.includes(p.team) ? 'evil' : GOOD_TEAMS.includes(p.team) ? 'good' : '');
    const key = playerKey(p);
    const icon = p.roleId ? images.character(p.roleId, p.team, align, p.icon) : null;
    // Drawn like botc.app: the art shows good/evil (a red Washerwoman for an evil one); the tooltip has the details.
    html += `<div class="g-seat" style="${pos(cx, cy)}" data-tip="${esc(seatTip(p))}">
      ${characterToken({ id: p.roleId, name: p.roleName || 'Unknown', team: p.team, icon, fallback: images.fallback(p.roleId, icon), meta: roleMeta[p.roleId],
        shroud: !p.survived, voteless: !p.survived && p.deadVoteUsed, shroudUrl: images.asset('shroud.webp'), link: !!p.roleId })}
      <div class="g-name">${key ? playerLink(key, p.username || 'unknown') : `<span>Seat ${p.seat}</span>`}</div>
    </div>`;

    // Reminder tokens cluster just inside the seat, three per row, working toward the middle.
    // Seats in the top half also clear their nameplate, which hangs down toward the middle.
    const rs = p.reminders || [];
    const plate = tok * 0.3;
    const r0 = R - tok / 2 - rem * 0.62 - 0.6 - plate * Math.max(0, -Math.sin(a));
    rs.slice(0, 6).forEach((r, k) => {
      const row = Math.floor(k / 3), col = [0, -1, 1][k % 3];
      const radial = r0 - row * step;
      const x = 50 + radial * Math.cos(a) - col * step * Math.sin(a);
      const y = 50 + radial * Math.sin(a) + col * step * Math.cos(a);
      const tip = `${p.username || `Seat ${p.seat}`}: ${r.source ? `${r.source} – ` : ''}${r.name}${k === 5 && rs.length > 6 ? `\n+${rs.length - 6} more` : ''}`;
      const rIcon = images.reminder(r.role, teamOf.get(r.role), r.icon);
      // Like botc.app: a custom note of 15+ letters (or one with no art) is written across the middle, not round the edge.
      const custom = !rIcon || (r.role === 'custom' && (r.name || '').length >= 15);
      html += `<div class="g-reminder" style="${pos(x, y)}" data-tip="${esc(tip)}">${reminderToken({ name: r.name, icon: rIcon, fallback: images.fallback(r.role, rIcon), custom })}</div>`;
    });
  });

  const corner = (cls, title, list) => (list && list.length
    ? `<div class="g-corner ${cls}"><span>${title}</span><div>${list.map((x) => {
      const icon = images.character(x.id, cls === 'tl' ? 'fabled' : null, null, x.icon);
      return `<div class="g-mini" data-tip="${esc(x.name)}">${characterToken({ id: x.id, name: x.name, team: cls === 'tl' ? 'fabled' : null, icon, fallback: images.fallback(x.id, icon), meta: roleMeta[x.id] })}</div>`;
    }).join('')}</div></div>` : '');

  const bg = images.background(g.background);
  return `<div class="grimoire ${g.winner} ${bg ? 'has-bg' : ''}" style="--tok:${tok.toFixed(2)}cqw;--rem:${rem.toFixed(2)}cqw;${bg ? `background-image:url('${esc(bg)}')` : ''}">
    <div class="g-result ${g.winner === 'evil' ? 'evil' : 'good'}"><b>${g.winner === 'evil' ? 'Evil' : 'Good'}</b> has won!</div>
    ${html}
    ${corner('tl', 'Fabled', g.fabled)}
    ${corner('br', 'Demon bluffs', g.bluffs)}
  </div>`;
}
