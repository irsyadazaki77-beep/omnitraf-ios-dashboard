import 'dotenv/config';
import initSqlJs from 'sql.js';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPostgresMigrations } from '../server/db/migrations/postgresMigrations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePathArg = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
const sourcePath = path.resolve(root, sourcePathArg || process.env.DB_PATH || './data/omnitraf.sqlite');
const dryRun = process.argv.includes('--dry-run');
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run db:migrate:sqljs-to-postgres [-- --source=path/to/omnitraf.sqlite] [--dry-run]');
  console.log('Set DATABASE_URL for an import. --dry-run only reads and counts the source database.');
  process.exit(0);
}
const connectionString = process.env.DATABASE_URL;
if (!dryRun && !connectionString) throw new Error('Set DATABASE_URL to the destination PostgreSQL database.');

const SQL = await initSqlJs();
const sourceBuffer = await fs.readFile(sourcePath);
const source = new SQL.Database(sourceBuffer);
const tables = ['schema_metadata', 'incidents', 'audit_logs', 'signal_configs', 'device_telemetry'];
const rowsByTable = new Map();
for (const table of tables) {
  const exists = source.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]).length > 0;
  if (!exists) throw new Error(`Source database is missing required table: ${table}`);
  const result = source.exec(`SELECT * FROM ${table}`);
  rowsByTable.set(table, result[0]?.values.map((values) => Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]]))) || []);
}

console.log(`Source: ${sourcePath}`);
for (const table of tables) console.log(`${table}: ${rowsByTable.get(table).length} rows`);
if (dryRun) {
  source.close();
  console.log('Dry run complete; destination was not modified.');
} else {
const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
try {
  await pool.query('SELECT 1');
  await runPostgresMigrations(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rowsByTable.get('schema_metadata')) await client.query('INSERT INTO schema_metadata(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at', [r.key,r.value,r.updated_at]);
    for (const r of rowsByTable.get('incidents')) await client.query('INSERT INTO incidents(id,type,location,lat,lng,time,status,severity,priority,resolved_at,acknowledged_at,operator,notes,source,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,location=EXCLUDED.location,lat=EXCLUDED.lat,lng=EXCLUDED.lng,time=EXCLUDED.time,status=EXCLUDED.status,severity=EXCLUDED.severity,priority=EXCLUDED.priority,resolved_at=EXCLUDED.resolved_at,acknowledged_at=EXCLUDED.acknowledged_at,operator=EXCLUDED.operator,notes=EXCLUDED.notes,source=EXCLUDED.source,payload=EXCLUDED.payload', [r.id,r.type,r.location,r.lat,r.lng,r.time,r.status,r.severity,r.priority,r.resolved_at,r.acknowledged_at,r.operator,r.notes,r.source,r.payload]);
    for (const r of rowsByTable.get('audit_logs')) {
      await client.query('INSERT INTO audit_logs(id,operator,action,entity,result,correlation_id,details,command_id,idempotency_key,actor_role,source_instance_id,leader_instance_id,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING', [r.id,r.operator,r.action,r.entity,r.result,r.correlation_id,r.details,r.command_id,r.idempotency_key,r.actor_role,r.source_instance_id,r.leader_instance_id,r.timestamp]);
      const dedupeKey = r.idempotency_key ? `idem:${r.idempotency_key}` : (r.correlation_id ? `corr:${r.correlation_id}` : null);
      if (dedupeKey) await client.query('INSERT INTO audit_deduplication_keys(dedupe_key) VALUES($1) ON CONFLICT(dedupe_key) DO NOTHING', [dedupeKey]);
    }
    for (const r of rowsByTable.get('signal_configs')) await client.query('INSERT INTO signal_configs(node_id,green_split,cycle_time,mode,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(node_id) DO UPDATE SET green_split=EXCLUDED.green_split,cycle_time=EXCLUDED.cycle_time,mode=EXCLUDED.mode,updated_at=EXCLUDED.updated_at', [r.node_id,r.green_split,r.cycle_time,r.mode,r.updated_at]);
    for (const r of rowsByTable.get('device_telemetry')) await client.query('INSERT INTO device_telemetry(device_id,type,status,battery,ping_ms,fps,resolution,green_wave_sync,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(device_id) DO UPDATE SET type=EXCLUDED.type,status=EXCLUDED.status,battery=EXCLUDED.battery,ping_ms=EXCLUDED.ping_ms,fps=EXCLUDED.fps,resolution=EXCLUDED.resolution,green_wave_sync=EXCLUDED.green_wave_sync,updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload', [r.device_id,r.type,r.status,r.battery,r.ping_ms,r.fps,r.resolution,r.green_wave_sync == null ? null : Boolean(r.green_wave_sync),r.updated_at,r.payload]);
    await client.query("SELECT setval(pg_get_serial_sequence('audit_logs','id'), COALESCE((SELECT MAX(id) FROM audit_logs),1), EXISTS(SELECT 1 FROM audit_logs))");
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  for (const table of tables) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    console.log(`${table}: imported ${rowsByTable.get(table).length}, destination now ${rows[0].count}`);
  }
} finally {
  source.close();
  await pool.end();
}
}
