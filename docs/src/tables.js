// Flattens game records into tidy tables (one row per game / player / nomination / death).
// Used for CSV export and Google Sheets sync, so both always have identical columns.
import { gameCommunity, communityName } from './communities.js?v=1ec2d5cb89';

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');
const names = (list) => (list || []).map((x) => x.username || x.name || x.userId || x.id).filter(Boolean).join(', ');
const playerName = (p) => p.username || (p.userId ? p.userId : `Seat ${p.seat}`);

export const COLUMNS = {
  games: ['game_id', 'community', 'room', 'started_at', 'ended_at', 'duration_min', 'script_id', 'script_name', 'official_script', 'winner',
    'storytellers', 'player_count', 'traveller_count', 'days', 'fabled', 'demons', 'minions', 'outsiders', 'bluffs', 'nominations', 'deaths', 'captured_by', 'excluded'],
  game_players: ['game_id', 'community', 'ended_at', 'script_name', 'winner', 'seat', 'player', 'user_id', 'role_id', 'role', 'team', 'alignment',
    'starting_role', 'role_changed', 'traveller', 'survived', 'died_day', 'died_at_night', 'dead_vote_used', 'reminders', 'won', 'player_count', 'excluded'],
  nominations: ['game_id', 'community', 'ended_at', 'day', 'nominator', 'nominator_seat', 'nominator_role', 'nominee', 'nominee_seat', 'nominee_role',
    'type', 'completed', 'votes', 'majority', 'reached_majority', 'voters', 'excluded'],
  deaths: ['game_id', 'community', 'ended_at', 'day', 'at_night', 'phase', 'player', 'seat', 'role', 'team', 'alignment', 'excluded'],
};

export function toTables(games, settings = {}) {
  const t = { games: [], game_players: [], nominations: [], deaths: [] };
  for (const g of games) {
    const bySeat = new Map(g.players.map((p) => [p.seat, p]));
    const roleAt = (seat) => (bySeat.get(seat) || {}).roleName || '';
    const ex = !!g.excluded;
    const cid = gameCommunity(settings, g);
    const community = cid ? communityName(settings, cid) : '';
    t.games.push({
      game_id: g.id,
      community,
      room: g.room,
      started_at: iso(g.startedAt),
      ended_at: iso(g.endedAt),
      duration_min: g.startedAt && g.endedAt ? Math.round((g.endedAt - g.startedAt) / 60000) : '',
      script_id: g.script.id || '',
      script_name: g.script.name || '',
      official_script: !!g.script.isOfficial,
      winner: g.winner,
      storytellers: names(g.storytellers),
      player_count: g.playerCount,
      traveller_count: g.travellerCount,
      days: g.days,
      fabled: names(g.fabled),
      demons: g.players.filter((p) => p.team === 'demon').map((p) => p.roleName).join(', '),
      minions: g.players.filter((p) => p.team === 'minion').map((p) => p.roleName).join(', '),
      outsiders: g.players.filter((p) => p.team === 'outsider').map((p) => p.roleName).join(', '),
      bluffs: (g.bluffs || []).map((b) => b.name).join(', '),
      nominations: g.nominations.length,
      deaths: g.deaths.length,
      captured_by: (g.capturedBy && g.capturedBy.username) || '',
      excluded: ex,
    });
    for (const p of g.players) {
      t.game_players.push({
        game_id: g.id,
        community,
        ended_at: iso(g.endedAt),
        script_name: g.script.name || '',
        winner: g.winner,
        seat: p.seat,
        player: playerName(p),
        user_id: p.userId || '',
        role_id: p.roleId || '',
        role: p.roleName || '',
        team: p.team || '',
        alignment: p.alignment || '',
        starting_role: p.startingRoleName || '',
        role_changed: !!(p.startingRoleId && p.startingRoleId !== p.roleId),
        traveller: p.isTraveller,
        survived: p.survived,
        died_day: p.diedPhase ? Math.ceil(p.diedPhase / 2) : '',
        died_at_night: p.diedPhase ? p.diedPhase % 2 === 1 : '',
        dead_vote_used: !!p.deadVoteUsed,
        reminders: (p.reminders || []).map((r) => (r.source ? `${r.source}: ${r.name}` : r.name)).join('; '),
        won: p.won === null ? '' : p.won,
        player_count: g.playerCount,
        excluded: ex,
      });
    }
    for (const n of g.nominations) {
      t.nominations.push({
        game_id: g.id,
        community,
        ended_at: iso(g.endedAt),
        day: n.day,
        nominator: n.nominator || `Seat ${n.nominatorSeat}`,
        nominator_seat: n.nominatorSeat,
        nominator_role: roleAt(n.nominatorSeat),
        nominee: n.nominee || `Seat ${n.nomineeSeat}`,
        nominee_seat: n.nomineeSeat,
        nominee_role: roleAt(n.nomineeSeat),
        type: n.type,
        completed: n.completed,
        votes: n.votes === null ? '' : n.votes,
        majority: n.majority,
        reached_majority: n.votes === null ? '' : n.votes >= n.majority,
        voters: (n.voters || []).map((v) => v.username || `Seat ${v.seat}`).join(', '),
        excluded: ex,
      });
    }
    for (const d of g.deaths) {
      const p = bySeat.get(d.seat) || {};
      t.deaths.push({
        game_id: g.id,
        community,
        ended_at: iso(g.endedAt),
        day: d.phase ? Math.ceil(d.phase / 2) : '',
        at_night: d.phase ? d.phase % 2 === 1 : '',
        phase: d.phase === null ? '' : d.phase,
        player: d.username || p.username || `Seat ${d.seat}`,
        seat: d.seat,
        role: p.roleName || '',
        team: p.team || '',
        alignment: p.alignment || '',
        excluded: ex,
      });
    }
  }
  return t;
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n');
}
