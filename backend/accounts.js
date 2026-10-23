// Accounts: a username and the person's own password (no email). Creating an account needs the community
// password; after that, signing in is enough to see the stats. Editors (EDITOR_KEY) can list accounts, set a new
// password for someone who forgot theirs, and delete accounts.
//
// Passwords are stored salted and hashed (repeated HMAC-SHA256). Signing in returns a token that's checked on
// each request; changing or resetting a password bumps a version number, which signs out every other device.
// After 10 wrong passwords an account is locked for 15 minutes.

var TOKEN_DAYS_ = 180;
var HASH_ROUNDS_ = 400;
var MAX_TRIES_ = 10;
var LOCK_MS_ = 15 * 60 * 1000;

// "Liat W" and "liat w" are the same account.
function accountKey_(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function checkUsername_(name) {
  var n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 24) return 'Usernames are 2 to 24 characters.';
  if (!/^[\w .\-']+$/.test(n)) return 'Usernames can use letters, numbers, spaces and . - _ \' only.';
  return '';
}

function checkPassword_(pw) {
  return String(pw || '').length >= 8 ? '' : 'Passwords need at least 8 characters.';
}

function hashPassword_(store, password, salt) {
  var h = salt + '|' + password;
  for (var i = 0; i < HASH_ROUNDS_; i++) h = store.hmac(salt, h + '|' + password);
  return h;
}

function publicAccount_(acct) {
  return { username: acct.username, created: acct.created, profile: acct.profile || {} };
}

// Token: username key, time issued and password version, signed with the store's secret.
function makeToken_(store, acct, now) {
  var k = accountKey_(acct.username);
  var body = [k, now, acct.pwv || 1].join('|');
  return encodeURIComponent(k) + '.' + now + '.' + (acct.pwv || 1) + '.' + store.hmac(store.secret(), body);
}

function accountFromToken_(store, token, now) {
  var parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  var k = decodeURIComponent(parts[0]);
  var issued = Number(parts[1]), pwv = Number(parts[2]);
  if (!issued || now - issued > TOKEN_DAYS_ * 864e5) return null;
  if (store.hmac(store.secret(), [k, issued, pwv].join('|')) !== parts[3]) return null;
  var acct = store.getAccount(k);
  if (!acct || (acct.pwv || 1) !== pwv) return null;
  return acct;
}

// The account-related actions. `who` is { canRead, canEdit, account } for this request. Returns null for actions
// it doesn't handle.
function handleAccount_(body, store, who, now) {
  var deny = function (message) { return { ok: false, error: 'not-allowed', message: message }; };
  switch (body.action) {
    case 'signup': {
      if (!who.viewKey) return deny('That community password isn\'t right.');
      var bad = checkUsername_(body.username) || checkPassword_(body.password);
      if (bad) return { ok: false, error: 'invalid', message: bad };
      var k = accountKey_(body.username);
      var created = null;
      store.batch(function () {
        if (store.getAccount(k)) return;
        var salt = store.randomId();
        created = { username: String(body.username).replace(/\s+/g, ' ').trim(), created: now, salt: salt, hash: hashPassword_(store, body.password, salt), pwv: 1, profile: {} };
        store.putAccount(k, created, now);
      });
      if (!created) return { ok: false, error: 'taken', message: 'That username is taken. Try another.' };
      return { ok: true, token: makeToken_(store, created, now), account: publicAccount_(created) };
    }

    case 'signin': {
      var k2 = accountKey_(body.username);
      var acct = store.getAccount(k2);
      var tries = store.getTries(k2) || { n: 0, until: 0 };
      if (tries.until > now) return { ok: false, error: 'locked', message: 'Too many wrong passwords. Try again in a few minutes.' };
      if (!acct || hashPassword_(store, body.password || '', acct.salt) !== acct.hash) {
        var n = tries.n + 1;
        store.setTries(k2, n >= MAX_TRIES_ ? { n: 0, until: now + LOCK_MS_ } : { n: n, until: 0 });
        return { ok: false, error: 'wrong', message: 'That username and password don\'t match.' };
      }
      store.setTries(k2, null);
      return { ok: true, token: makeToken_(store, acct, now), account: publicAccount_(acct) };
    }

    case 'me':
      if (!who.account) return { ok: false, error: 'signed-out' };
      return { ok: true, account: publicAccount_(who.account), canEdit: who.canEdit };

    case 'change-password': {
      var me = who.account;
      if (!me) return { ok: false, error: 'signed-out' };
      if (hashPassword_(store, body.password || '', me.salt) !== me.hash) return { ok: false, error: 'wrong', message: 'Your current password isn\'t right.' };
      var bad2 = checkPassword_(body.newPassword);
      if (bad2) return { ok: false, error: 'invalid', message: bad2 };
      var next = setPassword_(store, me, body.newPassword, now);
      return { ok: true, token: makeToken_(store, next, now) };
    }

    case 'accounts':
      if (!who.canEdit) return deny('Only editors can see accounts.');
      return { ok: true, accounts: store.listAccounts().map(publicAccount_).sort(function (a, b) { return a.username.localeCompare(b.username); }) };

    case 'reset-password': {
      if (!who.canEdit) return deny('Only editors can reset passwords.');
      var target = store.getAccount(accountKey_(body.username));
      if (!target) return { ok: false, error: 'not-found', message: 'There\'s no account with that username.' };
      var bad3 = checkPassword_(body.newPassword);
      if (bad3) return { ok: false, error: 'invalid', message: bad3 };
      setPassword_(store, target, body.newPassword, now);
      store.setTries(accountKey_(body.username), null);
      return { ok: true };
    }

    case 'delete-account': {
      if (!who.canEdit) return deny('Only editors can delete accounts.');
      var k3 = accountKey_(body.username);
      if (!store.getAccount(k3)) return { ok: false, error: 'not-found', message: 'There\'s no account with that username.' };
      store.batch(function () { store.deleteAccount(k3); });
      return { ok: true };
    }

    default:
      return null;
  }
}

function setPassword_(store, acct, password, now) {
  var salt = store.randomId();
  var next = Object.assign({}, acct, { salt: salt, hash: hashPassword_(store, password, salt), pwv: (acct.pwv || 1) + 1 });
  store.batch(function () { store.putAccount(accountKey_(acct.username), next, now); });
  return next;
}
