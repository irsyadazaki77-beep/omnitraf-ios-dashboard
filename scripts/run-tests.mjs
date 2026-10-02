import { spawnSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testDbPath = path.join(os.tmpdir(), `omnitraf-phase9-test-${process.pid}.sqlite`);
const env = { ...process.env, DB_PATH: testDbPath, NODE_ENV: 'test' };
const commands = [
  ['--test', 'test/unit/**/*.test.js'],
  ['--test', 'test/integration/api.test.js'],
  ['--test', 'test/integration/persistence.test.js'],
  ['--test', 'test/integration/command_authority.test.js'],
  ['--test', 'test/integration/state_machine_p14d.test.js'],
  ['--test', 'test/integration/chaos_resilience.test.js'],
  ['--test', 'test/integration/security_hardening.test.js']
];

let exitCode = 0;
try {
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  const tempPrefix = `${path.basename(testDbPath)}.tmp.`;
  const tempFiles = (await readdir(os.tmpdir()))
    .filter((name) => name.startsWith(tempPrefix))
    .map((name) => path.join(os.tmpdir(), name));
  await Promise.all([testDbPath, ...tempFiles].map((file) => rm(file, { force: true })));
}

process.exitCode = exitCode;
