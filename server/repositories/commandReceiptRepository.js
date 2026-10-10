import { dbManager } from '../db/database.js';

export function createCommandReceiptRepository(database = dbManager) {
  return {
    async find(actorId, idempotencyKey, tx = database, commandId = null) {
      const { rows } = await tx.query(
        'SELECT actor_id,idempotency_key,fingerprint,command_id,correlation_id,action,status,result_json FROM command_receipts WHERE idempotency_key=$1 OR ($2 IS NOT NULL AND command_id=$2) ORDER BY CASE WHEN idempotency_key=$1 THEN 0 ELSE 1 END LIMIT 1',
        [String(idempotencyKey), commandId == null ? null : String(commandId)]
      );
      if (!rows[0]) return null;
      let result = null;
      try { result = rows[0].result_json ? JSON.parse(rows[0].result_json) : null; } catch (error) {
        throw new Error('COMMAND_RECEIPT_CORRUPT', { cause: error });
      }
      return { ...rows[0], result };
    },
    async claim({ actorId, idempotencyKey, fingerprint, commandId, correlationId, action }, tx = database) {
      const { rowCount } = await tx.execute(
        `INSERT INTO command_receipts(actor_id,idempotency_key,fingerprint,command_id,correlation_id,action,status)
         VALUES($1,$2,$3,$4,$5,$6,'PROCESSING') ON CONFLICT DO NOTHING`,
        [String(actorId), String(idempotencyKey), fingerprint, commandId, correlationId, action]
      );
      return rowCount === 1;
    },
    async complete(actorId, idempotencyKey, result, tx = database) {
      const { rowCount } = await tx.execute(
        `UPDATE command_receipts SET status='COMPLETED',result_json=$3,completed_at=$4
         WHERE actor_id=$1 AND idempotency_key=$2 AND status='PROCESSING'`,
        [String(actorId), String(idempotencyKey), JSON.stringify(result), new Date().toISOString()]
      );
      if (rowCount !== 1) throw new Error('COMMAND_RECEIPT_COMPLETION_FAILED');
      return true;
    }
  };
}

export const commandReceiptRepository = createCommandReceiptRepository();
