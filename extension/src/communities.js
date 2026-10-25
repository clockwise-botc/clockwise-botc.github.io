// Communities group games across rooms (e.g. Escape always plays in "escape"; Rhap uses a new room each time).
// A game's community is decided by, in order:
//   1. a manual choice for that room (popup), stored in settings.roomCommunity
//   2. a community whose room list includes the room
//   3. the default community for every other room
// A game can also have no community at all (null): the user switched the selection off. There is
// no "No community" option anywhere in the UI; internally NONE marks "switched off" for a room.

export const NONE = 'none';

export const DEFAULTS = {
  communities: [
    { id: 'escape', name: 'Escape', rooms: ['escape'] },
    { id: 'rhap', name: 'Rhap', rooms: [] },
  ],
  fallbackCommunity: 'rhap',
};

const norm = (room) => String(room || '').trim().toLowerCase();

export function communityConfig(settings = {}) {
  const base = Array.isArray(settings.communities) ? settings.communities : DEFAULTS.communities;
  // Your own communities, from the account you're signed in to in the extension (made on the website). They're
  // marked `own` so the Communities card in Data & settings, which edits this browser's list, leaves them out.
  const own = (Array.isArray(settings.accountCommunities) ? settings.accountCommunities : [])
    .filter((c) => c && c.id && !base.some((b) => b.id === c.id)).map((c) => ({ ...c, own: true }));
  return {
    communities: [...base, ...own],
    fallback: settings.fallbackCommunity !== undefined ? settings.fallbackCommunity : DEFAULTS.fallbackCommunity,
    overrides: settings.roomCommunity || {},
  };
}

// The community a room gets without a manual choice.
export function automaticCommunity(settings, room) {
  const cfg = communityConfig(settings);
  const r = norm(room);
  const match = cfg.communities.find((c) => (c.rooms || []).some((x) => norm(x) === r));
  if (match) return match.id;
  return cfg.fallback && cfg.fallback !== NONE && cfg.communities.some((c) => c.id === cfg.fallback) ? cfg.fallback : null;
}

// The community for a room, honouring a manual choice. Returns a community id, or null for "no community".
export function communityForRoom(settings, room) {
  const choice = communityConfig(settings).overrides[norm(room)];
  if (choice === NONE) return null;
  if (choice && communityConfig(settings).communities.some((c) => c.id === choice)) return choice;
  return automaticCommunity(settings, room);
}

export function isManual(settings, room) {
  return communityConfig(settings).overrides[norm(room)] !== undefined;
}

// Returns new settings with the room's manual choice set (communityId, NONE) or cleared (null).
export function withRoomChoice(settings, room, choice) {
  const overrides = { ...(settings.roomCommunity || {}) };
  if (choice === null || choice === undefined) delete overrides[norm(room)];
  else overrides[norm(room)] = choice;
  return { ...settings, roomCommunity: overrides };
}

export function communityName(settings, id) {
  if (!id || id === NONE) return '';
  const c = communityConfig(settings).communities.find((x) => x.id === id);
  return c ? c.name : id;
}

// Games saved before communities existed get one from their room.
export function gameCommunity(settings, game) {
  return game.community !== undefined ? game.community : communityForRoom(settings, game.room);
}

export function slug(name, taken) {
  const base = norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'community';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}
