import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { io as Client } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../server/config/env.js';
import { ROLES } from '../../server/config/constants.js';
import { tokenRevocationService } from '../../server/services/tokenRevocationService.js';
import { testDatabasePath } from '../helpers/testDatabasePath.js';

// Setup test server environment
process.env.PORT = '0';
process.env.DB_PATH = testDatabasePath('session-revocation-test.sqlite');
process.env.NODE_ENV = 'test';

const { server } = await import('../../server.js');

describe('Security & Reliability Hardening: Session Revocation & Socket.IO Trust Boundary', () => {
  let baseUrl;
  let operatorToken;
  let operatorCookie;

  before(async () => {
    await new Promise((resolve) => {
      if (server.listening) resolve();
      else server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Login as operator
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    assert.strictEqual(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie');
    operatorToken = cookieHeader.match(/omnitraf_session=([^;]+)/)?.[1];
    operatorCookie = cookieHeader.split(';')[0];
  });

  test('1. Server-side token revocation: token becomes unusable in REST API immediately after revocation', async () => {
    // 1.1 Before revocation, protected GET /api/auth/me works
    const validRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${operatorToken}` }
    });
    assert.strictEqual(validRes.status, 200);

    // 1.2 Revoke the token explicitly via revocation service
    await tokenRevocationService.revokeToken(operatorToken);

    // 1.3 Subsequent requests with this token must be rejected with 401 REVOKED_TOKEN
    const revokedRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${operatorToken}` }
    });
    assert.strictEqual(revokedRes.status, 401);
    const body = await revokedRes.json();
    assert.strictEqual(body.code, 'REVOKED_TOKEN');
  });

  test('2. Server-side token revocation: Socket.IO handshake rejects connection using revoked token', async () => {
    // Attempt connection with the revoked token
    const socket = Client(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: operatorToken }
    });
    socket.on('error', () => {});

    const errorMsg = await new Promise((resolve) => {
      socket.on('connect_error', (err) => resolve(err.message));
      socket.on('connect', () => resolve('CONNECTED_UNEXPECTEDLY'));
    });

    socket.disconnect();
    socket.close();
    assert.ok(errorMsg.includes('AUTHENTICATION_FAILED'), `Expected AUTHENTICATION_FAILED for revoked token, got: ${errorMsg}`);
  });

  test('3. Server-side token revocation: active Socket.IO connection is disconnected upon logout', async () => {
    // 3.1 Login fresh operator
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    const freshCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
    const freshToken = loginRes.headers.get('set-cookie')?.match(/omnitraf_session=([^;]+)/)?.[1];

    // 3.2 Connect socket with fresh token
    const socket = Client(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: freshToken }
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });
    assert.ok(socket.connected);

    // 3.3 Set up listener for auth:revoked or disconnect
    const disconnectPromise = new Promise((resolve) => {
      socket.on('auth:revoked', (data) => resolve(`REVOKED: ${data.message}`));
      socket.on('disconnect', () => resolve('DISCONNECTED'));
      socket.on('connect_error', (err) => resolve(`CONNECT_ERROR: ${err.message}`));
      socket.on('error', (err) => resolve(`ERROR: ${err.message}`));
    });

    // 3.4 Logout via REST API with freshCookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: freshCookie }
    });
    assert.strictEqual(logoutRes.status, 200);

    // 3.5 Socket must be terminated
    const disconnectReason = await disconnectPromise;
    assert.ok(disconnectReason.includes('REVOKED') || disconnectReason === 'DISCONNECTED');
    socket.close();
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
});
