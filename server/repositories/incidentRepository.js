import { dbManager } from '../db/database.js';

export const incidentRepository = {
  findAll: () => dbManager.getAllIncidents(),
  findById: (id) => dbManager.getAllIncidents().data?.find((item) => String(item.id) === String(id)) || null,
  create: (data) => dbManager.upsertIncident(data),
  update: (id, patch) => {
    const current = incidentRepository.findById(id);
    if (!current) return false;
    return dbManager.upsertIncident({ ...current, ...patch, id: current.id });
  },
  remove: (id) => dbManager.deleteIncident(id),
  upsert: (...args) => dbManager.upsertIncident(...args)
};
