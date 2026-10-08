import { dbManager } from '../db/database.js';
import { normalizeCanonicalIncident, CompatibilityAdapters } from '../config/domainModels.js';

const page = ({ limit = 1000, offset = 0 } = {}) => [Math.min(5000, Math.max(1, Number(limit) || 1000)), Math.max(0, Number(offset) || 0)];

function mapIncident(item) {
  let payload = {};
  try { if (item.payload) payload = JSON.parse(item.payload); } catch (_) {}
  return CompatibilityAdapters.toLegacyIncident(normalizeCanonicalIncident({
    id:item.id, title:payload.title||item.type||`Insiden #${item.id}`, category:payload.category||item.type||'congestion',
    severity:item.severity||payload.severity||'medium', location:item.location||'Surabaya', coordinates:[item.lat||0,item.lng||0],
    status:item.status||'ACTIVE', priority:item.priority||payload.priority||'normal', source:item.source||payload.source||'SITS Core',
    assignedUnit:item.operator||payload.assignedUnit||'Petugas SITS', notes:item.notes||payload.notes||'',
    reportedAt:item.time||payload.reportedAt||new Date().toISOString(), updatedAt:payload.updatedAt||item.time||new Date().toISOString(),
    acknowledgedAt:item.acknowledged_at||payload.acknowledgedAt||null, resolvedAt:item.resolved_at||payload.resolvedAt||null
  }));
}

export function createIncidentRepository(database = dbManager) {
const repository = {
  async findAll(options = {}) {
    const [limit, offset] = page(options);
    try {
      const { rows } = await database.query('SELECT id,type,location,lat,lng,time,status,severity,priority,resolved_at,acknowledged_at,operator,notes,source,payload FROM incidents ORDER BY time DESC LIMIT $1 OFFSET $2', [limit, offset]);
      return { status: 'OK', data: rows.map(mapIncident) };
    } catch (error) { return { status: 'ERROR', error: error.code || 'DATABASE_QUERY_FAILED', data: [] }; }
  },
  async findById(id) {
    const { rows } = await database.query('SELECT id,type,location,lat,lng,time,status,severity,priority,resolved_at,acknowledged_at,operator,notes,source,payload FROM incidents WHERE id=$1', [String(id)]);
    return rows[0] ? mapIncident(rows[0]) : null;
  },
  async create(data, flushImmediate = false, tx = database) { return repository.upsert(data, flushImmediate, tx); },
  async update(id, patch) {
    const current = await repository.findById(id);
    if (!current) return false;
    return repository.upsert({ ...current, ...patch, id: current.id });
  },
  async remove(id, tx = database) { return (await tx.execute('DELETE FROM incidents WHERE id=$1', [String(id)])).rowCount > 0; },
  async upsert(incident, flushImmediate = false, tx = database) {
    if (!incident?.id) throw new Error("VALIDATION_ERROR: Objek insiden harus memiliki properti 'id'.");
    const coords = Array.isArray(incident.coordinates) ? incident.coordinates : [0, 0];
    const status = incident.status || 'ACTIVE';
    const result = await tx.execute(`INSERT INTO incidents(id,type,location,lat,lng,time,status,severity,priority,resolved_at,acknowledged_at,operator,notes,source,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,location=EXCLUDED.location,lat=EXCLUDED.lat,lng=EXCLUDED.lng,time=EXCLUDED.time,status=EXCLUDED.status,severity=EXCLUDED.severity,priority=EXCLUDED.priority,resolved_at=EXCLUDED.resolved_at,acknowledged_at=EXCLUDED.acknowledged_at,operator=EXCLUDED.operator,notes=EXCLUDED.notes,source=EXCLUDED.source,payload=EXCLUDED.payload`, [
      String(incident.id),String(incident.category||incident.type||'traffic'),String(incident.location||'Surabaya'),coords[0]||incident.lat||0,coords[1]||incident.lng||0,
      incident.reportedAt||incident.timestamp||incident.time||new Date().toISOString(),status,incident.severity||'medium',incident.priority||(incident.severity==='critical'||incident.severity==='high'?'high':'normal'),
      incident.resolvedAt||(status==='RESOLVED'?new Date().toISOString():null),incident.acknowledgedAt||(status==='ACKNOWLEDGED'?new Date().toISOString():null),incident.assignedUnit||incident.operator||'SITS Dispatcher',incident.notes||'',incident.source||'SITS System',JSON.stringify(incident)
    ]);
    if (flushImmediate && tx === database && database.driver === 'sqljs') await database.flush();
    return result.rowCount >= 0;
  }
};
return repository;
}

export const incidentRepository = createIncidentRepository();
