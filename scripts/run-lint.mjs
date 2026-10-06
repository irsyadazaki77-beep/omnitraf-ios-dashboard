import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['.git', 'node_modules', 'coverage']);

async function listJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) return listJavaScript(filePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [filePath] : [];
  }));
  return nested.flat();
}

const files = (await listJavaScript(root)).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Syntax check failed: ${path.relative(root, file)}`);
    process.exitCode = result.status ?? 1;
    break;
  }
}
if (!process.exitCode) console.log(`Syntax check passed for ${files.length} JavaScript files.`);
