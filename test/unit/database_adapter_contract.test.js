import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseManager } from '../../server/db/database.js';
import { testDatabasePath } from '../helpers/testDatabasePath.js';
import { createIncidentRepository } from '../../server/repositories/incidentRepository.js';
import { createAuditRepository } from '../../server/repositories/auditRepository.js';

test('sqljs implements shared query and rollback contract', async () => {
  const database = new DatabaseManager({ driver: 'sqljs' });
  database.dbPath = path.join(testDatabasePath('database-adapter-contract'), 'adapter.sqlite');
  await database.init();
  try {
    assert.equal(database.driver, 'sqljs');
    assert.equal(await database.ping(), true);
    const incidents = createIncidentRepository(database);
    const audits = createAuditRepository(database);
    await incidents.upsert({id:'REPO-1',category:'collision',status:'ACTIVE',coordinates:[1,2]});
    assert.equal((await incidents.findById('REPO-1')).category,'collision');
    const audit = {commandId:'sqljs-command',idempotencyKey:'sqljs-idempotency',action:'test'};
    await audits.insert(audit);
    await audits.insert(audit);
    assert.equal((await audits.findAll({commandId:'sqljs-command'})).data.length,1);
    await database.execute('INSERT INTO incidents(id,status) VALUES($1,$2)', ['CONTRACT-1', 'ACTIVE']);
    assert.equal((await database.query('SELECT id FROM incidents WHERE id=$1', ['CONTRACT-1'])).rows[0].id, 'CONTRACT-1');
    await assert.rejects(database.transaction(async (tx) => {
      await tx.execute('INSERT INTO incidents(id,status) VALUES($1,$2)', ['CONTRACT-2', 'ACTIVE']);
      throw new Error('force rollback');
    }), /force rollback/);
    assert.equal((await database.query('SELECT id FROM incidents WHERE id=$1', ['CONTRACT-2'])).rowCount, 0);
  } finally { await database.close(); }
});

test('production cluster refuses local sqljs persistence and PostgreSQL requires a URL', async () => {
  const original = { node: process.env.NODE_ENV, mode: process.env.OMNITRAF_RUNTIME_MODE, driver: process.env.DB_DRIVER, url: process.env.DATABASE_URL, allow: process.env.ALLOW_SQLJS_CLUSTER };
  try {
    process.env.NODE_ENV = 'production';
    process.env.OMNITRAF_RUNTIME_MODE = 'cluster';
    process.env.DB_DRIVER = 'sqljs';
    delete process.env.ALLOW_SQLJS_CLUSTER;
    assert.throws(() => new DatabaseManager(), /requires DB_DRIVER=postgres|requires DB_DRIVER/);
    process.env.DB_DRIVER = 'postgres';
    delete process.env.DATABASE_URL;
    assert.throws(() => new DatabaseManager(), /DATABASE_URL is required/);
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/omnitraf_test';
    const clusterPostgres = new DatabaseManager();
    assert.equal(clusterPostgres.driver, 'postgres');
    await clusterPostgres.close();
  } finally {
    for (const [key, value] of [['NODE_ENV',original.node],['OMNITRAF_RUNTIME_MODE',original.mode],['DB_DRIVER',original.driver],['DATABASE_URL',original.url],['ALLOW_SQLJS_CLUSTER',original.allow]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
