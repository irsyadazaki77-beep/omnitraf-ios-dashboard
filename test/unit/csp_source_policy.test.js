import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');

async function sourceFiles(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target, extensions));
    else if (entry.isFile() && extensions.some(extension => entry.name.endsWith(extension))) files.push(target);
  }
  return files;
}

test('runtime HTML and JavaScript templates do not introduce inline style attributes', async () => {
  const files = [path.join(root, 'index.html')];
  files.push(...await sourceFiles(path.join(root, 'public'), ['.html', '.js']));
  files.push(...await sourceFiles(path.join(root, 'src'), ['.html', '.js']));
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\bstyle\s*=\s*(["'])/g)) {
      violations.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(violations, [], `CSP-blocked inline style attributes found: ${violations.join(', ')}`);
});
