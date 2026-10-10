import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresAdapter } from '../../server/db/adapters/postgresAdapter.js';
import { RedisManager } from '../../server/infrastructure/redis/redisManager.js';
import { SimulationLeadership } from '../../server/infrastructure/redis/simulationLeadership.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const clusterRequired = process.env.REQUIRE_CLUSTER_TESTS === 'true';
const waitFor = async (predicate, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= until) throw new Error('Timed out waiting for cluster leadership transition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('Redis and PostgreSQL elect one leader and fence takeover after lease expiry', {
  skip: (!databaseUrl || !redisUrl) && !clusterRequired ? 'SKIPPED: DATABASE_URL and REDIS_URL are required for real cluster validation.' : false
}, async (t) => {
  assert.ok(databaseUrl && redisUrl, 'DATABASE_URL and REDIS_URL are required when cluster integration tests are mandatory.');
  const { Pool } = pg;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `cluster_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const databases = ['A', 'B', 'C'].map(() => new PostgresAdapter({ connectionString: isolatedUrl.toString(), poolMax: 2 }));
  const redis = ['A', 'B', 'C'].map(() => new RedisManager({ url: redisUrl }));
  const leaders = ['A', 'B', 'C'].map((instanceId, index) => new SimulationLeadership({
    redisManager: redis[index], databaseManager: databases[index], mode: 'cluster', instanceId,
    leaseTtlMs: 900, renewIntervalMs: 150,
    onSnapshot: () => ({ schemaVersion: 1, simulationSessionId: 'test-session', stateVersion: 1, simulationCheckpoint: {}, auditLogs: [] }),
    applySnapshot: async () => true
  }));
  t.after(async () => {
    await Promise.allSettled(leaders.map((leadership) => leadership.stop()));
    await Promise.allSettled(redis.map((manager) => manager.disconnect()));
    await Promise.allSettled(databases.map((database) => database.close()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  for (let index = 0; index < databases.length; index++) {
    await databases[index].init();
    await redis[index].connect();
  }
  await Promise.all(leaders.map((leadership) => leadership.start()));
  assert.equal(leaders.filter((leadership) => leadership.isLeader()).length, 1);
  const oldLeader = leaders.find((leadership) => leadership.isLeader());
  const oldEpoch = oldLeader.epoch;
  const staleFence = { instanceId: oldLeader.instanceId, epoch: oldEpoch };
  const oldDatabase = databases[['A', 'B', 'C'].indexOf(oldLeader.instanceId)];

  await oldLeader.stop({ release: false }); // Leave both leases to expire, as on process loss.
  await waitFor(() => leaders.filter((leadership) => leadership.isLeader()).length === 1 && leaders.some((leadership) => leadership.isLeader() && leadership.instanceId !== oldLeader.instanceId), 4000);
  const newLeader = leaders.find((leadership) => leadership.isLeader());
  assert.notEqual(String(newLeader.epoch), String(oldEpoch));
  await assert.rejects(
    oldDatabase.transaction((tx) => tx.query('INSERT INTO audit_logs(action) VALUES($1)', ['stale leader']), { leadershipFence: staleFence }),
    (error) => error.code === 'LEADERSHIP_FENCE_REJECTED'
  );
  assert.equal((await oldDatabase.query("SELECT id FROM audit_logs WHERE action='stale leader'")).rowCount, 0);
});
