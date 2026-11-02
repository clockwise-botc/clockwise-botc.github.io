// Players who don't want their name shown anywhere: the ANONYMOUS_PLAYERS Script property (botc.app usernames or user
// ids, separated by commas). The games are stored as recorded (and the Sheet keeps their name), but in every game
// the dashboard is sent, their name and botc.app id are replaced by "Anonymous" and an id of their own that can't be
// traced back to them. Their games still count toward the stats (always unnamed, like HIDDEN_PLAYERS), but nothing
// on the site names them, not even the Games tab. A name matched once is remembered by its botc.app id, so a new
// name later doesn't bring them back.

var ANON_NAME_ = 'Anonymous';

// What to look for: { names, ids } (lowercase names; ids → the list entry they belong to), or null with nobody listed.
function anonymousList_(store, list) {
  var entries = String(list || '').split(',').map(function (n) { return n.trim(); }).filter(function (n) { return n; });
  if (!entries.length) return null;
  var learned = {};
  try { learned = JSON.parse(store.getValue('anonIds') || '{}'); } catch (e) { learned = {}; }
  var anon = { names: {}, ids: {}, learned: learned, changed: false };
  entries.forEach(function (e) {
    anon.names[e.toLowerCase()] = e;
    if (/^\d+$/.test(e)) anon.ids[e] = e;
  });
  // Ids learned from a name stay theirs while that name is still on the list.
  Object.keys(learned).forEach(function (id) { if (anon.names[learned[id].toLowerCase()]) anon.ids[id] = learned[id]; });
  // The stand-in id: the same for every game of theirs, made with the store's secret so it can't be worked back.
  anon.tag = function (entry) { return 'anon-' + store.hmac(store.secret(), 'anon|' + entry.toLowerCase()).slice(0, 12); };
  return anon;
}

// Saves any ids learned while anonymizing, so later games under another name are still caught.
function saveAnonymous_(store, anon) {
  if (anon && anon.changed) store.setValue('anonIds', JSON.stringify(anon.learned));
}

// The list entry a person matches (by botc.app id, then name), or null.
function anonEntry_(anon, name, id) {
  if (id && anon.ids[String(id)]) return anon.ids[String(id)];
  var entry = name ? anon.names[String(name).trim().toLowerCase()] : null;
  if (entry && id && !/^anon-/.test(String(id)) && !anon.ids[String(id)]) {
    anon.ids[String(id)] = entry;
    anon.learned[String(id)] = entry;
    anon.changed = true;
  }
  return entry || null;
}

// Replaces one person's name and id in place: o[nameField], o[idField].
function anonPerson_(anon, o, nameField, idField) {
  if (!o) return null;
  var entry = anonEntry_(anon, o[nameField], o[idField]);
  if (!entry) return null;
  o[nameField] = ANON_NAME_;
  o[idField] = anon.tag(entry);
  delete o.avatar;
  return entry;
}

// A game (a record, an upload or a game as read), changed in place and returned.
function anonymizeGame_(g, anon) {
  if (!g || !anon) return g;
  var people = function (list) { (list || []).forEach(function (p) { anonPerson_(anon, p, 'username', 'userId'); }); };
  people(g.players);
  people(g.departedTravellers);
  people(g.storytellers);
  people(g.deaths);
  (g.nominations || []).forEach(function (n) {
    anonPerson_(anon, n, 'nominator', 'nominatorId');
    anonPerson_(anon, n, 'nominee', 'nomineeId');
    people(n.voters);
  });
  var recorder = g.capturedBy ? { name: g.capturedBy.username, id: g.capturedBy.userId } : null;
  anonPerson_(anon, g.capturedBy, 'username', 'userId');
  // Who recorded it: by name (recorders) and by botc.app id (filedBy).
  if (g.recorders) g.recorders = g.recorders.map(function (r) { return anonEntry_(anon, r, recorder && r === recorder.name ? recorder.id : null) ? ANON_NAME_ : r; });
  if (g.filedBy) {
    var fb = {};
    Object.keys(g.filedBy).forEach(function (id) { var e = anonEntry_(anon, null, id); fb[e ? anon.tag(e) : id] = g.filedBy[id]; });
    g.filedBy = fb;
  }
  return g;
}
