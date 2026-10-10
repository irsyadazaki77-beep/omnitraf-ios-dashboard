import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const connectionString = process.env.DATABASE_URL;
const { Pool } = pg;
const backupPath = process.argv[2] && path.resolve(process.argv[2]);
if (!connectionString || !backupPath) throw new Error('Usage: DATABASE_URL=... node scripts/verify-postgres-backup.mjs <backup.dump>');

const url = new URL(connectionString);
const scratchDatabase = `omnitraf_restore_${randomUUID().replaceAll('-', '')}`;
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGDATABASE: scratchDatabase,
  ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {})
};
if (url.searchParams.get('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
const admin = new Pool({ connectionString });
let created = false;
try {
  await admin.query(`CREATE DATABASE "${scratchDatabase}"`);
  created = true;
  const restored = spawnSync('pg_restore', ['--no-owner', '--no-acl', '--dbname', scratchDatabase, backupPath], { env, stdio: 'ignore' });
  if (restored.error) throw new Error(`pg_restore is unavailable: ${restored.error.message}`);
  if (restored.status !== 0) throw new Error(`pg_restore failed with exit code ${restored.status}.`);

  const scratchUrl = new URL(connectionString);
  scratchUrl.pathname = `/${scratchDatabase}`;
  const restoredPool = new Pool({ connectionString: scratchUrl.toString(), max: 1 });
  let counts;
  try {
    const { rows } = await restoredPool.query(`
      SELECT
        (SELECT count(*)::bigint FROM schema_migrations) AS migrations,
        (SELECT count(*)::bigint FROM audit_logs) AS audit_logs,
        (SELECT count(*)::bigint FROM command_receipts) AS command_receipts
    `);
    counts = Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
  } finally { await restoredPool.end(); }
  if (counts.migrations < 1) throw new Error('Restored backup is missing schema migration history.');
  console.log(`Restore drill passed in isolated database ${scratchDatabase}: ${JSON.stringify(counts)}`);
} finally {
  if (created) await admin.query(`DROP DATABASE "${scratchDatabase}" WITH (FORCE)`);
  await admin.end();
}
