import { dbManager } from '../db/database.js';

const bounded = (value, fallback, max) => Math.min(max, Math.max(0, Number.isInteger(Number(value)) ? Number(value) : fallback));

export function createAuditRepository(database = dbManager) {
const repository = {
  async findAll(options = 100) {
    const opts = typeof options === 'object' && options !== null ? options : { limit: options };
    const limit = Math.min(500, Math.max(1, bounded(opts.limit, 100, 500)));
    const offset = bounded(opts.offset, 0, 1_000_000);
    const filters = [];
    const params = [];
    const add = (column, value, operator = '=') => { if (value !== undefined && value !== null && value !== '') { params.push(value); filters.push(`${column} ${operator} $${params.length}`); } };
    add('action', opts.action);
    add('command_id', opts.commandId);
    add('correlation_id', opts.correlationId);
    add('idempotency_key', opts.idempotencyKey);
    add('operator', opts.actor);
    add('timestamp', opts.since, '>=');
    add('timestamp', opts.until, '<=');
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    params.push(limit, offset);
    try {
      const { rows } = await database.query(`SELECT id,operator,action,entity,result,correlation_id,command_id,idempotency_key,actor_role,source_instance_id,leader_instance_id,details,timestamp FROM audit_logs ${where} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { status: 'OK', data: rows.map((row) => ({ id:Number(row.id),operator:row.operator,action:row.action,entity:row.entity,result:row.result,correlationId:row.correlation_id,commandId:row.command_id,idempotencyKey:row.idempotency_key,actorRole:row.actor_role,sourceInstanceId:row.source_instance_id,leaderInstanceId:row.leader_instance_id,details:row.details,timestamp:row.timestamp })) };
    } catch (error) { return { status: 'ERROR', error: error.code || 'DATABASE_QUERY_FAILED', data: [] }; }
  },
  async create(log, flushImmediate = false, tx = database) { return repository.insert(log, flushImmediate, tx); },
  async insert(log = {}, flushImmediate = false, tx = database) {
    const correlationId = log.correlationId || log.commandId || null;
    const insert = async (connection) => {
      const idempotencyKey = log.idempotencyKey || null;
      // Dedupe command result audit records by action and command key. This keeps
      // semantically distinct audit events for one command independently recordable.
      const action = String(log.action || 'ACTION');
      const dedupeKey = idempotencyKey
        ? `audit-event:${action}:idem:${idempotencyKey}`
        : (correlationId ? `audit-event:${action}:corr:${correlationId}` : null);
      if (dedupeKey) {
        const claimed = await connection.execute('INSERT INTO audit_deduplication_keys(dedupe_key,created_at) VALUES($1,$2) ON CONFLICT(dedupe_key) DO NOTHING', [dedupeKey, new Date().toISOString()]);
        if (claimed.rowCount === 0) return false;
      }
      await connection.execute('INSERT INTO audit_logs(operator,action,entity,result,correlation_id,details,command_id,idempotency_key,actor_role,source_instance_id,leader_instance_id,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
        String(log.operator || 'System'),String(log.action || 'ACTION'),String(log.entity || 'Global'),String(log.result || 'OK'),correlationId,String(log.details || ''),log.commandId || correlationId,log.idempotencyKey || null,log.actorRole || null,log.sourceInstanceId || null,log.leaderInstanceId || null,log.timestamp || new Date().toISOString()
      ]);
      return true;
    };
    try {
      const result = tx === database ? await database.transaction(insert) : await insert(tx);
      if (flushImmediate && tx === database && database.driver === 'sqljs') await database.flush();
      return result;
    } catch (error) { throw new Error(`PERSISTENCE_FAILED: audit log (${error.code || 'DATABASE_QUERY_FAILED'})`, { cause: error }); }
  }
};
return repository;
}

export const auditRepository = createAuditRepository();
