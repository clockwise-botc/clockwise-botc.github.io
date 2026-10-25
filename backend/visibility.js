// Who sees which game, and personal communities.
//
// Each recorder files a game under a community: whatever their extension picked when they recorded it
// (filedBy: { recorder's botc.app id: { c: community, chosen } }). Someone signed in can also make their own
// communities on the website, each a list of rooms; a game they recorded in one of those rooms is filed there
// instead, unless they picked a community for it by hand in the extension.
//
// A game is shown to everyone if anyone filed it under Escape or Rhap (or an editor did). Otherwise only the
// people who recorded it get it, and "who recorded it" means the accounts that claimed those players.
//
// Changing your communities or your claim can change what other people see, so it bumps a stamp; a read from
// before the stamp gets everything again (full: true) rather than only what changed.

var PUBLIC_COMMUNITIES_ = ['escape', 'rhap'];
var MAX_COMMUNITIES_ = 20;
var MAX_ROOMS_ = 50;

var roomKey_ = function (room) { return String(room || '').trim().toLowerCase(); };

function recorderId_(g) {
  return g && g.capturedBy ? String(g.capturedBy.userId || g.capturedBy.username || '') : '';
}

// Records saved before filedBy existed: the one recording that's stored.
function filedBy_(rec) {
  if (rec.filedBy) return rec.filedBy;
  var out = {}, id = recorderId_(rec);
  if (id) out[id] = { c: rec.community || null, chosen: !!rec.communityChosen };
  return out;
}

function withFiling_(filedBy, incoming) {
  var out = Object.assign({}, filedBy || {});
  var id = recorderId_(incoming);
  if (id) out[id] = { c: incoming.community || null, chosen: !!incoming.communityChosen };
  return out;
}

// { player id: account } for accounts that have claimed a player.
function accountsByPlayer_(store) {
  var map = {};
  store.listAccounts().forEach(function (a) { if (a.claim && a.claim.player) map[a.claim.player] = a; });
  return map;
}

function personalCommunity_(acct, room) {
  var r = roomKey_(room);
  var list = (acct && acct.communities) || [];
  for (var i = 0; i < list.length; i++) if ((list[i].rooms || []).some(function (x) { return roomKey_(x) === r; })) return list[i].id;
  return null;
}

// The game as this viewer sees it, or null if they can't. `viewer` is the viewer's claimed player id (or null).
function viewGame_(rec, edit, byPlayer, viewer) {
  var g = withEdits_(rec, edit);
  var filings = {};
  var fb = filedBy_(rec);
  Object.keys(fb).forEach(function (id) {
    var f = fb[id] || {};
    var mine = f.chosen ? null : personalCommunity_(byPlayer[id], rec.room);
    filings[id] = mine || f.c || null;
  });
  // An editor putting a game under Escape or Rhap settles it for everyone.
  var edited = !!edit && PUBLIC_COMMUNITIES_.indexOf(edit.community) !== -1;
  var publicOne = edited ? edit.community : null;
  if (!edited) {
    // The stored community if someone filed it there, else the first public filing.
    if (PUBLIC_COMMUNITIES_.indexOf(rec.community) !== -1 && Object.keys(filings).some(function (id) { return filings[id] === rec.community; })) publicOne = rec.community;
    else Object.keys(filings).forEach(function (id) { if (!publicOne && PUBLIC_COMMUNITIES_.indexOf(filings[id]) !== -1) publicOne = filings[id]; });
  }
  var recorded = !!viewer && viewer in filings;
  if (!publicOne && !recorded) return null;
  // You see a game you recorded under the community you filed it in; everyone else sees the public one.
  g.community = recorded && !edited ? filings[viewer] : publicOne;
  delete g.filedBy;
  return g;
}

function bumpVisibility_(store, now) { store.setValue('visibilityAt', String(now)); }
function visibilityAt_(store) { return Number(store.getValue('visibilityAt')) || 0; }

// Checks and tidies a list of communities from the website: [{ id, name, rooms }].
function cleanCommunities_(list) {
  if (!Array.isArray(list)) return { error: 'Something went wrong with that list.' };
  if (list.length > MAX_COMMUNITIES_) return { error: 'You can have up to ' + MAX_COMMUNITIES_ + ' communities.' };
  var out = [], taken = PUBLIC_COMMUNITIES_.concat(['none']);
  for (var i = 0; i < list.length; i++) {
    var c = list[i] || {};
    var name = String(c.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return { error: 'Every community needs a name.' };
    if (name.length > 40) return { error: 'Community names are up to 40 characters.' };
    if (taken.indexOf(name.toLowerCase()) !== -1 || out.some(function (o) { return o.name.toLowerCase() === name.toLowerCase(); })) return { error: 'There\'s already a community called ' + name + '.' };
    var rooms = (Array.isArray(c.rooms) ? c.rooms : []).map(roomKey_).filter(function (r, j, a) { return r && a.indexOf(r) === j; });
    if (rooms.length > MAX_ROOMS_) return { error: 'A community can have up to ' + MAX_ROOMS_ + ' rooms.' };
    if (rooms.some(function (r) { return r.length > 60; })) return { error: 'That room name is too long.' };
    var keep = typeof c.id === 'string' && /^[a-z0-9-]{1,48}$/.test(c.id) && taken.indexOf(c.id) === -1 ? c.id : slug(name, taken);
    taken.push(keep);
    out.push({ id: keep, name: name, rooms: rooms });
  }
  return { communities: out };
}
