import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeCanonicalIncident, normalizeCanonicalDevice, CompatibilityAdapters } from '../../config/domainModels.js';
import { runPostgresMigrations } from '../migrations/postgresMigrations.js';

const { Pool } = pg;
const safeError = (error) => error?.code ? String(error.code) : 'DATABASE_QUERY_FAILED';
const timeoutValue = (value, fallback, name) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120000) throw new Error(`${name} must be an integer between 1 and 120000.`);
  return parsed;
};

export class PostgresAdapter {
  driver = 'postgres';

  constructor({ connectionString = process.env.DATABASE_URL, poolMax = process.env.DB_POOL_MAX, ssl = process.env.DB_SSL } = {}) {
    if (!connectionString) throw new Error('DATABASE_URL is required when DB_DRIVER=postgres.');
    const max = poolMax === undefined ? 10 : Number(poolMax);
    if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('DB_POOL_MAX must be an integer between 1 and 50.');
    this.pool = new Pool({
      connectionString,
      max,
      idleTimeoutMillis: timeoutValue(process.env.DB_IDLE_TIMEOUT_MS, 30000, 'DB_IDLE_TIMEOUT_MS'),
      connectionTimeoutMillis: timeoutValue(process.env.DB_CONNECTION_TIMEOUT_MS, 5000, 'DB_CONNECTION_TIMEOUT_MS'),
      statement_timeout: timeoutValue(process.env.DB_STATEMENT_TIMEOUT_MS, 30000, 'DB_STATEMENT_TIMEOUT_MS'),
      ...(ssl === 'true' ? { ssl: { rejectUnauthorized: true } } : {})
    });
    this.pool.on('error', (error) => { this.lastQueryError = safeError(error); });
    this.isInitialized = false;
    this.shuttingDown = false;
    this.lastQueryError = null;
    this.transactionContext = new AsyncLocalStorage();
  }

  async init() {
    try {
      await this.pool.query('SELECT 1');
      await runPostgresMigrations(this.pool);
      this.isInitialized = true;
      this.lastQueryError = null;
      return this;
    } catch (error) {
      this.lastQueryError = safeError(error);
      throw Object.assign(new Error(`DATABASE_INITIALIZATION_FAILED${error?.code ? ` (${error.code})` : ''}`), { code: error?.code || 'DATABASE_INITIALIZATION_FAILED', cause: error });
    }
  }

  async query(sql, params = []) {
    if (!this.isInitialized || this.shuttingDown) throw new Error('DATABASE_UNAVAILABLE');
    const transactionClient = this.transactionContext.getStore();
    try {
      const result = await (transactionClient || this.pool).query(sql, params);
      this.lastQueryError = null;
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (error) {
      this.lastQueryError = safeError(error);
      throw Object.assign(new Error(`DATABASE_QUERY_FAILED${error?.code ? ` (${error.code})` : ''}`), { code: error?.code || 'DATABASE_QUERY_FAILED', cause: error });
    }
  }

  execute(sql, params = []) { return this.query(sql, params); }

  async transaction(callback, { leadershipFence = null, validateLeadershipFence = null } = {}) {
    if (!this.isInitialized || this.shuttingDown) throw new Error('DATABASE_UNAVAILABLE');
    const activeClient = this.transactionContext.getStore();
    if (activeClient) {
      if (leadershipFence) throw new Error('NESTED_TRANSACTION_CANNOT_CHANGE_LEADERSHIP_FENCE');
      return callback(this._transactionHandle(activeClient));
    }
    let client;
    try { client = await this.pool.connect(); }
    catch (error) {
      this.lastQueryError = safeError(error);
      throw Object.assign(new Error(`DATABASE_CONNECTION_FAILED${error?.code ? ` (${error.code})` : ''}`), { code: error?.code || 'DATABASE_CONNECTION_FAILED', cause: error });
    }
    const tx = this._transactionHandle(client);
    try {
      await client.query('BEGIN');
      if (leadershipFence) await this._assertLeadershipFence(client, leadershipFence);
      const result = await this.transactionContext.run(client, () => callback(tx));
      // Redis is not part of the database transaction. Revalidate its lease at
      // the commit boundary, then check the DB fence again while holding the
      // transaction-scoped shared advisory lock. A new epoch cannot be claimed
      // until this transaction commits or rolls back.
      if (validateLeadershipFence) await validateLeadershipFence();
      if (leadershipFence) await this._assertLeadershipFence(client, leadershipFence);
      await client.query('COMMIT');
      this.lastQueryError = null;
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      this.lastQueryError = safeError(error);
      throw error;
    } finally { client.release(); }
  }

  _transactionHandle(client) {
    const tx = { query: async (sql, params = []) => {
      try {
        const result = await client.query(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      } catch (error) {
        this.lastQueryError = safeError(error);
        throw Object.assign(new Error(`DATABASE_QUERY_FAILED${error?.code ? ` (${error.code})` : ''}`), { code: error?.code || 'DATABASE_QUERY_FAILED', cause: error });
      }
    }, execute: async (sql, params = []) => tx.query(sql, params) };
    return tx;
  }

  async _assertLeadershipFence(client, fence) {
    await client.query('SELECT pg_advisory_xact_lock_shared($1)', [741903123]);
    const { rows } = await client.query(
      `SELECT epoch, leader_instance_id, lease_expires_at > clock_timestamp() AS valid
       FROM cluster_leadership_fence WHERE scope = 'simulation'`,
    );
    const row = rows[0];
    if (!row || !row.valid || row.leader_instance_id !== fence.instanceId || String(row.epoch) !== String(fence.epoch)) {
      throw Object.assign(new Error('LEADERSHIP_FENCE_REJECTED'), { code: 'LEADERSHIP_FENCE_REJECTED', statusCode: 503 });
    }
  }

  async claimLeadershipFence(instanceId, leaseTtlMs) {
    const result = await this.transaction(async (tx) => {
      await tx.query("SELECT set_config('lock_timeout', $1, true)", [`${Math.min(5000, Math.max(500, leaseTtlMs))}ms`]);
      await tx.query('SELECT pg_advisory_xact_lock($1)', [741903123]);
      const { rows } = await tx.query(
        `INSERT INTO cluster_leadership_fence(scope, epoch, leader_instance_id, lease_expires_at)
         VALUES('simulation', 1, $1, clock_timestamp() + ($2 * interval '1 millisecond'))
         ON CONFLICT(scope) DO UPDATE SET
           epoch = cluster_leadership_fence.epoch + 1,
           leader_instance_id = EXCLUDED.leader_instance_id,
           lease_expires_at = EXCLUDED.lease_expires_at,
           updated_at = clock_timestamp()
         WHERE cluster_leadership_fence.lease_expires_at <= clock_timestamp()
         RETURNING epoch`,
        [instanceId, leaseTtlMs],
      );
      if (!rows[0]) return null;
      return String(rows[0].epoch);
    });
    return result;
  }

  async renewLeadershipFence(instanceId, epoch, leaseTtlMs) {
    const { rowCount } = await this.query(
      `UPDATE cluster_leadership_fence
       SET lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'), updated_at = clock_timestamp()
       WHERE scope = 'simulation' AND leader_instance_id = $1 AND epoch = $2
         AND lease_expires_at > clock_timestamp()`,
      [instanceId, String(epoch), leaseTtlMs],
    );
    return rowCount === 1;
  }

  async releaseLeadershipFence(instanceId, epoch) {
    const { rowCount } = await this.query(
      `UPDATE cluster_leadership_fence SET lease_expires_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE scope = 'simulation' AND leader_instance_id = $1 AND epoch = $2`,
      [instanceId, String(epoch)],
    );
    return rowCount === 1;
  }

  async ping() {
    if (!this.isInitialized || this.shuttingDown) return false;
    try { await this.query('SELECT 1'); return true; } catch (_) { return false; }
  }

  getHealth() {
    const pool = this.pool;
    return { status: this.isInitialized && !this.lastQueryError ? 'CONNECTED' : (this.isInitialized ? 'DEGRADED' : 'DISCONNECTED'), driver: this.driver,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, lastQueryError: this.lastQueryError };
  }

  async close() {
    this.shuttingDown = true;
    await this.pool.end();
    this.isInitialized = false;
  }

  async flush() { return true; }
  markDirty() { return false; }
  setMetadata(key, value) { return this.query(`INSERT INTO schema_metadata(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`, [String(key), String(value), new Date().toISOString()]).then(() => true); }
  async getMetadata(key) { const { rows } = await this.query('SELECT value FROM schema_metadata WHERE key=$1', [key]); return rows[0]?.value ?? null; }

  async getAllIncidents({ limit = 1000, offset = 0 } = {}) {
    try {
      const { rows } = await this.query('SELECT id,type,location,lat,lng,time,status,severity,priority,resolved_at,acknowledged_at,operator,notes,source,payload FROM incidents ORDER BY time DESC LIMIT $1 OFFSET $2', [limit, offset]);
      const data = rows.map((item) => {
        let payload = {}; try { if (item.payload) payload = JSON.parse(item.payload); } catch (_) {}
        return CompatibilityAdapters.toLegacyIncident(normalizeCanonicalIncident({ id:item.id, title:payload.title||item.type||`Insiden #${item.id}`, category:payload.category||item.type||'congestion', severity:item.severity||payload.severity||'medium', location:item.location||'Surabaya', coordinates:[item.lat||0,item.lng||0], status:item.status||'ACTIVE', priority:item.priority||payload.priority||'normal', source:item.source||payload.source||'SITS Core', assignedUnit:item.operator||payload.assignedUnit||'Petugas SITS', notes:item.notes||payload.notes||'', reportedAt:item.time||payload.reportedAt||new Date().toISOString(), updatedAt:payload.updatedAt||item.time||new Date().toISOString(), acknowledgedAt:item.acknowledged_at||payload.acknowledgedAt||null, resolvedAt:item.resolved_at||payload.resolvedAt||null }));
      });
      return { status:'OK', data };
    } catch (error) { return { status:'ERROR', error:safeError(error), data:[] }; }
  }

  async upsertIncident(incident, _flushImmediate = false, tx = null) {
    if (!incident?.id) throw new Error("VALIDATION_ERROR: Objek insiden harus memiliki properti 'id'.");
    const coords = Array.isArray(incident.coordinates) ? incident.coordinates : [0,0];
    await (tx?.query || this.query.bind(this))(`INSERT INTO incidents(id,type,location,lat,lng,time,status,severity,priority,resolved_at,acknowledged_at,operator,notes,source,payload) VALUES(${Array.from({length:15},(_,i)=>`$${i+1}`).join(',')}) ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,location=EXCLUDED.location,lat=EXCLUDED.lat,lng=EXCLUDED.lng,time=EXCLUDED.time,status=EXCLUDED.status,severity=EXCLUDED.severity,priority=EXCLUDED.priority,resolved_at=EXCLUDED.resolved_at,acknowledged_at=EXCLUDED.acknowledged_at,operator=EXCLUDED.operator,notes=EXCLUDED.notes,source=EXCLUDED.source,payload=EXCLUDED.payload`, [String(incident.id),String(incident.category||incident.type||'traffic'),String(incident.location||'Surabaya'),coords[0]||incident.lat||0,coords[1]||incident.lng||0,incident.reportedAt||incident.timestamp||incident.time||new Date().toISOString(),incident.status||'ACTIVE',incident.severity||'medium',incident.priority||'normal',incident.resolvedAt||null,incident.acknowledgedAt||null,incident.assignedUnit||incident.operator||'SITS Dispatcher',incident.notes||'',incident.source||'SITS System',JSON.stringify(incident)]);
    return true;
  }
  async deleteIncident(id) { return (await this.query('DELETE FROM incidents WHERE id=$1',[String(id)])).rowCount > 0; }

  async getAllAuditLogs(limit = 100, offset = 0) {
    try { const { rows } = await this.query('SELECT id,operator,action,entity,result,correlation_id,command_id,idempotency_key,actor_role,source_instance_id,leader_instance_id,details,timestamp FROM audit_logs ORDER BY id DESC LIMIT $1 OFFSET $2',[limit,offset]); return { status:'OK', data:rows.map(r=>({id:Number(r.id),operator:r.operator,action:r.action,entity:r.entity,result:r.result,correlationId:r.correlation_id,commandId:r.command_id,idempotencyKey:r.idempotency_key,actorRole:r.actor_role,sourceInstanceId:r.source_instance_id,leaderInstanceId:r.leader_instance_id,details:r.details,timestamp:r.timestamp})) }; }
    catch(error) { return {status:'ERROR',error:safeError(error),data:[]}; }
  }
  async insertAuditLog(log = {}, _flushImmediate = false, tx = null) {
    const corrId=log.correlationId||log.commandId||null;
    const insert = async (target) => {
      const action = String(log.action || 'ACTION');
      const key = log.idempotencyKey ? `audit-event:${action}:idem:${log.idempotencyKey}`
        : (corrId ? `audit-event:${action}:corr:${corrId}` : null);
      if (key) {
        const claim = await target.query('INSERT INTO audit_deduplication_keys(dedupe_key,created_at) VALUES($1,$2) ON CONFLICT(dedupe_key) DO NOTHING', [key, new Date().toISOString()]);
        if (claim.rowCount === 0) return false;
      }
      await target.query('INSERT INTO audit_logs(operator,action,entity,result,correlation_id,details,command_id,idempotency_key,actor_role,source_instance_id,leader_instance_id,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[String(log.operator||'System'),action,String(log.entity||'Global'),String(log.result||'OK'),corrId,String(log.details||''),log.commandId||corrId,log.idempotencyKey||null,log.actorRole||null,log.sourceInstanceId||null,log.leaderInstanceId||null,log.timestamp||new Date().toISOString()]);
      return true;
    };
    if (tx) await insert(tx); else await this.transaction(insert);
    return true;
  }

  async getAllSignalConfigs() { try { const {rows}=await this.query('SELECT node_id,green_split,cycle_time,mode,updated_at FROM signal_configs'); return {status:'OK',data:rows}; } catch(error) { return {status:'ERROR',error:safeError(error),data:[]}; } }
  async upsertSignalConfig(nodeId,{greenSplit,cycleTime,mode,updatedAt}={},_flushImmediate=false,tx=null) { if(!nodeId) return false; await (tx?.query || this.query.bind(this))('INSERT INTO signal_configs(node_id,green_split,cycle_time,mode,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(node_id) DO UPDATE SET green_split=EXCLUDED.green_split,cycle_time=EXCLUDED.cycle_time,mode=EXCLUDED.mode,updated_at=EXCLUDED.updated_at',[String(nodeId),Number(greenSplit||35),Number(cycleTime||90),String(mode||'ADAPTIVE_AI'),updatedAt||new Date().toISOString()]); return true; }

  async getAllDeviceTelemetry() { try { const {rows}=await this.query('SELECT device_id,type,status,battery,ping_ms,fps,resolution,green_wave_sync,updated_at,payload FROM device_telemetry'); const data=rows.map(item=>{let payload={};try{payload=item.payload?JSON.parse(item.payload):{};}catch(_){};return CompatibilityAdapters.toLegacyDevice(normalizeCanonicalDevice({deviceId:item.device_id,type:item.type,status:item.status,battery:item.battery,ping_ms:item.ping_ms,fps:item.fps||payload.fps,resolution:item.resolution||payload.resolution,greenWaveSync:item.green_wave_sync??payload.greenWaveSync,updatedAt:item.updated_at,...payload}));}); return {status:'OK',data}; } catch(error){return {status:'ERROR',error:safeError(error),data:[]};} }
  async upsertDeviceTelemetry(device,_flushImmediate=false,tx=null) { if(!device?.deviceId) return false; await (tx?.query || this.query.bind(this))('INSERT INTO device_telemetry(device_id,type,status,battery,ping_ms,fps,resolution,green_wave_sync,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(device_id) DO UPDATE SET type=EXCLUDED.type,status=EXCLUDED.status,battery=EXCLUDED.battery,ping_ms=EXCLUDED.ping_ms,fps=EXCLUDED.fps,resolution=EXCLUDED.resolution,green_wave_sync=EXCLUDED.green_wave_sync,updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload',[String(device.deviceId),String(device.type||'IoT Node'),String(device.status||'ONLINE'),Number(device.battery??100),Number(device.latencyMs||device.ping_ms||12),device.fps==null?null:Number(device.fps),device.resolution?String(device.resolution):null,device.greenWaveSync==null?null:Boolean(device.greenWaveSync),device.updatedAt||device.lastSeenAt||new Date().toISOString(),JSON.stringify(device)]); return true; }
}
