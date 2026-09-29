import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAndValidateCommand, parseCommandInput, normalizeCommand, validateCommand, validateDiagnosticEventsQuery, validateForecastQuery } from '../../server/config/contracts.js';
import { commandExecutor } from '../../server/services/commandExecutor.js';
import { backendState } from '../../server/services/stateManager.js';
import { dbManager } from '../../server/db/database.js';

const admin = { id: 'contract-admin', name: 'Contract Admin', role: 'ADMIN' };

function contractError(input, code = 'INVALID_COMMAND') {
  assert.throws(() => normalizeAndValidateCommand(input), error => error.code === code && Boolean(error.field));
}

test('signal override and green split share exact 15..90 integer boundaries', () => {
  for (const duration of [15, 90]) {
    const command = normalizeAndValidateCommand({ action: 'signal:override', targetId: 'node-wonokromo', payload: { duration } });
    assert.equal(command.payload.duration, duration);
  }
  for (const duration of [10, 14, 91, 120, 180, '15', '', null, NaN, Infinity]) {
    contractError({ action: 'signal:override', targetId: 'node-wonokromo', payload: { duration } });
  }
  for (const value of [15, 90]) {
    assert.equal(normalizeAndValidateCommand({ action: 'green-split:update', targetId: 'node-wonokromo', payload: { value } }).payload.value, value);
  }
  for (const value of [10, 14, 91, 120, 180, '35', null, NaN, Infinity]) {
    contractError({ action: 'green-split:update', targetId: 'node-wonokromo', payload: { value } });
  }
});

test('critical command contracts reject missing fields, malformed identifiers, enums and implicit coercion', () => {
  contractError({ action: 'signal:override', targetId: null, payload: { duration: 45 } }, 'INVALID_TARGET');
  contractError({ action: 'signal:override', targetId: 'not a node', payload: { duration: 45 } }, 'INVALID_TARGET');
  contractError({ action: 'device:config', targetId: 'NODE-EDGE-01', payload: { fps: '30' } });
  contractError({ action: 'device:config', targetId: 'NODE-EDGE-01', payload: { resolution: '1080P' } });
  contractError({ action: 'device:fault', targetId: 'NODE-EDGE-01', payload: { type: 'Latency_Spike' } });
  contractError({ action: 'emergency:activate', payload: { code: 'AMB-22', route: 'route-does-not-exist' } }, 'INVALID_TARGET');
  contractError({ action: 'emergency:cancel', payload: { id: null } }, 'INVALID_TARGET');
  contractError({ action: 'incident:create', targetId: 'INC-22', payload: { title: ' ', location: 'Jalan' } });
  contractError({ action: 'incident:update-status', targetId: 'INC-22', payload: { status: 'unknown-state' } });
  contractError({ action: 'chaos:fault-inject', targetId: 'FLT-22', payload: { targetSubsystem: 'device', intendedEffect: 'unknown' } });
  contractError({ action: 'simulation:control', targetId: 'simulation-runtime', payload: { operation: 'set_speed', speedMultiplier: Infinity } });
});

test('device, emergency, incident, chaos and simulation contracts enforce their declared boundaries', () => {
  const normalize = (action, targetId, payload) => normalizeAndValidateCommand({ action, targetId, payload });
  for (const fps of [5, 60]) assert.equal(normalize('device:config', 'NODE-EDGE-01', { fps }).payload.fps, fps);
  for (const fps of [4, 61, '30', null, NaN, Infinity]) contractError({ action: 'device:config', targetId: 'NODE-EDGE-01', payload: { fps } });
  for (const duration of [1, 300000]) assert.equal(normalize('device:fault', 'NODE-EDGE-01', { type: 'latency_spike', duration }).payload.duration, duration);
  for (const duration of [0, 300001, '5000']) contractError({ action: 'device:fault', targetId: 'NODE-EDGE-01', payload: { type: 'latency_spike', duration } });

  for (const active of [true, false]) assert.equal(normalize('green-wave:toggle', 'corridor-ayani-darmo', { active }).payload.active, active);
  contractError({ action: 'green-wave:toggle', targetId: 'corridor-ayani-darmo', payload: { active: 'true' } });
  for (const targetSplit of [15, 90]) assert.equal(normalize('ai:apply-recommendation', 'node-wonokromo', { targetSplit }).payload.targetSplit, targetSplit);
  for (const targetSplit of [14, 91, '48', NaN]) contractError({ action: 'ai:apply-recommendation', targetId: 'node-wonokromo', payload: { targetSplit } });

  assert.equal(normalize('emergency:activate', 'AMB-22', { code: 'AMB-22', route: 'route-soetomo' }).targetId, 'AMB-22');
  contractError({ action: 'emergency:activate', payload: { code: '', route: 'route-soetomo' } }, 'INVALID_TARGET');
  contractError({ action: 'emergency:activate', targetId: 'AMB-22', payload: { code: 'AMB-23' } }, 'INVALID_TARGET');
  contractError({ action: 'emergency:cancel', targetId: 'bad id', payload: {} }, 'INVALID_TARGET');

  const incident = normalize('incident:create', 'INC-22', { title: 'Road closure', location: 'Jalan', category: 'ACCIDENT', severity: 'HIGH' });
  assert.equal(incident.payload.category, 'accident');
  assert.equal(incident.payload.severity, 'high');
  contractError({ action: 'incident:create', targetId: 'INC-22', payload: { title: 42, location: 'Jalan' } });
  contractError({ action: 'incident:update-status', targetId: 'INC-22', payload: { status: null } });

  for (const durationMs of [1, 3600000]) assert.equal(normalize('chaos:fault-inject', 'FLT-22', { targetSubsystem: 'socket', intendedEffect: 'delayed_ack', durationMs }).payload.durationMs, durationMs);
  for (const durationMs of [0, 3600001, '3000', Infinity]) contractError({ action: 'chaos:fault-inject', targetId: 'FLT-22', payload: { targetSubsystem: 'socket', intendedEffect: 'delayed_ack', durationMs } });
  for (const speedMultiplier of [0.1, 10]) assert.equal(normalize('simulation:control', 'simulation-runtime', { operation: 'set_speed', speedMultiplier }).payload.speedMultiplier, speedMultiplier);
  for (const speedMultiplier of [0.09, 10.01, '1']) contractError({ action: 'simulation:control', targetId: 'simulation-runtime', payload: { operation: 'set_speed', speedMultiplier } });
  contractError({ action: 'simulation:control', targetId: 'simulation-runtime', payload: { operation: 'set_mode', mode: 'REALTIME' } });
});

test('legacy status and emergency aliases normalize once to canonical command form', () => {
  const status = normalizeAndValidateCommand({ action: 'incident:update-status', targetId: 'INC-22', payload: { status: ' dispatched/responding ' } });
  assert.equal(status.action, 'incident:update-status');
  assert.equal(status.payload.status, 'DISPATCHED');
  const resolved = normalizeAndValidateCommand({ action: 'incident:update-status', targetId: 'INC-22', payload: { status: 'resolved' } });
  assert.equal(resolved.action, 'incident:resolve');
  const emergency = normalizeAndValidateCommand({ action: 'emergency:activate', targetId: 'AMB-22', payload: { vehicleId: 'AMB-22', routeId: 'route-soetomo' } });
  assert.equal(emergency.payload.code, 'AMB-22');
  assert.equal(emergency.payload.route, 'route-soetomo');
  assert.equal(emergency.targetId, 'AMB-22');
});

test('REST-shaped and Socket-shaped device commands have the same normalized contract', () => {
  const rest = normalizeAndValidateCommand({ action: 'device:config', targetId: 'NODE-EDGE-01', payload: { deviceId: 'NODE-EDGE-01', fps: 30, resolution: '1080p' } });
  const socket = normalizeAndValidateCommand({ action: 'device:config', targetId: 'NODE-EDGE-01', payload: { deviceId: 'NODE-EDGE-01', fps: 30, resolution: '1080p' } });
  assert.deepEqual({ action: rest.action, targetId: rest.targetId, payload: rest.payload }, { action: socket.action, targetId: socket.targetId, payload: socket.payload });
});

test('command pipeline exposes parse, normalize, validate stages without executing mutation', () => {
  const parsed = parseCommandInput({ action: ' signal:override ', targetId: 'node-wonokromo', payload: { duration: 45, role: 'ADMIN' } });
  assert.equal(parsed.action, ' signal:override ');
  const normalized = normalizeCommand(parsed);
  assert.equal(normalized.action, 'signal:override');
  assert.equal(normalized.payload.role, undefined);
  const validated = validateCommand(normalized);
  assert.equal(validated.action, 'signal:override');
  assert.equal(validated.targetId, 'node-wonokromo');
  assert.equal(validated.payload.duration, 45);
});

test('invalid and unknown-target commands produce no state, persistence, audit or event changes', async () => {
  const node = backendState.state.intersections.find(item => item.id === 'node-wonokromo');
  const stateBefore = { signal: { state: node.state, timer: node.timer, status: node.status }, sequence: backendState.sequence, audit: backendState.auditLogs.length, signalAudit: backendState.deviceAuditTrail.length };
  const originalPersist = dbManager.upsertSignalConfig;
  let persistenceCalls = 0;
  let emitted = 0;
  const io = backendState.io;
  const originalEmit = io?.emit;
  try {
    dbManager.upsertSignalConfig = (...args) => { persistenceCalls++; return originalPersist.apply(dbManager, args); };
    if (io) io.emit = (...args) => { emitted++; return originalEmit.apply(io, args); };
    await assert.rejects(commandExecutor.executeCommand({ action: 'signal:override', targetId: 'node-wonokromo', payload: { duration: 180 }, authenticatedUser: admin }), error => error.code === 'INVALID_COMMAND');
    await assert.rejects(commandExecutor.executeCommand({ action: 'signal:override', targetId: 'node-missing', payload: { duration: 45 }, authenticatedUser: admin }), error => error.code === 'NOT_FOUND');
    const forbidden = await commandExecutor.executeCommand({ action: 'signal:override', targetId: 'node-wonokromo', payload: { duration: 45 }, authenticatedUser: { id: 'viewer', name: 'Viewer', role: 'VIEWER' } });
    assert.equal(forbidden.code, 'FORBIDDEN');
    assert.equal(persistenceCalls, 0);
    assert.equal(emitted, 0);
    assert.equal(backendState.sequence, stateBefore.sequence);
    assert.equal(backendState.auditLogs.length, stateBefore.audit);
    assert.equal(backendState.deviceAuditTrail.length, stateBefore.signalAudit);
    assert.deepEqual({ state: node.state, timer: node.timer, status: node.status }, stateBefore.signal);
  } finally {
    dbManager.upsertSignalConfig = originalPersist;
    if (io) io.emit = originalEmit;
  }
});

test('shared read-query contracts reject clamped or malformed pagination and forecast values', () => {
  assert.deepEqual(validateDiagnosticEventsQuery({ limit: '100', category: 'FAULT', level: 'warn' }), { limit: 100, category: 'fault', level: 'WARN' });
  for (const limit of ['0', '101', '1.5', 'abc']) assert.throws(() => validateDiagnosticEventsQuery({ limit }), error => error.code === 'INVALID_COMMAND');
  assert.equal(validateForecastQuery('23.99', 12), 23.99);
  for (const hour of ['24', '-1', 'invalid', 'Infinity']) assert.throws(() => validateForecastQuery(hour, 12), error => error.code === 'INVALID_COMMAND');
});
