// Who belongs to each community, worked out from the games, so nobody has to sign up.
//
// When someone from the group plays in another group's lobby, the recorder still files that game under a
// community (any room that isn't a community's own room goes to the default community). These rules tell
// those games apart from the community's own:
//   - A game is set for its community when someone chose that community for it (the popup while it was being
//     recorded, or the game's settings in the dashboard), or when it was played in one of the community's own
//     rooms (Escape always plays in "escape").
//   - A member is anyone who has played or storytold at least MIN_MEMBER_GAMES of the community's games.
//   - Any other game counts for the community when its storyteller is a member, or when at least half of
//     the seated players (not counting travellers) are members.
// Members are worked out from the games that count, and which games count from the members, so the two are
// settled together: start from every game filed under the community and drop games until nothing changes.
// Games that don't count are kept (the Games tab lists them as from another lobby) but left out of the stats.
//
// Each community has its own members, so someone can be a member of several. Nothing here is specific to
// Escape or Rhap: a community made on the website gets members the same way.
import { playerKey, storytellerKeys } from './stats.js';
import { communityConfig } from './communities.js';

// Low while there are only a few dozen games; worth raising as more games are recorded.
export const MIN_MEMBER_GAMES = 3;

const norm = (s) => String(s || '').trim().toLowerCase();
const seatedKeys = (g) => (g.players || []).filter((p) => !p.isTraveller).map(playerKey).filter(Boolean);
const everyoneKeys = (g) => [...new Set([...(g.players || []).map(playerKey), ...storytellerKeys(g)].filter(Boolean))];

// Set for its community without looking at who played: chosen by hand, or played in the community's own room.
export function setByChoice(cfg, g) {
  if (g.communityManual || g.communityChosen) return true;
  const c = cfg.communities.find((x) => x.id === g.community);
  return !!c && (c.rooms || []).some((r) => norm(r) === norm(g.room));
}

// Counts because of who was there: a member storytold, or at least half the seated players are members.
// A game with no known seated players isn't judged on its players.
export function byMembers(g, members) {
  if (storytellerKeys(g).some((k) => members.has(k))) return true;
  const seated = seatedKeys(g);
  return !seated.length || seated.filter((k) => members.has(k)).length * 2 >= seated.length;
}

// games: the games to learn from (leave out excluded ones). Returns
//   members: Map(community id → Set of player keys)
//   status:  Map(game id → 'chosen' | 'members' | 'outside'); games without a community aren't in it
export function communityMembers(games, settings, { minGames = MIN_MEMBER_GAMES } = {}) {
  const cfg = communityConfig(settings);
  const byCommunity = new Map();
  for (const g of games) {
    if (!g.community) continue;
    if (!byCommunity.has(g.community)) byCommunity.set(g.community, []);
    byCommunity.get(g.community).push(g);
  }
  const members = new Map(), status = new Map();
  for (const [c, list] of byCommunity) {
    const chosen = new Set(list.filter((g) => setByChoice(cfg, g)));
    let counted = list, set = new Set();
    // Each round can only drop games, so this settles in a few rounds.
    for (;;) {
      const n = new Map();
      for (const g of counted) for (const k of everyoneKeys(g)) n.set(k, (n.get(k) || 0) + 1);
      set = new Set([...n].filter(([, v]) => v >= minGames).map(([k]) => k));
      const next = counted.filter((g) => chosen.has(g) || byMembers(g, set));
      if (next.length === counted.length) break;
      counted = next;
    }
    members.set(c, set);
    for (const g of list) status.set(g.id, chosen.has(g) ? 'chosen' : byMembers(g, set) ? 'members' : 'outside');
  }
  return { members, status };
}
