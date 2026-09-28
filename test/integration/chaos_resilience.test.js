import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { ROLES } from '../../server/config/constants.js';
import { commandExecutor } from '../../server/services/commandExecutor.js';
import { backendState } from '../../server/services/stateManager.js';
import { dbManager } from '../../server/db/database.js';
import { diagnosticEngine, HEALTH_STATUS, SUBSYSTEMS, DIAGNOSTIC_LEVELS } from '../../server/services/diagnosticEngine.js';

// Setup environment variables before importing the server
process.env.PORT = '0';
const testDbPath = 'data/test_chaos_resilience.sqlite';
process.env.DB_PATH = testDbPath;
process.env.ENABLE_CHAOS_MODE = 'true';

const { server } = await import('../../server.js');

describe('PHASE 17 — Comprehensive Chaos & Fault Injection Resilience Matrix', () => {
  let baseUrl;
  let adminToken;
  let operatorToken;

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
    const adminData = await adminRes.json();
    adminToken = adminData.token || adminData.data?.token;

    const opRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    const opData = await opRes.json();
    operatorToken = opData.token || opData.data?.token;
  });

  after(() => {
    diagnosticEngine.clearAllFaults();
    server.close();
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch (_) {}
  });

  beforeEach(() => {
    diagnosticEngine.clearAllFaults();
  });

  // 1. Fault Injection: Deterministic Activation & Recovery Audit Trail
  test('1. Fault Injection Lifecycle: Inject fault, verify degraded health, and recover cleanly without residual state', () => {
    const fault = diagnosticEngine.injectFault({
      faultId: 'CHAOS-FLT-001',
      targetSubsystem: SUBSYSTEMS.DATABASE,
      intendedEffect: 'database_write_failure',
      durationMs: 5000,
      deterministicSeed: 101
    });

    assert.strictEqual(fault.faultId, 'CHAOS-FLT-001');
    assert.strictEqual(diagnosticEngine.isFaultActive(SUBSYSTEMS.DATABASE), true);
    assert.strictEqual(diagnosticEngine.subsystems.get(SUBSYSTEMS.DATABASE).status, HEALTH_STATUS.DEGRADED);

    // Clear fault
    const cleared = diagnosticEngine.clearFault('CHAOS-FLT-001');
    assert.strictEqual(cleared, true);
    assert.strictEqual(diagnosticEngine.isFaultActive(SUBSYSTEMS.DATABASE), false);
    assert.strictEqual(diagnosticEngine.subsystems.get(SUBSYSTEMS.DATABASE).status, HEALTH_STATUS.HEALTHY);

    // Verify audit event exists
    const recent = diagnosticEngine.events.filter(e => e.component === SUBSYSTEMS.DATABASE);
    assert.ok(recent.length >= 2, 'Must have injected and recovered events');
    const recoverEvt = recent.find(e => e.event === 'SUBSYSTEM_RECOVERED');
    assert.ok(recoverEvt, 'Must record SUBSYSTEM_RECOVERED event');
  });

  // 2. Persistence Failure during Command Execution -> Zero Committed State Mutation & Rollback
  test('2. Persistence Failure: Simulating DB write error triggers rollback and returns 500 without state mutation', async () => {
    const devId = 'NODE-EDGE-01';
    const originalDev = backendState.devicesRegistry.find(d => d.deviceId === devId);
    const originalFps = originalDev.fps;
    const originalRes = originalDev.resolution;

    // Inject DB write rejection fault
    diagnosticEngine.injectFault({
      faultId: 'CHAOS-DB-FAIL',
      targetSubsystem: SUBSYSTEMS.PERSISTENCE,
      intendedEffect: 'database_write_rejection',
      deterministicSeed: 202
    });

    // Mock dbManager.upsertDeviceTelemetry to throw error during the fault
    const originalUpsert = dbManager.upsertDeviceTelemetry;
    dbManager.upsertDeviceTelemetry = () => {
      throw new Error('CHAOS_INJECTED_SQLITE_IO_DISK_FULL');
    };

    try {
      await assert.rejects(
        async () => {
          await commandExecutor.executeCommand({
            action: 'device:config',
            targetId: devId,
            payload: { resolution: '1080p', fps: 30 },
            commandId: 'CMD-CHAOS-ROLLBACK-01',
            idempotencyKey: 'IDEMP-CHAOS-ROLLBACK-01',
            correlationId: 'CORR-CHAOS-ROLLBACK-01',
            authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
          });
        },
        /CHAOS_INJECTED_SQLITE_IO_DISK_FULL/
      );

      // Verify zero committed state mutation (in-memory state rolled back to original)
      const devAfter = backendState.devicesRegistry.find(d => d.deviceId === devId);
      assert.strictEqual(devAfter.resolution, originalRes, 'Resolution must remain unchanged');
      assert.strictEqual(devAfter.fps, originalFps, 'FPS must remain unchanged');
    } finally {
      dbManager.upsertDeviceTelemetry = originalUpsert;
      diagnosticEngine.clearFault('CHAOS-DB-FAIL');
    }
  });

  // 3. Command Idempotency & Replay: Duplicate command returns exact cached response
  test('3. Duplicate Command Retry: Second attempt with identical idempotencyKey yields isIdempotentReplay and same correlationId', async () => {
    const idempKey = `IDEMP-CHAOS-${Date.now()}`;
    const cmdId = `CMD-CHAOS-IDEMP-${Date.now()}`;
    const corrId = `CORR-CHAOS-IDEMP-${Date.now()}`;

    // First execution
    const res1 = await commandExecutor.executeCommand({
      action: 'signal:override',
      targetId: 'node-wonokromo',
      payload: { duration: 40 },
      commandId: cmdId,
      idempotencyKey: idempKey,
      correlationId: corrId,
      authenticatedUser: { id: 'usr-op', name: 'Operator Budi', role: ROLES.OPERATOR }
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.status, 'SERVER_APPLIED');

    const signalSeq1 = backendState.signalSequence;

    // Retry with duplicate command
    const res2 = await commandExecutor.executeCommand({
      action: 'signal:override',
      targetId: 'node-wonokromo',
      payload: { duration: 40 },
      commandId: `CMD-CHAOS-RETRY-${Date.now()}`,
      idempotencyKey: idempKey,
      correlationId: corrId,
      authenticatedUser: { id: 'usr-op', name: 'Operator Budi', role: ROLES.OPERATOR }
    });

    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.isIdempotentReplay, true, 'Must identify as idempotent duplicate');
    assert.strictEqual(backendState.signalSequence, signalSeq1, 'Sequence must not increment on duplicate');
    assert.strictEqual(res2.commandId, cmdId, 'Must return original commandId from cache');
  });

  // 4. Stale State / Sequence Ordering Rejection in StateStore Validation
  test('4. Realtime Ordering: Out-of-order and stale sequence packets are rejected by validateAndTrackSequence', async () => {
    const { validateAndTrackSequence, updateTrafficState, stateStore } = await import('../../src/core/stateStore.js');

    // Baseline sequence
    const baselineSeq = stateStore.getState().lastReceivedSequence;

    // Valid forward packet applied via updateTrafficState
    const validPacket = {
      seq: baselineSeq + 1,
      timestamp: Date.now(),
      source: 'server',
      telemetry: { networkLoad: 50 }
    };
    updateTrafficState(validPacket, 'server');
    assert.strictEqual(stateStore.getState().lastReceivedSequence, baselineSeq + 1);

    // Duplicate packet (same seq) must be dropped
    const duplicatePacket = {
      seq: baselineSeq + 1,
      timestamp: Date.now(),
      source: 'server',
      telemetry: { networkLoad: 75 }
    };
    const dupResult = validateAndTrackSequence(duplicatePacket, 'server', 'traffic');
    assert.strictEqual(dupResult, false, 'Duplicate packet must be dropped');

    // Out-of-order older packet (seq < currentSeq) must be dropped
    const olderPacket = {
      seq: baselineSeq,
      timestamp: Date.now(),
      source: 'server',
      telemetry: { networkLoad: 90 }
    };
    const olderResult = validateAndTrackSequence(olderPacket, 'server', 'traffic');
    assert.strictEqual(olderResult, false, 'Older sequence must be dropped');
  });

  // 5. Emergency Conflict under Degraded State: Strict 409 State Conflict
  test('5. State Machine Conflict: Prohibits incident resolution while emergency is active', async () => {
    const emgId = `EMG-CHAOS-ACT-${Date.now()}`;
    const incId = `INC-CHAOS-RES-${Date.now()}`;

    // Add active emergency
    backendState.state.activeEmergencies.unshift({
      id: emgId,
      vehicleId: 'AMB-CHAOS-01',
      vehicleType: 'Ambulance',
      status: 'EN_ROUTE',
      routeId: 'route-soetomo'
    });

    // Add incident linked to active emergency
    backendState.state.incidents.unshift({
      id: incId,
      title: 'Kecelakaan Beruntun',
      status: 'DISPATCHED',
      associatedEmergencyId: emgId
    });

    // Attempting resolution via API must return HTTP 409
    const res = await fetch(`${baseUrl}/api/incidents/${incId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorToken}`
      },
      body: JSON.stringify({ status: 'RESOLVED' })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.code, 'STATE_CONFLICT');
    assert.ok(body.message.includes('armada tanggap darurat'));

    // Clean up
    backendState.state.activeEmergencies = backendState.state.activeEmergencies.filter(e => e.id !== emgId);
  });

  // 6. Sanitized Diagnostic Snapshot & Health Aggregation API
  test('6. Observability Endpoints: GET /api/diagnostics/health and /api/diagnostics/snapshot return sanitized, structured data', async () => {
    // Check health endpoint
    const healthRes = await fetch(`${baseUrl}/api/diagnostics/health`);
    assert.strictEqual(healthRes.status, 200);
    const health = await healthRes.json();
    assert.strictEqual(health.success, true);
    assert.ok(health.data.subsystems.database, 'Database health check must be present');
    assert.strictEqual(health.data.subsystems.database.status, HEALTH_STATUS.HEALTHY);

    // Check snapshot endpoint
    const snapRes = await fetch(`${baseUrl}/api/diagnostics/snapshot`);
    assert.strictEqual(snapRes.status, 200);
    const snap = await snapRes.json();
    assert.strictEqual(snap.success, true);
    assert.ok(snap.data.subsystems, 'Subsystems map must exist');
    assert.ok(snap.data.metrics, 'Metrics object must exist');
    assert.ok(Array.isArray(snap.data.recentEvents), 'recentEvents must be an array');

    // Assert NO leaked secrets in snapshot
    const snapStr = JSON.stringify(snap);
    assert.strictEqual(snapStr.includes('admin123'), false, 'Password must not be in snapshot');
    assert.strictEqual(snapStr.includes(adminToken), false, 'JWT token must not be in snapshot');
  });

  // 7. Deterministic Chaos API: Inject & Clear Chaos Fault via API (RBAC Guarded)
  test('7. Chaos API Guard: Operator role cannot inject faults, Admin role can inject & clear', async () => {
    // 1. Operator attempts to inject fault -> 403 Forbidden
    const opRes = await fetch(`${baseUrl}/api/diagnostics/chaos/faults/inject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorToken}`
      },
      body: JSON.stringify({
        faultId: 'FLT-OP-DENIED',
        targetSubsystem: 'socket',
        intendedEffect: 'delayed_ack'
      })
    });
    assert.strictEqual(opRes.status, 403, 'Operator must be forbidden from injecting faults');

    // 2. Admin injects fault -> 201 Created
    const adminRes = await fetch(`${baseUrl}/api/diagnostics/chaos/faults/inject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faultId: 'FLT-ADMIN-ALLOWED',
        targetSubsystem: 'socket',
        intendedEffect: 'delayed_ack',
        durationMs: 3000,
        deterministicSeed: 404
      })
    });
    assert.ok(adminRes.status === 200 || adminRes.status === 201, `Admin injection should return 200 or 201, got ${adminRes.status}`);
    const adminData = await adminRes.json();
    assert.strictEqual(adminData.success, true);
    assert.strictEqual(adminData.data.faultId, 'FLT-ADMIN-ALLOWED');

    // Verify active in engine
    assert.strictEqual(diagnosticEngine.isFaultActive('socket', 'delayed_ack'), true);

    // 3. Admin clears fault -> 200 OK
    const clearRes = await fetch(`${baseUrl}/api/diagnostics/chaos/faults/clear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ faultId: 'FLT-ADMIN-ALLOWED' })
    });
    assert.strictEqual(clearRes.status, 200);
    assert.strictEqual(diagnosticEngine.isFaultActive('socket', 'delayed_ack'), false);
  });

  // 8. Server Readiness Probe (/ready) reflects degraded health on active critical faults
  test('8. Readiness Check (/ready): Returns 503 DEGRADED when database fault is injected, 200 when cleared', async () => {
    // Baseline -> 200
    const resReady1 = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(resReady1.status, 200);

    // Inject database fault
    diagnosticEngine.injectFault({
      faultId: 'FLT-READY-CHECK',
      targetSubsystem: SUBSYSTEMS.DATABASE,
      intendedEffect: 'database_unavailable'
    });

    const resReady2 = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(resReady2.status, 503);
    const readyData = await resReady2.json();
    assert.strictEqual(readyData.ready, false);
    assert.strictEqual(readyData.status, 'DEGRADED');

    // Clear fault -> Restores 200
    diagnosticEngine.clearFault('FLT-READY-CHECK');
    const resReady3 = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(resReady3.status, 200);
    const restoredData = await resReady3.json();
    assert.strictEqual(restoredData.ready, true);
    assert.strictEqual(restoredData.status, 'READY');
  });
});
