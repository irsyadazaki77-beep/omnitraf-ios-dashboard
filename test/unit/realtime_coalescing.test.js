import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CctvRealtimeAdapter } from '../../src/modules/cctv/cctvRealtimeAdapter.js';

test('CCTV visual coalescing renders only the latest accepted frame per animation frame', () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  let nextHandle = 1;
  globalThis.requestAnimationFrame = callback => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  };
  globalThis.cancelAnimationFrame = handle => callbacks.delete(handle);
  try {
    const rendered = [];
    const adapter = new CctvRealtimeAdapter({
      coalesceVisualUpdates: true,
      onFrame: frame => rendered.push(frame.seq)
    });
    assert.equal(adapter.handleIncomingPayload({ seq: 1, timestamp: Date.now() }), true);
    assert.equal(adapter.handleIncomingPayload({ seq: 2, timestamp: Date.now() }), true);
    assert.equal(adapter.handleIncomingPayload({ seq: 3, timestamp: Date.now() }), true);
    assert.deepEqual(rendered, []);
    assert.equal(adapter.coalescedVisualUpdates, 2);
    const [handle, callback] = callbacks.entries().next().value;
    callbacks.delete(handle);
    callback();
    assert.deepEqual(rendered, [3]);
    adapter.disconnect();
  } finally {
    if (originalRequest) globalThis.requestAnimationFrame = originalRequest;
    else delete globalThis.requestAnimationFrame;
    if (originalCancel) globalThis.cancelAnimationFrame = originalCancel;
    else delete globalThis.cancelAnimationFrame;
  }
});
