import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ViewLoader } from '../../src/core/viewLoader.js';
import { REALTIME_ROOMS as clientRealtimeRooms } from '../../shared/realtimeRooms.js';
import { REALTIME_ROOMS as serverRealtimeRooms } from '../../server/sockets/eventRegistry.js';
import { diagnostics } from '../../src/core/diagnostics.js';

const root = new URL('../../', import.meta.url);
const [html, stylesheet, worker] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('style.css', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8')
]);
const cctvAdapter = await readFile(new URL('../../src/modules/cctv/cctvRealtimeAdapter.js', import.meta.url), 'utf8');

test('Phase 9: CSS entrypoints load the main stylesheet once without an import loop', () => {
  const mainStylesheetLinks = html.match(/href=["'](?:\.\/)?css\/main\.css["']/g) || [];
  assert.equal(mainStylesheetLinks.length, 1);
  assert.doesNotMatch(stylesheet, /@import\s+["']\.\/css\/main\.css["']/);
});

test('Phase 9: service worker excludes API, socket and authenticated requests from cache handling', () => {
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/socket\.io\/'\)/);
  assert.match(worker, /request\.headers\.has\('Authorization'\)/);
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /url\.origin === self\.location\.origin/);
});

test('Phase 9: cache namespace is versioned and old OmniTRAF versions are removed', () => {
  assert.match(worker, /const CACHE_NAME = 'omnitraf-sits-v\d+'/);
  assert.match(worker, /const SHELL_CACHE_NAME = 'omnitraf-sits-v\d+-shell'/);
  assert.match(worker, /key\.startsWith\('omnitraf-sits-'\)/);
  assert.match(worker, /key !== CACHE_NAME && key !== SHELL_CACHE_NAME/);
  assert.match(worker, /MAX_STATIC_ENTRIES/);
});

test('Phase 9: offline navigation falls back only to the app shell', () => {
  assert.match(worker, /caches\.match\('\/index\.html', \{ cacheName: SHELL_CACHE_NAME \}\)/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(html, /Data operasional live tidak tersedia/);
});

test('Phase 9: independent shell templates are requested concurrently and retain DOM order', async () => {
  const loader = new ViewLoader();
  let inFlight = 0;
  let peakInFlight = 0;
  loader.fetchTemplate = async (url) => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return url;
  };

  const { marqueeHtml, notifHtml, modalHtmls } = await loader._fetchShellTemplates();
  assert.ok(peakInFlight > 1, 'shell fetches should overlap instead of forming a serial waterfall');
  assert.equal(marqueeHtml, loader.componentMap.marquee.file);
  assert.equal(notifHtml, loader.componentMap.notifDrawer.file);
  assert.deepEqual(modalHtmls, loader.componentMap.modals);
});

test('Phase 9: browser realtime room contract is shared without importing protected server modules', () => {
  assert.strictEqual(clientRealtimeRooms, serverRealtimeRooms);
  assert.doesNotMatch(cctvAdapter, /from\s+["'][^"']*server\//);
  assert.equal(clientRealtimeRooms.cctvCamera('camera-1'), 'room:cctv:camera-1');
});

test('Phase 9: long-task observation is opt-in, records local metrics, and disconnects cleanly', () => {
  const previousWindow = globalThis.window;
  const previousObserver = globalThis.PerformanceObserver;
  let observerInstance;
  class MockPerformanceObserver {
    static supportedEntryTypes = ['longtask'];
    constructor(callback) { this.callback = callback; observerInstance = this; }
    observe(options) { this.options = options; }
    disconnect() { this.disconnected = true; }
  }

  globalThis.window = { location: { search: '' } };
  globalThis.PerformanceObserver = MockPerformanceObserver;
  try {
    assert.equal(diagnostics.startLongTaskObserver(), false, 'observation stays off by default');
    globalThis.window.location.search = '?diagnostics=1';
    assert.equal(diagnostics.startLongTaskObserver(), true);
    assert.deepEqual(observerInstance.options, { type: 'longtask', buffered: true });
    observerInstance.callback({ getEntries: () => [{ duration: 72.36 }] });
    assert.equal(diagnostics.getMetrics().longTaskCount, 1);
    assert.equal(diagnostics.getMetrics().maxLongTaskDurationMs, '72.4ms');
    diagnostics.stopLongTaskObserver();
    assert.equal(observerInstance.disconnected, true);
  } finally {
    diagnostics.stopLongTaskObserver();
    diagnostics.longTaskCount = 0;
    diagnostics.maxLongTaskDurationMs = 0;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousObserver === undefined) delete globalThis.PerformanceObserver;
    else globalThis.PerformanceObserver = previousObserver;
  }
});
