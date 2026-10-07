import { dbManager } from '../db/database.js';

export const metadataRepository = {
  findByKey: (key) => dbManager.getMetadata(key),
  set: (key, value) => dbManager.setMetadata(key, value)
};
