import { dbManager } from '../db/database.js';
import { normalizeCanonicalDevice, CompatibilityAdapters } from '../config/domainModels.js';

function mapDevice(item) {
  let payload = {};
  try { if (item.payload) payload = JSON.parse(item.payload); } catch (_) {}
  return CompatibilityAdapters.toLegacyDevice(normalizeCanonicalDevice({
    deviceId:item.device_id,type:item.type,status:item.status,battery:item.battery,ping_ms:item.ping_ms,
    fps:item.fps??payload.fps,resolution:item.resolution||payload.resolution,
    greenWaveSync:item.green_wave_sync==null?payload.greenWaveSync:Boolean(item.green_wave_sync),updatedAt:item.updated_at,...payload
  }));
}

export function createDeviceRepository(database = dbManager) {
const repository = {
  async findAll({ limit = 1000, offset = 0 } = {}) {
    try { const result = await database.query('SELECT device_id,type,status,battery,ping_ms,fps,resolution,green_wave_sync,updated_at,payload FROM device_telemetry ORDER BY updated_at DESC LIMIT $1 OFFSET $2', [Math.min(5000,Math.max(1,Number(limit)||1000)),Math.max(0,Number(offset)||0)]); return {status:'OK',data:result.rows.map(mapDevice)}; }
    catch(error) { return {status:'ERROR',error:error.code||'DATABASE_QUERY_FAILED',data:[]}; }
  },
  async findById(id) { const {rows}=await database.query('SELECT device_id,type,status,battery,ping_ms,fps,resolution,green_wave_sync,updated_at,payload FROM device_telemetry WHERE device_id=$1',[String(id)]); return rows[0]?mapDevice(rows[0]):null; },
  async create(data, flushImmediate = false, tx = database) { return repository.upsert(data,flushImmediate,tx); },
  async update(id, patch) { const current=await repository.findById(id); if(!current)return false; return repository.upsert({...current,...patch,deviceId:current.deviceId}); },
  async upsert(device, flushImmediate = false, tx = database) {
    if(!device?.deviceId)return false;
    const result=await tx.execute('INSERT INTO device_telemetry(device_id,type,status,battery,ping_ms,fps,resolution,green_wave_sync,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(device_id) DO UPDATE SET type=EXCLUDED.type,status=EXCLUDED.status,battery=EXCLUDED.battery,ping_ms=EXCLUDED.ping_ms,fps=EXCLUDED.fps,resolution=EXCLUDED.resolution,green_wave_sync=EXCLUDED.green_wave_sync,updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload',[String(device.deviceId),String(device.type||'IoT Node'),String(device.status||'ONLINE'),Number(device.battery??100),Number(device.latencyMs||device.ping_ms||12),device.fps==null?null:Number(device.fps),device.resolution?String(device.resolution):null,device.greenWaveSync==null?null:Boolean(device.greenWaveSync),device.updatedAt||device.lastSeenAt||new Date().toISOString(),JSON.stringify(device)]);
    if(flushImmediate&&tx===database&&database.driver==='sqljs')await database.flush();
    return result.rowCount >= 0;
  }
};
return repository;
}

export const deviceRepository = createDeviceRepository();
