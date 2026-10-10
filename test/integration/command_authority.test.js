import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { ROLES } from '../../server/config/constants.js';
import { commandExecutor, CommandExecutor } from '../../server/services/commandExecutor.js';
import { auditRepository } from '../../server/repositories/auditRepository.js';
import { backendState } from '../../server/services/stateManager.js';
import { dbManager } from '../../server/db/database.js';
import { testDatabasePath } from '../helpers/testDatabasePath.js';

// Setup environment variables before importing the server
process.env.PORT = '0';
const testDbPath = testDatabasePath('command-authority.sqlite');
process.env.DB_PATH = testDbPath;

const { server } = await import('../../server.js');

describe('PHASE 14C — Command Authority, Idempotency, Authorization & Audit Integrity Tests', { concurrency: 1 }, () => {
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

    // Obtain tokens for all roles
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

  test('1. Command Success: Authoritative execution, persistence, and sequence increment', async () => {
    const initialDevSeq = backendState.deviceSequence;

    const outcome = await commandExecutor.executeCommand({
      action: 'device:config',
      targetId: 'NODE-EDGE-01',
      payload: { resolution: '1080p', fps: 30 },
      commandId: 'CMD-TEST-SUCCESS-01',
      idempotencyKey: 'IDEMP-TEST-SUCCESS-01',
      correlationId: 'CORR-TEST-SUCCESS-01',
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN },
      sourceChannel: 'socket'
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.status, 'SERVER_APPLIED');
    assert.strictEqual(outcome.result, 'SUCCESS');
    assert.strictEqual(outcome.commandId, 'CMD-TEST-SUCCESS-01');
    assert.strictEqual(outcome.idempotencyKey, 'IDEMP-TEST-SUCCESS-01');
    assert.ok(outcome.sequence > initialDevSeq, 'Device sequence must increment authoritatively');

    // Verify in-memory state updated
    const dev = backendState.devicesRegistry.find(d => d.deviceId === 'NODE-EDGE-01');
    assert.strictEqual(dev.resolution, '1080p');
    assert.strictEqual(dev.fps, 30);

    // Verify audit log has proper correlation
    const latestAudit = backendState.auditLogs[0];
    assert.ok(latestAudit.action.includes('CONFIG') || latestAudit.action.includes('DEVICE'));
    assert.ok(latestAudit.result.includes('CORR-TEST-SUCCESS-01'));
  });

  test('2. RBAC Rejection: Viewer rejected from operational & admin actions', async () => {
    const outcome = await commandExecutor.executeCommand({
      action: 'signal:override',
      targetId: 'node-wonokromo',
      payload: { duration: 45 },
      commandId: 'CMD-RBAC-VIEWER-01',
      idempotencyKey: 'IDEMP-RBAC-VIEWER-01',
      correlationId: 'CORR-RBAC-VIEWER-01',
      authenticatedUser: { id: 'usr-viewer', name: 'Masyarakat Umum', role: ROLES.VIEWER }
    });

    assert.strictEqual(outcome.success, false);
    assert.strictEqual(outcome.status, 'REJECTED');
    assert.strictEqual(outcome.code, 'FORBIDDEN');
    assert.strictEqual(outcome.error.code, 'FORBIDDEN');
    assert.ok(outcome.error.message.includes('Akses ditolak'));

    // Operator rejected from admin-only actions (chaos:toggle, green-wave:toggle, device:fault)
    const adminOnlyOutcome = await commandExecutor.executeCommand({
      action: 'device:fault',
      targetId: 'NODE-EDGE-01',
      payload: { type: 'latency_spike' },
      commandId: 'CMD-RBAC-OP-01',
      idempotencyKey: 'IDEMP-RBAC-OP-01',
      correlationId: 'CORR-RBAC-OP-01',
      authenticatedUser: { id: 'usr-op', name: 'Operator Lapangan', role: ROLES.OPERATOR }
    });

    assert.strictEqual(adminOnlyOutcome.success, false);
    assert.strictEqual(adminOnlyOutcome.status, 'REJECTED');
    assert.strictEqual(adminOnlyOutcome.code, 'FORBIDDEN');
  });

  test('3. Duplicate Command ID & Idempotency Key: Replays authoritative cached result without double mutation', async () => {
    const sequenceBefore = backendState.signalSequence;
    const firstRequest = commandExecutor.executeCommand({
      action: 'green-split:update',
      targetId: 'node-wonokromo',
      payload: { value: 50 },
      commandId: 'CMD-IDEMP-01',
      idempotencyKey: 'IDEMP-KEY-GREEN-SPLIT-50',
      correlationId: 'CORR-IDEMP-01',
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });
    const retryRequest = new CommandExecutor().executeCommand({
      action: 'green-split:update', targetId: 'node-wonokromo', payload: { value: 50 },
      commandId: 'CMD-IDEMP-01-RETRY', idempotencyKey: 'IDEMP-KEY-GREEN-SPLIT-50',
      correlationId: 'CORR-IDEMP-01-RETRY',
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });
    const [firstOutcome, replayOutcome] = await Promise.all([firstRequest, retryRequest]);
    assert.strictEqual(firstOutcome.success, true);
    assert.strictEqual(firstOutcome.status, 'SERVER_APPLIED');
    assert.strictEqual(replayOutcome.success, true);
    assert.strictEqual(replayOutcome.isIdempotentReplay, true, 'Must indicate idempotent replay');
    assert.strictEqual(replayOutcome.status, 'SERVER_APPLIED');
    assert.strictEqual(backendState.signalSequence, sequenceBefore + 1, 'Concurrent duplicate commands must increment sequence once');
    await assert.rejects(commandExecutor.executeCommand({
      action:'green-split:update', targetId:'node-wonokromo', payload:{value:55},
      commandId:'CMD-IDEMP-CONFLICT', idempotencyKey:'IDEMP-KEY-GREEN-SPLIT-50',
      authenticatedUser:{id:'usr-admin',name:'Zaki Admin',role:ROLES.ADMIN}
    }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
  });

  test('4. Command Status Lookup: Accurate lookup including in-flight or applied states', async () => {
    // Check known applied command
    const processedMap = backendState.processedCommands;
    assert.ok(processedMap.has('IDEMP-KEY-GREEN-SPLIT-50'));

    const cached = processedMap.get('IDEMP-KEY-GREEN-SPLIT-50');
    assert.strictEqual(cached.status, 'SERVER_APPLIED');

    // Simulate in-flight key
    commandExecutor.inFlightKeys.add('INFLIGHT-KEY-999');
    assert.strictEqual(commandExecutor.inFlightKeys.has('INFLIGHT-KEY-999'), true);
    commandExecutor.inFlightKeys.delete('INFLIGHT-KEY-999');
  });

  test('5. Persistence Failure Rollback: In-memory mutation cleanly reverted if database fails', async () => {
    const devId = 'NODE-EDGE-01';
    const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);
    const originalFps = dev.fps;
    const originalResolution = dev.resolution;
    const originalSeq = backendState.deviceSequence;

    const originalExecute = dbManager.execute;
    dbManager.execute = (sql, ...args) => {
      if (sql.includes('INSERT INTO device_telemetry')) throw new Error('DISK_FULL: Simulated SQLite write failure');
      return originalExecute.call(dbManager, sql, ...args);
    };

    try {
      await assert.rejects(
        async () => {
          await commandExecutor.executeCommand({
            action: 'device:config',
            targetId: devId,
            payload: { resolution: '4k', fps: 60 },
            commandId: 'CMD-FAIL-ROLLBACK-01',
            idempotencyKey: 'IDEMP-FAIL-ROLLBACK-01',
            correlationId: 'CORR-FAIL-ROLLBACK-01',
            authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
          });
        },
        /DISK_FULL/
      );

      // Verify that in-memory state was completely rolled back
      assert.strictEqual(dev.fps, originalFps, 'FPS must rollback to original');
      assert.strictEqual(dev.resolution, originalResolution, 'Resolution must rollback to original');
      assert.strictEqual(backendState.deviceSequence, originalSeq, 'Sequence must rollback without increment');
    } finally {
      // Restore original DB method
      dbManager.execute = originalExecute;
    }
  });

  test('Audit failure rolls back durable mutation and withholds success acknowledgement', async () => {
    const dev = backendState.devicesRegistry.find((entry) => entry.deviceId === 'NODE-EDGE-01');
    const original = { fps:dev.fps, resolution:dev.resolution };
    const originalInsert = auditRepository.insert;
    const originalEmit = backendState.io.emit;
    const acknowledgements = [];
    backendState.io.emit = function(event, payload, ...rest) {
      if (event === 'command:ack') acknowledgements.push(payload);
      return originalEmit.call(this, event, payload, ...rest);
    };
    auditRepository.insert = async () => { throw new Error('INJECTED_AUDIT_FAILURE'); };
    try {
      await assert.rejects(commandExecutor.executeCommand({
        action:'device:config', targetId:'NODE-EDGE-01', payload:{fps:27,resolution:'720p'},
        commandId:'CMD-AUDIT-ROLLBACK', idempotencyKey:'IDEMP-AUDIT-ROLLBACK',
        authenticatedUser:{id:'usr-admin',name:'Zaki Admin',role:ROLES.ADMIN}
      }), /INJECTED_AUDIT_FAILURE/);
    } finally { auditRepository.insert = originalInsert; backendState.io.emit = originalEmit; }
    assert.deepEqual({fps:dev.fps,resolution:dev.resolution}, original);
    assert.equal((await dbManager.query("SELECT status FROM command_receipts WHERE idempotency_key=$1", ['IDEMP-AUDIT-ROLLBACK'])).rowCount, 0);
    assert.equal((await dbManager.query("SELECT id FROM audit_logs WHERE idempotency_key=$1", ['IDEMP-AUDIT-ROLLBACK'])).rowCount, 0);
    assert.equal(acknowledgements.some((ack) => ack.success === true), false);
  });

  test('6. REST vs Socket Consistency: Calling device:config via REST produces identical commandExecutor semantics', async () => {
    const res = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${adminToken}`,
        'X-Command-Id': 'CMD-REST-UNIFIED-01',
        'X-Idempotency-Key': 'IDEMP-REST-UNIFIED-01',
        'X-Correlation-Id': 'CORR-REST-UNIFIED-01'
      },
      body: JSON.stringify({
        deviceId: 'NODE-EDGE-01',
        resolution: '720p',
        fps: 24,
        commandId: 'CMD-REST-UNIFIED-01',
        idempotencyKey: 'IDEMP-REST-UNIFIED-01'
      })
    });

    const data = await res.json();
    if (res.status !== 200) {
      console.error('Test 6 Failed response:', JSON.stringify(data));
    }
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, 'SERVER_APPLIED');
    assert.strictEqual(data.commandId, 'CMD-REST-UNIFIED-01');

    // Confirm that backendState processedCommands contains the record
    assert.ok(backendState.processedCommands.has('IDEMP-REST-UNIFIED-01'));
  });

  test('7. Invalid State Transition Rejection: RESOLVED -> ACTIVE prohibited', async () => {
    const incidentId = 'INC-STATE-TRANS-01';
    const sampleInc = {
      id: incidentId,
      title: 'Kecelakaan Minor',
      category: 'accident',
      severity: 'medium',
      location: 'Jl. Pemuda',
      status: 'RESOLVED',
      priority: 'normal',
      assignedUnit: 'Dishub Patroli 02',
      notes: 'Selesai ditangani',
      reportedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString()
    };
    backendState.state.incidents.unshift(sampleInc);

    // Attempting to move RESOLVED incident back to ACTIVE via REST must return 409 STATE_CONFLICT
    const res = await fetch(`${baseUrl}/api/incidents/${incidentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${operatorToken}`
      },
      body: JSON.stringify({ status: 'ACTIVE' })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.code, 'STATE_CONFLICT');
    assert.ok(body.message.includes('RESOLVED'));
  });

  test('8. Forged Actor Field Prevention: Server derives identity strictly from verified token', async () => {
    // Client tries to spoof actor as "Mayor of Surabaya" in terminal command
    const res = await fetch(`${baseUrl}/api/terminal/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `omnitraf_session=${adminToken}`
      },
      body: JSON.stringify({
        command: '/status',
        actor: 'FORGED_MAYOR_NAME'
      })
    });

    assert.strictEqual(res.status, 200);

    // Verify audit log recorded real admin name from token, not forged string
    const terminalAudit = backendState.auditLogs.find(a => a.action === 'TERMINAL_EXECUTE');
    assert.ok(terminalAudit, 'Terminal audit must exist');
    assert.notStrictEqual(terminalAudit.operator, 'FORGED_MAYOR_NAME');
    assert.ok(terminalAudit.operator.includes('Administrator') || terminalAudit.operator.includes('admin'));
  });

  test('9. PreviousState Snapshot Integrity: Captured before mutation', async () => {
    const devId = 'NODE-EDGE-01';
    const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);
    dev.resolution = '720p';
    dev.fps = 20;

    const outcome = await commandExecutor.executeCommand({
      action: 'device:config',
      targetId: devId,
      payload: { resolution: '1080p', fps: 30 },
      commandId: 'CMD-PREV-STATE-01',
      idempotencyKey: 'IDEMP-PREV-STATE-01',
      correlationId: 'CORR-PREV-STATE-01',
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.previousState.resolution, '720p', 'previousState must be 720p before mutation');
    assert.strictEqual(outcome.previousState.fps, 20, 'previousState fps must be 20 before mutation');
    assert.strictEqual(outcome.newState.resolution, '1080p', 'newState resolution must be 1080p');
    assert.strictEqual(outcome.newState.fps, 30, 'newState fps must be 30');
  });

  test('10. Sequence Integrity: Exactly one increment per command execution', async () => {
    const initialSignalSeq = backendState.signalSequence;

    await commandExecutor.executeCommand({
      action: 'signal:override',
      targetId: 'node-wonokromo',
      payload: { duration: 30 },
      commandId: 'CMD-SEQ-INTEGRITY-01',
      idempotencyKey: 'IDEMP-SEQ-INTEGRITY-01',
      correlationId: 'CORR-SEQ-INTEGRITY-01',
      authenticatedUser: { id: 'usr-op', name: 'Operator Budi', role: ROLES.OPERATOR }
    });

    assert.strictEqual(backendState.signalSequence, initialSignalSeq + 1, 'Signal sequence must increment exactly once');
  });
});
