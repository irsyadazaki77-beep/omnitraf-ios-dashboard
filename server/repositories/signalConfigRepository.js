import { dbManager } from '../db/database.js';

export function createSignalConfigRepository(database = dbManager) {
const repository = {
  async findAll({ limit = 1000, offset = 0 } = {}) {
    try { const {rows}=await database.query('SELECT node_id,green_split,cycle_time,mode,updated_at FROM signal_configs ORDER BY node_id LIMIT $1 OFFSET $2',[Math.min(5000,Math.max(1,Number(limit)||1000)),Math.max(0,Number(offset)||0)]); return {status:'OK',data:rows}; }
    catch(error) { return {status:'ERROR',error:error.code||'DATABASE_QUERY_FAILED',data:[]}; }
  },
  async upsert(nodeId,{greenSplit,cycleTime,mode,updatedAt}={},flushImmediate=false,tx=database) {
    if(!nodeId)return false;
    await tx.execute('INSERT INTO signal_configs(node_id,green_split,cycle_time,mode,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(node_id) DO UPDATE SET green_split=EXCLUDED.green_split,cycle_time=EXCLUDED.cycle_time,mode=EXCLUDED.mode,updated_at=EXCLUDED.updated_at',[String(nodeId),Number(greenSplit||35),Number(cycleTime||90),String(mode||'ADAPTIVE_AI'),updatedAt||new Date().toISOString()]);
    if(flushImmediate&&tx===database&&database.driver==='sqljs')await database.flush();
    return true;
  }
};
return repository;
}

export const signalConfigRepository = createSignalConfigRepository();
