import initSqlJs from 'sql.js';

const isTest = typeof global.it === 'function' || 
               typeof global.test === 'function' || 
               process.env.NODE_ENV === 'test' || 
               (process.env.DB_PATH && process.env.DB_PATH.includes('test')) ||
               process.env.PORT === '0';

if (isTest) {
  console.log = () => {};
  console.warn = () => {};
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/omnitraf.sqlite');

/**
 * OmniTRAF SITS Surabaya - Embedded SQLite Persistence & Recovery Layer (Phase 17 Hardened)
 * - Atomic binary flush via temporary file + atomic rename (POSIX crash-proof durability)
 * - Non-destructive schema migrations & metadata version tracking
 * - Distinct operational states (EMPTY vs UNAVAILABLE vs ERROR)
 * - Defensive recovery rules for corrupted rows, missing fields & shutdown synchronization
 */
export class DatabaseManager {
  static _globalShutdownRegistered = false;

  constructor() {
    this.db = null;
    this.SQL = null;
    this.dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : DEFAULT_DB_PATH;
    this.isInitialized = false;
    this._saveTimer = null;
    this._initPromise = null;
    this.schemaVersion = 17;
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
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        this.SQL = await initSqlJs();

        if (fs.existsSync(this.dbPath)) {
          try {
            const fileBuffer = fs.readFileSync(this.dbPath);
            if (fileBuffer.length > 0) {
              this.db = new this.SQL.Database(fileBuffer);
              console.log(`🗄️ [Database] Memuat database tersemat SQLite dari: ${this.dbPath} (${fileBuffer.length} bytes)`);
            } else {
              console.warn(`⚠️ [Database] File database berukuran 0 byte, membuat database SQLite baru.`);
              this.db = new this.SQL.Database();
            }
          } catch (readErr) {
            console.error(`❌ [Database] Berkas SQLite korup/tidak terbaca (${readErr.message}), menginisialisasi fresh database dengan backup.`);
            const backupPath = `${this.dbPath}.corrupt.${Date.now()}`;
            try { fs.renameSync(this.dbPath, backupPath); } catch (_) {}
            this.db = new this.SQL.Database();
          }
        } else {
          this.db = new this.SQL.Database();
          console.log(`🗄️ [Database] Menginisialisasi database SQLite baru di: ${this.dbPath}`);
        }

        this._createTables();
        this._runMigrations();
        this.isInitialized = true;
        this.saveToDisk(true); // Initial atomic flush
        this._registerShutdownHooks();

        return this;
      } catch (err) {
        console.error('❌ [Database] Gagal menginisialisasi SQLite database:', err);
        this.isInitialized = false;
        this.db = null;
        throw err;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  _registerShutdownHooks() {
    const isTest = typeof global.it === 'function' || 
                   typeof global.test === 'function' || 
                   process.env.NODE_ENV === 'test' || 
                   (process.env.DB_PATH && process.env.DB_PATH.includes('test'));
    if (isTest) return; // Do not register process exit handlers in a testing context to avoid test runner IPC deserialization issues

    if (DatabaseManager._globalShutdownRegistered) return;
    DatabaseManager._globalShutdownRegistered = true;

    const onShutdown = (signal) => {
      try {
        if (this.isInitialized && this.db) {
          console.log(`\n🛑 [Database] Menerima sinyal ${signal}: Menjalankan atomic sync ke disk...`);
          this.setMetadata('last_shutdown_at', new Date().toISOString());
          this.setMetadata('shutdown_signal', signal);
          this.flushSync();
        }
      } catch (e) {
        console.error('❌ [Database] Kesalahan saat shutdown flush:', e.message);
      }
    };

    process.once('SIGINT', () => { onShutdown('SIGINT'); process.exit(0); });
    process.once('SIGTERM', () => { onShutdown('SIGTERM'); process.exit(0); });
    process.once('beforeExit', () => { onShutdown('beforeExit'); });
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
    try {
      // 1. Check existing columns in audit_logs
      const auditCols = this._getTableColumns('audit_logs');
      if (!auditCols.includes('correlation_id')) {
        this.db.run(`ALTER TABLE audit_logs ADD COLUMN correlation_id TEXT;`);
      }
      if (!auditCols.includes('details')) {
        this.db.run(`ALTER TABLE audit_logs ADD COLUMN details TEXT;`);
      }

      // 2. Check existing columns in incidents
      const incCols = this._getTableColumns('incidents');
      if (!incCols.includes('severity')) {
        this.db.run(`ALTER TABLE incidents ADD COLUMN severity TEXT;`);
      }
      if (!incCols.includes('priority')) {
        this.db.run(`ALTER TABLE incidents ADD COLUMN priority TEXT;`);
      }
      if (!incCols.includes('acknowledged_at')) {
        this.db.run(`ALTER TABLE incidents ADD COLUMN acknowledged_at TEXT;`);
      }
      if (!incCols.includes('notes')) {
        this.db.run(`ALTER TABLE incidents ADD COLUMN notes TEXT;`);
      }
      if (!incCols.includes('source')) {
        this.db.run(`ALTER TABLE incidents ADD COLUMN source TEXT;`);
      }

      // 3. Check existing columns in device_telemetry
      const devCols = this._getTableColumns('device_telemetry');
      if (!devCols.includes('fps')) {
        this.db.run(`ALTER TABLE device_telemetry ADD COLUMN fps INTEGER;`);
      }
      if (!devCols.includes('resolution')) {
        this.db.run(`ALTER TABLE device_telemetry ADD COLUMN resolution TEXT;`);
      }
      if (!devCols.includes('green_wave_sync')) {
        this.db.run(`ALTER TABLE device_telemetry ADD COLUMN green_wave_sync INTEGER;`);
      }

      // 4. Ensure high performance indexes after migrations ensure columns exist
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp);`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_corr ON audit_logs(correlation_id);`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_time ON incidents(time);`);

      // 5. Update Schema Version in Metadata
      this.setMetadata('schema_version', String(this.schemaVersion));
      this.setMetadata('last_migrated_at', new Date().toISOString());
    } catch (migErr) {
      console.warn('⚠️ [Database] Non-critical migration notice:', migErr.message);
    }
  }

  _getTableColumns(tableName) {
    try {
      const res = this.db.exec(`PRAGMA table_info(${tableName});`);
      if (!res.length || !res[0].values) return [];
      // Col name is index 1
      return res[0].values.map(row => row[1]);
    } catch (e) {
      return [];
    }
  }

  /**
   * Atomic file write via temporary file + atomic rename
   * Prevents half-written corrupted SQLite files when process crashes during write
   */
  saveToDisk(forceSync = false) {
    if (!this.db || (!this.isInitialized && !forceSync)) return false;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(this.dbPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmpPath = `${this.dbPath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 6)}`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this.dbPath);
      return true;
    } catch (err) {
      console.error('❌ [Database] Gagal menyimpan biner database secara atomik ke disk:', err);
      return false;
    }
  }

  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    return this.saveToDisk(true);
  }

  debounceSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveToDisk();
      this._saveTimer = null;
    }, 150);
  }

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

        return {
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

  insertAuditLog({ operator, action, entity, result, timestamp, correlationId, commandId, details }, flushImmediate = false) {
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
        INSERT INTO audit_logs (operator, action, entity, result, correlation_id, details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `);

      stmt.run([
        String(operator || 'System'),
        String(action || 'ACTION'),
        String(entity || 'Global'),
        String(result || 'OK'),
        corrId,
        String(details || ''),
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

        return {
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

export const dbManager = new DatabaseManager();
