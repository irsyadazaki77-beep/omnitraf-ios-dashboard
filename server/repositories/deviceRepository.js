import { dbManager } from '../db/database.js';

export const deviceRepository = {
  findAll: () => dbManager.getAllDeviceTelemetry(),
  findById: (id) => dbManager.getAllDeviceTelemetry().data?.find((item) => item.deviceId === id) || null,
  create: (data) => dbManager.upsertDeviceTelemetry(data),
  update: (id, patch) => {
    const current = deviceRepository.findById(id);
    if (!current) return false;
    return dbManager.upsertDeviceTelemetry({ ...current, ...patch, deviceId: current.deviceId });
  },
  upsert: (...args) => dbManager.upsertDeviceTelemetry(...args)
};
