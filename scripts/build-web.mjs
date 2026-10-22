// Builds the community dashboard website into docs/ (served by GitHub Pages) from the extension's dashboard.
//   node scripts/build-web.mjs                 uses BACKEND_URL from extension/src/config.js
//   node scripts/build-web.mjs --backend URL   (e.g. a local mock for testing)  --out DIR
// The site holds only code: games come from the shared store, which needs the community password.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const config = fs.readFileSync(path.join(ext, 'src/config.js'), 'utf8');
const backend = arg('backend') || (config.match(/BACKEND_URL = '([^']*)'/) || [])[1] || '';
const out = path.resolve(root, arg('out') || 'docs');
if (!backend) console.warn('warning: no backend address yet (set BACKEND_URL in extension/src/config.js); the site will build but can\'t sign in.');

// Start clean, but only ever inside the chosen output folder.
if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to = from) => fs.cpSync(path.join(ext, from), path.join(out, to), { recursive: true });
for (const dir of ['src', 'fonts', 'images', 'icons']) copy(dir);
copy('dashboard.css');
// Extension-only scripts aren't needed on the website.
for (const f of ['background.js', 'bridge.js', 'page-hook.js', 'popup.js']) fs.rmSync(path.join(out, 'src', f), { force: true });

let html = fs.readFileSync(path.join(ext, 'dashboard.html'), 'utf8');
html = html
  .replace('<a class="brand" href="dashboard.html"', '<a class="brand" href="./"')
  .replace('<title>Clockwise</title>', '<title>Clockwise</title>\n  <meta name="robots" content="noindex">')
  .replace('<script type="module" src="src/dashboard.js"></script>', '<script src="web-config.js"></script>\n  <script type="module" src="src/dashboard.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'web-config.js'), `// Where the community dashboard reads its games (password needed).\nwindow.CLOCKWISE_WEB = ${JSON.stringify({ backendUrl: backend })};\n`);
fs.copyFileSync(path.join(root, 'site/privacy.html'), path.join(out, 'privacy.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log(`built ${path.relative(root, out)}/ (backend: ${backend || 'not set'})`);
