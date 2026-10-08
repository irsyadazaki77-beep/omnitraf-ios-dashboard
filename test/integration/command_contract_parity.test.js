import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { testDatabasePath } from '../helpers/testDatabasePath.js';

process.env.PORT = '0';
process.env.DB_PATH = testDatabasePath('command-contract-parity.sqlite');
process.env.NODE_ENV = 'test';

const [{ server }, { backendState }, { dbManager }] = await Promise.all([
  import('../../server.js'),
  import('../../server/services/stateManager.js'),
  import('../../server/db/database.js')
]);

let baseUrl;
let adminToken;
let socket;

test('REST and Socket use the same canonical device command and expose matching execution result', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  await login.json();
  adminToken = login.headers.get('set-cookie')?.match(/omnitraf_session=([^;]+)/)?.[1];
  socket = Client(baseUrl, { transports: ['websocket'], forceNew: true, auth: { token: adminToken } });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });

  const payload = { deviceId: 'NODE-EDGE-02', fps: 32, resolution: '1080p', greenWaveSync: true };
  const restResponse = await fetch(`${baseUrl}/api/devices/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `omnitraf_session=${adminToken}`, 'X-Idempotency-Key': 'CONTRACT-PARITY-REST-01' },
    body: JSON.stringify({ ...payload, commandId: 'CONTRACT-PARITY-REST-CMD' })
  });
  assert.equal(restResponse.status, 200);
  const restBody = await restResponse.json();

  const socketResult = await new Promise(resolve => socket.emit('operator:command', {
    cmd: { action: 'device:config', targetId: payload.deviceId, payload,
      commandId: 'CONTRACT-PARITY-SOCKET-CMD', idempotencyKey: 'CONTRACT-PARITY-SOCKET-01' }
  }, resolve));
  assert.equal(socketResult.success, true);
  assert.deepEqual(restBody.command.normalizedCommand, socketResult.normalizedCommand);
  assert.deepEqual(restBody.command.newState, socketResult.newState);
  assert.equal(restBody.command.result, socketResult.result);
});

test('invalid REST and Socket commands return the same contract error and cause no side effects', async () => {
  const before = { sequence: backendState.deviceSequence, audit: backendState.auditLogs.length };
  const originalExecute = dbManager.execute;
  let persistCalls = 0;
  dbManager.execute = (sql, ...args) => { if (sql.includes('INSERT INTO device_telemetry')) persistCalls++; return originalExecute.call(dbManager, sql, ...args); };
  try {
    const restResponse = await fetch(`${baseUrl}/api/devices/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `omnitraf_session=${adminToken}` },
      body: JSON.stringify({ deviceId: 'NODE-EDGE-02', fps: 91 })
    });
    const restBody = await restResponse.json();
    const socketResult = await new Promise(resolve => socket.emit('operator:command', {
      cmd: { action: 'device:config', targetId: 'NODE-EDGE-02', payload: { deviceId: 'NODE-EDGE-02', fps: 91 } }
    }, resolve));

    assert.equal(restResponse.status, 422);
    assert.equal(restBody.error.code, socketResult.code);
    assert.equal(restBody.error.details.field, socketResult.error.field);
    assert.deepEqual(restBody.error.details.expected, socketResult.error.expected);
    assert.equal(restBody.error.details.actual, socketResult.error.actual);
    assert.equal(persistCalls, 0);
    assert.equal(backendState.deviceSequence, before.sequence);
    assert.equal(backendState.auditLogs.length, before.audit);
  } finally {
    dbManager.execute = originalExecute;
  }
});

test.after(() => {
  socket?.disconnect();
  if (server.listening) server.close();
});
