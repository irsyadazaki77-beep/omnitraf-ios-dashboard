import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportController } from '../../src/controllers/reportController.js';

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
