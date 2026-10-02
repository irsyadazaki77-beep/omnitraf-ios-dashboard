import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const [html, css, manifest, worker] = await Promise.all([
  read('index.html'), read('style.css'), read('manifest.webmanifest'), read('sw.js')
]);
const parsedManifest = JSON.parse(manifest);

async function listJavaScript(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScript(relative);
    return entry.isFile() && entry.name.endsWith('.js') ? [relative] : [];
  }));
  return nested.flat();
}

assert.ok(parsedManifest.name && parsedManifest.start_url, 'manifest must identify the app and start URL');
assert.equal((html.match(/href=["'](?:\.\/)?css\/main\.css["']/g) || []).length, 1,
  'index.html must link css/main.css exactly once');
assert.doesNotMatch(css, /@import\s+["']\.\/css\/main\.css["']/,
  'style.css must not import the main stylesheet a second time');
assert.match(worker, /const CACHE_NAME = 'omnitraf-sits-v\d+'/,
  'service worker cache namespace must be versioned');

for (const shellPath of ['/index.html', '/style.css', '/css/main.css', '/manifest.webmanifest']) {
  await access(path.join(root, shellPath.slice(1)));
}

for (const sourcePath of await listJavaScript('src')) {
  const source = await read(sourcePath);
  assert.doesNotMatch(source, /from\s+["'][^"']*\/server\//,
    `${sourcePath} must not import protected backend modules into the browser graph`);
}

console.log('Static PWA validation passed (no bundle or compilation is produced).');
