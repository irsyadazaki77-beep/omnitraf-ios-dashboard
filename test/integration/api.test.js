import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { rateLimitStore } from '../../server/middlewares/rateLimiter.js';
import { testDatabasePath } from '../helpers/testDatabasePath.js';

// Setup environment variables before importing the server to listen on a random free port (0)
process.env.PORT = '0';
process.env.DB_PATH = testDatabasePath('api.sqlite');

// Dynamically import server to ensure process.env.PORT is respected
const { server } = await import('../../server.js');

describe('REST API Integration Tests', () => {
  let baseUrl;
  let viewerCookie;
  let operatorCookie;
  const sessionCookie = (response) => response.headers.get('set-cookie')?.split(';', 1)[0];

  before(async () => {
    // Wait for the server to be listening
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
    const login = async username => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: `${username}123` })
      });
      return sessionCookie(response);
    };
    [viewerCookie, operatorCookie] = await Promise.all(['viewer', 'operator'].map(login));
  });

  after(() => {
    // Close the server to allow the test run to exit cleanly
    server.close();
    try {
      if (fs.existsSync(process.env.DB_PATH)) {
        fs.unlinkSync(process.env.DB_PATH);
      }
    } catch (_) {}
  });

  test('GET /api/state/snapshot should return correct JSON schema and status code 200', async () => {
    const res = await fetch(`${baseUrl}/api/state/snapshot`, { headers: { Cookie: viewerCookie } });
    assert.strictEqual(res.status, 200);

    const contentType = res.headers.get('content-type');
    assert.ok(contentType && contentType.includes('application/json'));

    const data = await res.json();
    
    // Validate top-level schema contract
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, 'success');
    assert.strictEqual(data.source, 'server');
    assert.ok(typeof data.seq === 'number' || data.seq === null || data.seq === undefined);
    assert.ok(typeof data.timestamp === 'number' || typeof data.timestamp === 'string');
    assert.ok(data.state && typeof data.state === 'object');
  });

  test('Rate Limiter should return status 429 when client exceeds the requests threshold', async () => {
    const testIp = '12.34.56.78';
    const rateLimitKey = `api-global:${testIp}`;

    // Force the rate limit count to exceed the maximum threshold (limit is 200)
    rateLimitStore.set(rateLimitKey, {
      count: 201,
      resetTime: Date.now() + 15000
    });

    try {
      // Send a request masquerading as the target IP
      const res = await fetch(`${baseUrl}/api/state/snapshot`, {
        headers: {
          'x-forwarded-for': testIp
        }
      });

      assert.strictEqual(res.status, 429);

      const contentType = res.headers.get('content-type');
      assert.ok(contentType && contentType.includes('application/json'));

      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 'TOO_MANY_REQUESTS');
      assert.strictEqual(data.type, 'rate_limit_exceeded');
      assert.strictEqual(data.retryable, true);
      assert.ok(data.details && typeof data.details.cooldownMs === 'number');
    } finally {
      // Cleanup the rate limiter state for the test IP
      rateLimitStore.delete(rateLimitKey);
    }
  });

  test('GET /healthz and GET /ready should return proper health statuses', async () => {
    const resHealthz = await fetch(`${baseUrl}/healthz`);
    assert.strictEqual(resHealthz.status, 200);
    const healthzData = await resHealthz.json();
    assert.strictEqual(healthzData.success, true);
    assert.strictEqual(healthzData.status, 'OK');
    assert.equal(healthzData.pid, undefined);

    const resReady = await fetch(`${baseUrl}/ready`, { headers: { Cookie: operatorCookie } });
    assert.strictEqual(resReady.status, 200);
    const readyData = await resReady.json();
    assert.strictEqual(readyData.success, true);
    assert.strictEqual(readyData.status, 'READY');
    assert.strictEqual(readyData.components.database, 'CONNECTED');
  });

  test('Auth & RBAC contract validation: login, role checks, and error responses', async () => {
    // 1. Missing credentials -> 400 VALIDATION_ERROR
    const resBad = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(resBad.status, 400);
    const badData = await resBad.json();
    assert.strictEqual(badData.success, false);
    assert.strictEqual(badData.error.code, 'VALIDATION_ERROR');

    // 2. Login Operator
    const resOp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    assert.strictEqual(resOp.status, 200);
    const opData = await resOp.json();
    assert.strictEqual(opData.success, true);
    assert.equal(opData.token, undefined);
    assert.strictEqual(opData.user.role, 'OPERATOR');
    const operatorSession = sessionCookie(resOp);
    assert.match(resOp.headers.get('set-cookie') || '', /HttpOnly/i);

    // 3. Login Admin
    const resAdmin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.strictEqual(resAdmin.status, 200);
    const adminData = await resAdmin.json();
    assert.strictEqual(adminData.success, true);
    const adminSession = sessionCookie(resAdmin);

    // 4. GET /api/auth/me without token -> 401
    const resNoAuth = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(resNoAuth.status, 401);
    const noAuthData = await resNoAuth.json();
    assert.strictEqual(noAuthData.success, false);
    assert.strictEqual(noAuthData.error.code, 'UNAUTHORIZED');

    // 5. GET /api/auth/me with the HttpOnly session cookie -> 200
    const resWithAuth = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: operatorSession }
    });
    assert.strictEqual(resWithAuth.status, 200);
    const meData = await resWithAuth.json();
    assert.strictEqual(meData.success, true);
    assert.strictEqual(meData.data.user.username, 'operator');

    // 6. Role check: Operator attempting ADMIN-only endpoint -> 403 FORBIDDEN
    const resForbidden = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: operatorSession
      },
      body: JSON.stringify({ deviceId: 'NODE-EDGE-01', fps: 30 })
    });
    assert.strictEqual(resForbidden.status, 403);
    const forbiddenData = await resForbidden.json();
    assert.strictEqual(forbiddenData.success, false);
    assert.strictEqual(forbiddenData.error.code, 'FORBIDDEN');

    // 7. Validation check: Admin with invalid FPS parameter -> 422 UNPROCESSABLE_ENTITY
    const resInvalidFps = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({ deviceId: 'NODE-EDGE-01', fps: 999 })
    });
    assert.strictEqual(resInvalidFps.status, 422);
    const invalidFpsData = await resInvalidFps.json();
    assert.strictEqual(invalidFpsData.success, false);
    assert.strictEqual(invalidFpsData.error.code, 'INVALID_COMMAND');

    // 8. Admin with valid config -> 200
    const resValidConfig = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({ deviceId: 'NODE-EDGE-01', fps: 30, resolution: '1080p' })
    });
    assert.strictEqual(resValidConfig.status, 200);
    const validConfigData = await resValidConfig.json();
    assert.strictEqual(validConfigData.success, true);
    assert.strictEqual(validConfigData.data.status, 'APPLIED');
  });

  test('PDF report download endpoint should produce valid application/pdf', async () => {
    const res = await fetch(`${baseUrl}/api/reports/download`, { headers: { Cookie: operatorCookie } });
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.ok(contentType && contentType.includes('application/pdf'));
    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition && disposition.includes('attachment; filename='));

    const arrayBuffer = await res.arrayBuffer();
    assert.ok(arrayBuffer.byteLength > 1000);
  });

  test('Forecast API should validate hour parameter and return structured metadata', async () => {
    // 1. Invalid hour string -> canonical 422 contract error
    const headers = { Cookie: viewerCookie };
    const resInvalid = await fetch(`${baseUrl}/api/prediction/v1/forecast?hour=invalid_input`, { headers });
    assert.strictEqual(resInvalid.status, 422);
    const invalidData = await resInvalid.json();
    assert.strictEqual(invalidData.success, false);
    assert.strictEqual(invalidData.error.code, 'INVALID_COMMAND');

    // 2. Valid hour -> 200 with scenario comparison and metadata
    const resValid = await fetch(`${baseUrl}/api/prediction/v1/forecast?hour=17.5`, { headers });
    assert.strictEqual(resValid.status, 200);
    const forecastData = await resValid.json();
    assert.strictEqual(forecastData.success, true);
    assert.ok(forecastData.scenarioComparison);
    assert.ok(forecastData.metadata);
    assert.strictEqual(forecastData.metadata.requestedHour, 17.5);
  });

  test('Incident lifecycle contract: create, status update, conflict guard, and resolve aliases', async () => {
    // Login as operator
    const resOp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    const opCookie = sessionCookie(resOp);

    // 1. Missing canonical fields -> 422 INVALID_COMMAND
    const resBad = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(resBad.status, 422);
    assert.strictEqual((await resBad.json()).error.code, 'INVALID_COMMAND');

    // 2. Invalid category -> 422 UNPROCESSABLE_ENTITY
    const resInvalidCat = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({
        title: 'Macet Jemursari',
        location: 'Jl. Jemursari Indah',
        category: 'invalid_category_xyz'
      })
    });
    assert.strictEqual(resInvalidCat.status, 422);

    // 3. Valid creation -> 201
    const testIncId = `INC-TEST-${Date.now()}`;
    const resCreate = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({
        id: testIncId,
        title: 'Hambatan Simpang Darmo',
        location: 'Jl. Raya Darmo',
        category: 'congestion',
        severity: 'high'
      })
    });
    assert.strictEqual(resCreate.status, 201);
    const createdData = await resCreate.json();
    assert.strictEqual(createdData.success, true);
    assert.strictEqual(createdData.data.id, testIncId);
    assert.strictEqual(createdData.data.status, 'ACTIVE');

    // 4. Update status to DISPATCHED -> 200
    const resUpdate = await fetch(`${baseUrl}/api/incidents/${testIncId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({
        status: 'DISPATCHED',
        assignedUnit: 'Patroli Dishub 03',
        notes: 'Petugas sedang meluncur ke lokasi.'
      })
    });
    assert.strictEqual(resUpdate.status, 200);
    const updatedData = await resUpdate.json();
    assert.strictEqual(updatedData.success, true);
    assert.strictEqual(updatedData.data.status, 'DISPATCHED');

    // 5. Resolve incident via PATCH alias -> 200
    const resResolve = await fetch(`${baseUrl}/api/incidents/${testIncId}/resolve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      }
    });
    assert.strictEqual(resResolve.status, 200);
    const resolveData = await resResolve.json();
    assert.strictEqual(resolveData.success, true);
    assert.strictEqual(resolveData.data.status, 'RESOLVED');

    // 6. Conflict Guard: Attempting to reactivate a RESOLVED incident -> 409 STATE_CONFLICT
    const resConflict = await fetch(`${baseUrl}/api/incidents/${testIncId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({
        status: 'ACTIVE'
      })
    });
    assert.strictEqual(resConflict.status, 409);
    const conflictData = await resConflict.json();
    assert.strictEqual(conflictData.error.code, 'STATE_CONFLICT');
  });

  test('Emergency Priority contract: activate, validation, and cancellation', async () => {
    const resOp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    const opCookie = sessionCookie(resOp);

    // 1. Invalid emergency route -> 422
    const resInvalidRoute = await fetch(`${baseUrl}/api/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({
        code: 'AMB-TEST-01',
        route: 'route-nonexistent-nowhere'
      })
    });
    assert.strictEqual(resInvalidRoute.status, 422);

    // 2. Valid emergency activation -> 201
    const resActivate = await fetch(`${baseUrl}/api/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opCookie
      },
      body: JSON.stringify({
        code: 'AMB-TEST-99',
        route: 'route-soetomo'
      })
    });
    assert.strictEqual(resActivate.status, 201);
    const actData = await resActivate.json();
    assert.strictEqual(actData.success, true);
    assert.strictEqual(actData.data.vehicleId, 'AMB-TEST-99');

    // 3. Cancel emergency -> 200
    const resCancel = await fetch(`${baseUrl}/api/emergencies/AMB-TEST-99`, {
      method: 'DELETE',
      headers: {
        Cookie: opCookie
      }
    });
    assert.strictEqual(resCancel.status, 200);
    const cancelData = await resCancel.json();
    assert.strictEqual(cancelData.success, true);
    assert.strictEqual(cancelData.data.status, 'CANCELLED');
  });

  test('Device Ping, Fault Injection and Audit Trail contract', async () => {
    // 1. Ping device -> 200 with latencyMs and actionId
    const resPing = await fetch(`${baseUrl}/api/devices/ping?deviceId=NODE-EDGE-01`, { headers: { Cookie: operatorCookie } });
    assert.strictEqual(resPing.status, 200);
    const pingData = await resPing.json();
    assert.strictEqual(pingData.success, true);
    assert.strictEqual(pingData.data.deviceId, 'NODE-EDGE-01');
    assert.ok(typeof pingData.data.latencyMs === 'number');

    // 2. Fetch device audit trail -> 200 with list
    const resAudit = await fetch(`${baseUrl}/api/devices/audit?deviceId=NODE-EDGE-01`, { headers: { Cookie: operatorCookie } });
    assert.strictEqual(resAudit.status, 200);
    const auditData = await resAudit.json();
    assert.strictEqual(auditData.success, true);
    assert.ok(Array.isArray(auditData.data));

    // 3. Fault injection requires ADMIN
    const resAdmin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const adminSession = sessionCookie(resAdmin);

    // Invalid fault type -> 422
    const resBadFault = await fetch(`${baseUrl}/api/devices/fault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        type: 'exploding_hardware'
      })
    });
    assert.strictEqual(resBadFault.status, 422);

    // Valid fault type -> 200
    const resFault = await fetch(`${baseUrl}/api/devices/fault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        type: 'latency_spike'
      })
    });
    assert.strictEqual(resFault.status, 200);
    const faultData = await resFault.json();
    assert.strictEqual(faultData.success, true);
    assert.strictEqual(faultData.data.faultType, 'latency_spike');

    // Recovery -> 200
    const resRecover = await fetch(`${baseUrl}/api/devices/fault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        type: 'recover'
      })
    });
    assert.strictEqual(resRecover.status, 200);
  });

  test('Terminal Execution contract: auth, allowlist enforcement & execution output', async () => {
    // 1. Without token -> 401
    const resNoToken = await fetch(`${baseUrl}/api/terminal/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '/status' })
    });
    assert.strictEqual(resNoToken.status, 401);

    // 2. Login as admin
    const resAdmin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const adminSession = sessionCookie(resAdmin);

    // 3. Rejected command -> 422
    const resReject = await fetch(`${baseUrl}/api/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({ command: 'rm -rf /' })
    });
    assert.strictEqual(resReject.status, 422);
    const rejectData = await resReject.json();
    assert.strictEqual(rejectData.success, false);
    assert.strictEqual(rejectData.error.code, 'COMMAND_NOT_PERMITTED');

    // 4. Allowed command -> 200
    const resValidCmd = await fetch(`${baseUrl}/api/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminSession
      },
      body: JSON.stringify({ command: '/status' })
    });
    assert.strictEqual(resValidCmd.status, 200);
    const cmdData = await resValidCmd.json();
    assert.strictEqual(cmdData.success, true);
    assert.ok(Array.isArray(cmdData.data.output));
  });

  test('State snapshot & resync alias consistency', async () => {
    const authHeaders = { Cookie: viewerCookie };
    const resSnapshot = await fetch(`${baseUrl}/api/state/snapshot`, { headers: authHeaders });
    assert.strictEqual(resSnapshot.status, 200);
    const snapData = await resSnapshot.json();

    const resResync = await fetch(`${baseUrl}/api/state/resync`, { headers: authHeaders });
    assert.strictEqual(resResync.status, 200);
    const resyncData = await resResync.json();

    assert.strictEqual(snapData.type, resyncData.type);
    assert.strictEqual(snapData.success, resyncData.success);
    assert.ok(resyncData.data.intersections);
  });
});
