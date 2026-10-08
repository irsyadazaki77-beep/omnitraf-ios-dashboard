import { SqlJsAdapter } from './adapters/sqljsAdapter.js';
import { PostgresAdapter } from './adapters/postgresAdapter.js';

export { SqlJsAdapter };

export class DatabaseManager {
  constructor({ driver = process.env.DB_DRIVER || 'sqljs', ...options } = {}) {
    if (!['sqljs', 'postgres'].includes(driver)) throw new Error('DB_DRIVER must be either "sqljs" or "postgres".');
    if (driver === 'postgres') return new PostgresAdapter(options);
    if (process.env.OMNITRAF_RUNTIME_MODE === 'cluster' && (process.env.NODE_ENV === 'production' || process.env.ALLOW_SQLJS_CLUSTER !== 'true')) {
      throw new Error('Cluster mode requires DB_DRIVER=postgres. Set ALLOW_SQLJS_CLUSTER=true only for explicit non-production tests.');
    }
    return new SqlJsAdapter();
  }
}

export const dbManager = new DatabaseManager();
