/**
 * OmniTRAF Surabaya - State Store & Event Bus (Pub-Sub)
 * Sentralisasi state aplikasi & orkestrator event lintas modul
 */

import { TRAFFIC_LIMITS } from '../config/trafficConfig.js';

class StateStore {
  constructor() {
    this._state = {
      currentView: "dashboard",
      theme: "dark",
      isChaosMode: false,
      chaosLevel: 0,
      isSirenMuted: false,
      greenWaveActive: false,
      greenSplitWonokromo: TRAFFIC_LIMITS.DEFAULT_GREEN_SPLIT,
      activeCycles: [38, 28],
      apillStateWonokromo: "green",
      apillTimerWonokromo: 24,
      cctvPaused: false,
      cctvBoxesVisible: true,
      activeIncidentFilter: "all",
      sseConnected: false,
      lastTelemetryTime: null,
      telemetry: {
        timestamp: "--:--:-- WIB",
        networkLoad: 74,
        avgWaitTime: 42,
        congestionIndex: 62,
        co2SavedKg: 1420,
        fuelSavedLiters: 580,
        vehiclesToday: 128540,
        sitsUptime: 99.4,
        cctvOnline: 184,
        iotOnline: 312,
        sitsSignal: 94,
        aiScore: 92,
        aiConfidence: 96
      },
      activeResponders: []
    };

    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Mengambil snapshot state saat ini
   * @returns {Readonly<typeof this._state>}
   */
  getState() {
    return Object.freeze({ ...this._state });
  }

  /**
   * Memperbarui sebagian state dan memancarkan event spesifik jika diperlukan
   * @param {Partial<typeof this._state>} partialState
   * @param {boolean} [emitGeneric=true]
   */
  setState(partialState, emitGeneric = true) {
    const prevState = { ...this._state };
    this._state = { ...this._state, ...partialState };

    if (emitGeneric) {
      this.publish("state:changed", {
        prev: prevState,
        current: this.getState(),
        changedKeys: Object.keys(partialState)
      });
    }

    // Trigger specific key-based events for targeted listeners
    for (const key of Object.keys(partialState)) {
      this.publish(`state:${key}`, {
        value: this._state[key],
        prev: prevState[key]
      });
    }
  }

  /**
   * Berlangganan ke event tertentu
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Fungsi unsubscribe
   */
  subscribe(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    return () => {
      const set = this._listeners.get(event);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this._listeners.delete(event);
      }
    };
  }

  /**
   * Memancarkan event ke semua subscriber
   * @param {string} event
   * @param {any} [payload]
   */
  publish(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.forEach(fn => {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[StateStore] Error in listener for event "${event}":`, err);
        }
      });
    }

    // Wildcard subscriber for debugging or global logging
    const wildcardHandlers = this._listeners.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach(fn => {
        try {
          fn(event, payload);
        } catch (err) {
          console.error(`[StateStore] Error in wildcard listener:`, err);
        }
      });
    }
  }
}

export const stateStore = new StateStore();
