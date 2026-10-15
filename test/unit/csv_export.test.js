import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncidentCsv, encodeCsvCell } from '../../src/core/csv.js';

test('incident CSV exports current records with simulation provenance and escaped cells', () => {
  const csv = buildIncidentCsv([{
    id: 'INC-1', reportedAt: '2026-10-09T01:00:00Z', location: 'Jl. Darmo, Surabaya',
    title: 'Queue "sample"', category: 'congestion', severity: 'high', status: 'ACTIVE', assignedUnit: '=IMPORTXML("x")'
  }], 'SIMULATED');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"INC-1"/);
  assert.match(csv, /"Jl\. Darmo, Surabaya"/);
  assert.match(csv, /"Queue ""sample"""/);
  assert.match(csv, /"'=IMPORTXML\(""x""\)"/);
  assert.match(csv, /"SIMULATED"/);
});

test('incident CSV empty state contains only a header and cells normalize safely', () => {
  const csv = buildIncidentCsv(null);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
  assert.equal(encodeCsvCell(null), '""');
  assert.equal(encodeCsvCell('line\nbreak'), '"line\nbreak"');
});

test('snapshot CSV always carries the same snapshot ID, including an empty incident set', () => {
  const snapshot = { id: 'SIM-20261015090000000', timestamp: '2026-10-15T02:00:00.000Z', stale: true };
  const empty = buildIncidentCsv([], 'SIMULATED', snapshot);
  assert.match(empty, /"Snapshot ID"/);
  assert.match(empty, /"SNAPSHOT"/);
  assert.match(empty, /"SIM-20261015090000000"/);
  assert.match(empty, /"STALE"/);
  const [emptyHeader, emptySnapshotRow] = empty.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(emptySnapshotRow.split(',').length, emptyHeader.split(',').length);

  const withIncident = buildIncidentCsv([{ id: 'INC-1', status: 'ACTIVE' }], 'SIMULATED', snapshot);
  assert.match(withIncident, /"INSIDEN"/);
  assert.match(withIncident, /"SIM-20261015090000000"/);
  assert.match(withIncident, /"STALE"/);
  const [incidentHeader, incidentRow] = withIncident.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(incidentRow.split(',').length, incidentHeader.split(',').length);
});
