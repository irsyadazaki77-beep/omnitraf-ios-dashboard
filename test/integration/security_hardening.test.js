import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { io as Client } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../server/config/env.js';
import { ROLES } from '../../server/config/constants.js';
import { backendState } from '../../server/services/stateManager.js';
import { rateLimitStore } from '../../server/middlewares/rateLimiter.js';
import { dbManager } from '../../server/db/database.js';
import { commandExecutor } from '../../server/services/commandExecutor.js';
import { testDatabasePath } from '../helpers/testDatabasePath.js';

// Run isolated server on dynamic port (0) with test SQLite database
process.env.PORT = '0';
const testDbPath = testDatabasePath('security-hardening.sqlite');
process.env.DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const { server } = await import('../../server.js');

describe('PHASE 18 — Comprehensive Security Hardening & Trust Boundary Verification', () => {
  let baseUrl;
  let adminToken;
  let operatorToken;
  let viewerToken;

  before(async () => {
    await new Promise((resolve) => {
      if (server.listening) {
        resolve();
      } else {
        server.listen(0, '127.0.0.1', () => {
          resolve();
        });
      }
    });

    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Obtain tokens
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    await adminRes.json();
    adminToken = adminRes.headers.get('set-cookie')?.match(/omnitraf_session=([^;]+)/)?.[1];

    const opRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    await opRes.json();
    operatorToken = opRes.headers.get('set-cookie')?.match(/omnitraf_session=([^;]+)/)?.[1];

    const viewRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer123' })
    });
    await viewRes.json();
    viewerToken = viewRes.headers.get('set-cookie')?.match(/omnitraf_session=([^;]+)/)?.[1];
  });

  after(() => {
    server.close();
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch (_) {}
  });

  // 1. Missing Authentication Check
  test('1. Missing Authentication: Privileged mutation returns 401 UNAUTHORIZED and does not mutate state', async () => {
    const initialIncidentsCount = backendState.state.incidents.length;

    const res = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Unauthorized Intrusion Incident',
        location: 'Jl. Tunjungan'
      })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.code, 'UNAUTHORIZED');
    assert.strictEqual(backendState.state.incidents.length, initialIncidentsCount, 'State must not mutate on 401');
  });

  // 2. Malformed JWT Check
  test('2. Malformed JWT: Rejected with 401 INVALID_TOKEN', async () => {
    const res = await fetch(`${baseUrl}/api/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer NOT_A_VALID_JWT_TOKEN.HEADER.SIGNATURE'
      },
      body: JSON.stringify({
        code: 'AMB-ATTACK-01',
        route: 'route-soetomo'
      })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'INVALID_TOKEN');
  });

  // 3. Expired JWT Check
  test('3. Expired JWT: Rejected with 401 INVALID_TOKEN', async () => {
    const expiredToken = jwt.sign(
      { id: 'usr-admin-01', username: 'admin', role: ROLES.ADMIN, name: 'Admin Expired' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: -10, issuer: 'omnitraf-sits-surabaya', audience: 'omnitraf-api', subject: 'usr-admin-01' }
    );

    const res = await fetch(`${baseUrl}/api/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expiredToken}`
      },
      body: JSON.stringify({
        code: 'AMB-EXPIRED-01',
        route: 'route-soetomo'
      })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'INVALID_TOKEN');
  });

  // 4. Wrong Signature / Secret Forgery Check
  test('4. Wrong Signature / Secret Forgery: Token signed with different key rejected with 401', async () => {
    const forgedToken = jwt.sign(
      { id: 'usr-admin-01', username: 'admin', role: ROLES.ADMIN, name: 'Forged Superadmin' },
      'attacker-custom-fake-jwt-secret-key-666',
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const res = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${forgedToken}`
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        resolution: '1080p',
        fps: 30
      })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'INVALID_TOKEN');
  });

  test('Invalid issuer JWT and query-token credentials are rejected without invoking command execution', async () => {
    const invalidIssuer = jwt.sign({ id: 'usr-admin-01', username: 'admin', role: ROLES.ADMIN, name: 'Forged' }, JWT_SECRET, {
      algorithm: 'HS256', expiresIn: '1h', issuer: 'attacker.invalid', audience: 'omnitraf-api', subject: 'usr-admin-01'
    });
    const beforeSequence = backendState.sequence;
    const beforeAudit = backendState.auditLogs.length;
    let commandCalls = 0;
    const originalExecute = commandExecutor.executeCommand;
    commandExecutor.executeCommand = async (...args) => { commandCalls++; return originalExecute.apply(commandExecutor, args); };
    try {
      const issuerRes = await fetch(`${baseUrl}/api/devices/ping?deviceId=NODE-EDGE-01`, {
        headers: { Authorization: `Bearer ${invalidIssuer}` }
      });
      assert.equal(issuerRes.status, 401);
      const queryRes = await fetch(`${baseUrl}/api/devices/ping?deviceId=NODE-EDGE-01&token=${encodeURIComponent(adminToken)}`);
      assert.equal(queryRes.status, 401);
      assert.equal(commandCalls, 0);
      assert.equal(backendState.sequence, beforeSequence);
      assert.equal(backendState.auditLogs.length, beforeAudit);
    } finally {
      commandExecutor.executeCommand = originalExecute;
    }

    const querySocket = Client(baseUrl, {
      transports: ['websocket'], forceNew: true,
      query: { token: adminToken }
    });
    const socketError = await new Promise(resolve => querySocket.once('connect_error', resolve));
    assert.match(socketError.message, /AUTHENTICATION_REQUIRED/);
    querySocket.disconnect();
  });

  test('JWT audience and algorithm must match canonical settings', async () => {
    const claims = { id: 'usr-admin-01', username: 'admin', role: ROLES.ADMIN, name: 'Forged Admin' };
    const wrongAudience = jwt.sign(claims, JWT_SECRET, {
      algorithm: 'HS256', expiresIn: '1h', issuer: 'omnitraf-sits-surabaya', audience: 'other-api', subject: claims.id
    });
    const wrongAlgorithm = jwt.sign(claims, JWT_SECRET, {
      algorithm: 'HS512', expiresIn: '1h', issuer: 'omnitraf-sits-surabaya', audience: 'omnitraf-api', subject: claims.id
    });
    for (const token of [wrongAudience, wrongAlgorithm]) {
      const response = await fetch(`${baseUrl}/api/devices/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deviceId: 'NODE-EDGE-01', fps: 31 })
      });
      assert.equal(response.status, 401);
    }
  });

  // 5. Wrong Role / Insufficient Privileges Check
  test('5. Wrong Role: Viewer role attempting Admin operation rejected with 403 FORBIDDEN without mutation', async () => {
    const res = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${viewerToken}`
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        fps: 60
      })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN');
    assert.strictEqual(body.details.currentRole, 'VIEWER');
  });

  test('Sensitive read and anonymous ping policies reject before state, persistence, audit, event, or command side effects', async () => {
    const socket = Client(baseUrl, { transports: ['websocket'], forceNew: true, auth: { token: viewerToken } });
    await new Promise(resolve => socket.once('connect', resolve));
    let commandAckEvents = 0;
    let auditEvents = 0;
    let signalEvents = 0;
    socket.on('command:ack', () => commandAckEvents++);
    socket.on('audit:log', () => auditEvents++);
    socket.on('signal:update', () => signalEvents++);

    const before = {
      sequence: backendState.sequence,
      auditLength: backendState.auditLogs.length,
      device: JSON.stringify(backendState.devicesRegistry.find(item => item.deviceId === 'NODE-EDGE-01'))
    };
    const originalExecute = commandExecutor.executeCommand;
    const originalPersist = dbManager.upsertSignalConfig;
    let commandCalls = 0;
    let persistenceCalls = 0;
    commandExecutor.executeCommand = async (...args) => { commandCalls++; return originalExecute.apply(commandExecutor, args); };
    dbManager.upsertSignalConfig = (...args) => { persistenceCalls++; return originalPersist.apply(dbManager, args); };
    try {
      const anonymousPing = await fetch(`${baseUrl}/api/devices/ping?deviceId=NODE-EDGE-01`);
      const anonymousAudit = await fetch(`${baseUrl}/api/audit-logs`);
      const viewerAudit = await fetch(`${baseUrl}/api/audit-logs`, { headers: { Cookie: `omnitraf_session=${viewerToken}` } });
      const anonymousDiagnostics = await fetch(`${baseUrl}/api/diagnostics/health`);
      const viewerDiagnostics = await fetch(`${baseUrl}/api/diagnostics/snapshot`, { headers: { Cookie: `omnitraf_session=${viewerToken}` } });
      const anonymousDeviceAudit = await fetch(`${baseUrl}/api/devices/audit`);

      assert.equal(anonymousPing.status, 401);
      assert.equal(anonymousAudit.status, 401);
      assert.equal(viewerAudit.status, 403);
      assert.equal(anonymousDiagnostics.status, 401);
      assert.equal(viewerDiagnostics.status, 403);
      assert.equal(anonymousDeviceAudit.status, 401);
      assert.equal(commandCalls, 0);
      assert.equal(persistenceCalls, 0);
      assert.equal(backendState.sequence, before.sequence);
      assert.equal(backendState.auditLogs.length, before.auditLength);
      assert.equal(JSON.stringify(backendState.devicesRegistry.find(item => item.deviceId === 'NODE-EDGE-01')), before.device);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(commandAckEvents, 0);
      assert.equal(auditEvents, 0);
      assert.equal(signalEvents, 0);
    } finally {
      commandExecutor.executeCommand = originalExecute;
      dbManager.upsertSignalConfig = originalPersist;
      socket.disconnect();
    }
  });

  // 6. Forged Actor / Identity in Payload Check
  test('6. Forged Actor Payload: Server derives identity strictly from principal token, ignoring forged body field', async () => {
    const res = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${operatorToken}`
      },
      body: JSON.stringify({
        title: 'Macet Uji Keamanan',
        location: 'Jl. Pemuda',
        source: 'FORGED_GUEST_HACKER',
        assignedUnit: 'Dishub 01',
        role: 'ADMIN',
        userId: 'usr-admin-01',
        actor: { id: 'usr-admin-01', name: 'Forged Admin', role: 'ADMIN' }
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    // Server must ignore source: 'FORGED_GUEST_HACKER' and authoritatively bind to Operator name
    assert.ok(body.data.source.includes('Operator') || body.data.source.includes('Zaki'), 'Source must derive from authenticated principal');
    assert.strictEqual(body.data.source.includes('FORGED_GUEST_HACKER'), false);
  });

  // 7. Sensitive Files Static Serving Protection Check
  test('7. Production static allowlist serves dist with safe cache headers', async () => {
    const appRes = await fetch(`${baseUrl}/`);
    assert.strictEqual(appRes.status, 200);
    assert.match(appRes.headers.get('cache-control') || '', /no-cache/);
    const html = await appRes.text();
    const entryPath = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    assert.ok(entryPath, 'Production HTML must reference a hashed JavaScript asset');
    const chunkRes = await fetch(`${baseUrl}${entryPath}`);
    assert.strictEqual(chunkRes.status, 200);
    assert.match(chunkRes.headers.get('cache-control') || '', /max-age=31536000, immutable/);
    assert.strictEqual((await fetch(`${baseUrl}/views/dashboardView.html`)).status, 200);
    assert.strictEqual((await fetch(`${baseUrl}/sw.js`)).status, 200);
    assert.strictEqual((await fetch(`${baseUrl}/src/app.js`)).status, 404);
  });

  test('7b. Sensitive File Exposure: .env, sqlite, package.json and server source code blocked with 403', async () => {
    const envRes = await fetch(`${baseUrl}/.env`);
    assert.strictEqual(envRes.status, 403);

    const dbRes = await fetch(`${baseUrl}/data/test_security_hardening.sqlite`);
    assert.strictEqual(dbRes.status, 403);

    const srvRes = await fetch(`${baseUrl}/server.js`);
    assert.strictEqual(srvRes.status, 403);

    const pkgRes = await fetch(`${baseUrl}/package.json`);
    assert.strictEqual(pkgRes.status, 403);
  });

  // 8. CORS Preflight & Disallowed Origin Rejection Check
  test('8. CORS Origin Enforcement: Unauthorized origin rejected on preflight OPTIONS', async () => {
    const res = await fetch(`${baseUrl}/api/state/snapshot`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://malicious-traffic-spoofing-site.xyz',
        'Access-Control-Request-Method': 'POST'
      }
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'CORS_ORIGIN_REJECTED');
  });

  // 9. Security Headers Verification Check
  test('9. Security Headers: nosniff, frame protection, referrer policy, and strict CSP present', async () => {
    const res = await fetch(`${baseUrl}/api/state/snapshot`, { headers: { Cookie: `omnitraf_session=${viewerToken}` } });
    assert.strictEqual(res.status, 200);

    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.ok(res.headers.get('content-security-policy'), 'CSP header must be present');
    assert.ok(res.headers.get('content-security-policy').includes("default-src 'self'"));
  });

  // 10. Rate Limiting Multi-Tier Verification Check
  test('10. Tiered Rate Limiting: Authentication endpoint blocks excess attempts with 429', async () => {
    const testIp = '10.99.88.77';
    const key = `auth-login:${testIp}`;

    rateLimitStore.set(key, {
      count: 25,
      resetTime: Date.now() + 60000
    });

    try {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': testIp
        },
        body: JSON.stringify({ username: 'operator', password: 'wrongpassword' })
      });

      assert.strictEqual(res.status, 429);
      const body = await res.json();
      assert.strictEqual(body.code, 'TOO_MANY_REQUESTS');
      assert.ok(res.headers.get('retry-after'), 'Must include Retry-After header');
    } finally {
      rateLimitStore.delete(key);
    }
  });

  // 11. Idempotency Key Collision with Different Payload Check
  test('11. Idempotency Key Collision: Reusing key for different action or payload is rejected deterministically', async () => {
    const collisionKey = `IDEMP-SEC-COLLISION-${Date.now()}`;

    // First command: device config
    const res1 = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${adminToken}`,
        'X-Idempotency-Key': collisionKey
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        fps: 25,
        idempotencyKey: collisionKey
      })
    });
    assert.strictEqual(res1.status, 200);

    // Second command: same key used for different device ID -> rejected with 500 PERSISTENCE_FAILED or collision error
    const res2 = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${adminToken}`,
        'X-Idempotency-Key': collisionKey
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-02', // Different target!
        fps: 25,
        idempotencyKey: collisionKey
      })
    });
    assert.strictEqual(res2.status, 409);
    const body2 = await res2.json();
    assert.strictEqual(body2.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  // 12. Socket.io Handshake Authentication & RBAC Verification Check
  test('12. Socket.io Trust Boundary: Anonymous socket cannot perform privileged operator:command mutations', async () => {
    const socket = Client(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {}
    });
    const beforeSequence = backendState.sequence;
    const beforeAudit = backendState.auditLogs.length;
    const socketError = await new Promise(resolve => socket.once('connect_error', resolve));
    assert.match(socketError.message, /AUTHENTICATION_REQUIRED/);
    assert.equal(backendState.sequence, beforeSequence);
    assert.equal(backendState.auditLogs.length, beforeAudit);
    socket.disconnect();
  });

  // 13. Socket.io vs REST RBAC Parity Check
  test('13. Parity: REST and Socket.io both reject Viewer from signal:override identically', async () => {
    // 1. Socket rejection
    const socket = Client(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: viewerToken }
    });
    await new Promise((resolve) => socket.on('connect', resolve));

    const originalPersist = dbManager.upsertSignalConfig;
    try {
      const beforeSequence = backendState.sequence;
      const beforeAudit = backendState.auditLogs.length;
      let persistCalls = 0;
      dbManager.upsertSignalConfig = (...args) => { persistCalls++; return originalPersist.apply(dbManager, args); };
      let ackEvents = 0;
      let auditEvents = 0;
      socket.on('command:ack', () => ackEvents++);
      socket.on('audit:log', () => auditEvents++);
      const sockAck = await new Promise((resolve) => {
        socket.emit('signal:override', {
          intersectionId: 'node-wonokromo',
          duration: 30,
          role: 'ADMIN',
          userId: 'usr-admin-01',
          actor: { id: 'usr-admin-01', role: 'ADMIN', name: 'Forged Admin' }
        }, resolve);
      });
      assert.strictEqual(sockAck.success, false);
      assert.strictEqual(sockAck.code, 'FORBIDDEN');
      assert.equal(backendState.sequence, beforeSequence);
      assert.equal(backendState.auditLogs.length, beforeAudit);
      assert.equal(persistCalls, 0);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(ackEvents, 0);
      assert.equal(auditEvents, 0);
      dbManager.upsertSignalConfig = originalPersist;
    } finally {
      if (dbManager.upsertSignalConfig !== originalPersist) dbManager.upsertSignalConfig = originalPersist;
      socket.disconnect();
    }
  });

  // 14. Input Bounds & Oversized String Injection Prevention Check
  test('14. Input Bounds: Oversized title or illegal duration rejected before business logic runs', async () => {
    // Huge title payload
    const hugeTitle = 'A'.repeat(500);
    const res = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${operatorToken}`
      },
      body: JSON.stringify({
        title: hugeTitle,
        location: 'Jl. Darmo'
      })
    });

    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.code, 'INVALID_COMMAND');
  });

  // 15. SSE Access Control & Keep-Alive Header Integrity Check
  test('15. SSE Stream: Valid headers, chunked streaming, and keep-alive ping', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/stream-traffic`, {
      headers: { Cookie: `omnitraf_session=${viewerToken}` },
      signal: controller.signal
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.strictEqual(res.headers.get('cache-control'), 'no-cache, no-transform, no-store');

    // Read first chunk
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes('event: telemetry'));
    assert.ok(text.includes('traffic_stream'));

    controller.abort();
  });

  // 16. HttpOnly Cookie Authentication & Logout Session Lifecycle
  test('16. Cookie Auth & Session Logout: Sets HttpOnly cookie, authenticates requests, and clears cookie on logout', async () => {
    // 16a. Login returns Set-Cookie header
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    assert.strictEqual(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(cookieHeader, 'Set-Cookie header must be present on login');
    assert.ok(cookieHeader.includes('omnitraf_session='), 'Cookie must contain omnitraf_session token');
    assert.ok(cookieHeader.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');

    const sessionCookie = cookieHeader.split(';')[0];

    // 16b. Request with cookie succeeds without Bearer header
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': sessionCookie }
    });
    assert.strictEqual(meRes.status, 200);
    const meBody = await meRes.json();
    assert.strictEqual(meBody.data.user.username, 'operator');

    // 16c. Logout endpoint clears cookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie }
    });
    assert.strictEqual(logoutRes.status, 200);
    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert.ok(logoutCookie, 'Set-Cookie header must be present on logout');
    assert.ok(logoutCookie.includes('omnitraf_session=;'), 'Session cookie must be cleared on logout');
  });

  // 17. Path Traversal & Double-Encoding Protection
  test('17. Path Traversal Defense: Encoded and double-encoded traversal sequences are rejected with 403', async () => {
    // Simple traversal attempt
    const res1 = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.ok([400, 403].includes(res1.status), 'Path traversal must be rejected');

    // Double-encoded traversal attempt (%252e%252e%252f)
    const res2 = await fetch(`${baseUrl}/%252e%252e%252fpackage.json`);
    assert.ok([400, 403].includes(res2.status), 'Double-encoded traversal must be rejected');

    // Nested internal server file access
    const res3 = await fetch(`${baseUrl}/server/config/constants.js`);
    assert.strictEqual(res3.status, 403);
  });

  // 18. Audit Trail Log Injection Defense
  test('18. Log Injection Defense: Control characters and newlines are sanitized in audit trails', async () => {
    const maliciousIncident = {
      title: 'Valid Title\r\nINJECTED_LOG_ENTRY: ADMIN GRANTED\r\n',
      location: 'Jl. Pemuda'
    };

    const res = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${operatorToken}`
      },
      body: JSON.stringify(maliciousIncident)
    });

    assert.strictEqual(res.status, 201);
    const created = (await res.json()).data;
    assert.ok(!created.title.includes('\r'), 'Carriage return must be stripped');
    assert.ok(!created.title.includes('\n'), 'Newline must be stripped');
  });
});
