import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

describe('Security Hardening: Production Environment Fail-Closed & User DB Validation', () => {
  function runEnvCheck(envOverrides = {}) {
    return spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import './server/config/env.js'; console.log('ENV_OK');`
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...envOverrides
      },
      encoding: 'utf8'
    });
  }

  test('1. Production rejects invalid NODE_ENV', () => {
    const res = runEnvCheck({ NODE_ENV: 'staging' });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('Invalid NODE_ENV "staging"'));
  });

  test('1a. Direct starts default to production when NODE_ENV is absent', () => {
    const env = { ...process.env };
    delete env.NODE_ENV;
    const res = spawnSync(process.execPath, [
      '--input-type=module', '-e', `import './server/config/env.js'; console.log('ENV_OK');`
    ], { cwd: projectRoot, env, encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /JWT_SECRET environment variable is missing/);
  });

  test('2. Production rejects missing or default JWT_SECRET', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'omnitraf-surabaya-jwt-secret-key-2026-secure',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id'
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('JWT_SECRET environment variable is missing, using default development secret, or is too short'));
  });

  test('2a. Production rejects the cluster test JWT secret', () => {
    const res = runEnvCheck({ NODE_ENV: 'production', JWT_SECRET: 'cluster-test-only-not-for-production', ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id' });
    assert.strictEqual(res.status, 1);
  });

  test('3. Production rejects wildcard (*) in ALLOWED_ORIGINS', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: '*'
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('Wildcard origin (*) is strictly forbidden in production mode'));
  });

  test('4. Production rejects empty ALLOWED_ORIGINS', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: ''
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('ALLOWED_ORIGINS is required and must contain explicit allowed origins'));
  });

  test('5. Production rejects E2E_TEST_RUN=true', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id',
      E2E_TEST_RUN: 'true'
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('E2E_TEST_RUN is restricted strictly to isolated test environments'));
  });

  test('6. Production cluster mode requires REDIS_URL and DB_DRIVER=postgres', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id',
      OMNITRAF_RUNTIME_MODE: 'cluster',
      REDIS_URL: ''
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('OMNITRAF_RUNTIME_MODE=cluster requires REDIS_URL in production mode'));
  });

  test('7. Production DB_DRIVER=postgres requires DATABASE_URL', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id',
      DB_DRIVER: 'postgres',
      DATABASE_URL: ''
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('DB_DRIVER=postgres requires DATABASE_URL in production mode'));
  });

  test('8. Valid production configuration passes validation', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id',
      E2E_TEST_RUN: 'false'
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('ENV_OK'));
  });

  test('8a. Production user loading rejects a missing admin and duplicate accounts', () => {
    const baseEnv = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id',
      ADMIN_PASSWORD_HASH: '',
      OPERATOR_PASSWORD_HASH: '',
      VIEWER_PASSWORD_HASH: '',
      PRODUCTION_USERS_JSON: ''
    };
    const runConstants = env => spawnSync(process.execPath, ['--input-type=module', '-e', `import './server/config/constants.js';`], { cwd: projectRoot, env, encoding: 'utf8' });
    const missingAdmin = runConstants(baseEnv);
    assert.equal(missingAdmin.status, 1);
    assert.match(missingAdmin.stderr, /at least one valid ADMIN account/);

    const passwordHash = bcrypt.hashSync('valid-production-password', 10);
    const duplicate = runConstants({
      ...baseEnv,
      ADMIN_PASSWORD_HASH: passwordHash,
      PRODUCTION_USERS_JSON: JSON.stringify([{ id: 'usr-admin-prod', username: 'another-admin', passwordHash, role: 'ADMIN' }])
    });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /duplicate production user id or username/);
  });

  test('9. Production user loading: supports admin, operator, viewer from env and rejects dev fallback', () => {
    const res = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `
      import { USERS_DB, ROLES } from './server/config/constants.js';
      assert.strictEqual(USERS_DB.length, 3);
      assert.ok(USERS_DB.find(u => u.role === ROLES.ADMIN && u.username === 'custom_admin'));
      assert.ok(USERS_DB.find(u => u.role === ROLES.OPERATOR && u.username === 'custom_operator'));
      assert.ok(USERS_DB.find(u => u.role === ROLES.VIEWER && u.username === 'custom_viewer'));
      // Ensure dev users are not present
      assert.ok(!USERS_DB.some(u => u.username === 'admin'));
      console.log('PROD_USERS_OK');
      `
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: 'super-strong-production-jwt-secret-min-32-chars-long!',
        ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id',
        ADMIN_USERNAME: 'custom_admin',
        ADMIN_PASSWORD_HASH: bcrypt.hashSync('prod-admin-password', 10),
        OPERATOR_USERNAME: 'custom_operator',
        OPERATOR_PASSWORD_HASH: bcrypt.hashSync('prod-operator-password', 10),
        VIEWER_USERNAME: 'custom_viewer',
        VIEWER_PASSWORD_HASH: bcrypt.hashSync('prod-viewer-password', 10)
      },
      encoding: 'utf8'
    });

    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('PROD_USERS_OK'));
  });

  test('10. RBAC fallback: unknown roles return false rather than ADMIN', async () => {
    const { isActionAuthorized } = await import('../../server/config/capabilities.js');
    assert.strictEqual(isActionAuthorized('signal:override', 'UNKNOWN_GUEST_ROLE'), false);
    assert.strictEqual(isActionAuthorized('system:reset', undefined), false);
    assert.strictEqual(isActionAuthorized('system:reset', null), false);
  });
});
