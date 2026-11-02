// Apps Script entry points. The keys are Script properties (Project Settings → Script properties), not code, so
// they can be changed without editing this file: VIEW_PASSWORD, WRITE_KEY, EDITOR_KEY, and optionally HIDDEN_PLAYERS
// (botc.app usernames, separated by commas, never named in the dashboard's stats; see hiddenPlayers_) and
// ANONYMOUS_PLAYERS (never named anywhere on the site, though the Sheet keeps their name; see anonymous.js).

function keys_() {
  var p = PropertiesService.getScriptProperties();
  return { view: p.getProperty('VIEW_PASSWORD') || '', write: p.getProperty('WRITE_KEY') || '', editor: p.getProperty('EDITOR_KEY') || '', hidden: p.getProperty('HIDDEN_PLAYERS') || '', anonymous: p.getProperty('ANONYMOUS_PLAYERS') || '' };
}

// Opening the web app's address in a browser just confirms it's running; games are only ever sent in response
// to a POST with the right password.
function doGet() {
  var k = keys_();
  return json_({ ok: true, service: 'clockwise', ready: !!(k.view && k.write && k.editor) });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad-request' });
  }
  try {
    return json_(handle_(body, sheetStore_(), keys_(), Date.now()));
  } catch (err) {
    return json_({ ok: false, error: 'server-error', message: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
