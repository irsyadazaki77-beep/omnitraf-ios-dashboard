import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const sourceAssets = path.resolve('public/assets');
const outputAssets = path.join(dist, 'assets');
const references = new Map();

for (const entry of await readdir(sourceAssets, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const originalName = entry.name;
  const originalPath = path.join(outputAssets, originalName);
  const bytes = await readFile(originalPath);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const extension = path.extname(originalName);
  const stem = path.basename(originalName, extension);
  const hashedName = `${stem}-${hash}${extension}`;
  await rename(originalPath, path.join(outputAssets, hashedName));
  references.set(`/assets/${originalName}`, `/assets/${hashedName}`);
}

async function rewriteReferences(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteReferences(target);
      continue;
    }
    if (!/\.(?:html|webmanifest|json|js|css)$/i.test(entry.name)) continue;
    let contents = await readFile(target, 'utf8');
    for (const [original, hashed] of references) contents = contents.replaceAll(original, hashed);
    await writeFile(target, contents);
  }
}

await rewriteReferences(dist);
console.log(`Content-hashed ${references.size} public image assets.`);
