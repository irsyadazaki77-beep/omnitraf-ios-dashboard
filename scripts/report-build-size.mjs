import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve('dist');
const assetsDirectory = path.join(root, 'assets');
const html = await readFile(path.join(root, 'index.html'), 'utf8');

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  }));
  return nested.flat();
}

const assets = await Promise.all((await filesIn(assetsDirectory)).map(async (file) => ({
  file,
  name: path.relative(root, file).replaceAll(path.sep, '/'),
  bytes: (await stat(file)).size,
  gzipBytes: gzipSync(await readFile(file)).byteLength
})));
const initialPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
  .map((match) => match[1].split('?')[0].replace(/^\//, ''));
const initial = assets.filter((asset) => initialPaths.includes(asset.name));
const initialJs = initial.filter((asset) => asset.name.endsWith('.js')).reduce((sum, asset) => sum + asset.bytes, 0);
const initialCss = initial.filter((asset) => asset.name.endsWith('.css')).reduce((sum, asset) => sum + asset.bytes, 0);
const lazyChunks = assets.filter((asset) => asset.name.endsWith('.js') && !initialPaths.includes(asset.name))
  .sort((a, b) => b.bytes - a.bytes);
const largestAssets = [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const initialGzip = (extension) => initial.filter((asset) => asset.name.endsWith(extension))
  .reduce((sum, asset) => sum + asset.gzipBytes, 0);
console.log(`Initial JS: ${kib(initialJs)} (${kib(initialGzip('.js'))} gzip) | Initial CSS: ${kib(initialCss)} (${kib(initialGzip('.css'))} gzip)`);
console.log('Largest lazy JS chunks:');
for (const asset of lazyChunks.slice(0, 8)) console.log(`  ${kib(asset.bytes)}  ${asset.name}`);
console.log('Largest built assets:');
for (const asset of largestAssets) console.log(`  ${kib(asset.bytes)}  ${asset.name}`);

const budgets = { initialJs: 500 * 1024, initialCss: 150 * 1024, lazyChunk: 600 * 1024, asset: 2 * 1024 * 1024 };
const largestLazy = lazyChunks[0]?.bytes || 0;
const largestAsset = Math.max(0, ...assets.map((asset) => asset.bytes));
if (initialJs > budgets.initialJs) console.warn(`WARNING initial JS exceeds ${kib(budgets.initialJs)}.`);
if (initialCss > budgets.initialCss) console.warn(`WARNING initial CSS exceeds ${kib(budgets.initialCss)}.`);
if (largestLazy > budgets.lazyChunk) console.warn(`WARNING a lazy JS chunk exceeds ${kib(budgets.lazyChunk)}.`);
if (largestAsset > budgets.asset) console.warn(`WARNING an asset exceeds ${kib(budgets.asset)}.`);
