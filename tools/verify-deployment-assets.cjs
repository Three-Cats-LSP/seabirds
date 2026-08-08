const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');
const manifestPath = path.join(root, 'site-assets-manifest.txt');
const assets = fs.readFileSync(manifestPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const errors = [];
const seen = new Set();
for (const asset of assets) {
  if (seen.has(asset)) errors.push(`Duplicate manifest entry: ${asset}`);
  seen.add(asset);
  if (path.isAbsolute(asset) || asset.includes('..')) errors.push(`Unsafe manifest path: ${asset}`);
  if (!fs.existsSync(path.join(root, asset))) errors.push(`Missing source asset: ${asset}`);
  if (!fs.existsSync(path.join(www, asset))) errors.push(`Missing www asset: ${asset}`);
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
for (const reference of references) {
  const asset = reference.split('?')[0];
  if (!asset || /^(?:https?:|data:|#|mailto:|tel:)/i.test(asset)) continue;
  if (!seen.has(asset)) errors.push(`index.html references an asset missing from the manifest: ${asset}`);
}

const webFiles = [];
function walk(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
    else webFiles.push(relative);
  }
}
walk(www);
for (const file of webFiles) if (!seen.has(file)) errors.push(`Unexpected www asset not declared in manifest: ${file}`);

if (errors.length) {
  console.error('SeaBirds deployment asset verification failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`SeaBirds deployment assets verified (${assets.length} files).`);
