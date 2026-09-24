/**
 * OmniTRAF Surabaya - Unified Socket.io Network Gateway Client
 * Menyediakan koneksi tunggal Socket.io untuk seluruh modul aplikasi (TrafficEngine, CCTV, Chat, Alert).
 * Mencegah redundansi koneksi ganda dan mengalirkan status koneksi ke Pub/Sub StateStore.
 */

import { stateStore } from './stateStore.js';
import { soundManager } from './soundManager.js';

class SocketClient {
  constructor() {
    this.socket = null;
    this.isConnecting = false;
    this.hasRegisteredListeners = false;
    this._listeners = new Map();
  }

  /**
   * Mengambil atau menginisialisasi instance tunggal socket
   */
  getSocket() {
    if (this.socket) return this.socket;

    try {
      if (typeof window.io !== "undefined") {
        this.socket = window.io({
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 4000
        });
        this._bindStandardEvents();
      } else {
        // Dynamic load fallback
        const script = document.createElement("script");
        script.src = "/socket.io/socket.io.js";
        script.onload = () => {
          if (typeof window.io !== "undefined" && !this.socket) {
            this.socket = window.io({
              reconnection: true,
              reconnectionAttempts: Infinity,
              reconnectionDelay: 1000,
              reconnectionDelayMax: 5000,
              timeout: 4000
            });
            this._bindStandardEvents();
            this._flushPendingListeners();
          }
        };
        script.onerror = () => {
          console.info("[SocketClient] Socket.io script unreachable. Fallback to Local Simulation.");
          stateStore.setState({ sseConnected: false });
          stateStore.publish("socket:status", "fallback");
          stateStore.publish("socket:connected", false);
        };
        document.head.appendChild(script);
      }
    } catch (err) {
      console.warn("[SocketClient] Connection deferred:", err);
      stateStore.publish("socket:status", "fallback");
      stateStore.publish("socket:connected", false);
    }

    return this.socket;
  }

  _bindStandardEvents() {
    if (!this.socket || this.hasRegisteredListeners) return;
    this.hasRegisteredListeners = true;

    this.socket.on('connect', () => {
      console.info("⚡ [SocketClient] Terhubung ke Backend SITS Gateway.");
      stateStore.setState({ sseConnected: true });
      stateStore.publish("socket:status", "connected");
      stateStore.publish("socket:connected", true);
    });

    this.socket.on('reconnect_attempt', () => {
      stateStore.publish("socket:status", "reconnecting");
    });

    this.socket.on('reconnecting', () => {
      stateStore.publish("socket:status", "reconnecting");
    });

    this.socket.on('connect_error', () => {
      stateStore.setState({ sseConnected: false });
      stateStore.publish("socket:status", "fallback");
      stateStore.publish("socket:connected", false);
    });

    this.socket.on('disconnect', () => {
      console.warn("⚠️ [SocketClient] Terputus dari server. Fallback simulasi aktif.");
      stateStore.setState({ sseConnected: false });
      stateStore.publish("socket:status", "fallback");
      stateStore.publish("socket:connected", false);
    });

    // Global Toast & Alert Bridge
    this.socket.on('system:toast', (data) => {
      if (data && data.message && typeof window.showToast === "function") {
        window.showToast(data.message);
        if (data.type === 'alert' || data.type === 'danger') {
          soundManager.play('alert');
        } else {
          soundManager.play('success');
        }
      }
    });

    this.socket.on('emergency:dispatch-alert', (data) => {
      if (data && typeof window.showToast === "function") {
        window.showToast(`🚨 DISPATCH AUTOMATION: ${data.code} (${data.vehicle}) diberikan Hak Utama.`);
        soundManager.play('alert');
      }
    });
  }

  _flushPendingListeners() {
    if (!this.socket) return;
    this._listeners.forEach((callbacks, event) => {
      callbacks.forEach(cb => {
        this.socket.on(event, cb);
      });
    });
  }

  /**
   * Mendaftarkan listener event socket
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  /**
   * Menghapus listener event socket
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(callback);
    }
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  /**
   * Mengirim event ke socket server
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    const sock = this.getSocket();
    if (sock && sock.connected) {
      sock.emit(event, data);
      return true;
    }
    return false;
  }

  isConnected() {
    return !!(this.socket && this.socket.connected);
  }
}

export const socketClient = new SocketClient();
