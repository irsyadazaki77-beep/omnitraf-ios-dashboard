import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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

  test('2. Production rejects missing or default JWT_SECRET', () => {
    const res = runEnvCheck({
      NODE_ENV: 'production',
      JWT_SECRET: 'omnitraf-surabaya-jwt-secret-key-2026-secure',
      ALLOWED_ORIGINS: 'https://omnitraf.surabaya.go.id'
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('JWT_SECRET environment variable is missing, using default development secret, or is too short'));
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
        ADMIN_PASSWORD_HASH: '$2a$10$prodAdminHashTestValueOnly1234567890123456789012',
        OPERATOR_USERNAME: 'custom_operator',
        OPERATOR_PASSWORD_HASH: '$2a$10$prodOperatorHashTestValueOnly12345678901234567890',
        VIEWER_USERNAME: 'custom_viewer',
        VIEWER_PASSWORD_HASH: '$2a$10$prodViewerHashTestValueOnly1234567890123456789012'
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
