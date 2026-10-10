import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { DatabaseManager } from '../../server/db/database.js';
import { BackendStateManager } from '../../server/services/stateManager.js';
import { testDatabasePath } from '../helpers/testDatabasePath.js';

describe('Phase 17: Persistence, Recovery & Data Integrity Hardening Test Suite', () => {
  const testDir = testDatabasePath('persistence');
  const testDbPath = path.join(testDir, 'test_omnitraf.sqlite');

  before(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  after(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('1. Fresh database startup: creates schema, metadata, and latest schema version', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    assert.strictEqual(db.isInitialized, true);
    assert.ok(fs.existsSync(testDbPath), 'Database file must be written to disk on startup');

    const schemaVer = db.getMetadata('schema_version');
    assert.strictEqual(schemaVer, '20', 'Schema version metadata must match version 20');

    const incidentsRes = db.getAllIncidents();
    assert.strictEqual(incidentsRes.status, 'OK');
    assert.ok(Array.isArray(incidentsRes.data));
  });

  test('2. Existing database startup: preserves existing records cleanly', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    const sampleIncident = {
      id: 'INC-PERSIST-01',
      title: 'Kepadatan Simpang Joyoboyo',
      category: 'congestion',
      severity: 'medium',
      location: 'Jl. Joyoboyo',
      status: 'ACTIVE',
      assignedUnit: 'Patroli Dishub 01',
      notes: 'Antrean kendaraan dari arah selatan.'
    };
    db.upsertIncident(sampleIncident, true);
    await db.flush();

    // Reopen database from disk in a fresh instance
    const dbReopened = new DatabaseManager();
    dbReopened.dbPath = testDbPath;
    await dbReopened.init();

    const res = dbReopened.getAllIncidents();
    assert.strictEqual(res.status, 'OK');
    const found = res.data.find(i => i.id === 'INC-PERSIST-01');
    assert.ok(found, 'Incident must be recovered from existing database on disk');
    assert.strictEqual(found.location, 'Jl. Joyoboyo');
    assert.strictEqual(found.status, 'ACTIVE');
  });

  test('3. Multiple rapid writes: handles concurrent mutations without corruption', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    const writePromises = [];
    for (let i = 1; i <= 25; i++) {
      writePromises.push(
        Promise.resolve().then(() => {
          db.upsertIncident({
            id: `INC-RAPID-${i}`,
            title: `Rapid Incident #${i}`,
            location: `Jl. Darmo No. ${i}`,
            status: 'ACTIVE'
          });
        })
      );
    }

    await Promise.all(writePromises);
    await db.flushSync();

    const check = db.getAllIncidents();
    assert.strictEqual(check.status, 'OK');
    const rapidItems = check.data.filter(i => i.id.startsWith('INC-RAPID-'));
    assert.strictEqual(rapidItems.length, 25, 'All 25 rapid writes must be persisted without corruption');
  });

  test('4. Incident update + immediate restart: status transitions survive reboot', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    const incId = 'INC-LIFECYCLE-99';
    db.upsertIncident({
      id: incId,
      title: 'Truk Mogok Jemursari',
      status: 'ACTIVE',
      notes: 'Lajur kiri terhalang.'
    }, true);
    await db.flush();

    // Mutate to RESOLVED
    const nowIso = new Date().toISOString();
    db.upsertIncident({
      id: incId,
      title: 'Truk Mogok Jemursari',
      status: 'RESOLVED',
      resolvedAt: nowIso,
      notes: 'Truk telah diderek.'
    }, true);
    await db.flush();

    // Simulate immediate server crash and restart
    const dbCrashedReboot = new DatabaseManager();
    dbCrashedReboot.dbPath = testDbPath;
    await dbCrashedReboot.init();

    const res = dbCrashedReboot.getAllIncidents();
    const inc = res.data.find(i => i.id === incId);
    assert.ok(inc);
    assert.strictEqual(inc.status, 'RESOLVED', 'Status must survive restart as RESOLVED');
    assert.strictEqual(inc.notes, 'Truk telah diderek.');
  });

  test('5. Signal config + immediate restart: custom timings preserved', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    db.upsertSignalConfig('node-tunjungan', {
      greenSplit: 52,
      cycleTime: 110,
      mode: 'MANUAL_OVERRIDE'
    }, true);
    await db.flush();

    const dbReboot = new DatabaseManager();
    dbReboot.dbPath = testDbPath;
    await dbReboot.init();

    const sigs = dbReboot.getAllSignalConfigs();
    assert.strictEqual(sigs.status, 'OK');
    const tunjungan = sigs.data.find(s => s.node_id === 'node-tunjungan');
    assert.ok(tunjungan);
    assert.strictEqual(Number(tunjungan.green_split), 52);
    assert.strictEqual(Number(tunjungan.cycle_time), 110);
    assert.strictEqual(tunjungan.mode, 'MANUAL_OVERRIDE');
  });

  test('6. Device config + immediate restart: FPS & resolution preserved', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    db.upsertDeviceTelemetry({
      deviceId: 'NODE-EDGE-01',
      fps: 45,
      resolution: '4k',
      greenWaveSync: true
    }, true);
    await db.flush();

    const dbReboot = new DatabaseManager();
    dbReboot.dbPath = testDbPath;
    await dbReboot.init();

    const devs = dbReboot.getAllDeviceTelemetry();
    assert.strictEqual(devs.status, 'OK');
    const edge01 = devs.data.find(d => d.deviceId === 'NODE-EDGE-01');
    assert.ok(edge01);
    assert.strictEqual(edge01.fps, 45);
    assert.strictEqual(edge01.resolution, '4k');
    assert.strictEqual(edge01.greenWaveSync, true);
  });

  test('7. Audit log burst: event deduplication and durable history beyond 500 entries', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    const burstCorrId = 'CORR-BURST-100';
    // Insert 5 logs with exact same correlationId
    for (let i = 0; i < 5; i++) {
      db.insertAuditLog({
        operator: 'Zaki Putra',
        action: 'SIGNAL_OVERRIDE',
        entity: 'node-wonokromo',
        result: 'SUCCESS',
        correlationId: burstCorrId,
        details: 'Override green light'
      });
    }
    await db.flushSync();

    const logsRes = db.getAllAuditLogs(50);
    assert.strictEqual(logsRes.status, 'OK');
    const duplicates = logsRes.data.filter(l => l.correlationId === burstCorrId);
    assert.strictEqual(duplicates.length, 1, 'Burst logs with identical correlationId must be deduplicated to 1 record');
    for (let index = 0; index < 510; index++) {
      db.insertAuditLog({ operator:'retention-test', action:'RETENTION_PROBE', entity:`entry-${index}`, result:'RECORDED', correlationId:`retention-${index}` });
    }
    await db.flushSync();
    const retained = await db.query("SELECT COUNT(*) AS total FROM audit_logs WHERE action='RETENTION_PROBE'");
    assert.equal(Number(retained.rows[0].total), 510, 'Persistent audit history must not be trimmed at 500 entries');
  });

  test('8. Database write failure: uninitialized DB throws and does not report success', () => {
    const uninitDb = new DatabaseManager();
    assert.strictEqual(uninitDb.isInitialized, false);

    assert.throws(() => {
      uninitDb.upsertIncident({ id: 'FAIL-1', title: 'Should fail' });
    }, /DATABASE_UNAVAILABLE/);
  });

  test('9. Malformed payload row: defensive parsing handles corrupt JSON gracefully', async () => {
    const db = new DatabaseManager();
    db.dbPath = testDbPath;
    await db.init();

    // Directly insert an invalid corrupt JSON string into payload
    const corruptId = 'INC-CORRUPT-JSON';
    const stmt = db.db.prepare(`
      INSERT INTO incidents (id, type, location, lat, lng, time, status, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run([
      corruptId,
      'accident',
      'Jl. Ahmad Yani KM 8',
      -7.31,
      112.73,
      new Date().toISOString(),
      'ACTIVE',
      '{"bad_json_not_terminated...' // Malformed JSON payload
    ]);
    stmt.free();
    await db.flushSync();

    const res = db.getAllIncidents();
    assert.strictEqual(res.status, 'OK');
    const corruptInc = res.data.find(i => i.id === corruptId);
    assert.ok(corruptInc, 'Corrupted row must still be safely loaded with defensive field fallbacks');
    assert.strictEqual(corruptInc.id, corruptId);
    assert.strictEqual(corruptInc.location, 'Jl. Ahmad Yani KM 8');
    assert.strictEqual(corruptInc.status, 'ACTIVE');
  });

  test('10. Active runtime state at shutdown: active emergency reset on hydration', async () => {
    const stateManager = new BackendStateManager();
    // Simulate active in-flight emergency before crash
    stateManager.state.activeEmergencies = [
      {
        id: 'EMG-PRE-CRASH',
        vehicleId: 'AMB-99',
        status: 'EN_ROUTE',
        routeId: 'route-soetomo'
      }
    ];
    stateManager.state.greenWaveActive = true;

    // Run hydration
    await stateManager.init();

    const emg = stateManager.state.activeEmergencies.find(e => e.id === 'EMG-PRE-CRASH');
    assert.ok(emg);
    assert.strictEqual(emg.status, 'CANCELLED_UPON_RESTART', 'Active emergency must transition to safe reset on reboot');
    assert.strictEqual(stateManager.state.greenWaveActive, false, 'Green wave lock must be released on restart');
  });

  test('11. Restart lalu frontend resync: snapshot reflects authoritative SQLite data', async () => {
    const stateManager = new BackendStateManager();
    await stateManager.init();

    const snapshot = stateManager.getSnapshot();
    assert.ok(snapshot.seq >= 1);
    assert.strictEqual(snapshot.source, 'server');
    assert.ok(Array.isArray(snapshot.state.incidents));
    assert.ok(snapshot.state.intersections.length > 0);
  });

  test('12. Burst mutations coalesce into bounded atomic flushes', async () => {
    const db = new DatabaseManager();
    db.dbPath = path.join(testDir, 'coalescing.sqlite');
    await db.init();
    const before = db.getHealth().flushCount;
    for (let i = 0; i < 80; i++) {
      db.upsertIncident({ id: `INC-COALESCE-${i}`, title: `Incident ${i}`, status: 'ACTIVE' });
    }
    await db.flush();
    assert.ok(db.getHealth().flushCount - before <= 2, 'a mutation burst must be persisted in one bounded flush');
    await db.shutdown();
  });

  test('13. A mutation during asynchronous file replacement is persisted by the same drain', async () => {
    const db = new DatabaseManager();
    db.dbPath = path.join(testDir, 'concurrent-flush.sqlite');
    await db.init();
    db.upsertIncident({ id: 'INC-BEFORE-FLUSH', status: 'ACTIVE' });
    const draining = db.flush();
    db.upsertIncident({ id: 'INC-DURING-FLUSH', status: 'ACTIVE' });
    await draining;
    const reopened = new DatabaseManager();
    reopened.dbPath = db.dbPath;
    await reopened.init();
    const ids = reopened.getAllIncidents().data.map((incident) => incident.id);
    assert.ok(ids.includes('INC-BEFORE-FLUSH'));
    assert.ok(ids.includes('INC-DURING-FLUSH'));
    await db.shutdown();
    await reopened.shutdown();
  });

  test('14. Shutdown drains pending mutations before closing database', async () => {
    const db = new DatabaseManager();
    db.dbPath = path.join(testDir, 'shutdown-drain.sqlite');
    await db.init();
    db.upsertIncident({ id: 'INC-SHUTDOWN-FLUSH', status: 'ACTIVE' });
    await db.shutdown();
    const reopened = new DatabaseManager();
    reopened.dbPath = db.dbPath;
    await reopened.init();
    assert.ok(reopened.getAllIncidents().data.some((incident) => incident.id === 'INC-SHUTDOWN-FLUSH'));
    await reopened.shutdown();
  });

  test('15. Failed atomic replacement reports degraded persistence diagnostics', async () => {
    const db = new DatabaseManager();
    db.dbPath = path.join(testDir, 'failed-write.sqlite');
    await db.init();
    await fs.promises.unlink(db.dbPath);
    await fs.promises.mkdir(db.dbPath);
    db.upsertIncident({ id: 'INC-FAILED-FLUSH', status: 'ACTIVE' });
    assert.strictEqual(await db.flush(), false);
    const health = db.getHealth();
    assert.strictEqual(health.status, 'DEGRADED');
    assert.strictEqual(health.dirty, true);
    assert.ok(health.failedFlushCount >= 1);
    assert.ok(health.lastError);
    await fs.promises.rm(db.dbPath, { recursive: true, force: true });
    await db.shutdown();
  });

  test('16. Relative DB_PATH resolves from repository root regardless of process working directory', () => {
    const previousCwd = process.cwd();
    const previousDbPath = process.env.DB_PATH;
    try {
      process.env.DB_PATH = path.join('data', 'cwd-independent.sqlite');
      process.chdir(testDir);
      const configuredDb = new DatabaseManager();
      assert.strictEqual(configuredDb.dbPath, path.join(previousCwd, 'data', 'cwd-independent.sqlite'));
    } finally {
      process.chdir(previousCwd);
      if (previousDbPath === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = previousDbPath;
    }
  });
});
