// Builds the community dashboard website into docs/ (served by GitHub Pages) from the extension's dashboard.
//   node scripts/build-web.mjs                 uses BACKEND_URL from extension/src/config.js
//   node scripts/build-web.mjs --backend URL   (e.g. a local mock for testing)  --out DIR
// The site holds only code: games come from the shared store, which needs the community password.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
for (const f of ['background.js', 'bridge.js', 'page-hook.js', 'popup.js', 'site-sync.js']) fs.rmSync(path.join(out, 'src', f), { force: true });

// GitHub Pages lets browsers keep each file for 10 minutes. Stamping every link (and every import between the
// scripts) with this build's version means a browser never mixes files from two versions, and picks up a new
// build in one go once its copy of the page expires.
const srcDir = path.join(out, 'src');
const scripts = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();
const version = crypto.createHash('sha1')
  .update(scripts.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('') + fs.readFileSync(path.join(out, 'dashboard.css'), 'utf8') + backend)
  .digest('hex').slice(0, 10);
for (const f of scripts) {
  const file = path.join(srcDir, f);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\/[^'"?]+\.js)\2/g, `$1$2$3?v=${version}$2`));
}

let html = fs.readFileSync(path.join(ext, 'dashboard.html'), 'utf8');
html = html
  .replace('<a class="brand" href="dashboard.html"', '<a class="brand" href="./"')
  .replace('<title>Clockwise</title>', '<title>Clockwise</title>\n  <meta name="robots" content="noindex">')
  .replace('href="dashboard.css"', `href="dashboard.css?v=${version}"`)
  .replace('<script type="module" src="src/dashboard.js"></script>', `<script src="web-config.js?v=${version}"></script>\n  <script type="module" src="src/dashboard.js?v=${version}"></script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'web-config.js'), `// Where the community dashboard reads its games (password needed).\nwindow.CLOCKWISE_WEB = ${JSON.stringify({ backendUrl: backend })};\n`);
fs.copyFileSync(path.join(root, 'site/privacy.html'), path.join(out, 'privacy.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
// The site's own address (SITE_URL), when it isn't the github.io one: GitHub Pages serves it there. Only for the
// real build, not test copies.
const siteHost = (() => { try { return new URL((config.match(/SITE_URL = '([^']*)'/) || [])[1] || '').host; } catch { return ''; } })();
if (!arg('out') && siteHost && !siteHost.endsWith('.github.io')) fs.writeFileSync(path.join(out, 'CNAME'), `${siteHost}\n`);
console.log(`built ${path.relative(root, out)}/ version ${version} (backend: ${backend || 'not set'})`);
