// Packages the extension for the Chrome Web Store: dist/clockwise-<version>.zip
//   node scripts/pack.mjs
// Refuses to package a build that isn't set up to share games (empty BACKEND_URL / WRITE_KEY), since everyone
// who installs it would then only keep games to themselves.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const config = fs.readFileSync(path.join(ext, 'src/config.js'), 'utf8');
const value = (name) => (config.match(new RegExp(`${name} = '([^']*)'`)) || [])[1] || '';
if (!process.argv.includes('--allow-unshared') && !(value('BACKEND_URL') && value('WRITE_KEY'))) {
  console.error('BACKEND_URL and WRITE_KEY in extension/src/config.js are empty. Set them first (or pass --allow-unshared).');
  process.exit(1);
}
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const zip = path.join(dist, `clockwise-${version}.zip`);
fs.rmSync(zip, { force: true });
// The dashboard is the community website (built from these same files by build-web.mjs), so the extension itself
// doesn't ship it: only the popup, the background and the content scripts (and what they import) go in.
const dashboardOnly = ['dashboard.html', 'dashboard.css', ...['dashboard', 'data', 'dataview', 'grimoire', 'images', 'insights', 'multiselect', 'stats', 'tables', 'tokens', 'ui'].map((m) => `src/${m}.js`)];
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.DS_Store', ...dashboardOnly], { cwd: ext, stdio: 'inherit' });
console.log(`wrote ${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
