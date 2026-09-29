import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { commandExecutor } from '../../server/services/commandExecutor.js';
import { activateEmergencyRest } from '../../server/controllers/incidentController.js';
import { registerEmergencyHandlers } from '../../server/sockets/handlers/emergencyHandler.js';
import { registerSignalHandlers } from '../../server/sockets/handlers/signalHandler.js';
import { backendState } from '../../server/services/stateManager.js';
import { dbManager } from '../../server/db/database.js';

test('REST and Socket emergency activation route the same canonical action through CommandExecutor', async () => {
  const calls = [];
  const original = commandExecutor.executeCommand;
  commandExecutor.executeCommand = async command => {
    calls.push(command);
    return { success: true, status: 'SERVER_APPLIED', commandId: command.commandId,
      newState: { id: 'EMG-ROUTE-TEST', vehicleId: 'AMB-TEST' }, isIdempotentReplay: false };
  };
  try {
    let restResponse;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { restResponse = value; return this; } };
    await activateEmergencyRest({ body: { code: 'AMB-TEST', route: 'route-soetomo' }, headers: {},
      user: { id: 'op-1', name: 'Operator', role: 'OPERATOR' } }, res);

    const listeners = new Map();
    const socket = { user: { id: 'op-1', name: 'Operator', role: 'OPERATOR' }, on: (event, fn) => listeners.set(event, fn) };
    registerEmergencyHandlers({}, socket);
    let socketResponse;
    await listeners.get('emergency:priority')({ vehicleId: 'AMB-TEST', routeId: 'route-soetomo' }, result => { socketResponse = result; });

    assert.equal(restResponse.data.id, 'EMG-ROUTE-TEST');
    assert.equal(socketResponse.success, true);
    assert.equal(socketResponse.status, restResponse.extra.command.status);
    assert.equal(socketResponse.result, restResponse.extra.command.result);
    assert.deepEqual(calls.map(call => call.action), ['emergency:activate', 'emergency:activate']);
    assert.equal(calls[0].sourceChannel, 'rest');
    assert.equal(calls[1].sourceChannel, 'socket');
    assert.equal(calls[0].targetId, calls[1].targetId);
    assert.equal(calls[0].authenticatedUser.role, calls[1].authenticatedUser.role);
  } finally {
    commandExecutor.executeCommand = original;
  }
});

test('signal, emergency, and chaos socket adapters contain no direct domain mutation calls', () => {
  for (const file of [
    'server/sockets/handlers/signalHandler.js',
    'server/sockets/handlers/emergencyHandler.js',
    'server/sockets/handlers/chaosHandler.js'
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /commandExecutor\.executeCommand/);
    assert.doesNotMatch(source, /backendState\.(?:signalOverride|applyAiRecommendation|setGreenSplit|toggleGreenWave|activateEmergencyPriority|cancelEmergency|toggleChaos)/);
  }
});

test('Socket duplicate/reconnect invocation mutates signal once and persists/audits once through executor', async () => {
  const listeners = new Map();
  const socket = { user: { id: 'op-signal-1', name: 'Operator', role: 'OPERATOR' }, on: (event, fn) => listeners.set(event, fn) };
  registerSignalHandlers({}, socket);
  const beforeSequence = backendState.sequence;
  const beforeAuditCount = backendState.auditLogs.length;
  const originalPersist = dbManager.upsertSignalConfig;
  let persistCount = 0;
  dbManager.upsertSignalConfig = (...args) => { persistCount++; return originalPersist.apply(dbManager, args); };
  const invoke = () => new Promise(resolve => listeners.get('signal:override')({
    intersectionId: 'node-wonokromo', duration: 40, commandId: 'CMD-SIGNAL-RECONNECT-TEST',
    idempotencyKey: 'IDEMP-SIGNAL-RECONNECT-TEST'
  }, resolve));
  try {
    const first = await invoke();
    const replay = await invoke();
    assert.equal(first.success, true);
    assert.equal(replay.success, true);
    assert.equal(replay.isIdempotentReplay, true);
    assert.equal(backendState.sequence, beforeSequence + 1);
    assert.equal(backendState.auditLogs.length, beforeAuditCount + 1);
    assert.equal(persistCount, 1);
  } finally {
    dbManager.upsertSignalConfig = originalPersist;
  }
});

test('Socket command gateway rejects unauthorized, invalid, and unknown-target mutations', async () => {
  const listeners = new Map();
  const socket = { user: { id: 'viewer-1', name: 'Viewer', role: 'VIEWER' }, on: (event, fn) => listeners.set(event, fn) };
  registerSignalHandlers({}, socket);
  const call = (data) => new Promise(resolve => listeners.get('signal:override')(data, resolve));
  const before = backendState.sequence;
  const forbidden = await call({ intersectionId: 'node-wonokromo', duration: 40, commandId: 'CMD-UNAUTH-SIGNAL' });
  assert.equal(forbidden.success, false);
  assert.equal(forbidden.code, 'FORBIDDEN');
  assert.equal(backendState.sequence, before);

  socket.user.role = 'OPERATOR';
  const invalid = await call({ intersectionId: 'node-wonokromo', duration: 999, commandId: 'CMD-INVALID-SIGNAL' });
  assert.equal(invalid.success, false);
  const unknown = await call({ intersectionId: 'node-missing', duration: 40, commandId: 'CMD-UNKNOWN-SIGNAL' });
  assert.equal(unknown.success, false);
  assert.equal(unknown.code, 'NOT_FOUND');
  assert.equal(backendState.sequence, before);
});

test('Signal persistence failure rolls back mutation and does not add a success audit', async () => {
  const listeners = new Map();
  const socket = { user: { id: 'op-persist-1', name: 'Operator', role: 'OPERATOR' }, on: (event, fn) => listeners.set(event, fn) };
  registerSignalHandlers({}, socket);
  const node = backendState.state.intersections.find(item => item.id === 'node-wonokromo');
  const snapshot = { state: node.state, timer: node.timer, status: node.status, isOverrideActive: node.isOverrideActive };
  const beforeSequence = backendState.sequence;
  const beforeAuditCount = backendState.auditLogs.length;
  const originalPersist = dbManager.upsertSignalConfig;
  dbManager.upsertSignalConfig = () => { throw new Error('DISK_FULL: test failure'); };
  try {
    const response = await new Promise(resolve => listeners.get('signal:override')({
      intersectionId: 'node-wonokromo', duration: 42, commandId: 'CMD-SIGNAL-PERSIST-FAIL'
    }, resolve));
    assert.equal(response.success, false);
    assert.match(response.message, /PERSISTENCE_FAILED/);
    assert.equal(backendState.sequence, beforeSequence);
    assert.equal(backendState.auditLogs.length, beforeAuditCount);
    assert.deepEqual({ state: node.state, timer: node.timer, status: node.status, isOverrideActive: node.isOverrideActive }, snapshot);
  } finally {
    dbManager.upsertSignalConfig = originalPersist;
  }
});
