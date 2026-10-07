import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateStore, stateStore, updateIncidentState, applyServerSnapshot } from '../../src/core/stateStore.js';
import { shallowEqual } from '../../src/core/state/comparators.js';

test('structural sharing changes only updated branches and returns stable state references', () => {
  const store = new StateStore();
  const previous = store.getState();
  store.setState({ telemetry: { ...previous.telemetry, avgWaitTime: 41 } });
  const next = store.getState();
  assert.notStrictEqual(next, previous);
  assert.notStrictEqual(next.telemetry, previous.telemetry);
  assert.strictEqual(next.incidents, previous.incidents);
  assert.strictEqual(next.devices, previous.devices);
  assert.strictEqual(store.getState(), next);
});

test('selectors use Object.is by default, support shallow equality, and skip unrelated root domains', () => {
  const store = new StateStore();
  let incidentCalls = 0;
  let connectionCalls = 0;
  let objectCalls = 0;
  store.subscribeSelector(state => state.incidents, () => incidentCalls++);
  store.subscribeSelector(state => state.connectionStatus, () => connectionCalls++);
  store.subscribeSelector(state => ({ status: state.connectionStatus, stale: state.isStaleData }), () => objectCalls++, shallowEqual);
  store.updateCctv({ cctvVisionData: { seq: 1 } }, { emitGeneric: false });
  assert.equal(incidentCalls, 0);
  assert.equal(connectionCalls, 0);
  assert.equal(objectCalls, 0);
  store.updateConnection({ connectionStatus: 'connected' });
  assert.equal(connectionCalls, 1);
  assert.equal(objectCalls, 1);
});

test('nested selectors skip sibling changes inside a shared legacy domain object', () => {
  const store = new StateStore();
  let networkLoadCalls = 0;
  store.subscribeSelector(state => state.telemetry.networkLoad, () => networkLoadCalls++);
  store.updateTraffic({ telemetry: { avgWaitTime: 41 } });
  assert.equal(networkLoadCalls, 0);
  store.updateTraffic({ telemetry: { networkLoad: 73 } });
  assert.equal(networkLoadCalls, 1);
});

test('batch sends one selector callback for a logical multi-domain update', () => {
  const store = new StateStore();
  let calls = 0;
  store.subscribeSelector(state => state.telemetry, () => calls++);
  store.batch(() => {
    store.updateTraffic({ telemetry: { avgWaitTime: 40 } });
    store.updateTraffic({ telemetry: { congestionIndex: 63 } });
  });
  assert.equal(calls, 1);
  assert.equal(store.getState().telemetry.avgWaitTime, 40);
  assert.equal(store.getState().telemetry.congestionIndex, 63);
});

test('delta entity update preserves unrelated entities and normalized lookup remains current', () => {
  const original = stateStore.getState().incidents;
  const unrelated = original.find(item => item.id === '102');
  const matching = original.find(item => item.id === '101');
  updateIncidentState('101', { status: 'TEST_UPDATED' }, 'controller');
  const next = stateStore.getState();
  assert.notStrictEqual(next.incidents, original);
  assert.strictEqual(next.incidents.find(item => item.id === '102'), unrelated);
  assert.notStrictEqual(next.incidents.find(item => item.id === '101'), matching);
  assert.equal(stateStore.getIncidentById('101').status, 'TEST_UPDATED');
});

test('full snapshot is atomic and retains unchanged canonical entity slices', () => {
  const previous = stateStore.getState();
  const canonicalIncidents = previous.canonical.incidents;
  let incidentCalls = 0;
  const unsubscribe = stateStore.subscribeSelector(state => state.canonical.incidents, () => incidentCalls++);
  applyServerSnapshot({
    seq: 100,
    timestamp: Date.now(),
    state: {
      intersections: previous.intersections.map(item => ({ ...item })),
      incidents: previous.incidents.map(item => ({ ...item })),
      activeEmergencies: previous.activeEmergencies.map(item => ({ ...item })),
      devices: previous.devices.map(item => ({ ...item })),
      ...previous.telemetry
    }
  });
  const next = stateStore.getState();
  assert.notStrictEqual(next, previous);
  assert.strictEqual(next.canonical.incidents, canonicalIncidents);
  assert.equal(incidentCalls, 0);
  unsubscribe();
});

test('CCTV stress keeps latest payload and never notifies unrelated incident selectors', () => {
  const store = new StateStore();
  let incidentCalls = 0;
  const initialCount = store.getDiagnostics().activeSelectorSubscriptions;
  const unsubscribe = store.subscribeSelector(state => state.incidents, () => incidentCalls++);
  for (let seq = 1; seq <= 300; seq++) {
    store.updateCctv({ cctvVisionData: { seq, detections: [{ id: `track-${seq}` }] }, lastReceivedCctvSequence: seq }, { emitGeneric: false });
  }
  assert.equal(store.getState().cctvVisionData.seq, 300);
  assert.equal(incidentCalls, 0);
  unsubscribe();
  assert.equal(store.getDiagnostics().activeSelectorSubscriptions, initialCount);
});

test('shallowEqual compares object values without serialization', () => {
  assert.equal(shallowEqual({ a: 1, b: true }, { a: 1, b: true }), true);
  assert.equal(shallowEqual({ a: 1 }, { a: 2 }), false);
});

test('1000 small state updates complete without cloning stable unrelated slices', () => {
  const store = new StateStore();
  const incidents = store.getState().incidents;
  const startedAt = performance.now();
  for (let value = 0; value < 1000; value++) store.updateTraffic({ telemetry: { networkLoad: value } });
  const elapsedMs = performance.now() - startedAt;
  assert.strictEqual(store.getState().incidents, incidents);
  assert.equal(store.getDiagnostics().stateUpdatesPerSecond > 0, true);
  console.info(`[state-store-benchmark] updates=1000 elapsedMs=${elapsedMs.toFixed(2)}`);
});
