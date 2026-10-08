import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresAdapter } from '../../server/db/adapters/postgresAdapter.js';
import { createIncidentRepository } from '../../server/repositories/incidentRepository.js';
import { createAuditRepository } from '../../server/repositories/auditRepository.js';
import { createSignalConfigRepository } from '../../server/repositories/signalConfigRepository.js';
import { createDeviceRepository } from '../../server/repositories/deviceRepository.js';

const connectionString = process.env.DATABASE_URL;
test('PostgreSQL adapter connection, migrations, repository semantics and rollback', { skip: !connectionString }, async (t) => {
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
  assert.equal(await db.ping(), true);
  assert.equal(db.getHealth().driver, 'postgres');
  const migration = await db.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  assert.equal(Number(migration.rows[0]?.version), 1);

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
});
