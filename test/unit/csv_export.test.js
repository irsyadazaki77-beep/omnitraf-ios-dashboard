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
