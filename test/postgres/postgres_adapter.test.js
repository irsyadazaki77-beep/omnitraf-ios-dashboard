import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresAdapter } from '../../server/db/adapters/postgresAdapter.js';
import { createIncidentRepository } from '../../server/repositories/incidentRepository.js';
import { createAuditRepository } from '../../server/repositories/auditRepository.js';
import { createSignalConfigRepository } from '../../server/repositories/signalConfigRepository.js';
import { createDeviceRepository } from '../../server/repositories/deviceRepository.js';
import { POSTGRES_MIGRATIONS } from '../../server/db/migrations/postgresMigrations.js';
import { createCommandReceiptRepository } from '../../server/repositories/commandReceiptRepository.js';

const connectionString = process.env.DATABASE_URL;
const postgresRequired = process.env.REQUIRE_POSTGRES_TESTS === 'true';
test('PostgreSQL adapter connection, migrations, repository semantics and rollback', { skip: !connectionString && !postgresRequired ? 'SKIPPED: DATABASE_URL is not configured.' : false }, async (t) => {
  assert.ok(connectionString, 'DATABASE_URL is required when PostgreSQL integration tests are mandatory.');
  const { Pool } = pg;
  const admin = new Pool({ connectionString, max: 1 });
  const schema = `omnitraf_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const isolatedUrl = new URL(connectionString);
  isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const db = new PostgresAdapter({ connectionString: isolatedUrl.toString(), poolMax: 2 });
  t.after(async () => {
    await db.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  await db.init();
  const incidents = createIncidentRepository(db);
  const audits = createAuditRepository(db);
  const signals = createSignalConfigRepository(db);
  const devices = createDeviceRepository(db);
  const receipts = createCommandReceiptRepository(db);
  assert.equal(await db.ping(), true);
  assert.equal(db.getHealth().driver, 'postgres');
  const { runPostgresMigrations } = await import('../../server/db/migrations/postgresMigrations.js');
  await runPostgresMigrations(db.pool);
  const migration = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(migration.rows.map((row) => Number(row.version)), POSTGRES_MIGRATIONS.map((entry) => entry.version));

  const firstEpoch = await db.claimLeadershipFence('leader-a', 5000);
  assert.ok(firstEpoch);
  assert.equal(await db.claimLeadershipFence('leader-b', 5000), null, 'a live PostgreSQL fence cannot be stolen');
  await db.transaction((tx) => tx.query('INSERT INTO audit_logs(action) VALUES($1)', ['fenced write']), {
    leadershipFence: { instanceId: 'leader-a', epoch: firstEpoch }
  });
  await assert.rejects(
    db.transaction((tx) => tx.query('INSERT INTO audit_logs(action) VALUES($1)', ['lease lost before commit']), {
      leadershipFence: { instanceId: 'leader-a', epoch: firstEpoch },
      validateLeadershipFence: async () => { throw Object.assign(new Error('REDIS_LEASE_LOST'), { code: 'LEADERSHIP_FENCE_REJECTED' }); }
    }),
    (error) => error.code === 'LEADERSHIP_FENCE_REJECTED'
  );
  assert.equal((await db.query("SELECT id FROM audit_logs WHERE action='lease lost before commit'")).rowCount, 0);
  await db.query("UPDATE cluster_leadership_fence SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE scope = 'simulation'");
  const secondEpoch = await db.claimLeadershipFence('leader-b', 5000);
  assert.ok(secondEpoch);
  assert.notEqual(String(secondEpoch), String(firstEpoch));
  await assert.rejects(
    db.transaction((tx) => tx.query('INSERT INTO audit_logs(action) VALUES($1)', ['stale fenced write']), {
      leadershipFence: { instanceId: 'leader-a', epoch: firstEpoch }
    }),
    (error) => error.code === 'LEADERSHIP_FENCE_REJECTED'
  );
  assert.equal((await db.query("SELECT id FROM audit_logs WHERE action='stale fenced write'")).rowCount, 0);

  await incidents.upsert({ id: 'ROLLBACK-1', category: 'test', status: 'ACTIVE' });
  await assert.rejects(db.transaction(async (tx) => {
    await tx.query('INSERT INTO incidents(id,status) VALUES($1,$2)', ['ROLLBACK-2', 'ACTIVE']);
    await tx.query('INSERT INTO audit_logs(action) VALUES($1)', ['test rollback']);
    throw new Error('force rollback');
  }), /force rollback/);
  const afterRollback = await db.query('SELECT id FROM incidents ORDER BY id');
  assert.deepEqual(afterRollback.rows.map((row) => row.id), ['ROLLBACK-1']);
  const auditAfterRollback = await db.query("SELECT id FROM audit_logs WHERE action='test rollback'");
  assert.equal(auditAfterRollback.rowCount, 0);

  await incidents.upsert({ id:'PARITY-1',category:'collision',status:'ACTIVE',coordinates:[1,2] });
  assert.equal((await incidents.findById('PARITY-1')).category, 'collision');
  await signals.upsert('node-test', {greenSplit:42,cycleTime:90,mode:'ADAPTIVE_AI'});
  assert.equal((await signals.findAll()).data.find((row)=>row.node_id==='node-test').green_split, 42);
  await devices.upsert({deviceId:'device-test',type:'sensor',status:'ONLINE',battery:80});
  assert.equal((await devices.findById('device-test')).deviceId,'device-test');

  const audit = { commandId: 'cmd-unique', idempotencyKey:'idem-unique', correlationId: 'corr-unique', action: 'test', result: 'OK' };
  await audits.insert(audit);
  await audits.insert(audit);
  const persistedLogs = await audits.findAll({limit:10,commandId:'cmd-unique'});
  assert.equal(persistedLogs.data.filter((entry) => entry.commandId === 'cmd-unique').length, 1);

  const receipt = {actorId:'operator-1',idempotencyKey:'retry-key',fingerprint:'fp',commandId:'cmd-retry',correlationId:'corr-retry',action:'incident:create'};
  await db.transaction(async (tx) => {
    assert.equal(await receipts.claim(receipt, tx), true);
    await receipts.complete(receipt.actorId, receipt.idempotencyKey, {success:true, commandId:receipt.commandId}, tx);
  });
  assert.equal((await receipts.find(receipt.actorId, receipt.idempotencyKey)).result.success, true);
  await db.transaction(async (tx) => assert.equal(await receipts.claim(receipt, tx), false));
  assert.equal((await receipts.find(receipt.actorId, 'rotated-key', db, receipt.commandId)).result.success, true);

  for (let index = 0; index < 505; index++) await audits.insert({action:'retention_probe',result:'RECORDED',commandId:`retention-${index}`});
  const retained = await audits.findAll({limit:10,offset:500,action:'retention_probe'});
  assert.equal(retained.status, 'OK');
  assert.equal((await audits.findAll({limit:10,action:'retention_probe'})).data.length, 10);
});
