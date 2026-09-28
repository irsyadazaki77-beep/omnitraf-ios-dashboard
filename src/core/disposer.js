/**
 * OmniTRAF Surabaya - Disposer & Resource Cleanup Registry (Phase 8)
 * Manages resource lifecycles: timers, animation frames, event listeners, observers, and socket subscriptions.
 */

import { diagnostics } from './diagnostics.js';

export class Disposer {
  constructor(name = 'Module') {
    this.name = name;
    this.cleanups = new Set();
  }

  setInterval(fn, ms) {
    const id = diagnostics.setInterval(fn, ms);
    const cleanup = () => diagnostics.clearInterval(id);
    this.add(cleanup);
    return id;
  }

  setTimeout(fn, ms) {
    const id = diagnostics.setTimeout(fn, ms);
    const cleanup = () => diagnostics.clearTimeout(id);
    this.add(cleanup);
    return id;
  }

  requestAnimationFrame(fn) {
    const id = diagnostics.requestAnimationFrame(fn);
    const cleanup = () => diagnostics.cancelAnimationFrame(id);
    this.add(cleanup);
    return id;
  }

  addEventListener(target, event, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, handler, options);
    const cleanup = () => {
      try {
        target.removeEventListener(event, handler, options);
      } catch (err) {
        // Ignore removal error
      }
    };
    this.add(cleanup);
    return cleanup;
  }

  addSocketListener(socketClient, event, handler) {
    if (!socketClient || typeof socketClient.on !== 'function') return () => {};
    const unsub = socketClient.on(event, handler);
    this.add(unsub);
    return unsub;
  }

  addStoreSubscription(stateStore, event, handler) {
    if (!stateStore || typeof stateStore.subscribe !== 'function') return () => {};
    const unsub = stateStore.subscribe(event, handler);
    this.add(unsub);
    return unsub;
  }

  addObserver(observer) {
    if (!observer || typeof observer.disconnect !== 'function') return () => {};
    const cleanup = () => {
      try {
        observer.disconnect();
      } catch (err) {
        // Ignore
      }
    };
    this.add(cleanup);
    return cleanup;
  }

  add(cleanupFn) {
    if (typeof cleanupFn === 'function') {
      this.cleanups.add(cleanupFn);
    }
  }

  clear() {
    this.cleanups.forEach(fn => {
      try {
        fn();
      } catch (err) {
        console.warn(`[Disposer:${this.name}] Cleanup error:`, err);
      }
    });
    this.cleanups.clear();
  }
}
