// Finds images for characters, reminder tokens and backgrounds.
//
// 1. botc.app's own images. Their file names carry a release hash (imp_e-DNpveOPY.webp), so the
//    extension keeps the latest list read from botc.app's code (page-hook.js while a game tab is open,
//    and background.js fetches it directly). These match the in-game grimoire, including the red art
//    for a good character that turned evil.
// 2. The address recorded with the game.
// 3. The official wiki's character icons (wiki.bloodontheclocktower.com, e.g. Icon_imp.png). Used when
//    botc.app's list isn't available yet, and as the backup if a botc.app image fails to load.
// Custom-script artwork (hosted elsewhere) is always taken as recorded.

const GOOD_TEAMS = ['townsfolk', 'outsider'];
const EVIL_TEAMS = ['minion', 'demon'];
const isBotcAsset = (u) => /^https:\/\/botc\.app\/assets\//.test(u || '');

// MediaWiki stores a file at /images/<a>/<ab>/<name>, where "ab" are the first hex digits of md5(name).
export function wikiIcon(id) {
  if (!id || !/^[a-z0-9_]+$/.test(id) || ['custom', 'good', 'evil'].includes(id)) return null;
  const name = `Icon_${id}.png`;
  const h = md5(name);
  return `https://wiki.bloodontheclocktower.com/images/${h[0]}/${h.slice(0, 2)}/${name}`;
}

export function makeImages(assetMap) {
  const files = (assetMap && assetMap.map) || {};
  const byName = new Map();
  for (const [path, url] of Object.entries(files)) {
    const m = /^icons\/([^/]+)\/([^/]+)\.webp$/.exec(path);
    if (m && !byName.has(m[2])) byName.set(m[2], url);
  }

  function character(id, team, alignment, recorded) {
    if (recorded && !isBotcAsset(recorded)) return recorded;
    const usual = GOOD_TEAMS.includes(team) ? 'g' : EVIL_TEAMS.includes(team) ? 'e' : '';
    const a = alignment === 'evil' ? 'e' : alignment === 'good' ? 'g' : usual;
    for (const n of [a && `${id}_${a}`, usual && `${id}_${usual}`, id, `${id}_g`, `${id}_e`]) {
      if (n && byName.has(n)) return byName.get(n);
    }
    return recorded || wikiIcon(id) || byName.get(team ? `${team}${a ? `_${a}` : ''}` : 'custom') || null;
  }

  function reminder(roleId, team, recorded) {
    if (!roleId || ['custom', 'good', 'evil'].includes(roleId)) return byName.get(roleId || 'custom') || recorded || null;
    return character(roleId, team, null, recorded);
  }

  // A second address to try if the first one fails to load.
  function fallback(id, primary) {
    const w = wikiIcon(id);
    return w && w !== primary ? w : null;
  }

  function background(bg) {
    if (bg && bg.url && !isBotcAsset(bg.url)) return bg.url;
    const theme = bg ? Number(bg.theme) || 0 : 0;
    const key = theme > 0 ? `editions/${(bg && bg.edition) || 'custom'}/background${theme}.webp` : theme < 0 ? `background${-theme}.webp` : 'background1.webp';
    return files[key] || (bg && bg.url) || null;
  }

  // Other botc.app images by file name, e.g. 'shroud.webp'.
  const asset = (name) => files[name] || null;

  return { character, reminder, fallback, background, asset, tokenStyle: (assetMap && assetMap.tokenStyle) || null, styleError: (assetMap && assetMap.styleError) || '', ready: byName.size > 0 };
}

// Compact MD5 (RFC 1321) for the wiki's file paths. Input is ASCII.
function md5(str) {
  const k = [], s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const bytes = [...str].map((c) => c.charCodeAt(0) & 0xff);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(i < 4 ? (bitLen >>> (i * 8)) & 0xff : 0);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < bytes.length; off += 64) {
    const m = [];
    for (let i = 0; i < 16; i++) m[i] = bytes[off + i * 4] | (bytes[off + i * 4 + 1] << 8) | (bytes[off + i * 4 + 2] << 16) | (bytes[off + i * 4 + 3] << 24);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + k[i] + m[g]) | 0;
      b = (b + ((x << s[(i >> 4) * 4 + (i % 4)]) | (x >>> (32 - s[(i >> 4) * 4 + (i % 4)])))) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 1, 2, 3].map((i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}
