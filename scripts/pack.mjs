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
// doesn't ship it: only what the manifest loads (the popup, the background, the content scripts) and everything
// they import, followed file by file so a new import can't be left out.
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const pages = [manifest.action.default_popup];
const scripts = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((c) => c.js)];
for (const page of pages) {
  const html = fs.readFileSync(path.join(ext, page), 'utf8');
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) scripts.push(path.join(path.dirname(page), src));
}
const needed = new Set();
const follow = (file) => {
  if (needed.has(file)) return;
  if (!fs.existsSync(path.join(ext, file))) { console.error(`${file} is imported but doesn't exist.`); process.exit(1); }
  needed.add(file);
  const code = fs.readFileSync(path.join(ext, file), 'utf8');
  for (const [, spec] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)'(\.{1,2}\/[^']+)'/g)) follow(path.join(path.dirname(file), spec));
};
scripts.forEach(follow);
// Besides scripts: the icons, and the popup's fonts and images.
const assets = ['icons', 'fonts', 'images'].filter((d) => fs.existsSync(path.join(ext, d)));
execFileSync('zip', ['-r', '-X', '-q', zip, 'manifest.json', ...pages, ...needed, ...assets, '-x', '*.DS_Store'], { cwd: ext, stdio: 'inherit' });
console.log(`wrote ${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
