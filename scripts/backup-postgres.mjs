import { access, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');
const url = new URL(connectionString);
const outputDirectory = path.resolve(process.argv[2] || 'backups');
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = path.join(outputDirectory, `omnitraf-${timestamp}.dump`);
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  ...(url.password ? { PGPASSWORD: decodeURIComponent(url.password) } : {})
};
if (url.searchParams.get('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');

await mkdir(outputDirectory, { recursive: true });
try { await access(outputPath); throw new Error('Backup file already exists; refusing to overwrite it.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', outputPath], { env, stdio: 'ignore' });
if (result.error) throw new Error(`pg_dump is unavailable: ${result.error.message}`);
if (result.status !== 0) throw new Error(`pg_dump failed with exit code ${result.status}.`);
const info = await stat(outputPath);
console.log(`PostgreSQL backup created: ${outputPath} (${info.size} bytes)`);
