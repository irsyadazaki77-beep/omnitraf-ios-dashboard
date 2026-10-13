import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ViewLoader } from '../../src/core/viewLoader.js';

describe('Frontend Runtime Reliability: ViewLoader Resiliency & Concurrency', () => {
  let loader;

  beforeEach(() => {
    loader = new ViewLoader();
  });

  test('1. fetchTemplate retries on network error before succeeding', async () => {
    let callCount = 0;
    global.fetch = async (url) => {
      callCount++;
      if (callCount < 2) {
        throw new Error('Network error transient failure');
      }
      return {
        ok: true,
        text: async () => '<div>Retried Content</div>'
      };
    };

    const content = await loader.fetchTemplate('/test-view.html', 2);
    assert.strictEqual(content, '<div>Retried Content</div>');
    assert.strictEqual(callCount, 2);
  });

  test('2. fetchTemplate fails cleanly and evicts cache on exhaustion', async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      throw new Error('Persistent network failure');
    };

    await assert.rejects(
      async () => await loader.fetchTemplate('/failing-view.html', 1),
      /Persistent network failure/
    );
    assert.strictEqual(callCount, 2);
    assert.strictEqual(loader.templateCache.has('/failing-view.html'), false);
  });

  test('3. mountShellComponents shares in-flight promise and sets isComponentsMounted only on success', async () => {
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls++;
      return {
        ok: true,
        text: async () => '<div class="test-component">Component</div>'
      };
    };

    // Mock DOM elements
    const dummyElements = {};
    global.document = {
      getElementById: (id) => {
        if (!dummyElements[id]) {
          dummyElements[id] = {
            id,
            append: () => {},
            replaceWith: () => {}
          };
        }
        return dummyElements[id];
      },
      createElement: () => ({
        innerHTML: '',
        childNodes: [{ nodeType: 1 }],
        firstElementChild: { classList: { remove: () => {} }, setAttribute: () => {} }
      }),
      body: {
        prepend: () => {},
        append: () => {}
      }
    };

    assert.strictEqual(loader.isComponentsMounted, false);
    // Concurrent shell mounts
    const p1 = loader.mountShellComponents();
    const p2 = loader.mountShellComponents();
    assert.strictEqual(p1, p2, 'Concurrent mountShellComponents calls must share the same in-flight promise');

    await Promise.all([p1, p2]);
    assert.strictEqual(loader.isComponentsMounted, true);
    assert.strictEqual(loader._shellMountPromise, null);
  });

  test('4. mountShellComponents resets isComponentsMounted to false if mounting fails', async () => {
    global.fetch = async () => {
      throw new Error('Fatal template fetch error');
    };

    await assert.rejects(
      async () => await loader.mountShellComponents(),
      /Fatal template fetch error/
    );
    assert.strictEqual(loader.isComponentsMounted, false);
    assert.strictEqual(loader._shellMountPromise, null);
  });
});
