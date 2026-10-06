import { spawnSync } from 'node:child_process';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'omnitraf-tests-'));

async function findTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [entryPath] : [];
  }));
  return nested.flat();
}

async function runTestFiles(suite, directory, env) {
  const testRoot = path.join(root, 'test', directory);
  const files = (await findTestFiles(testRoot)).sort();
  if (files.length === 0) {
    console.error(`No ${suite} test files found under ${path.relative(root, testRoot)}.`);
    return { exitCode: 1, count: 0 };
  }
  for (const file of files) {
    const relativeFile = path.relative(root, file);
    const perTestPath = path.relative(testRoot, file).replace(/\.test\.js$/, '');
    const testDataDirectory = path.join(tempRoot, suite, perTestPath);
    console.log(`\n[${suite}] ${relativeFile}`);
    const result = spawnSync(process.execPath, ['--test', file], {
      cwd: root,
      env: {
        ...env,
        DB_PATH: path.join(testDataDirectory, 'default.sqlite'),
        TEST_DATA_DIR: testDataDirectory
      },
      stdio: 'inherit'
    });
    if (result.error) {
      console.error(`Unable to run ${relativeFile}:`, result.error);
      return { exitCode: 1, count: files.length };
    }
    if (result.status !== 0) {
      console.error(`\nTest failed: ${relativeFile}`);
      return { exitCode: result.status ?? 1, count: files.length };
    }
  }
  return { exitCode: 0, count: files.length };
}

let exitCode = 0;
let total = 0;
try {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DB_PATH: path.join(tempRoot, 'default.sqlite'),
    TEST_DATA_DIR: tempRoot
  };
  for (const [suite, directory] of [['unit', 'unit'], ['integration', 'integration']]) {
    const result = await runTestFiles(suite, directory, env);
    total += result.count;
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      break;
    }
  }
  if (exitCode === 0) console.log(`\nAll ${total} test files passed (unit and integration).`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;
