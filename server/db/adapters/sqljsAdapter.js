import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const isTest = typeof global.it === 'function' ||
               typeof global.test === 'function' ||
               process.env.NODE_ENV === 'test' ||
               (process.env.DB_PATH && process.env.DB_PATH.includes('test')) ||
               process.env.PORT === '0';

if (isTest) {
  console.log = () => {};
  console.warn = () => {};
}

import fsPromises from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCanonicalIncident, normalizeCanonicalDevice, CompatibilityAdapters } from '../../config/domainModels.js';
import { runMigrations } from '../migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_DB_PATH = path.join(APP_ROOT, 'data', 'omnitraf.sqlite');

async function atomicReplace(tmpPath, targetPath) {
  try {
    await fsPromises.rename(tmpPath, targetPath);
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
    let targetStat;
    try { targetStat = await fsPromises.stat(targetPath); }
    catch (statError) { if (statError.code === 'ENOENT') throw error; throw statError; }
    if (!targetStat.isFile()) throw error;

    const backupPath = `${targetPath}.replace.${process.pid}.${Date.now()}`;
    await fsPromises.rename(targetPath, backupPath);
    try {
      await fsPromises.rename(tmpPath, targetPath);
      await fsPromises.rm(backupPath, { force: true });
    } catch (replaceError) {
      try { await fsPromises.rename(backupPath, targetPath); } catch (restoreError) {
        throw new AggregateError([replaceError, restoreError], 'DATABASE_REPLACE_AND_RESTORE_FAILED');
      }
      throw replaceError;
    }
  }
}

/**
 * OmniTRAF SITS Surabaya - Embedded SQLite Persistence & Recovery Layer (Phase 17 Hardened)
 * - Atomic binary flush via temporary file + atomic rename (POSIX crash-proof durability)
 * - Non-destructive schema migrations & metadata version tracking
 * - Distinct operational states (EMPTY vs UNAVAILABLE vs ERROR)
 * - Defensive recovery rules for corrupted rows, missing fields & shutdown synchronization
 */
export class SqlJsAdapter {
  driver = 'sqljs';
  constructor() {
    this.db = null;
    this.SQL = null;
    this.dbPath = process.env.DB_PATH
      ? (path.isAbsolute(process.env.DB_PATH) ? path.normalize(process.env.DB_PATH) : path.resolve(APP_ROOT, process.env.DB_PATH))
      : DEFAULT_DB_PATH;
    this.isInitialized = false;
    this._saveTimer = null;
    this.dirty = false;
    this.flushScheduled = false;
    this.flushInProgress = false;
    this.flushRequestedDuringWrite = false;
    this._flushPromise = null;
    this._flushWaiters = [];
    this._closed = false;
    this._transactionDepth = 0;
    this._transactionQueue = Promise.resolve();
    this._transactionContext = new AsyncLocalStorage();
    this._metrics = { flushCount: 0, failedFlushCount: 0, totalFlushDurationMs: 0, lastFlushDurationMs: null, lastFlushAt: null, lastError: null };
    this._initPromise = null;
    this.schemaVersion = 19;
  }

  /**
   * Idempotent initialization with concurrency guard
   */
  async init() {
    if (this.isInitialized && this.db) {
      return this;
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        const dir = path.dirname(this.dbPath);
        await fsPromises.mkdir(dir, { recursive: true });

        this.SQL = await initSqlJs();

        try {
          await fsPromises.access(this.dbPath);
          const fileBuffer = await fsPromises.readFile(this.dbPath);
          if (fileBuffer.length > 0) {
            try {
              this.db = new this.SQL.Database(fileBuffer);
            } catch (parseErr) {
              const backupPath = `${this.dbPath}.corrupt.${Date.now()}`;
              await fsPromises.rename(this.dbPath, backupPath);
              console.error(`❌ [Database] Database SQLite korup (${parseErr.message}); berkas dipindah ke backup ${path.basename(backupPath)}.`);
              this.db = new this.SQL.Database();
            }
            console.log(`🗄️ [Database] Memuat database tersemat SQLite dari ${fileBuffer.length} bytes.`);
          } else {
            console.warn('⚠️ [Database] File database berukuran 0 byte, membuat database SQLite baru.');
            this.db = new this.SQL.Database();
          }
        } catch (accessErr) {
          if (accessErr.code !== 'ENOENT') throw accessErr;
          this.db = new this.SQL.Database();
          console.log(`🗄️ [Database] Menginisialisasi database SQLite baru di: ${this.dbPath}`);
        }

        this._createTables();
        this._runMigrations();
        this.isInitialized = true;
        this.markDirty();
        if (!await this.flush()) throw new Error(`DATABASE_INITIAL_FLUSH_FAILED: ${this._metrics.lastError || 'unknown error'}`);

        return this;
      } catch (err) {
        console.error('❌ [Database] Gagal menginisialisasi SQLite database:', err);
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = null;
        this.flushScheduled = false;
        try { this.db?.close(); } catch (_) {}
        this.isInitialized = false;
        this.db = null;
        throw err;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  getHealth() {
    return { status: this.isInitialized && this.db ? (this._metrics.lastError ? 'DEGRADED' : 'CONNECTED') : 'DISCONNECTED', driver: this.driver, dirty: this.dirty, flushInProgress: this.flushInProgress, pendingFlush: this.flushScheduled || this.flushInProgress || this.dirty, lastFlushAt: this._metrics.lastFlushAt, lastFlushDurationMs: this._metrics.lastFlushDurationMs, lastError: this._metrics.lastError, flushCount: this._metrics.flushCount, failedFlushCount: this._metrics.failedFlushCount, averageFlushDurationMs: this._metrics.flushCount ? this._metrics.totalFlushDurationMs / this._metrics.flushCount : 0 };
  }

  ping() {
    if (!this.db || !this.isInitialized) return false;
    try {
      this.db.exec('SELECT 1;');
      return true;
    } catch (_) {
      return false;
    }
  }

  async query(sql, params = []) {
    if (!this.db || !this.isInitialized || this._closed) throw new Error('DATABASE_UNAVAILABLE');
    if (this._transactionDepth && !this._transactionContext.getStore()) await this._transactionQueue;
    const ordered = [];
    const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => { ordered.push(params[Number(index) - 1]); return '?'; });
    const statement = this.db.prepare(sqliteSql);
    try {
      statement.bind(ordered.length ? ordered : params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return { rows, rowCount: rows.length };
    } finally {
      statement.free();
    }
  }

  async execute(sql, params = []) {
    if (!this.db || !this.isInitialized || this._closed) throw new Error('DATABASE_UNAVAILABLE');
    if (this._transactionDepth && !this._transactionContext.getStore()) await this._transactionQueue;
    const ordered = [];
    const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => { ordered.push(params[Number(index) - 1]); return '?'; });
    this.db.run(sqliteSql, ordered.length ? ordered : params);
    const rowCount = this.db.getRowsModified();
    if (!this._transactionDepth) this.markDirty();
    return { rows: [], rowCount };
  }

  async transaction(callback) {
    if (!this.db || !this.isInitialized) throw new Error('DATABASE_UNAVAILABLE');
    if (this._transactionContext.getStore()) return callback(this);
    const run = () => this._transactionContext.run(true, async () => {
      this.db.run('BEGIN');
      this._transactionDepth++;
      try {
        const result = await callback(this);
        this.db.run('COMMIT');
        this.markDirty();
        return result;
      } catch (error) {
        try { this.db.run('ROLLBACK'); } catch (_) {}
        throw error;
      } finally { this._transactionDepth--; }
    });
    const pending = this._transactionQueue.then(run, run);
    this._transactionQueue = pending.catch(() => {});
    return pending;
  }

  markDirty() {
    if (!this.db || this._closed) return false;
    this.dirty = true;
    this.scheduleFlush();
    return true;
  }

  scheduleFlush(delayMs = 150) {
    if (!this.db || this._closed) return;
    if (this.flushInProgress) { this.flushRequestedDuringWrite = true; return; }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this.flushScheduled = true;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush().catch(() => {}); }, delayMs);
    this._saveTimer.unref?.();
  }

  async flush() {
    if (!this.db || this._closed) return false;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.flushScheduled = false;
    if (this.flushInProgress) {
      return this._flushPromise;
    }
    if (!this.dirty) return true;
    this.flushInProgress = true;
    this._flushPromise = (async () => {
      let outcome = true;
      try {
        do {
          this.flushRequestedDuringWrite = false;
          this.dirty = false;
          const started = Date.now();
          const buffer = Buffer.from(this.db.export());
          const tmpPath = `${this.dbPath}.tmp.${process.pid}.${randomUUID()}`;
          try {
            await fsPromises.writeFile(tmpPath, buffer, { flag: 'wx' });
            await atomicReplace(tmpPath, this.dbPath);
          } catch (err) {
            try { await fsPromises.rm(tmpPath, { force: true }); } catch (_) {}
            throw err;
          }
          this._metrics.flushCount++;
          this._metrics.lastFlushDurationMs = Date.now() - started;
          this._metrics.totalFlushDurationMs += this._metrics.lastFlushDurationMs;
          this._metrics.lastFlushAt = new Date().toISOString();
          this._metrics.lastError = null;
          if (this.flushRequestedDuringWrite) this.dirty = true;
        } while (this.dirty);
      } catch (err) {
        outcome = false;
        this.dirty = true;
        this._metrics.failedFlushCount++;
        this._metrics.lastError = err.code
          ? `${err.code}${err.syscall ? ` during ${err.syscall}` : ''}`
          : 'PERSISTENCE_ERROR';
        console.error('❌ [Database] Gagal menyimpan biner database secara atomik ke disk:', err);
      } finally {
        this.flushInProgress = false;
        this._flushPromise = null;
        if (this.dirty && !this._closed) this.scheduleFlush(1000);
      }
      return outcome;
    })();
    return this._flushPromise;
  }

  async shutdown() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    let flushError = null;
    if (this.db && this.isInitialized) {
      this.setMetadata('last_shutdown_at', new Date().toISOString());
      this.markDirty();
      const flushed = await this.flush();
      if (!flushed) flushError = new Error(`DATABASE_FLUSH_FAILED: ${this._metrics.lastError || 'unknown error'}`);
    }
    await this.close();
    if (flushError) throw flushError;
  }

  async close() {
    if (this._flushPromise) await this._flushPromise;
    this._closed = true;
    if (this.db) this.db.close();
    this.db = null;
    this.isInitialized = false;
  }

  _createTables() {
    // 0. Schema Metadata & Versioning Table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );
    `);
    this.db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );`);

    // 1. Incidents Table (Normalized with Extended Fields)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        type TEXT,
        location TEXT,
        lat REAL,
        lng REAL,
        time TEXT,
        status TEXT,
        severity TEXT,
        priority TEXT,
        resolved_at TEXT,
        acknowledged_at TEXT,
        operator TEXT,
        notes TEXT,
        source TEXT,
        payload TEXT
      );
    `);

    // 2. Audit Logs Table (With Stable Correlation & Details)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator TEXT,
        action TEXT,
        entity TEXT,
        result TEXT,
        correlation_id TEXT,
        details TEXT,
        command_id TEXT,
        idempotency_key TEXT,
        actor_role TEXT,
        source_instance_id TEXT,
        leader_instance_id TEXT,
        timestamp TEXT
      );
    `);

    // 3. Signal Configs Table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS signal_configs (
        node_id TEXT PRIMARY KEY,
        green_split INTEGER,
        cycle_time INTEGER,
        mode TEXT,
        updated_at TEXT
      );
    `);

    // 4. Device Telemetry / Config Table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS device_telemetry (
        device_id TEXT PRIMARY KEY,
        type TEXT,
        status TEXT,
        battery INTEGER,
        ping_ms INTEGER,
        fps INTEGER,
        resolution TEXT,
        green_wave_sync INTEGER,
        updated_at TEXT,
        payload TEXT
      );
    `);
  }

  _runMigrations() {
    runMigrations(this.db, (tableName) => this._getTableColumns(tableName), (key, value) => {
      if (!this.setMetadata(key, value)) throw new Error(`DATABASE_METADATA_MIGRATION_FAILED: ${key}`);
    }, this.schemaVersion);
    this.db.run(`CREATE TABLE IF NOT EXISTS audit_deduplication_keys (dedupe_key TEXT PRIMARY KEY, created_at TEXT NOT NULL);`);
    this.db.run("INSERT OR IGNORE INTO audit_deduplication_keys(dedupe_key,created_at) SELECT DISTINCT 'corr:' || correlation_id, datetime('now') FROM audit_logs WHERE correlation_id IS NOT NULL;");
    this.db.run("INSERT OR IGNORE INTO audit_deduplication_keys(dedupe_key,created_at) SELECT DISTINCT 'idem:' || idempotency_key, datetime('now') FROM audit_logs WHERE idempotency_key IS NOT NULL;");
    const applied = this.db.exec('SELECT version FROM schema_migrations;');
    const versions = new Set(applied[0]?.values.map(([version]) => Number(version)) || []);
    const migration = this.db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?);');
    for (const [version, name] of [[18, 'legacy_schema_upgrade_and_indexes'], [19, 'durable_audit_deduplication']]) {
      if (!versions.has(version)) migration.run([version, name, new Date().toISOString()]);
    }
    migration.free();
  }

  _getTableColumns(tableName) {
    try {
      const res = this.db.exec(`PRAGMA table_info(${tableName});`);
      if (!res.length || !res[0].values) return [];
      // Col name is index 1
      return res[0].values.map(row => row[1]);
    } catch (error) {
      throw new Error(`DATABASE_SCHEMA_INSPECTION_FAILED: ${error.message}`, { cause: error });
    }
  }

  /**
   * Atomic file write via temporary file + atomic rename
   * Prevents half-written corrupted SQLite files when process crashes during write
   */
  saveToDisk() { return this.markDirty(); }
  flushSync() { return this.flush(); }

  debounceSave() { this.markDirty(); }

  // ==========================================
  // METADATA & SEQUENCE OPERATIONS
  // ==========================================
  getMetadata(key) {
    if (!this.db) return null;
    try {
      const stmt = this.db.prepare("SELECT value FROM schema_metadata WHERE key = ?;");
      stmt.bind([key]);
      let val = null;
      if (stmt.step()) {
        val = stmt.get()[0];
      }
      stmt.free();
      return val;
    } catch (err) {
      console.error(`❌ [Database] getMetadata error for key ${key}:`, err.message);
      return null;
    }
  }

  setMetadata(key, value) {
    if (!this.db) return false;
    try {
      const ts = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO schema_metadata (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
      `);
      stmt.run([String(key), String(value), ts]);
      stmt.free();
      return true;
    } catch (err) {
      console.error(`❌ [Database] setMetadata error for key ${key}:`, err.message);
      return false;
    }
  }

  // ==========================================
  // INCIDENTS OPERATIONS
  // ==========================================
  getAllIncidents() {
    if (!this.db || !this.isInitialized) {
      return { status: 'UNAVAILABLE', error: 'Database belum terinisialisasi', data: [] };
    }

    try {
      const res = this.db.exec("SELECT * FROM incidents ORDER BY time DESC;");
      if (!res.length || !res[0].values) {
        return { status: 'OK', data: [] };
      }

      const cols = res[0].columns;
      const incidents = res[0].values.map(row => {
        const item = {};
        cols.forEach((col, idx) => item[col] = row[idx]);

        // Defensive JSON parsing with fallback
        let payloadObj = {};
        if (item.payload) {
          try {
            payloadObj = JSON.parse(item.payload);
          } catch (jsonErr) {
            console.warn(`⚠️ [Database] Malformed JSON payload pada insiden #${item.id}, menggunakan field fallback.`);
          }
        }

        const rawMapped = {
          id: item.id,
          title: payloadObj.title || item.type || `Insiden #${item.id}`,
          category: payloadObj.category || item.type || 'congestion',
          severity: item.severity || payloadObj.severity || 'medium',
          location: item.location || 'Surabaya',
          coordinates: [item.lat || 0, item.lng || 0],
          status: item.status || 'ACTIVE',
          priority: item.priority || payloadObj.priority || 'normal',
          source: item.source || payloadObj.source || 'SITS Core',
          assignedUnit: item.operator || payloadObj.assignedUnit || 'Petugas SITS',
          notes: item.notes || payloadObj.notes || '',
          reportedAt: item.time || payloadObj.reportedAt || new Date().toISOString(),
          updatedAt: payloadObj.updatedAt || item.time || new Date().toISOString(),
          acknowledgedAt: item.acknowledged_at || payloadObj.acknowledgedAt || null,
          resolvedAt: item.resolved_at || payloadObj.resolvedAt || null
        };
        const canonical = normalizeCanonicalIncident(rawMapped);
        return CompatibilityAdapters.toLegacyIncident(canonical);
      });

      return { status: 'OK', data: incidents };
    } catch (err) {
      console.error('❌ [Database] getAllIncidents error:', err);
      return { status: 'ERROR', error: err.message, data: [] };
    }
  }

  upsertIncident(incident, flushImmediate = false) {
    if (!this.db || !this.isInitialized) {
      throw new Error("DATABASE_UNAVAILABLE: Tidak dapat menyimpan insiden, SQLite belum aktif.");
    }
    if (!incident || !incident.id) {
      throw new Error("VALIDATION_ERROR: Objek insiden harus memiliki properti 'id'.");
    }

    try {
      const payloadStr = JSON.stringify(incident);
      const coords = Array.isArray(incident.coordinates) ? incident.coordinates : [0, 0];
      const lat = coords[0] || incident.lat || 0;
      const lng = coords[1] || incident.lng || 0;
      const time = incident.reportedAt || incident.timestamp || incident.time || new Date().toISOString();
      const status = incident.status || 'ACTIVE';
      const severity = incident.severity || 'medium';
      const priority = incident.priority || (severity === 'critical' || severity === 'high' ? 'high' : 'normal');
      const resolvedAt = incident.resolvedAt || (status === 'RESOLVED' ? new Date().toISOString() : null);
      const acknowledgedAt = incident.acknowledgedAt || (status === 'ACKNOWLEDGED' ? new Date().toISOString() : null);
      const operator = incident.assignedUnit || incident.operator || 'SITS Dispatcher';
      const notes = incident.notes || '';
      const source = incident.source || 'SITS System';

      const stmt = this.db.prepare(`
        INSERT INTO incidents (
          id, type, location, lat, lng, time, status, severity, priority,
          resolved_at, acknowledged_at, operator, notes, source, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          location = excluded.location,
          lat = excluded.lat,
          lng = excluded.lng,
          time = excluded.time,
          status = excluded.status,
          severity = excluded.severity,
          priority = excluded.priority,
          resolved_at = excluded.resolved_at,
          acknowledged_at = excluded.acknowledged_at,
          operator = excluded.operator,
          notes = excluded.notes,
          source = excluded.source,
          payload = excluded.payload;
      `);

      stmt.run([
        String(incident.id),
        String(incident.category || incident.type || 'traffic'),
        String(incident.location || 'Surabaya'),
        lat,
        lng,
        time,
        status,
        severity,
        priority,
        resolvedAt,
        acknowledgedAt,
        operator,
        notes,
        source,
        payloadStr
      ]);
      stmt.free();

      if (flushImmediate) {
        this.saveToDisk(true);
      } else {
        this.debounceSave();
      }

      return true;
    } catch (err) {
      console.error('❌ [Database] upsertIncident error:', err);
      throw new Error(`PERSISTENCE_FAILED: Gagal menyimpan insiden #${incident.id} ke SQLite (${err.message})`);
    }
  }

  deleteIncident(id) {
    if (!this.db || !this.isInitialized) return false;
    try {
      const stmt = this.db.prepare("DELETE FROM incidents WHERE id = ?;");
      stmt.run([String(id)]);
      stmt.free();
      this.debounceSave();
      return true;
    } catch (err) {
      console.error(`❌ [Database] deleteIncident error for #${id}:`, err);
      return false;
    }
  }

  // ==========================================
  // AUDIT LOGS OPERATIONS
  // ==========================================
  getAllAuditLogs(limit = 100) {
    if (!this.db || !this.isInitialized) {
      return { status: 'UNAVAILABLE', error: 'Database belum terinisialisasi', data: [] };
    }

    try {
      const stmt = this.db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?;");
      stmt.bind([limit]);
      const logs = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        logs.push({
          id: row.id,
          operator: row.operator,
          action: row.action,
          entity: row.entity,
          result: row.result,
          correlationId: row.correlation_id,
          commandId: row.command_id,
          idempotencyKey: row.idempotency_key,
          actorRole: row.actor_role,
          sourceInstanceId: row.source_instance_id,
          leaderInstanceId: row.leader_instance_id,
          details: row.details,
          timestamp: row.timestamp
        });
      }
      stmt.free();
      return { status: 'OK', data: logs };
    } catch (err) {
      console.error('❌ [Database] getAllAuditLogs error:', err);
      return { status: 'ERROR', error: err.message, data: [] };
    }
  }

  insertAuditLog({ operator, action, entity, result, timestamp, correlationId, commandId, idempotencyKey, actorRole, sourceInstanceId, leaderInstanceId, details }, flushImmediate = false) {
    if (!this.db || !this.isInitialized) {
      console.warn("⚠️ [Database] insertAuditLog skipped: DB belum siap.");
      return false;
    }

    try {
      const corrId = correlationId || commandId || null;

      // Stable Identifier Deduplication: If correlationId exists and was logged in the last 100 entries, skip insert
      if (corrId) {
        const checkStmt = this.db.prepare("SELECT id FROM audit_logs WHERE correlation_id = ? LIMIT 1;");
        checkStmt.bind([corrId]);
        const exists = checkStmt.step();
        checkStmt.free();
        if (exists) {
          return true; // Already safely stored, idempotent no-op
        }
      }

      const ts = timestamp || new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO audit_logs (operator, action, entity, result, correlation_id, details, command_id, idempotency_key, actor_role, source_instance_id, leader_instance_id, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      stmt.run([
        String(operator || 'System'),
        String(action || 'ACTION'),
        String(entity || 'Global'),
        String(result || 'OK'),
        corrId,
        String(details || ''),
        commandId || corrId,
        idempotencyKey || null,
        actorRole || null,
        sourceInstanceId || null,
        leaderInstanceId || null,
        ts
      ]);
      stmt.free();

      // Bounded retention cleanup: keep last 500 audit logs to prevent SQLite file bloat
      try {
        this.db.run(`
          DELETE FROM audit_logs WHERE id NOT IN (
            SELECT id FROM audit_logs ORDER BY id DESC LIMIT 500
          );
        `);
      } catch (_) {}

      if (flushImmediate) {
        this.saveToDisk(true);
      } else {
        this.debounceSave();
      }

      return true;
    } catch (err) {
      console.error('❌ [Database] insertAuditLog error:', err);
      return false;
    }
  }

  // ==========================================
  // SIGNAL CONFIGS OPERATIONS
  // ==========================================
  getAllSignalConfigs() {
    if (!this.db || !this.isInitialized) {
      return { status: 'UNAVAILABLE', error: 'Database belum terinisialisasi', data: [] };
    }

    try {
      const res = this.db.exec("SELECT * FROM signal_configs;");
      if (!res.length || !res[0].values) return { status: 'OK', data: [] };

      const cols = res[0].columns;
      const data = res[0].values.map(row => {
        const item = {};
        cols.forEach((col, idx) => item[col] = row[idx]);
        return item;
      });
      return { status: 'OK', data };
    } catch (err) {
      console.error('❌ [Database] getAllSignalConfigs error:', err);
      return { status: 'ERROR', error: err.message, data: [] };
    }
  }

  upsertSignalConfig(nodeId, { greenSplit, cycleTime, mode, updatedAt }, flushImmediate = false) {
    if (!this.db || !this.isInitialized) return false;
    if (!nodeId) return false;

    try {
      const ts = updatedAt || new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO signal_configs (node_id, green_split, cycle_time, mode, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          green_split = excluded.green_split,
          cycle_time = excluded.cycle_time,
          mode = excluded.mode,
          updated_at = excluded.updated_at;
      `);
      stmt.run([
        String(nodeId),
        Number(greenSplit || 35),
        Number(cycleTime || 90),
        String(mode || 'ADAPTIVE_AI'),
        ts
      ]);
      stmt.free();

      if (flushImmediate) {
        this.saveToDisk(true);
      } else {
        this.debounceSave();
      }
      return true;
    } catch (err) {
      console.error('❌ [Database] upsertSignalConfig error:', err);
      return false;
    }
  }

  // ==========================================
  // DEVICE CONFIGS & TELEMETRY OPERATIONS
  // ==========================================
  getAllDeviceTelemetry() {
    if (!this.db || !this.isInitialized) {
      return { status: 'UNAVAILABLE', error: 'Database belum terinisialisasi', data: [] };
    }

    try {
      const res = this.db.exec("SELECT * FROM device_telemetry;");
      if (!res.length || !res[0].values) return { status: 'OK', data: [] };

      const cols = res[0].columns;
      const data = res[0].values.map(row => {
        const item = {};
        cols.forEach((col, idx) => item[col] = row[idx]);

        let payloadObj = {};
        if (item.payload) {
          try {
            payloadObj = JSON.parse(item.payload);
          } catch (_) {}
        }

        const rawDevice = {
          deviceId: item.device_id,
          type: item.type,
          status: item.status,
          battery: item.battery,
          ping_ms: item.ping_ms,
          fps: item.fps || payloadObj.fps,
          resolution: item.resolution || payloadObj.resolution,
          greenWaveSync: item.green_wave_sync !== null ? !!item.green_wave_sync : payloadObj.greenWaveSync,
          updatedAt: item.updated_at,
          ...payloadObj
        };
        const canonical = normalizeCanonicalDevice(rawDevice);
        return CompatibilityAdapters.toLegacyDevice(canonical);
      });

      return { status: 'OK', data };
    } catch (err) {
      console.error('❌ [Database] getAllDeviceTelemetry error:', err);
      return { status: 'ERROR', error: err.message, data: [] };
    }
  }

  upsertDeviceTelemetry(device, flushImmediate = false) {
    if (!this.db || !this.isInitialized) return false;
    if (!device || !device.deviceId) return false;

    try {
      const payloadStr = JSON.stringify(device);
      const ts = device.updatedAt || device.lastSeenAt || new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO device_telemetry (
          device_id, type, status, battery, ping_ms, fps, resolution, green_wave_sync, updated_at, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          battery = excluded.battery,
          ping_ms = excluded.ping_ms,
          fps = excluded.fps,
          resolution = excluded.resolution,
          green_wave_sync = excluded.green_wave_sync,
          updated_at = excluded.updated_at,
          payload = excluded.payload;
      `);

      stmt.run([
        String(device.deviceId),
        String(device.type || 'IoT Node'),
        String(device.status || 'ONLINE'),
        Number(device.battery ?? 100),
        Number(device.latencyMs || device.ping_ms || 12),
        device.fps !== undefined ? Number(device.fps) : null,
        device.resolution ? String(device.resolution) : null,
        device.greenWaveSync !== undefined ? (device.greenWaveSync ? 1 : 0) : null,
        ts,
        payloadStr
      ]);
      stmt.free();

      if (flushImmediate) {
        this.saveToDisk(true);
      } else {
        this.debounceSave();
      }
      return true;
    } catch (err) {
      console.error('❌ [Database] upsertDeviceTelemetry error:', err);
      return false;
    }
  }
}
