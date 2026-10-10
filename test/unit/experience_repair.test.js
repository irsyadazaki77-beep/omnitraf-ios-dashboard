import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildAnalyticsSeries } from '../../src/modules/analyticsSeries.js';
import { generateForecastSnapshot } from '../../src/modules/forecastEngine.js';
import { createReportSnapshot } from '../../shared/reportSnapshot.js';
import { generateReportPdf } from '../../shared/reportPdf.js';
import { buildIncidentCsv } from '../../src/core/csv.js';

test('corridor selection changes the numeric series and totals equal hourly sum', () => {
  const a = buildAnalyticsSeries({}, 'corridor-ayani');
  const b = buildAnalyticsSeries({}, 'corridor-merr');
  assert.equal(a.points.length, 24);
  assert.equal(a.totalVolume, a.points.reduce((total, row) => total + row.volume, 0));
  assert.notEqual(a.totalVolume, b.totalVolume);
  assert.equal(a.peak.volume, Math.max(...a.points.map(row => row.volume)));
  assert.deepEqual(a, buildAnalyticsSeries({}, 'corridor-ayani'));
});

test('unknown savings stay unknown and real zeros survive forecasting and reporting', () => {
  assert.equal(generateForecastSnapshot(8, {}).esgImpact.observedSavings.co2SavedKg, null);
  const state = { telemetry: { co2SavedKg: 0, fuelSavedLiters: 0, vehiclesToday: 0, avgWaitTime: 0 }, incidents: [{ id: 'I1', status: 'ACTIVE' }] };
  assert.equal(generateForecastSnapshot(8, state).esgImpact.observedSavings.co2SavedKg, 0);
  const snapshot = createReportSnapshot(state, 'Snapshot sesi', '2026-10-10T01:00:00.000Z');
  state.telemetry.vehiclesToday = 999;
  state.incidents[0].status = 'RESOLVED';
  assert.equal(snapshot.metrics.volume, 0);
  assert.equal(snapshot.incidents[0].status, 'ACTIVE');
  const csv = buildIncidentCsv(snapshot.incidents, snapshot.source, snapshot);
  assert.ok(csv.includes(snapshot.id));
  assert.ok(csv.includes(snapshot.timestamp));
});

test('PDF handles empty and multi-page snapshots without inventing metrics', async () => {
  const empty = createReportSnapshot({});
  assert.equal(empty.metrics.volume, null);
  const document = await PDFDocument.load(await generateReportPdf(empty));
  assert.equal(document.getPageCount(), 1);
  const many = createReportSnapshot({ intersections: Array.from({ length: 50 }, (_, i) => ({ id: `S${i}`, name: `Simpang ${i}` })) });
  const multi = await PDFDocument.load(await generateReportPdf(many));
  assert.ok(multi.getPageCount() > 1);
});

