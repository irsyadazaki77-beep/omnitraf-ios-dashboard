/**
 * OmniTRAF Surabaya - Centralized Event Bus (Phase 1 Refactor)
 * Bertanggung jawab khusus untuk event pub/sub infrastructure, wildcard subscription,
 * dan event envelope creation.
 */

/**
 * Standard Event Envelope Factory
 */
export function createEventEnvelope(type, payload, source = 'system', version = 1) {
  return {
    type,
    timestamp: new Date().toISOString(),
    source,
    version,
    payload
  };
}

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Berlangganan ke event tertentu
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
   */
  subscribe(event, callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }

    const set = this._listeners.get(event);
    set.add(callback);

    let isUnsubscribed = false;
    return () => {
      if (isUnsubscribed) return;
      isUnsubscribed = true;
      set.delete(callback);
      if (set.size === 0) {
        this._listeners.delete(event);
      }
    };
  }

  /**
   * Memancarkan event ke semua subscriber
   * @param {string} event
   * @param {*} [payload]
   */
  publish(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers && handlers.size > 0) {
      const list = Array.from(handlers);
      list.forEach(fn => {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[EventBus] Error in listener for event "${event}":`, err);
        }
      });
    }

    // Wildcard subscriber (*) untuk logging / audit / global bridges
    const wildcardHandlers = this._listeners.get("*");
    if (wildcardHandlers && wildcardHandlers.size > 0) {
      const wList = Array.from(wildcardHandlers);
      wList.forEach(fn => {
        try {
          fn(event, payload);
        } catch (err) {
          console.error(`[EventBus] Error in wildcard listener for event "${event}":`, err);
        }
      });
    }
  }

  /**
   * Membersihkan seluruh listener
   */
  clearListeners() {
    this._listeners.clear();
  }

  getListenerCount() {
    let count = 0;
    for (const listeners of this._listeners.values()) count += listeners.size;
    return count;
  }
}

export const eventBus = new EventBus();
