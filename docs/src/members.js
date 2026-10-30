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
import { playerKey, storytellerKeys } from './stats.js?v=57a62a3c74';
import { communityConfig } from './communities.js?v=57a62a3c74';

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

// ---------- which community a game looks like it's from ----------
// The recorder uses this to pick a game's community when nobody has picked one (a game that fits none defaults to
// "Don't record"), and the Games tab uses it to flag games for an editor to check. A game fits a community when
//   - its storyteller is a member (MIN_MEMBER_GAMES+ of the community's games, played or storytold), or
//   - at least half of its seated players (not counting travellers) have sat in another of the community's games.
// (A community's own rooms, like "escape", and choices made by hand come first; see communities.js.)

// history: the games to learn from (leave out excluded and unrecorded ones), from communityHistory().
// Per community: seated (key → games sat in) and everyone (key → games played or storytold).
export function communityHistory(games) {
  const out = new Map();
  for (const g of games) {
    if (!g.community) continue;
    if (!out.has(g.community)) out.set(g.community, { seated: new Map(), everyone: new Map(), ids: new Set() });
    const h = out.get(g.community);
    h.ids.add(g.id);
    for (const k of new Set(seatedKeys(g))) h.seated.set(k, (h.seated.get(k) || 0) + 1);
    for (const k of everyoneKeys(g)) h.everyone.set(k, (h.everyone.get(k) || 0) + 1);
  }
  return out;
}

// Is score a ahead of score b, comparing the first values that differ?
const higher = (a, b) => { const i = a.findIndex((v, j) => v !== b[j]); return i >= 0 && a[i] > b[i]; };

// The community `who` ({ seated: [keys], storytellers: [keys] }) best fits, or null. `self`: the id of the game
// being judged, when it's in the history itself, so it doesn't count towards its own fit.
export function suggestCommunity(cfg, who, history, { self = null, minGames = MIN_MEMBER_GAMES } = {}) {
  const seated = [...new Set(who.seated || [])], sts = [...new Set(who.storytellers || [])];
  let best = null;
  for (const c of cfg.communities) {
    const h = history.get(c.id);
    if (!h) continue;
    const mine = self && h.ids.has(self) ? 1 : 0;
    const sat = (k) => (h.seated.get(k) || 0) - (mine && seated.includes(k) ? 1 : 0);
    const all = (k) => (h.everyone.get(k) || 0) - (mine && (seated.includes(k) || sts.includes(k)) ? 1 : 0);
    const byStoryteller = sts.some((k) => all(k) >= minGames);
    const known = seated.filter((k) => sat(k) > 0 || all(k) >= minGames).length;
    const byPlayers = seated.length > 0 && known * 2 >= seated.length;
    if (!byStoryteller && !byPlayers) continue;
    // Several fit: the one most of the table knows, then one whose storyteller is a member, then the busier one.
    const score = [seated.length ? known / seated.length : 0, byStoryteller ? 1 : 0, h.ids.size];
    if (!best || higher(score, best.score)) best = { id: c.id, score, why: byStoryteller ? 'storyteller' : 'players', known, seated: seated.length };
  }
  return best;
}

// Who sat and who storytold in a recorded game, in the form suggestCommunity takes.
export const whoOf = (g) => ({ seated: seatedKeys(g), storytellers: storytellerKeys(g) });
