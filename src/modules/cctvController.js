/**
 * OmniTRAF Surabaya - CCTV Controller & Orchestrator (Phase 7 Master Refactor)
 * Bertindak sebagai orchestrator tipis yang mengkoordinasikan:
 * - Camera Registry (metadata vs runtime)
 * - Detection Engine & Confidence Filter
 * - Tracking Engine & Temporal Smoothing
 * - Telemetry Builder & Anomaly Rules
 * - Snapshot & Evidence Service
 * - Canvas Renderers
 * - Realtime Adapter & State Adapter
 *
 * 100% Backward Compatible dengan public interface, getter, dan metode sebelumnya.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';
import { authManager } from '../core/authManager.js';
import { diagnostics } from '../core/diagnostics.js';

// Modularized CCTV Architecture
import {
  cameraRegistry,
  detectionEngine,
  detectionFilter,
  TrackingEngine,
  SmoothingEngine,
  TelemetryBuilder,
  SnapshotService,
  CctvCanvasRenderer,
  CctvRealtimeAdapter,
  cctvStateAdapter,
  cctvTelemetry
} from './cctv/index.js';

export {
  TrackingEngine,
  cctvTelemetry,
  cameraRegistry,
  detectionEngine,
  detectionFilter,
  SmoothingEngine,
  TelemetryBuilder,
  SnapshotService,
  CctvCanvasRenderer,
  CctvRealtimeAdapter,
  cctvStateAdapter
};

export class CctvController {
  constructor() {
    this.renderers = new Map();
    this.animFrameId = null;
    this.observer = null;
    this.lastFrameTime = 0;
    this.activeCamId = 'cctvCanvas1';
    this.isActive = false;
    this.disposer = new Disposer('CctvController');
    this._isInitialized = false;

    // Realtime adapter
    this.realtimeAdapter = new CctvRealtimeAdapter({
      coalesceVisualUpdates: true,
      onFrame: (payload, source) => this._ingestFramePipeline(payload, source)
    });

    // Anomaly Engine tracking
    this.activeAnomalies = new Map(); // key -> anomalyEvent
    this.anomalyCooldowns = new Map(); // key -> lastTriggeredTime
    this.autoCreateConfig = {
      EMERGENCY_VEHICLE_DETECTED: true,
      CRITICAL_QUEUE_DETECTED: false,
      CONGESTION_SPIKE: false,
      STOPPED_VEHICLE_ON_LANE: true,
      CAMERA_STALE_ALERT: false
    };
  }

  // Backward compatibility getters
  get camerasRegistry() {
    return cctvTelemetry.camerasRegistry;
  }

  get camerasState() {
    return cameraRegistry.getAllRuntimes();
  }

  get latestFramePayload() {
    return this.realtimeAdapter.latestPayload;
  }

  get lastProcessedSeq() {
    return this.realtimeAdapter.lastProcessedSeq;
  }

  get lastReceivedTime() {
    return this.realtimeAdapter.lastReceivedTime;
  }

  _setupVisibilityListener() {
    this.disposer.addEventListener(document, 'visibilitychange', () => {
      if (document.hidden) {
        if (this.animFrameId) {
          cancelAnimationFrame(this.animFrameId);
          this.animFrameId = null;
        }
      } else {
        if (this.isActive && !this.animFrameId) {
          this._startAnimationLoop();
        }
      }
    });
  }

  _setupStoreListeners() {
    this.disposer.addStoreSubscription(stateStore, 'state:isChaosMode', ({ value }) => {
      this.updateGlitchOverlays(value);
    });

    this.disposer.addStoreSubscription(stateStore, 'state:cctvBoxesVisible', ({ value }) => {
      const btnToggleCV = document.getElementById("btnToggleCVBoxes");
      if (btnToggleCV) {
        btnToggleCV.textContent = value ? "Sembunyikan Overlay AI" : "Tampilkan Overlay AI";
      }
    });

    this.disposer.addStoreSubscription(stateStore, 'state:cctvPaused', ({ value }) => {
      const btnPlayPause = document.getElementById("btnPlayPauseCctv");
      if (btnPlayPause) {
        btnPlayPause.innerHTML = value ? '<span class="btn-icon">▶</span> Putar' : '<span class="btn-icon">⏸</span> Jeda';
      }
    });

    this.disposer.addStoreSubscription(stateStore, 'state:cctvConfidenceThreshold', ({ value }) => {
      detectionFilter.setThreshold(value);
    });
  }

  /**
   * Inisialisasi seluruh renderer CCTV dan koneksi
   */
  init() {
    if (this._isInitialized) return;
    this._isInitialized = true;
  }

  activate() {
    this.deactivate(); // Ensure deterministic cleanup first
    this.isActive = true;

    // Initialize or bind renderers for existing canvas elements
    cameraRegistry.getAllMetadata().forEach(meta => {
      const id = meta.id;
      if (typeof document !== 'undefined') {
        const el = document.getElementById(id);
        if (el) {
          if (!this.renderers.has(id)) {
            const renderer = new CctvCanvasRenderer(id, meta.name);
            this.renderers.set(id, renderer);
          }
        }
      }
    });

    // Remove legacy DOM bounding boxes if present
    if (typeof document !== 'undefined') {
      document.querySelectorAll(".cv-rect").forEach(el => el.remove());
    }

    this._setupStoreListeners();
    this._setupVisibilityListener();
    this._connectSocketStream();
    this._bindControls();
    this._bindMultiCameraSwitcher();
    this._startWatermarkClock();
    this._startHealthTelemetryWatchdog();

    if (typeof document !== 'undefined' && !document.hidden && !this.animFrameId) {
      this._startAnimationLoop();
    }
  }

  deactivate() {
    this.isActive = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.realtimeAdapter.disconnect();
    this.disposer.clear();
  }

  _connectSocketStream() {
    this.realtimeAdapter.connect(this.disposer, this.camerasRegistry);
  }

  /**
   * Pipeline Utama: Ingest -> Sanitize & Filter -> Tracking Update -> Telemetry Metrics -> Sync Store -> UI HUD
   * Multi-camera isolation: Jika pemrosesan kamera A error, kamera B/C/D tetap berjalan normal.
   */
  _ingestFramePipeline(framePayload, source = 'server') {
    if (!framePayload) return;

    const dataMap = framePayload.cameras || framePayload;
    const isChaos = stateStore.getState().isChaosMode;

    cameraRegistry.getAllMetadata().forEach(meta => {
      const camId = meta.id;
      try {
        const camRuntime = cameraRegistry.getRuntime(camId);
        if (!camRuntime) return;

        const camFrame = dataMap[camId] || dataMap['dashCameraCanvas'] || null;
        if (!camFrame) return;

        const rawDetections = Array.isArray(camFrame) ? camFrame : (camFrame.detections || []);
        const latency = Number(camFrame.processingLatencyMs) || 8;
        const status = camFrame.streamStatus || 'ONLINE';
        // Backend frames are generated by the prototype simulator too; socket
        // delivery alone does not make this a real CCTV source.
        const provenance = 'SIMULATED';

        // 1. Process & validate detection objects (DetectionEngine)
        const validatedDetections = detectionEngine.process(rawDetections, { provenance });

        // 2. Filter by active confidence threshold (DetectionFilter)
        const activeThreshold = stateStore.getState().cctvConfidenceThreshold || 85;
        const acceptedDetections = detectionFilter.filter(validatedDetections, activeThreshold);

        // 3. Update Tracking Engine & Renderer target coordinates
        const renderer = this.renderers.get(camId);
        if (renderer) {
          renderer.updateBoxes(acceptedDetections);
        }

        // 4. Calculate Derived Intelligence Telemetry (TelemetryBuilder)
        const metrics = TelemetryBuilder.calculate(acceptedDetections, isChaos);

        // 5. Update Camera Runtime State
        camRuntime.status = status;
        camRuntime.provenance = provenance;
        camRuntime.lastFrameAt = Date.now();
        camRuntime.consecutiveFailures = 0;
        camRuntime.metrics = metrics;
        camRuntime.diagnostics = {
          droppedFrameCount: camRuntime.diagnostics.droppedFrameCount,
          averageLatencyMs: Math.round(camRuntime.diagnostics.averageLatencyMs * 0.9 + latency * 0.1),
          lastPacketAge: Date.now() - (framePayload.timestamp || Date.now()),
          activeTracks: acceptedDetections.length,
          fps: Number(camFrame.fps) || 30
        };

        // Window history
        camRuntime.shortWindowHistory.push(metrics.vehicleCount);
        if (camRuntime.shortWindowHistory.length > 10) {
          camRuntime.shortWindowHistory.shift();
        }

        // 6. Evaluate Anomaly Detection Rules
        const frameSequence = Number(camFrame.sequence ?? framePayload.seq);
        const simulationTimestamp = Number(camFrame.timestamp ?? framePayload.timestamp);
        this._evaluateAnomalyRules(camId, meta.name, metrics, {
          simulated: provenance === 'SIMULATED',
          timestamp: Number.isFinite(simulationTimestamp) ? simulationTimestamp : (Number.isFinite(frameSequence) ? frameSequence * 300 : null),
          sequence: Number.isSafeInteger(frameSequence) ? frameSequence : null
        });

        // 7. Sync Camera HUD to DOM
        this._updateCameraDomHUD(camId, camRuntime);
      } catch (camErr) {
        console.warn(`⚠️ [CctvController] Isolasi error kamera ${camId}:`, camErr);
      }
    });

    // 8. Throttled StateStore update to prevent render backlog & CPU spikes
    cctvStateAdapter.syncToStore(framePayload, cameraRegistry.getAllRuntimes(), source);
  }

  /**
   * Mesin Evaluasi Anomaly Deteksi & Koordinasi Incident
   */
  _evaluateAnomalyRules(camId, camName, metrics, timing = {}) {
    const simulated = timing.simulated === true;
    const timestamp = simulated && Number.isFinite(timing.timestamp) ? timing.timestamp : Date.now();
    const anomaliesToCheck = [];

    // Rule 1: Antrean sangat panjang
    if (metrics.queueLengthMeters > 130) {
      anomaliesToCheck.push({
        type: 'CRITICAL_QUEUE_DETECTED',
        severity: 'danger',
        confidence: metrics.aiConfidence,
        message: `Peringatan: Antrean kritis terdeteksi sepanjang ${metrics.queueLengthMeters}m di ${camName}.`
      });
    }

    // Rule 2: Kepadatan kritis
    if (metrics.trafficDensity > 80) {
      anomaliesToCheck.push({
        type: 'CONGESTION_SPIKE',
        severity: 'warning',
        confidence: metrics.aiConfidence,
        message: `Kepadatan lalu lintas melonjak hingga ${metrics.trafficDensity}% di ${camName}.`
      });
    }

    // Rule 3: Ambulans / PMK terdeteksi
    if (metrics.ambulanceCount > 0) {
      anomaliesToCheck.push({
        type: 'EMERGENCY_VEHICLE_DETECTED',
        severity: 'danger',
        confidence: 99,
        message: `Prioritas ATCS: Ambulans tanggap darurat terdeteksi di area jangkauan ${camName}!`
      });
    }

    // Process evaluated anomalies with cooldown guard (15s)
    anomaliesToCheck.forEach(anomaly => {
      const key = `${camId}_${anomaly.type}`;
      const lastTriggered = this.anomalyCooldowns.get(key);

      if (lastTriggered === undefined || timestamp - lastTriggered > 15000) {
        this.anomalyCooldowns.set(key, timestamp);
        const eventTime = new Date(timestamp).toISOString();
        const stablePart = timing.sequence ?? timestamp;
        const stableId = `ANM-${String(camId).replace(/[^A-Z0-9_-]/gi, '-')}-${stablePart}-${anomaly.type}`;

        const anomalyEvent = {
          id: simulated ? stableId : `ANM-${Date.now().toString().slice(-4)}`,
          provenance: simulated ? 'SIMULATED' : 'LIVE',
          simulated,
          cameraId: camId,
          sourceCamera: camName,
          type: anomaly.type,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
          firstSeenAt: eventTime,
          lastSeenAt: eventTime,
          message: anomaly.message,
          status: 'ACTIVE'
        };

        stateStore.publish('cctv:anomaly', anomalyEvent);

        if (this.autoCreateConfig[anomaly.type]) {
          this._triggerAutomaticIncident(anomalyEvent);
        } else {
          if (typeof window !== 'undefined' && typeof window.showToast === 'function' && anomaly.type === 'EMERGENCY_VEHICLE_DETECTED') {
            window.showToast(`🚨 ${anomaly.message}`, 'warning');
            soundManager.play('alert');
          }
        }
      }
    });
  }

  async _triggerAutomaticIncident(anomalyEvent) {
    // Generated camera frames are a browser demo. Never persist them as incidents
    // or send them to the incidents API as if they came from a live camera.
    if (anomalyEvent?.provenance === 'SIMULATED' || anomalyEvent?.simulated === true) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(`Skenario deteksi simulasi: ${anomalyEvent.message}`, 'warning');
      }
      return;
    }

    try {
      const isAmbulance = anomalyEvent.type === 'EMERGENCY_VEHICLE_DETECTED';
      const incidentPayload = {
        title: isAmbulance ? `Kecerdasan AI: Prioritas Kendaraan Darurat (${anomalyEvent.id})` : `Kritis: Deteksi Hambatan Lajur AI (${anomalyEvent.id})`,
        category: isAmbulance ? 'congestion' : 'accident',
        severity: anomalyEvent.severity,
        location: anomalyEvent.sourceCamera,
        status: 'ACTIVE',
        priority: 'high',
        source: 'AI_VISION',
        assignedUnit: 'Unit Demo',
        notes: anomalyEvent.message
      };

      const authToken = authManager.getToken();
      const response = await fetch('/api/incidents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify(incidentPayload)
      }).catch(() => null);

      if (!response || !response.ok) {
        stateStore.setState(prev => {
          const currentList = [...(prev.incidents || [])];
          if (currentList.some(i => i.id === anomalyEvent.id)) return {};

          currentList.unshift({
            id: anomalyEvent.id,
            ...incidentPayload,
            reportedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          return { incidents: currentList };
        });

        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
          window.showToast(`📸 DETEKSI OTOMATIS: Insiden #${anomalyEvent.id} dibuat berdasarkan analisis kamera Edge AI!`, 'alert');
          soundManager.play('alert');
        }
      }
    } catch (err) {
      console.warn("Failed auto incident trigger:", err);
    }
  }

  _startHealthTelemetryWatchdog() {
    this.disposer.setInterval(() => {
      if (!this.isActive || (typeof document !== 'undefined' && document.hidden)) return;
      const now = Date.now();
      const state = stateStore.getState();
      const devices = state.devices || [];

      cameraRegistry.getAllMetadata().forEach(meta => {
        const id = meta.id;
        const cam = cameraRegistry.getRuntime(id);
        if (!cam) return;

        // Pemetaan kamera ke perangkat Edge Node fisik
        let device = null;
        if (meta.edgeDeviceId) {
          device = devices.find(d => d.deviceId === meta.edgeDeviceId);
        }

        if (device) {
          const previousStatus = cam.status;
          cam.status = device.healthLevel === 'HEALTHY' ? 'ONLINE' : device.healthLevel;
          cam.diagnostics.averageLatencyMs = device.latencyMs;
          if (device.fps > 0) {
            cam.metrics.aiConfidence = device.healthScore;
          }

          if (cam.status !== previousStatus) {
            this._updateCameraDomHUD(id, cam);
          }
        } else {
          const age = now - cam.lastFrameAt;
          if (age > 10000) {
            if (cam.status !== 'OFFLINE') {
              cam.status = 'OFFLINE';
              this._updateCameraDomHUD(id, cam);
            }
          } else if (age > 4000) {
            if (cam.status !== 'STALE') {
              cam.status = 'STALE';
              this._updateCameraDomHUD(id, cam);
            }
          }
        }
      });
    }, 2000);
  }

  _updateCameraDomHUD(camId, camState) {
    if (typeof document === 'undefined') return;
    const card = document.querySelector(`[data-cam-id="${camId}"]`);
    if (!card) return;

    // Update active badges
    const livePill = card.querySelector('.pill-live, .pill-danger, .pill-ai');
    if (livePill) {
      if (camState.status === 'OFFLINE') {
        livePill.className = 'pill pill-danger';
        livePill.innerHTML = '<span class="pulse-dot"></span>Offline';
      } else if (camState.status === 'STALE' || camState.status === 'DEGRADED') {
        livePill.className = 'pill pill-ai';
        livePill.innerHTML = '<span class="pulse-dot"></span>Stale';
      } else {
        livePill.className = 'pill pill-live';
        livePill.innerHTML = '<span class="pulse-dot"></span>Active';
      }
    }

    // Update bottom HUD stats text elements
    const hudValElements = card.querySelectorAll('.hud-metric-val');
    if (hudValElements.length >= 3) {
      hudValElements[0].textContent = camState.status === 'OFFLINE' ? '0.0' : camState.diagnostics.averageLatencyMs > 25 ? '15.0' : '30.0';
      hudValElements[1].textContent = `${camState.diagnostics.averageLatencyMs}ms`;
      hudValElements[2].textContent = camState.status === 'OFFLINE' ? '0MB' : camState.status === 'DEGRADED' ? '280MB' : '415MB';
    }

    // Dynamic glitch overlay panel
    const glitchOverlay = document.getElementById(`cctvGlitch${camId.replace('cctvCanvas', '')}`);
    if (glitchOverlay) {
      const textEl = glitchOverlay.querySelector('.glitch-text');
      if (camState.status === 'OFFLINE') {
        glitchOverlay.classList.add('show');
        if (textEl) textEl.textContent = 'HOST NOT REACHABLE (504)';
      } else if (camState.status === 'STALE') {
        glitchOverlay.classList.add('show');
        if (textEl) textEl.textContent = 'STREAM STALE / RETRYING';
      } else {
        glitchOverlay.classList.remove('show');
      }
    }
  }

  _bindControls() {
    if (typeof document === 'undefined') return;

    // Toggle AI Overlays
    const btnToggleCV = document.getElementById("btnToggleCVBoxes");
    if (btnToggleCV) {
      this.disposer.addEventListener(btnToggleCV, "click", () => {
        const current = stateStore.getState().cctvBoxesVisible;
        const next = !current;
        stateStore.setState({ cctvBoxesVisible: next });
        btnToggleCV.textContent = next ? "Sembunyikan Overlay AI" : "Tampilkan Overlay AI";
        if (typeof window.showToast === "function") {
          window.showToast(next ? "Visualisasi bounding box AI diaktifkan." : "Visualisasi bounding box AI dinonaktifkan.");
        }
      });
    }

    // Play / Pause Simulation
    const btnPlayPause = document.getElementById("btnPlayPauseCctv");
    if (btnPlayPause) {
      this.disposer.addEventListener(btnPlayPause, "click", () => {
        const current = stateStore.getState().cctvPaused;
        const next = !current;
        stateStore.setState({ cctvPaused: next });
        btnPlayPause.innerHTML = next ? '<span class="btn-icon">▶</span> Putar' : '<span class="btn-icon">⏸</span> Jeda';
        if (typeof window.showToast === "function") {
          window.showToast(next ? "Pemutaran simulasi CCTV dijeda." : "Simulasi CCTV dilanjutkan kembali.");
        }
      });
    }

    // Confidence Threshold slider
    const thresholdRange = document.getElementById("cctvThresholdRange");
    const thresholdVal = document.getElementById("thresholdVal");
    if (thresholdRange && thresholdVal) {
      this.disposer.addEventListener(thresholdRange, "input", (e) => {
        const rawVal = e.target.value;
        const sanitized = detectionFilter.sanitizeThreshold(rawVal);
        thresholdVal.textContent = `${sanitized}%`;
        stateStore.setState({ cctvConfidenceThreshold: sanitized });
      });
    }

    // Matrix Layout Switcher (Grid 2x2, Stack 1x3, Focus 1x1)
    const matrixBtns = document.querySelectorAll('.matrix-btn');
    const feedGrid = document.querySelector('.cctv-feed-grid');
    matrixBtns.forEach(btn => {
      this.disposer.addEventListener(btn, 'click', (e) => {
        e.preventDefault();
        matrixBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const gridType = btn.dataset.grid;
        if (feedGrid) {
          feedGrid.className = `cctv-feed-grid ${gridType}`;
        }
      });
    });

    // Color Filters (Default, Mono, Night, Thermal)
    const filterBtns = document.querySelectorAll('.filter-mode-btn');
    filterBtns.forEach(btn => {
      this.disposer.addEventListener(btn, 'click', (e) => {
        e.preventDefault();
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter || 'none';
        this.renderers.forEach(r => r.setFilter(filter));
        if (typeof window.showToast === 'function') {
          window.showToast(`Filter Kamera: ${btn.textContent.trim()}`);
        }
      });
    });

    // Save a screenshot of the simulated camera canvas.
    document.querySelectorAll('#btnCaptureSnapshot, .btn-cam-snapshot').forEach(btn => {
      this.disposer.addEventListener(btn, 'click', (e) => {
        e.preventDefault();
        const camId = btn.dataset.cam || this.activeCamId || 'cctvCanvas1';
        this.captureDemoSnapshot(camId);
      });
    });
  }

  _bindMultiCameraSwitcher() {
    if (typeof document === 'undefined') return;
    const tabs = document.querySelectorAll('.cctv-cam-tab');
    tabs.forEach(tab => {
      this.disposer.addEventListener(tab, 'click', (e) => {
        e.preventDefault();
        tabs.forEach(t => {
          t.classList.remove('active');
          t.style.background = 'rgba(15, 23, 42, 0.6)';
          t.style.borderColor = 'rgba(255,255,255,0.1)';
          t.style.color = '#94a3b8';
        });

        tab.classList.add('active');
        tab.style.background = 'rgba(56, 189, 248, 0.2)';
        tab.style.borderColor = '#38bdf8';
        tab.style.color = '#fff';

        const previousCamId = this.activeCamId;
        const newCamId = tab.dataset.cam;
        this.switchActiveCamera(newCamId, previousCamId);

        const card = document.querySelector(`[data-cam-id="${newCamId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          card.classList.add('camera-card-spotlight');
          setTimeout(() => card.classList.remove('camera-card-spotlight'), 1500);
        }

        soundManager.play('click');
        if (typeof window.showToast === 'function') {
          window.showToast(`Fokus Kamera: ${tab.textContent.trim().replace('📹 ', '')}`);
        }
      });
    });
  }

  /**
   * Mengganti active camera dengan unsubscribe channel lama dan subscribe channel baru
   */
  switchActiveCamera(newCamId, oldCamId = null) {
    if (!newCamId) return;

    if (oldCamId && oldCamId !== newCamId) {
      this.realtimeAdapter.unsubscribeCamera(oldCamId);
    }

    this.activeCamId = newCamId;
    this.realtimeAdapter.subscribeCamera(newCamId);
    stateStore.setState({ activeCamId: newCamId });
  }

  /**
   * Menyimpan frame canvas simulasi sebagai file demo.
   */
  captureDemoSnapshot(camId = null) {
    const targetCamId = camId || this.activeCamId || 'cctvCanvas1';
    let renderer = this.renderers.get(targetCamId) || this.renderers.get('cctvCanvas1');
    return SnapshotService.captureDemoSnapshot(renderer, targetCamId);
  }

  _startAnimationLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.lastFrameTime = performance.now();

    const render = (currentTime) => {
      if (!this.isActive || (typeof document !== 'undefined' && document.hidden)) {
        this.animFrameId = null;
        return;
      }

      this.animFrameId = requestAnimationFrame(render);

      const dt = Math.min(0.1, Math.max(0.001, (currentTime - this.lastFrameTime) / 1000));
      this.lastFrameTime = currentTime;

      const state = stateStore.getState();
      const isChaos = state.isChaosMode;
      const isPaused = state.cctvPaused;
      const showBoxes = state.cctvBoxesVisible;
      const intersections = state.intersections || [];
      const intersectionById = new Map(intersections.map((intersection) => [intersection.id, intersection]));

      const renderStart = performance.now();
      let totalTrackedCount = 0;

      this.renderers.forEach((renderer, id) => {
        if (renderer.canvas && renderer.canvas.offsetParent !== null) {
          const camMeta = cameraRegistry.getMetadata(id);
          const camRuntime = cameraRegistry.getRuntime(id);
          const metrics = camRuntime ? camRuntime.metrics : {};
          const diag = camRuntime ? camRuntime.diagnostics : {};
          const status = camRuntime ? camRuntime.status : 'ONLINE';
          const provenance = camRuntime ? camRuntime.provenance : 'SIMULATED';

          // Determine intersection signal state
          const nodeId = camMeta?.nodeId || 'node-wonokromo';
          const node = intersectionById.get(nodeId);
          const signalState = node ? node.state : 'green';

          renderer.render(isChaos, isPaused, showBoxes, dt, metrics, diag, status, signalState, provenance);
          totalTrackedCount += renderer.trackedBoxes ? renderer.trackedBoxes.size : 0;
        }
      });

      const renderDuration = performance.now() - renderStart;
      diagnostics.recordRenderDuration(renderDuration);
      diagnostics.recordTrackedObjectsCount(totalTrackedCount);
    };

    this.animFrameId = requestAnimationFrame(render);
  }

  updateGlitchOverlays(isChaos) {
    if (typeof document === 'undefined') return;
    const overlays = document.querySelectorAll(".cctv-glitch-overlay");
    overlays.forEach((overlay, idx) => {
      if (isChaos && (idx === 0 || idx === 1 || idx === 3 || idx === 4)) {
        overlay.classList.add("show");
      } else {
        overlay.classList.remove("show");
      }
    });
  }

  _startWatermarkClock() {
    this.disposer.setInterval(() => {
      if (!this.isActive || (typeof document !== 'undefined' && document.hidden)) return;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
      if (typeof document !== 'undefined') {
        document.querySelectorAll(".cctv-time").forEach(el => {
          el.textContent = timeStr;
        });
      }
    }, 1000);
  }

  destroy() {
    this.deactivate();
    this.disposer.clear();
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

export const cctvController = new CctvController();
