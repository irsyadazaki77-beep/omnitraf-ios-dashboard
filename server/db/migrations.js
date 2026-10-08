export const CURRENT_SCHEMA_VERSION = 19;

export function runMigrations(db, getTableColumns, setMetadata, schemaVersion = CURRENT_SCHEMA_VERSION) {
  const auditCols = getTableColumns('audit_logs');
  if (!auditCols.includes('correlation_id')) db.run('ALTER TABLE audit_logs ADD COLUMN correlation_id TEXT;');
  if (!auditCols.includes('details')) db.run('ALTER TABLE audit_logs ADD COLUMN details TEXT;');
  for (const column of ['command_id', 'idempotency_key', 'actor_role', 'source_instance_id', 'leader_instance_id']) {
    if (!auditCols.includes(column)) db.run(`ALTER TABLE audit_logs ADD COLUMN ${column} TEXT;`);
  }

  const incidentCols = getTableColumns('incidents');
  if (!incidentCols.includes('severity')) db.run('ALTER TABLE incidents ADD COLUMN severity TEXT;');
  if (!incidentCols.includes('priority')) db.run('ALTER TABLE incidents ADD COLUMN priority TEXT;');
  if (!incidentCols.includes('acknowledged_at')) db.run('ALTER TABLE incidents ADD COLUMN acknowledged_at TEXT;');
  if (!incidentCols.includes('notes')) db.run('ALTER TABLE incidents ADD COLUMN notes TEXT;');
  if (!incidentCols.includes('source')) db.run('ALTER TABLE incidents ADD COLUMN source TEXT;');

  const deviceCols = getTableColumns('device_telemetry');
  if (!deviceCols.includes('fps')) db.run('ALTER TABLE device_telemetry ADD COLUMN fps INTEGER;');
  if (!deviceCols.includes('resolution')) db.run('ALTER TABLE device_telemetry ADD COLUMN resolution TEXT;');
  if (!deviceCols.includes('green_wave_sync')) db.run('ALTER TABLE device_telemetry ADD COLUMN green_wave_sync INTEGER;');

  db.run('CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp);');
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_corr ON audit_logs(correlation_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);');
  db.run('CREATE INDEX IF NOT EXISTS idx_incidents_time ON incidents(time);');
  setMetadata('schema_version', String(schemaVersion));
  setMetadata('last_migrated_at', new Date().toISOString());
}
