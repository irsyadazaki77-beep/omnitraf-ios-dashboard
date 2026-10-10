import { dbManager } from '../db/database.js';

export function createMetadataRepository(database = dbManager) {
  return {
    async findByKey(key, tx = database) { const {rows}=await tx.query('SELECT value FROM schema_metadata WHERE key=$1',[String(key)]); return rows[0]?.value??null; },
    async set(key,value,tx = database) { await tx.execute('INSERT INTO schema_metadata(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at',[String(key),String(value),new Date().toISOString()]); return true; }
  };
}

export const metadataRepository = createMetadataRepository();
