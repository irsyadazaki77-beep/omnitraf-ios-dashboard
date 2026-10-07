import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeRedisManager, FakeRedisState } from '../helpers/fakeRedisManager.js';
import { ClusterEventBus } from '../../server/infrastructure/redis/clusterEventBus.js';
import { SimulationLeadership } from '../../server/infrastructure/redis/simulationLeadership.js';
import { ClusterRuntime } from '../../server/infrastructure/redis/clusterRuntime.js';

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('cluster runtime: exactly one leader and follower takes over after lease expiry', async (t) => {
  const redisState = new FakeRedisState();
  const redisA = new FakeRedisManager(redisState, 'A');
  const redisB = new FakeRedisManager(redisState, 'B');
  const activeTickOwners = new Set();
  const onRoleChange = (instanceId) => ({ role }) => {
    if (role === 'LEADER') activeTickOwners.add(instanceId);
    else activeTickOwners.delete(instanceId);
  };
  const leadershipA = new SimulationLeadership({ redisManager: redisA, mode: 'cluster', instanceId: 'A', leaseTtlMs: 150, renewIntervalMs: 30, onRoleChange: onRoleChange('A') });
  const leadershipB = new SimulationLeadership({ redisManager: redisB, mode: 'cluster', instanceId: 'B', leaseTtlMs: 150, renewIntervalMs: 30, onRoleChange: onRoleChange('B') });
  t.after(async () => { await leadershipA.stop(); await leadershipB.stop(); });

  await leadershipA.start();
  await leadershipB.start();
  assert.equal([leadershipA, leadershipB].filter((manager) => manager.isLeader()).length, 1);
  assert.equal(activeTickOwners.size, 1, 'only the elected leader may own the authoritative tick loop');
  const leader = leadershipA.isLeader() ? leadershipA : leadershipB;
  const follower = leadershipA.isLeader() ? leadershipB : leadershipA;
  assert.equal(follower.role, 'FOLLOWER');

  await leader.stop({ release: false });
  await waitFor(() => follower.isLeader(), 1000);
  assert.equal(follower.leaderId, 'B' === follower.instanceId ? 'B' : follower.instanceId);
  assert.equal(activeTickOwners.size, 1, 'leadership transfer leaves exactly one active authoritative loop');
});

test('cluster runtime: shared snapshot/event propagation and duplicate event suppression', async () => {
  const redisState = new FakeRedisState();
  const redisA = new FakeRedisManager(redisState, 'A');
  const redisB = new FakeRedisManager(redisState, 'B');
  const busA = new ClusterEventBus(redisA, 'A');
  const busB = new ClusterEventBus(redisB, 'B');
  const received = [];
  await busB.subscribe('omnitraf:events:traffic', (event) => received.push(event));
  const event = busA.createEnvelope('traffic:update', 11, { value: 4 });
  await busA.publishEnvelope('omnitraf:events:traffic', event);
  await busA.publishEnvelope('omnitraf:events:traffic', event);
  await waitFor(() => busB.getMetrics().eventsReceived === 1);
  assert.equal(received.length, 1);
  assert.equal(busB.getMetrics().duplicateEventsDropped, 1);
});

test('cluster runtime: follower loads a baseline before applying newer canonical snapshots', async (t) => {
  const shared = new FakeRedisState();
  const redisA = new FakeRedisManager(shared, 'A');
  const redisB = new FakeRedisManager(shared, 'B');
  const busA = new ClusterEventBus(redisA, 'A');
  const busB = new ClusterEventBus(redisB, 'B');
  let canonical = { stateVersion: 1, marker: 'baseline' };
  let followerState = null;
  const leader = new SimulationLeadership({ redisManager: redisA, eventBus: busA, mode: 'cluster', instanceId: 'A', onSnapshot: () => canonical, applySnapshot: async () => true });
  await leader.start();
  t.after(async () => { await leader.stop(); await follower.stop(); });

  const follower = new SimulationLeadership({ redisManager: redisB, eventBus: busB, mode: 'cluster', instanceId: 'B', applySnapshot: async (snapshot) => { followerState = snapshot; return true; } });
  await busB.subscribe('omnitraf:events:snapshot', (event) => follower.onSnapshotEvent(event));
  await follower.start();
  assert.equal(follower.synchronized, true);
  assert.equal(followerState.marker, 'baseline');

  canonical = { stateVersion: 2, marker: 'command mutation' };
  await leader.publishSnapshot();
  await waitFor(() => followerState.stateVersion === 2);
  assert.equal(followerState.marker, 'command mutation');
});

test('cluster runtime: follower forwards commands and leader returns one idempotent result', async (t) => {
  const redisState = new FakeRedisState();
  const redisA = new FakeRedisManager(redisState, 'A');
  const redisB = new FakeRedisManager(redisState, 'B');
  const leadershipA = { isLeader: () => true, leaderId: 'A', synchronized: true };
  const leadershipB = { isLeader: () => false, leaderId: 'A', synchronized: true };
  const leader = new ClusterRuntime({ mode: 'cluster', instanceId: 'A', redisManager: redisA, leadership: leadershipA });
  const follower = new ClusterRuntime({ mode: 'cluster', instanceId: 'B', redisManager: redisB, leadership: leadershipB, commandTimeoutMs: 500 });
  let executions = 0;
  leader.configureCommandHandler(async ({ value }) => ({ success: true, value, execution: ++executions }));
  await leader.startCommandBroker();
  await follower.startCommandBroker();
  t.after(async () => { leader.unsubscribeRequest?.(); leader.unsubscribeReply?.(); follower.unsubscribeRequest?.(); follower.unsubscribeReply?.(); });

  const outcome = await follower.forwardCommand({ value: 'one' });
  assert.equal(outcome.execution, 1);
  const replay = await leader.executeIdempotently('key', 'fingerprint', async () => ({ success: true, value: 'once' }), { actorId: 'operator-1' });
  const replayed = await leader.executeIdempotently('key', 'fingerprint', async () => ({ success: true, value: 'twice' }), { actorId: 'operator-1' });
  assert.equal(replay.value, 'once');
  assert.equal(replayed.value, 'once');
  assert.equal(replayed.isIdempotentReplay, true);
  assert.equal((await follower.getIdempotentCommandResult('key')).actorId, 'operator-1');

  let concurrentExecutions = 0;
  let releaseExecution;
  const executionGate = new Promise((resolve) => { releaseExecution = resolve; });
  const execute = async () => { concurrentExecutions++; await executionGate; return { success: true, value: 'shared' }; };
  const first = leader.executeIdempotently('concurrent-key', 'concurrent-fingerprint', execute);
  const second = follower.executeIdempotently('concurrent-key', 'concurrent-fingerprint', async () => { concurrentExecutions++; return { success: true, value: 'duplicate' }; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  releaseExecution();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(concurrentExecutions, 1);
  assert.equal(firstResult.value, secondResult.value);
  assert.equal(secondResult.isIdempotentReplay, true);
});

test('cluster runtime: Redis loss makes leadership unavailable and stops authoritative role', async () => {
  const redis = new FakeRedisManager(new FakeRedisState(), 'A');
  const leadership = new SimulationLeadership({ redisManager: redis, mode: 'cluster', instanceId: 'A', leaseTtlMs: 1000, renewIntervalMs: 10000 });
  await leadership.start();
  assert.equal(leadership.role, 'LEADER');
  redis.connected = false;
  await assert.rejects(leadership._heartbeat());
  await leadership._redisFailure(new Error('REDIS_UNAVAILABLE'));
  assert.equal(leadership.role, 'UNAVAILABLE');
  assert.equal(leadership.synchronized, false);
  await leadership.stop({ release: false });
});
