import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportController } from '../../src/controllers/reportController.js';
import { createReportSnapshot } from '../../shared/reportSnapshot.js';

test('report generation progress is bounded and updates accessible status elements', () => {
  const previousDocument = globalThis.document;
  const elements = new Map([
    ['loaderPercentage', { textContent: '' }],
    ['loaderStatus', { textContent: '' }],
    ['modalLoaderCircle', { style: {} }]
  ]);
  globalThis.document = { getElementById: (id) => elements.get(id) || null };

  try {
    const controller = new ReportController();
    controller._updateLoaderProgress(150, 'Completed');
    assert.equal(elements.get('loaderPercentage').textContent, '100%');
    assert.equal(elements.get('loaderStatus').textContent, 'Completed');
    assert.equal(elements.get('modalLoaderCircle').style.strokeDashoffset, '0');

    controller._updateLoaderProgress(-10, 'Starting');
    assert.equal(elements.get('loaderPercentage').textContent, '0%');
    assert.equal(elements.get('modalLoaderCircle').style.strokeDashoffset, '264');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('report exports require and retain an explicit active snapshot', () => {
  const previousDocument = globalThis.document;
  const ids = ['activeReportSnapshotState', 'btnExportCsv', 'btnPrintExecutive', 'btnCopyTelemetryJson', 'btnCopyApiJson'];
  const elements = new Map(ids.map((id) => [id, { textContent: '', disabled: false, dataset: {} }]));
  globalThis.document = { getElementById: (id) => elements.get(id) || null };

  try {
    const controller = new ReportController();
    controller._syncSnapshotControls();
    assert.throws(() => controller._getActiveSnapshot(), /Buat snapshot sesi terlebih dahulu/);
    for (const id of ids.slice(1)) assert.equal(elements.get(id).disabled, true);

    const snapshot = { id: 'SIM-20261015090000000', timestamp: '2026-10-15T02:00:00.000Z', stale: true };
    controller.snapshot = snapshot;
    controller._syncSnapshotControls();
    assert.equal(controller._getActiveSnapshot(), snapshot);
    for (const id of ids.slice(1)) assert.equal(elements.get(id).disabled, false);
    assert.equal(elements.get('activeReportSnapshotState').dataset.snapshotId, snapshot.id);
    assert.match(elements.get('activeReportSnapshotState').textContent, /STALE/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('report snapshots preserve type, source, stale state, and the supplied timestamp', () => {
  const snapshot = createReportSnapshot({
    lastTelemetrySource: 'SIMULATED',
    isStaleData: true,
    telemetry: { vehiclesToday: 0 },
    incidents: [{ id: 'INC-1', status: 'RESOLVED' }]
  }, 'Latihan operator', '2026-10-15T02:00:00.000Z');
  assert.equal(snapshot.type, 'Latihan operator');
  assert.equal(snapshot.timestamp, '2026-10-15T02:00:00.000Z');
  assert.equal(snapshot.source, 'SIMULATED');
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.metrics.volume, 0);
  assert.equal(snapshot.metrics.incidents, 1);
});
