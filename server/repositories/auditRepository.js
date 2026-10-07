import { dbManager } from '../db/database.js';

export const auditRepository = {
  findAll: (limit) => dbManager.getAllAuditLogs(limit),
  create: (...args) => dbManager.insertAuditLog(...args),
  insert: (...args) => dbManager.insertAuditLog(...args)
};
