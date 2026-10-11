import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || '3100';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'omnitraf-e2e-'));
const testDbPath = path.join(tempDir, 'e2e-isolated.sqlite');

console.log(`[E2E Server] Starting isolated backend on port ${port} with temporary DB: ${testDbPath}`);

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: testDbPath,
    TEST_DATA_DIR: tempDir,
    DEV_AUTO_LOGIN: 'false',
    OMNITRAF_RUNTIME_MODE: 'single',
    ALLOW_SQLJS_CLUSTER: 'true',
    JWT_SECRET: 'omnitraf-e2e-deterministic-secret-key-32chars-min'
  },
  stdio: 'inherit'
});

async function cleanup() {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (_) {}
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

child.on('exit', async (code) => {
  await cleanup();
  process.exit(code ?? 0);
});
