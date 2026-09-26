import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

/**
 * OmniTRAF SITS Surabaya - Embedded SQLite Persistence Layer
 * Didukung oleh engine SQLite (sql.js) dengan sinkronisasi biner ke disk (data/omnitraf.sqlite).
 */
class DatabaseManager {
  constructor() {
    this.db = null;
    this.SQL = null;
    this.dbPath = path.resolve(process.cwd(), 'data/omnitraf.sqlite');
    this.isInitialized = false;
    this._saveTimer = null;
  }

  async init() {
    if (this.isInitialized) return this;

    try {
      // Pastikan direktori data/ ada
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.SQL = await initSqlJs();

      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
        console.log(`🗄️ [Database] Memuat database tersemat SQLite dari: ${this.dbPath}`);
      } else {
        this.db = new this.SQL.Database();
        console.log(`🗄️ [Database] Menginisialisasi database SQLite baru di: ${this.dbPath}`);
      }

      this._createTables();
      this.saveToDisk();
      this.isInitialized = true;
      return this;
    } catch (err) {
      console.error('❌ [Database] Gagal menginisialisasi SQLite database:', err);
      throw err;
    }
  }

  _createTables() {
    // 1. Incidents Table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        type TEXT,
        location TEXT,
        lat REAL,
        lng REAL,
        time TEXT,
        status TEXT,
        resolved_at TEXT,
        operator TEXT,
        payload TEXT
      );
    `);

    // 2. Audit Logs Table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator TEXT,
        action TEXT,
        entity TEXT,
        result TEXT,
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

    // 4. Device Telemetry Table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS device_telemetry (
        device_id TEXT PRIMARY KEY,
        type TEXT,
        status TEXT,
        battery INTEGER,
        ping_ms INTEGER,
        updated_at TEXT,
        payload TEXT
      );
    `);

    // Indexes for high performance lookup
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);`);
  }

  saveToDisk() {
    try {
      if (!this.db) return;
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (err) {
      console.error('❌ [Database] Gagal menyimpan ke disk:', err);
    }
  }

  debounceSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveToDisk();
      this._saveTimer = null;
    }, 200);
  }

  // ==========================================
  // INCIDENTS OPERATIONS
  // ==========================================
  getAllIncidents() {
    try {
      const res = this.db.exec("SELECT * FROM incidents ORDER BY time DESC;");
      if (!res.length || !res[0].values) return [];
      const cols = res[0].columns;
      return res[0].values.map(row => {
        const item = {};
        cols.forEach((col, idx) => item[col] = row[idx]);
        if (item.payload) {
          try {
            const parsed = JSON.parse(item.payload);
            return { ...parsed, ...item, payload: undefined };
          } catch {
            return item;
          }
        }
        return item;
      });
    } catch (err) {
      console.error('❌ [Database] getAllIncidents error:', err);
      return [];
    }
  }

  upsertIncident(incident) {
    if (!incident || !incident.id) return;
    try {
      const payloadStr = JSON.stringify(incident);
      const coords = Array.isArray(incident.coordinates) ? incident.coordinates : [0, 0];
      const lat = coords[0] || incident.lat || 0;
      const lng = coords[1] || incident.lng || 0;
      const time = incident.reportedAt || incident.timestamp || incident.time || new Date().toISOString();
      const status = incident.status || 'ACTIVE';
      const resolvedAt = incident.resolvedAt || (status === 'RESOLVED' ? new Date().toISOString() : null);
      const operator = incident.assignedUnit || incident.operator || 'SITS Dispatcher';

      const stmt = this.db.prepare(`
        INSERT INTO incidents (id, type, location, lat, lng, time, status, resolved_at, operator, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          location = excluded.location,
          lat = excluded.lat,
          lng = excluded.lng,
          time = excluded.time,
          status = excluded.status,
          resolved_at = excluded.resolved_at,
          operator = excluded.operator,
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
        resolvedAt,
        operator,
        payloadStr
      ]);
      stmt.free();
      this.debounceSave();
    } catch (err) {
      console.error('❌ [Database] upsertIncident error:', err);
    }
  }

  // ==========================================
  // AUDIT LOGS OPERATIONS
  // ==========================================
  getAllAuditLogs(limit = 100) {
    try {
      const stmt = this.db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?;");
      stmt.bind([limit]);
      const logs = [];
      while (stmt.step()) {
        logs.push(stmt.getAsObject());
      }
      stmt.free();
      return logs;
    } catch (err) {
      console.error('❌ [Database] getAllAuditLogs error:', err);
      return [];
    }
  }

  insertAuditLog({ operator, action, entity, result, timestamp }) {
    try {
      const ts = timestamp || new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO audit_logs (operator, action, entity, result, timestamp)
        VALUES (?, ?, ?, ?, ?);
      `);
      stmt.run([
        String(operator || 'System'),
        String(action || 'ACTION'),
        String(entity || 'Global'),
        String(result || 'OK'),
        ts
      ]);
      stmt.free();
      this.debounceSave();
    } catch (err) {
      console.error('❌ [Database] insertAuditLog error:', err);
    }
  }

  // ==========================================
  // SIGNAL CONFIGS OPERATIONS
  // ==========================================
  getAllSignalConfigs() {
    try {
      const res = this.db.exec("SELECT * FROM signal_configs;");
      if (!res.length || !res[0].values) return [];
      const cols = res[0].columns;
      return res[0].values.map(row => {
        const item = {};
        cols.forEach((col, idx) => item[col] = row[idx]);
        return item;
      });
    } catch (err) {
      console.error('❌ [Database] getAllSignalConfigs error:', err);
      return [];
    }
  }

  upsertSignalConfig(nodeId, { greenSplit, cycleTime, mode, updatedAt }) {
    if (!nodeId) return;
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
      this.debounceSave();
    } catch (err) {
      console.error('❌ [Database] upsertSignalConfig error:', err);
    }
  }

  // ==========================================
  // DEVICE TELEMETRY OPERATIONS
  // ==========================================
  getAllDeviceTelemetry() {
    try {
      const res = this.db.exec("SELECT * FROM device_telemetry;");
      if (!res.length || !res[0].values) return [];
      const cols = res[0].columns;
      return res[0].values.map(row => {
        const item = {};
        cols.forEach((col, idx) => item[col] = row[idx]);
        if (item.payload) {
          try {
            const parsed = JSON.parse(item.payload);
            return { ...parsed, ...item, payload: undefined };
          } catch {
            return item;
          }
        }
        return item;
      });
    } catch (err) {
      console.error('❌ [Database] getAllDeviceTelemetry error:', err);
      return [];
    }
  }

  upsertDeviceTelemetry(device) {
    if (!device || !device.deviceId) return;
    try {
      const payloadStr = JSON.stringify(device);
      const ts = device.updatedAt || device.lastSeenAt || new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO device_telemetry (device_id, type, status, battery, ping_ms, updated_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          battery = excluded.battery,
          ping_ms = excluded.ping_ms,
          updated_at = excluded.updated_at,
          payload = excluded.payload;
      `);
      stmt.run([
        String(device.deviceId),
        String(device.type || 'IoT Node'),
        String(device.status || 'ONLINE'),
        Number(device.battery ?? 100),
        Number(device.latencyMs || device.ping_ms || 12),
        ts,
        payloadStr
      ]);
      stmt.free();
      this.debounceSave();
    } catch (err) {
      console.error('❌ [Database] upsertDeviceTelemetry error:', err);
    }
  }
}

export const dbManager = new DatabaseManager();
