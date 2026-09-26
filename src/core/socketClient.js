/**
 * OmniTRAF Surabaya - Unified Socket.io Network Gateway Client (Phase 2 Master Architecture)
 * 
 * Prinsip Utama:
 * Backend State → Socket.io → StateStore → Modules/Controllers → UI
 * 
 * Fitur:
 * - Connection Lifecycle: 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'resyncing' | 'fallback'
 * - Monotonic Sequence & Gap Detection with Idempotent Full-State Resynchronization
 * - Exponential Bounded Backoff Reconnection (1s - 10s)
 * - Telemetry Health Watchdog & Heartbeat Monitor
 * - Stale-Data Detection & UI Indicators
 * - Request Acknowledgements with Timeouts (emitWithAck)
 * - Anti-Duplicate Listener & Memory Leak Protection
 */

import {
  stateStore,
  createEventEnvelope,
  setConnectionLifecycle,
  markStaleData,
  applyServerSnapshot,
  updateTrafficState,
  updateCctvVisionState,
  updateIncidentState,
  updateEmergencyState,
  updateSignalState,
  updateDeviceState
} from './stateStore.js';
import { soundManager } from './soundManager.js';
import { diagnostics } from './diagnostics.js';
import { authManager } from './authManager.js';

/**
 * Fetch with Deduplication, Timeout & Caching Helper (Phase 8)
 * Deduplicates in-flight GET requests, adds bounded timeouts, and caches read-only endpoints.
 */
const pendingRequests = new Map();
const apiCache = new Map();

export async function fetchWithCacheAndDedupe(url, options = {}) {
  const {
    ttlMs = 0,
    timeoutMs = 5000,
    signal: userSignal,
    method = 'GET',
    body,
    headers = {},
    forceRefresh = false
  } = options;

  const isReadOnly = method.toUpperCase() === 'GET';

  // Inject Authorization Bearer token jika ada
  const authToken = authManager.getToken();
  const mergedHeaders = {
    ...headers,
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
  };

  if (isReadOnly && ttlMs > 0 && !forceRefresh) {
    const cached = apiCache.get(url);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }
  }

  if (isReadOnly && pendingRequests.has(url)) {
    return pendingRequests.get(url);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (userSignal) {
    userSignal.addEventListener('abort', () => controller.abort());
  }

  const fetchPromise = (async () => {
    try {
      diagnostics.recordApiRequest();
      const res = await fetch(url, {
        method,
        headers: mergedHeaders,
        body,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        diagnostics.recordApiError();
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      if (isReadOnly && ttlMs > 0) {
        apiCache.set(url, {
          data,
          expiresAt: Date.now() + ttlMs
        });
      }

      return data;
    } catch (err) {
      clearTimeout(timer);
      diagnostics.recordApiError();
      throw err;
    } finally {
      if (isReadOnly) {
        pendingRequests.delete(url);
      }
    }
  })();

  if (isReadOnly) {
    pendingRequests.set(url, fetchPromise);
  }

  return fetchPromise;
}

class SocketClient {
  constructor() {
    this.socket = null;
    this.hasRegisteredListeners = false;
    this._listeners = new Map();
    this._isInitialized = false;

    // Resilience & Health Metadata
    this.connectionAttemptCount = 0;
    this.lastLatencyMs = 12;
    this.watchdogInterval = null;
    this.heartbeatInterval = null;
    this.isResyncing = false;

    this._setupInternalListeners();
  }

  _setupInternalListeners() {
    // Gap Detection Auto-Resync
    stateStore.subscribe("socket:gap-detected", (gapInfo) => {
      console.warn(`⚠️ [SocketClient] Sequence gap detected (expected ${gapInfo?.expected}, got ${gapInfo?.received}). Triggering atomic resync...`);
      this.requestResync();
    });

    // UI Status Synchronizer
    stateStore.subscribe("socket:status", () => {
      this._updateDomStatusCapsule();
    });

    stateStore.subscribe("state:stale-changed", () => {
      this._updateDomStatusCapsule();
    });

    // Dynamic Auth Token Synchronizer
    authManager.onAuthChange((user, token) => {
      if (this.socket) {
        this.socket.auth = { token: token || null };
        if (this.socket.connected) {
          console.info('🔄 [SocketClient] Memperbarui autentikasi socket session...');
          this.socket.disconnect().connect();
        }
      }
    });
  }

  /**
   * Mengambil atau menginisialisasi instance tunggal socket (Idempotent)
   */
  getSocket() {
    if (this.socket) return this.socket;

    const token = authManager.getToken();
    const socketOptions = {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.3,
      timeout: 5000,
      transports: ['websocket', 'polling'],
      auth: { token: token || null }
    };

    try {
      if (typeof window.io !== "undefined") {
        this.socket = window.io(socketOptions);
        this._bindStandardEvents();
        this._startHealthWatchdog();
      } else {
        // Dynamic load fallback
        const script = document.createElement("script");
        script.src = "/socket.io/socket.io.js";
        script.onload = () => {
          if (typeof window.io !== "undefined" && !this.socket) {
            const currentToken = authManager.getToken();
            this.socket = window.io({
              ...socketOptions,
              auth: { token: currentToken || null }
            });
            this._bindStandardEvents();
            this._flushPendingListeners();
            this._startHealthWatchdog();
          }
        };
        script.onerror = () => {
          console.warn("[SocketClient] Socket.io script unreachable. Entering Standalone Offline Mode.");
          setConnectionLifecycle('fallback', { isStaleData: true });
        };
        document.head.appendChild(script);
      }
    } catch (err) {
      console.warn("[SocketClient] Connection deferred:", err);
      setConnectionLifecycle('fallback', { isStaleData: true });
    }

    return this.socket;
  }

  _bindStandardEvents() {
    if (!this.socket || this.hasRegisteredListeners) return;
    this.hasRegisteredListeners = true;

    // 1. Connection Established
    this.socket.on('connect', () => {
      console.info(`⚡ [SocketClient] Socket terhubung (${this.socket.id}). Memulai fase Resyncing Server State...`);
      this.connectionAttemptCount = 0;
      
      // Masuk fase resyncing: minta canonical snapshot dari server
      setConnectionLifecycle('resyncing', {
        lastConnectedAt: Date.now(),
        connectionAttemptCount: 0,
        isStaleData: false
      });

      this.requestResync();
    });

    // 2. Reconnecting / Reconnect Attempts
    this.socket.on('reconnect_attempt', (attempt) => {
      this.connectionAttemptCount = attempt || this.connectionAttemptCount + 1;
      setConnectionLifecycle('reconnecting', {
        connectionAttemptCount: this.connectionAttemptCount,
        isStaleData: true
      });
    });

    this.socket.on('reconnecting', (attempt) => {
      this.connectionAttemptCount = attempt || this.connectionAttemptCount + 1;
      setConnectionLifecycle('reconnecting', {
        connectionAttemptCount: this.connectionAttemptCount,
        isStaleData: true
      });
    });

    // 3. Connection Error
    this.socket.on('connect_error', (err) => {
      this.connectionAttemptCount++;
      setConnectionLifecycle('reconnecting', {
        connectionAttemptCount: this.connectionAttemptCount,
        isStaleData: true
      });
    });

    // 4. Disconnection
    this.socket.on('disconnect', (reason) => {
      console.warn(`⚠️ [SocketClient] Terputus dari server (Alasan: ${reason}). Mempertahankan Last Known Good State.`);
      setConnectionLifecycle('offline', {
        lastDisconnectedAt: Date.now(),
        isStaleData: true
      });
    });

    // 5. Canonical State Inflow Pipeline ke StateStore
    this.socket.on('traffic:init', (data) => {
      if (data) {
        applyServerSnapshot(data, 'server');
        setConnectionLifecycle('connected', {
          isStaleData: false,
          lastTelemetryAt: Date.now()
        });
      }
    });

    this.socket.on('traffic:update', (data) => {
      updateTrafficState(data, 'server');
    });

    this.socket.on('cctv:vision-update', (data) => {
      updateCctvVisionState(data, 'server');
    });

    this.socket.on('incident:update', (data) => {
      if (data && data.id) {
        const payload = data.payload || data;
        payload.seq = data.seq || payload.seq;
        payload.timestamp = data.timestamp || payload.timestamp || Date.now();
        payload.source = data.source || payload.source || 'server';
        updateIncidentState(data.id, payload, 'server');
      }
    });

    this.socket.on('emergency:update', (data) => {
      if (data) {
        const payload = data.payload || data;
        payload.seq = data.seq || payload.seq;
        payload.timestamp = data.timestamp || payload.timestamp || Date.now();
        payload.source = data.source || payload.source || 'server';
        updateEmergencyState(payload, 'server');
      }
    });

    this.socket.on('signal:update', (data) => {
      if (data && data.nodeId) {
        const payload = data.payload || data.signalData || data;
        payload.seq = data.seq || payload.seq;
        payload.timestamp = data.timestamp || payload.timestamp || Date.now();
        payload.source = data.source || payload.source || 'server';
        updateSignalState(data.nodeId, payload, 'server');
      }
    });

    this.socket.on('device:update', (data) => {
      if (data && data.deviceId) {
        const payload = data.payload || data.deviceData || data;
        payload.seq = data.seq || payload.seq;
        payload.timestamp = data.timestamp || payload.timestamp || Date.now();
        payload.source = data.source || payload.source || 'server';
        updateDeviceState(data.deviceId, payload, 'server');
      }
    });

    this.socket.on('incident:resolved', (data) => {
      if (data && data.id) {
        updateIncidentState(data.id, {
          status: 'RESOLVED',
          resolvedAt: data.timestamp,
          resolvedBy: data.resolvedBy || 'SITS Command Center'
        }, 'server');
      }
    });

    // 6. Heartbeat Pong Listener
    this.socket.on('heartbeat:pong', (data) => {
      if (data && data.clientTimestamp) {
        this.lastLatencyMs = Math.max(1, Date.now() - data.clientTimestamp);
      }
      this._updatePerformanceChip();
    });

    // 7. Global Toast & Alert Bridge
    this.socket.on('system:toast', (data) => {
      if (data && data.message && typeof window.showToast === "function") {
        window.showToast(data.message, data.type || 'normal');
        if (data.type === 'alert' || data.type === 'danger') {
          soundManager.play('alert');
        } else {
          soundManager.play('success');
        }
      }
    });

    this.socket.on('emergency:dispatch-alert', (data) => {
      if (data && typeof window.showToast === "function") {
        window.showToast(`🚨 DISPATCH AUTOMATION: ${data.code} (${data.vehicle}) diberikan Hak Utama.`, 'warning');
        soundManager.play('alert');
      }
    });
  }

  /**
   * Memulai Heartbeat & Telemetry Stale Data Watchdog
   */
  _startHealthWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Watchdog cek kesegaran data setiap 1000ms
    this.watchdogInterval = setInterval(() => {
      const state = stateStore.getState();
      const lastTelemetry = state.lastTelemetryAt || 0;
      const now = Date.now();

      if (state.connectionStatus === 'connected') {
        // Jika tidak ada data telemetri masuk > 3500ms padahal connected, tandai stale
        if (lastTelemetry > 0 && (now - lastTelemetry) > 3500) {
          markStaleData(true);
        }
      }
    }, 1000);

    // Heartbeat ping berkala setiap 5000ms saat terkoneksi
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.socket.emit('heartbeat:ping', { timestamp: Date.now() });
      }
    }, 5000);
  }

  /**
   * Meminta Sinkronisasi State Kanonikal Penuh dari Server (Idempotent)
   */
  async requestResync() {
    if (this.isResyncing) return;
    this.isResyncing = true;

    try {
      if (this.isConnected()) {
        this.socket.emit('state:resync', {}, (response) => {
          this.isResyncing = false;
          if (response && response.success && response.state) {
            applyServerSnapshot(response.state, 'server');
            setConnectionLifecycle('connected', {
              isStaleData: false,
              lastTelemetryAt: Date.now()
            });
          }
        });
      } else {
        // HTTP REST Snapshot Fallback
        const res = await fetch('/api/state/snapshot', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json && json.success && json.state) {
            applyServerSnapshot(json.state, 'server');
          }
        }
        this.isResyncing = false;
      }
    } catch (err) {
      console.warn("[SocketClient] Resync attempt notice:", err);
      this.isResyncing = false;
    }
  }

  /**
   * Mengirim event ke socket dengan Acknowledgement & Timeout
   * @param {string} event
   * @param {*} data
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<any>}
   */
  emitWithAck(event, data, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const sock = this.getSocket();
      if (!sock || !sock.connected) {
        return reject(new Error(`Koneksi server terputus. Tidak dapat mengirim event '${event}'.`));
      }

      let hasTimedOut = false;
      const timer = setTimeout(() => {
        hasTimedOut = true;
        reject(new Error(`Timeout menunggu konfirmasi server untuk '${event}' (${timeoutMs}ms)`));
      }, timeoutMs);

      try {
        sock.emit(event, data, (ackResponse) => {
          if (hasTimedOut) return;
          clearTimeout(timer);
          resolve(ackResponse);
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Mengirim event ke socket server (Fire & Forget)
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

  /**
   * Mendaftarkan listener event socket
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
   */
  on(event, callback) {
    if (typeof callback !== 'function') return () => {};

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    
    const set = this._listeners.get(event);
    if (set.has(callback)) {
      return () => this.off(event, callback);
    }
    set.add(callback);

    if (this.socket) {
      this.socket.off(event, callback); // Remove any existing on the socket to prevent duplicate trigger
      this.socket.on(event, callback);
    }

    return () => this.off(event, callback);
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

  _flushPendingListeners() {
    if (!this.socket) return;
    this._listeners.forEach((callbacks, event) => {
      callbacks.forEach(cb => {
        this.socket.on(event, cb);
      });
    });
  }

  isConnected() {
    return !!(this.socket && this.socket.connected);
  }

  /**
   * Memperbarui UI Topbar Status Capsule & Banner Offline sesuai Lifecycle Koneksi
   */
  _updateDomStatusCapsule() {
    const state = stateStore.getState();
    const status = state.connectionStatus;
    const isStale = !!state.isStaleData;

    const ssePill = document.getElementById("sseStatusPill");
    const sseDot = document.getElementById("sseStatusDot");
    const sseText = document.getElementById("sseStatusText");
    const sitsStatusText = document.getElementById("sitsStatusText");
    const offlineBanner = document.getElementById("offlineNotificationBanner");

    if (!sseText || !sseDot) return;

    if (status === 'connected') {
      if (isStale) {
        sseText.textContent = "SITS Data Stale (Tertahan)";
        sseDot.style.background = "var(--warning)";
        sseDot.style.boxShadow = "0 0 6px var(--warning)";
      } else {
        sseText.textContent = "SITS Live 60Hz";
        sseDot.style.background = "var(--success)";
        sseDot.style.boxShadow = "0 0 6px var(--success)";
      }
      if (offlineBanner) offlineBanner.classList.add("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "98%";

    } else if (status === 'resyncing') {
      sseText.textContent = "Sinkronisasi State...";
      sseDot.style.background = "var(--cyan)";
      sseDot.style.boxShadow = "0 0 6px var(--cyan)";
      if (offlineBanner) offlineBanner.classList.add("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "Sync";

    } else if (status === 'reconnecting') {
      const attempt = state.connectionAttemptCount || 1;
      sseText.textContent = `Menghubungkan (#${attempt})...`;
      sseDot.style.background = "var(--warning)";
      sseDot.style.boxShadow = "0 0 6px var(--warning)";
      if (offlineBanner) offlineBanner.classList.remove("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "42%";

    } else if (status === 'connecting') {
      sseText.textContent = "Menghubungkan SITS...";
      sseDot.style.background = "var(--warning)";
      sseDot.style.boxShadow = "0 0 6px var(--warning)";
      if (sitsStatusText) sitsStatusText.textContent = "Init";

    } else { // 'offline' | 'fallback'
      sseText.textContent = "Offline (Data Tersimpan)";
      sseDot.style.background = "var(--danger)";
      sseDot.style.boxShadow = "0 0 6px var(--danger)";
      if (offlineBanner) offlineBanner.classList.remove("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "Simulasi";
    }

    this._updatePerformanceChip();
  }

  _updatePerformanceChip() {
    const perfChip = document.getElementById("perfChip");
    if (!perfChip) return;

    const perfText = perfChip.querySelector(".perf-text");
    const perfDot = perfChip.querySelector(".perf-dot");
    const state = stateStore.getState();

    const latency = this.isConnected() ? `${this.lastLatencyMs} ms` : "Offline";
    const status = state.connectionStatus;

    if (perfText) {
      perfText.textContent = `FPS: 60 | Ping: ${latency} | SITS: ${status.toUpperCase()}`;
    }

    if (perfDot) {
      if (status === 'connected') perfDot.style.background = "var(--success)";
      else if (status === 'reconnecting' || status === 'resyncing') perfDot.style.background = "var(--warning)";
      else perfDot.style.background = "var(--danger)";
    }
  }

  destroy() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this._listeners.clear();
  }
}

export const socketClient = new SocketClient();
