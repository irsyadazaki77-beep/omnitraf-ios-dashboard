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
import { realtimeMetrics } from './realtimeMetrics.js';
import { ResyncManager } from './resyncManager.js';
import { RealtimeRouter } from './realtimeRouter.js';

export { realtimeMetrics, ResyncManager, RealtimeRouter };

/**
 * Fetch with Deduplication, Timeout & Caching Helper (Phase 16 Hardened)
 * - Ensures mutations (POST/PUT/PATCH/DELETE) are never cached.
 * - Preserves Authorization headers from explicit options or authManager.
 * - Safely handles non-JSON (PDF, HTML, plaintext) responses without JSON parsing crashes.
 * - Extracts deterministic structured error messages and error codes on HTTP non-2xx responses.
 * - Fully cleans up timers and abort listeners.
 */
const pendingRequests = new Map();
const apiCache = new Map();

export async function fetchWithCacheAndDedupe(url, options = {}) {
  const {
    ttlMs = 0,
    timeoutMs = 6000,
    signal: userSignal,
    method = 'GET',
    body,
    headers = {},
    forceRefresh = false
  } = options;

  const upperMethod = method.toUpperCase();
  const isReadOnly = upperMethod === 'GET' || upperMethod === 'HEAD';

  // Ensure Authorization header is preserved or securely injected
  const authToken = authManager.getToken();
  const hasAuthHeader = Object.keys(headers).some(k => k.toLowerCase() === 'authorization');
  const mergedHeaders = {
    ...headers,
    ...(!hasAuthHeader && authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
  };

  // Add JSON Content-Type if sending stringified or object body
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    const hasContentType = Object.keys(mergedHeaders).some(k => k.toLowerCase() === 'content-type');
    if (!hasContentType) {
      mergedHeaders['Content-Type'] = 'application/json';
    }
  }

  // 1. Check read-only cache
  if (isReadOnly && ttlMs > 0 && !forceRefresh) {
    const cached = apiCache.get(url);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }
  }

  // 2. Check in-flight request deduplication for read-only calls
  if (isReadOnly && pendingRequests.has(url)) {
    return pendingRequests.get(url);
  }

  const controller = new AbortController();
  let timer = null;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Request timeout after ${timeoutMs}ms: ${upperMethod} ${url}`));
    }, timeoutMs);
  }

  const onUserAbort = () => {
    controller.abort(userSignal.reason || new Error(`Request aborted by caller`));
  };

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', onUserAbort, { once: true });
    }
  }

  const fetchPromise = (async () => {
    try {
      diagnostics.recordApiRequest();

      const finalBody = (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob))
        ? JSON.stringify(body)
        : body;

      const res = await fetch(url, {
        method: upperMethod,
        headers: mergedHeaders,
        body: finalBody,
        credentials: 'same-origin',
        signal: controller.signal
      });

      if (timer) clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort);

      const contentType = res.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        try {
          data = await res.json();
        } catch (jsonErr) {
          throw new Error(`Gagal mem-parsing JSON dari server (HTTP ${res.status}): ${jsonErr.message}`);
        }
      } else if (contentType.includes('application/pdf') || contentType.includes('application/octet-stream')) {
        data = await res.blob();
      } else {
        data = await res.text();
      }

      if (!res.ok) {
        diagnostics.recordApiError();
        const serverMsg = (data && typeof data === 'object')
          ? (data.error?.message || data.message || data.error || `HTTP ${res.status}`)
          : (typeof data === 'string' && data.length < 200 ? data : `HTTP ${res.status}: ${res.statusText}`);

        if (res.status === 401) {
          console.error('🔒 [API] Sesi tidak valid atau telah kedaluwarsa (401). Membersihkan sesi...');
          authManager.logout();
        }

        const err = new Error(serverMsg);
        err.status = res.status;
        err.statusCode = res.status;
        err.code = (data && typeof data === 'object' && (data.error?.code || data.code)) || `HTTP_${res.status}`;
        err.data = data;
        err.details = (data && typeof data === 'object' && (data.error?.details || data.details)) || null;
        throw err;
      }

      if (isReadOnly && ttlMs > 0) {
        apiCache.set(url, {
          data,
          expiresAt: Date.now() + Math.max(500, ttlMs)
        });
      }

      return data;
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
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

export class SocketClient {
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
    this._pendingPingTimestamp = null;
    this._missedHeartbeats = 0;

    // Phase 3 Subsystem Decomposition: ResyncManager, RealtimeRouter, RealtimeMetrics
    this.resyncManager = new ResyncManager(this);
    this.router = new RealtimeRouter(this.resyncManager);
    this.subscribedChannels = new Set(['global', 'room:dashboard', 'room:traffic']);

    this._setupInternalListeners();
  }

  get isResyncing() {
    return this.resyncManager.isResyncing;
  }

  set isResyncing(val) {
    this.resyncManager.isResyncing = !!val;
  }

  get _resyncBuffer() {
    return this.resyncManager._resyncBuffer;
  }

  set _resyncBuffer(val) {
    this.resyncManager._resyncBuffer = val;
  }

  get _resyncPromise() {
    return this.resyncManager._resyncPromise;
  }

  set _resyncPromise(val) {
    this.resyncManager._resyncPromise = val;
  }

  _setupInternalListeners() {
    // Gap Detection Auto-Resync
    stateStore.subscribe("socket:gap-detected", (gapInfo) => {
      console.warn(`⚠️ [SocketClient] Sequence gap detected (expected ${gapInfo?.expected}, got ${gapInfo?.received}). Triggering atomic resync...`);
      realtimeMetrics.recordSequenceGap(gapInfo);
      this.requestResync();
    });

    // UI Status Synchronizer
    stateStore.subscribe("socket:status", () => {
      this._updateDomStatusCapsule();
    });

    stateStore.subscribe("state:stale-changed", ({ isStale }) => {
      if (isStale) {
        realtimeMetrics.recordStaleDuration(1000);
      }
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
   * Subscribe to specific room/channel (Langkah 4 & 13)
   * @param {string|string[]} channels
   */
  subscribeChannels(channels) {
    const list = Array.isArray(channels) ? channels : [channels];
    list.forEach(ch => this.subscribedChannels.add(ch));

    if (this.socket && this.socket.connected) {
      this.socket.emit('channel:subscribe', { channels: list });
    }
  }

  /**
   * Unsubscribe from specific room/channel (Langkah 4 & 13)
   * @param {string|string[]} channels
   */
  unsubscribeChannels(channels) {
    const list = Array.isArray(channels) ? channels : [channels];
    list.forEach(ch => this.subscribedChannels.delete(ch));

    if (this.socket && this.socket.connected) {
      this.socket.emit('channel:unsubscribe', { channels: list });
    }
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
      if (typeof window !== "undefined" && typeof window.io !== "undefined") {
        this.socket = window.io(socketOptions);
        this.resyncManager.setSocketClient(this);
        this._bindStandardEvents();
        this._flushPendingListeners();
        this._startHealthWatchdog();
      } else if (typeof document !== "undefined") {
        // Dynamic load fallback
        const script = document.createElement("script");
        script.src = "/socket.io/socket.io.js";
        script.onload = () => {
          if (typeof window !== "undefined" && typeof window.io !== "undefined" && !this.socket) {
            const currentToken = authManager.getToken();
            this.socket = window.io({
              ...socketOptions,
              auth: { token: currentToken || null }
            });
            this.resyncManager.setSocketClient(this);
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
      } else {
        setConnectionLifecycle('fallback', { isStaleData: true });
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
      realtimeMetrics.recordConnect();
      realtimeMetrics.recordReconnectSuccess();

      // Sinkronisasi room subscription yang sudah didaftarkan
      if (this.subscribedChannels.size > 0) {
        this.socket.emit('channel:subscribe', { channels: Array.from(this.subscribedChannels) });
      }

      // Masuk fase resyncing: minta canonical snapshot dari server
      setConnectionLifecycle('resyncing', {
        lastConnectedAt: Date.now(),
        connectionAttemptCount: 0,
        isStaleData: false
      });

      this.requestResync();

      // Trigger command reconciliation if available
      if (typeof window !== 'undefined' && window.commandLayer && typeof window.commandLayer.reconcilePendingCommands === 'function') {
        window.commandLayer.reconcilePendingCommands();
      }
    });

    // 2. Reconnecting / Reconnect Attempts
    this.socket.on('reconnect_attempt', (attempt) => {
      this.connectionAttemptCount = attempt || this.connectionAttemptCount + 1;
      realtimeMetrics.recordReconnectAttempt();
      setConnectionLifecycle('reconnecting', {
        connectionAttemptCount: this.connectionAttemptCount,
        isStaleData: true
      });
    });

    this.socket.on('reconnecting', (attempt) => {
      this.connectionAttemptCount = attempt || this.connectionAttemptCount + 1;
      realtimeMetrics.recordReconnectAttempt();
      setConnectionLifecycle('reconnecting', {
        connectionAttemptCount: this.connectionAttemptCount,
        isStaleData: true
      });
    });

    // 3. Connection Error
    this.socket.on('connect_error', (err) => {
      this.connectionAttemptCount++;
      if (err && err.message && err.message.includes('AUTHENTICATION_FAILED')) {
        console.error('🔒 [SocketClient] Autentikasi ditolak server:', err.message);
        setConnectionLifecycle('auth_failed', {
          connectionAttemptCount: this.connectionAttemptCount,
          isStaleData: true,
          authError: err.message
        });

        // Hapus token kedaluwarsa/tidak valid dari client, lalu coba dapatkan sesi baru
        console.warn('🔑 [SocketClient] Mencoba memulihkan sesi dengan melakukan re-login otomatis...');
        authManager.logout();
        
        setTimeout(() => {
          authManager.ensureActiveSession()
        .then((sessionRestored) => {
              if (sessionRestored && this.socket) {
                console.info('🔑 [SocketClient] Sesi baru berhasil didapatkan. Menghubungkan kembali socket...');
                this.socket.auth = { token: null };
                this.socket.connect();
              }
            })
            .catch((e) => {
              console.error('❌ [SocketClient] Gagal memulihkan sesi otomatis setelah ditolak:', e.message);
            });
        }, 1000);
        return;
      }
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
      if (typeof window !== 'undefined' && window.commandLayer && typeof window.commandLayer.handleDisconnect === 'function') {
        window.commandLayer.handleDisconnect();
      }
    });

    // 5. Canonical State Inflow Pipeline ke Router
    const standardEvents = [
      'traffic:init',
      'traffic:update',
      'cctv:vision-update',
      'incident:update',
      'incident:resolved',
      'emergency:update',
      'emergency:dispatch-alert',
      'signal:update',
      'device:update',
      'device:config-transition',
      'system:toast'
    ];

    standardEvents.forEach(evt => {
      this.socket.on(evt, (data) => {
        this.router.route(evt, data);
      });
    });

    // 6. Heartbeat Pong Listener
    this.socket.on('heartbeat:pong', (data) => {
      this._pendingPingTimestamp = null;
      this._missedHeartbeats = 0;
      if (data && data.clientTimestamp) {
        const rtt = Math.max(1, Date.now() - data.clientTimestamp);
        realtimeMetrics.recordRtt(rtt);
        this.lastLatencyMs = Math.round(this.lastLatencyMs * 0.7 + rtt * 0.3);
        if (this.lastLatencyMs > 200) {
          setConnectionLifecycle('degraded', { latencyMs: this.lastLatencyMs });
        } else if (stateStore.getState().connectionStatus === 'degraded') {
          setConnectionLifecycle('connected', { latencyMs: this.lastLatencyMs });
        }
      }
      this._updatePerformanceChip();
    });
  }

  /**
   * Memulai Heartbeat & Telemetry Stale Data Watchdog
   */
  _startHealthWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this._pendingPingTimestamp = null;
    this._missedHeartbeats = 0;

    // Watchdog cek kesegaran data setiap 1000ms
    this.watchdogInterval = setInterval(() => {
      const state = stateStore.getState();
      const lastTelemetry = state.lastTelemetryAt || 0;
      const now = Date.now();

      if (state.connectionStatus === 'connected' || state.connectionStatus === 'degraded') {
        // Jika tidak ada data telemetri masuk > 3500ms padahal connected, tandai stale
        if (lastTelemetry > 0 && (now - lastTelemetry) > 3500) {
          markStaleData(true);
        }
      }
    }, 1000);

    // Heartbeat ping berkala setiap 5000ms saat terkoneksi
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        if (this._pendingPingTimestamp && (Date.now() - this._pendingPingTimestamp) > 4000) {
          this._missedHeartbeats++;
          console.warn(`⚠️ [SocketClient] Missed heartbeat pong (#${this._missedHeartbeats})`);
          if (this._missedHeartbeats >= 2) {
            console.warn(`⚠️ [SocketClient] Half-open connection detected (2 missed pings). Marking degraded/reconnecting.`);
            setConnectionLifecycle('degraded', { isStaleData: true });
            markStaleData(true);
          }
        }

        const now = Date.now();
        this._pendingPingTimestamp = now;
        this.socket.emit('heartbeat:ping', { timestamp: now });
      }
    }, 5000);
  }

  /**
   * Meminta Sinkronisasi State Kanonikal Penuh dari Server (Delegated to ResyncManager)
   */
  requestResync() {
    return this.resyncManager.requestResync();
  }

  _flushResyncBuffer() {
    this.resyncManager._flushResyncBuffer();
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
      const set = this._listeners.get(event);
      set.delete(callback);
      if (set.size === 0) {
        this._listeners.delete(event);
      }
    }
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  _flushPendingListeners() {
    if (!this.socket) return;
    this._listeners.forEach((callbacks, event) => {
      callbacks.forEach(cb => {
        this.socket.off(event, cb);
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
    if (typeof document === 'undefined') return;
    const state = stateStore.getState();
    const status = state.connectionStatus;
    const isStale = !!state.isStaleData;

    const sseDot = document.getElementById("sseStatusDot");
    const sseText = document.getElementById("sseStatusText");
    const sitsStatusText = document.getElementById("sitsStatusText");
    const offlineBanner = document.getElementById("offlineNotificationBanner");

    if (!sseText || !sseDot) return;

    if (status === 'connected') {
      if (isStale) {
        sseText.textContent = "Data Simulasi Tertahan";
        sseDot.style.background = "var(--warning)";
        sseDot.style.boxShadow = "0 0 6px var(--warning)";
      } else {
        sseText.textContent = "Server Simulasi Tersambung";
        sseDot.style.background = "var(--success)";
        sseDot.style.boxShadow = "0 0 6px var(--success)";
      }
      if (offlineBanner) offlineBanner.classList.add("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";

    } else if (status === 'resyncing') {
      sseText.textContent = "Sinkronisasi State...";
      sseDot.style.background = "var(--cyan)";
      sseDot.style.boxShadow = "0 0 6px var(--cyan)";
      if (offlineBanner) offlineBanner.classList.add("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";

    } else if (status === 'reconnecting') {
      const attempt = state.connectionAttemptCount || 1;
      sseText.textContent = `Menghubungkan (#${attempt})...`;
      sseDot.style.background = "var(--warning)";
      sseDot.style.boxShadow = "0 0 6px var(--warning)";
      if (offlineBanner) offlineBanner.classList.remove("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";

    } else if (status === 'connecting') {
      sseText.textContent = "Menghubungkan ke server demo...";
      sseDot.style.background = "var(--warning)";
      sseDot.style.boxShadow = "0 0 6px var(--warning)";
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";

    } else if (status === 'degraded') {
      sseText.textContent = "Server simulasi lambat";
      sseDot.style.background = "var(--warning)";
      sseDot.style.boxShadow = "0 0 6px var(--warning)";
      if (offlineBanner) offlineBanner.classList.add("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";

    } else if (status === 'auth_failed') {
      sseText.textContent = "Sesi Berakhir (Auth Failed)";
      sseDot.style.background = "var(--danger)";
      sseDot.style.boxShadow = "0 0 6px var(--danger)";
      if (offlineBanner) offlineBanner.classList.remove("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";

    } else { // 'offline' | 'fallback'
      sseText.textContent = "Offline • simulator lokal";
      sseDot.style.background = "var(--danger)";
      sseDot.style.boxShadow = "0 0 6px var(--danger)";
      if (offlineBanner) offlineBanner.classList.remove("is-hidden");
      if (sitsStatusText) sitsStatusText.textContent = "DEMO";
    }

    this._updatePerformanceChip();
  }

  _updatePerformanceChip() {
    if (typeof document === 'undefined') return;
    const perfChip = document.getElementById("perfChip");
    if (!perfChip) return;

    const perfText = perfChip.querySelector(".perf-text");
    const perfDot = perfChip.querySelector(".perf-dot");
    const state = stateStore.getState();

    const latency = this.isConnected() ? `${this.lastLatencyMs} ms` : "Offline";
    const status = state.connectionStatus;

    if (perfText) {
      perfText.textContent = `Ping: ${latency} | Server demo: ${status.toUpperCase()}`;
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
    this.watchdogInterval = null;
    this.heartbeatInterval = null;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.hasRegisteredListeners = false;
    this.isResyncing = false;
    this.resyncManager._resyncPromise = null;
    this._listeners.clear();
  }
}

export const socketClient = new SocketClient();
