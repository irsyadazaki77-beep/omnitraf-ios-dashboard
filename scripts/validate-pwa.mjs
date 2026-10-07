import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const exists = async (relative) => access(path.join(root, relative));
const html = await read('index.html');
const worker = await read('sw.js');
const manifest = JSON.parse(await read('.vite/manifest.json'));
const webManifest = JSON.parse(await read('manifest.webmanifest'));

assert.ok(webManifest.name && webManifest.start_url, 'PWA manifest must identify the app and start URL');
assert.match(html, /assets\/[^"']+-[A-Za-z0-9_-]{8,}\.js/, 'entry JavaScript must have a content hash');
assert.match(html, /assets\/[^"']+-[A-Za-z0-9_-]{8,}\.css/, 'entry CSS must have a content hash');
assert.doesNotMatch(html, /(?:unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|\/src\/app\.js)/,
  'production HTML must reference local bundled code and avoid development/CDN paths');
assert.match(worker, /request\.mode === 'navigate'/, 'service worker must use network-first navigation');
assert.match(worker, /HASHED_ASSET\.test\(url\.pathname\)/, 'service worker must cache only fingerprinted assets');
assert.match(worker, /\/api\//, 'service worker must bypass API traffic');
assert.match(worker, /\/socket\.io\//, 'service worker must bypass Socket.io traffic');
assert.ok(manifest['index.html']?.isEntry, 'Vite manifest must contain the HTML app entry');
const dynamicEntries = new Set(manifest['index.html'].dynamicImports || []);
for (const feature of [
  'src/modules/mapManager.js', 'src/modules/cctvController.js',
  'src/controllers/analyticsController.js', 'src/controllers/deviceController.js',
  'src/controllers/signalsController.js', 'src/controllers/incidentController.js'
]) {
  assert.ok(dynamicEntries.has(feature), `${feature} must stay outside the initial entry graph`);
}

for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'views/dashboardView.html', 'components/marquee.html', 'assets/favicon.png']) {
  await exists(file);
}

const assetDirectory = path.join(root, 'assets');
const assetNames = await readdir(assetDirectory);
const lazyChunks = assetNames.filter((name) => name.endsWith('.js') && /analyticsController|mapManager|cctvController|deviceController|signalsController/.test(name));
assert.ok(lazyChunks.length >= 3, 'production build must emit multiple feature-level JavaScript chunks');
const allHtmlPaths = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
for (const urlPath of allHtmlPaths) {
  if (urlPath.startsWith('/assets/')) await exists(urlPath.slice(1));
}

console.log(`Production frontend validation passed (${assetNames.length} hashed asset files, ${lazyChunks.length} feature chunks).`);
