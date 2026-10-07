import { dbManager } from '../db/database.js';

export const signalConfigRepository = {
  findAll: () => dbManager.getAllSignalConfigs(),
  upsert: (...args) => dbManager.upsertSignalConfig(...args)
};
