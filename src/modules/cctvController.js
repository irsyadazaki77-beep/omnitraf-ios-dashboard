/**
 * OmniTRAF Surabaya - CCTV Controller & AI Vision Canvas Renderer (Phase 4)
 * Menangani ingest data sensor kamera CCTV edge, estimasi kecerdasan lalu lintas (intelligence metrics),
 * tracking objek YOLOv8 dengan filter smoothing, instrumentasi performa,
 * deteksi anomali real-time, dan status kesehatan kamera (telemetry).
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';
import { socketClient } from '../core/socketClient.js';
import { commandLayer } from '../core/commandLayer.js';
import { Disposer } from '../core/disposer.js';

// Color map for YOLOv8 object classes
const CLASS_COLORS = {
  car: '#00e5ff',        // Mobil (Biru Cyan)
  motorcycle: '#ffbf00', // Motor (Kuning Amber)
  bus: '#8b5cf6',        // Bus/Truk (Ungu)
  truck: '#8b5cf6',      // Bus/Truk (Ungu)
  ambulance: '#ff3b30',  // Armada Darurat 112 (Merah Terang dengan Pulsasi)
  person: '#ff007c'      // Magenta
};

export class CctvCanvasRenderer {
  constructor(canvasId, cameraName = 'SITS CCTV') {
    this.canvasId = canvasId;
    this.cameraName = cameraName;
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.trackedBoxes = new Map();
    this.boxPool = []; // Reusable object pool to prevent garbage collection spikes
    this.lanesNorm = [0.12, 0.36, 0.64, 0.88];
    this.isVisible = true;

    // Smoothing & validation history
    this.lastFrameSeq = 0;
    this.lastFrameTime = 0;
    this.renderFps = 60;
    this.fpsTimer = Date.now();
    this.fpsCounter = 0;
  }

  /**
   * Mengambil Snapshot Frame Canvas dengan Bounding Box YOLOv8 & Stempel Bukti ETLE
   * @returns {string} Data URL gambar PNG
   */
  captureSnapshot() {
    if (!this.canvas) return null;
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Menerima target bounding box baru dari pipeline data terstruktur
   * dan mencatat target koordinat untuk diinterpolasi secara mulus di loop render 60 FPS.
   * Menggunakan object pooling agar tidak ada alokasi memori baru berulang saat 60 FPS.
   * @param {Array} boxes Bounding boxes YOLOv8
   */
  updateBoxes(boxes) {
    const incomingList = Array.isArray(boxes) ? boxes : [];
    const activeIds = new Set();
    const alpha = 0.35; // Smoothing factor untuk tracking & confidence

    for (let i = 0; i < incomingList.length; i++) {
      const box = incomingList[i];
      const boxId = box.trackId || box.id || `box-${i}`;
      activeIds.add(boxId);

      const existing = this.trackedBoxes.get(boxId);
      if (existing) {
        // Smoothing bounding box target (Lerp smoothing)
        existing.targetX = box.x;
        existing.targetY = box.y;
        existing.targetW = box.w;
        existing.targetH = box.h;
        
        // Rolling average smoothing untuk confidence
        existing.confidence = Math.round(existing.confidence * (1 - alpha) + box.confidence * alpha);
        existing.class = box.class;
        existing.speedKmh = box.speedKmh;

        // Snap instan jika terjadi perpindahan sangat drastis (reset lintasan)
        if (Math.abs(existing.targetX - existing.x) > 0.4 || Math.abs(existing.targetY - existing.y) > 0.4) {
          existing.x = existing.targetX;
          existing.y = existing.targetY;
          existing.w = existing.targetW;
          existing.h = existing.targetH;
          if (existing.trail) existing.trail = []; // Reset trail on snap
        }
      } else {
        // Recycle existing object from pool or create once
        let newBox = this.boxPool.pop();
        if (!newBox) {
          newBox = {
            id: boxId,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            targetX: box.x,
            targetY: box.y,
            targetW: box.w,
            targetH: box.h,
            class: box.class,
            confidence: box.confidence,
            speedKmh: box.speedKmh,
            trail: [],
            localSpeedKmh: box.speedKmh || 40
          };
        } else {
          newBox.id = boxId;
          newBox.x = box.x;
          newBox.y = box.y;
          newBox.w = box.w;
          newBox.h = box.h;
          newBox.targetX = box.x;
          newBox.targetY = box.y;
          newBox.targetW = box.w;
          newBox.targetH = box.h;
          newBox.class = box.class;
          newBox.confidence = box.confidence;
          newBox.speedKmh = box.speedKmh;
          newBox.trail = [];
          newBox.localSpeedKmh = box.speedKmh || 40;
        }
        this.trackedBoxes.set(boxId, newBox);
      }
    }

    // Kembalikan bounding box kadaluarsa ke object pool
    for (const [id, box] of this.trackedBoxes.entries()) {
      if (!activeIds.has(id)) {
        this.trackedBoxes.delete(id);
        if (this.boxPool.length < 60) {
          this.boxPool.push(box);
        }
      }
    }
  }

  /**
   * Render frame kanvas 60 FPS dengan Lerp Tweening & Overlay Intelijen AI
   * @param {boolean} isChaosMode
   * @param {boolean} isPaused
   * @param {boolean} showBoxes
   * @param {number} dt - Waktu delta antar frame dalam detik
   * @param {Object} metrics - Derived intelligence metrics
   * @param {Object} diagnostics - Performance diagnostics
   * @param {string} status - Health Status (ONLINE, STALE, OFFLINE, DEGRADED)
   */
  render(isChaosMode, isPaused, showBoxes, dt = 0.016, metrics = {}, diagnostics = {}, status = 'ONLINE') {
    if (!this.canvas || !this.ctx) {
      this.canvas = document.getElementById(this.canvasId);
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return;
    }

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Hitung Render FPS Aktual
    const now = Date.now();
    this.fpsCounter++;
    if (now - this.fpsTimer >= 1000) {
      this.renderFps = Math.min(60, this.fpsCounter);
      this.fpsCounter = 0;
      this.fpsTimer = now;
    }

    // 2. Clear & Background Perspective Road Canvas
    ctx.fillStyle = '#070f1b';
    ctx.fillRect(0, 0, w, h);

    // Sky / Horizon fill
    const vy = h * 0.28;
    const vx = w * 0.5;
    ctx.fillStyle = '#02060d';
    ctx.fillRect(0, 0, w, vy);

    // Horizon line
    ctx.strokeStyle = isChaosMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, vy);
    ctx.lineTo(w, vy);
    ctx.stroke();

    // Perspective Lane Guidelines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.setLineDash([4, 4]);
    for (let i = 0; i < this.lanesNorm.length; i++) {
      const lx = w * this.lanesNorm[i];
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(lx, h);
      ctx.stroke();
    }
    ctx.setLineDash([]); // Reset dash

    // 3. Render Real-Time Bounding Boxes dengan Lerp Interpolation & Signal Sync
    if (showBoxes && !isPaused && this.trackedBoxes.size > 0) {
      // Stable dt-damping factor to eliminate jitter completely
      const lerpFactor = 1 - Math.exp(-12 * dt);

      // Determine intersection signalState for speed and movement sync
      const CAMERA_TO_NODE_MAP = {
        'dashCameraCanvas': 'node-wonokromo',
        'cctvCanvas1': 'node-wonokromo',
        'cctvCanvas2': 'node-darmo',
        'cctvCanvas3': 'node-wonokromo', // fallback
        'cctvCanvas4': 'node-margorejo',
        'cctvZoomCanvas': 'node-wonokromo'
      };

      const targetCamId = this.canvasId;
      const nodeId = CAMERA_TO_NODE_MAP[targetCamId] || 'node-wonokromo';
      const state = stateStore.getState();
      const node = state.intersections?.find(n => n.id === nodeId);
      const signalState = node ? node.state : 'green'; // 'red', 'yellow', 'green'

      this.trackedBoxes.forEach(box => {
        const targetSpeed = box.speedKmh || 45;
        if (typeof box.localSpeedKmh === 'undefined') {
          box.localSpeedKmh = targetSpeed;
        }

        // Adjust speed based on APILL signalState (slow down on RED, speed up on GREEN/YELLOW)
        if (signalState === 'red') {
          box.localSpeedKmh = Math.max(0, box.localSpeedKmh - dt * 25); // stopped gradually
        } else {
          box.localSpeedKmh = Math.min(targetSpeed, box.localSpeedKmh + dt * 35); // speed up dynamically
        }

        // Speed ratio affects the motion speed on the canvas
        const speedRatio = targetSpeed > 0 ? (box.localSpeedKmh / targetSpeed) : 1;
        const clampedRatio = Math.max(0, Math.min(1, speedRatio));

        // Update positions using stable LERP factor scaled by speedRatio to come to a perfect stop
        box.x += (box.targetX - box.x) * lerpFactor * clampedRatio;
        box.y += (box.targetY - box.y) * lerpFactor * clampedRatio;
        box.w += (box.targetW - box.w) * lerpFactor * clampedRatio;
        box.h += (box.targetH - box.h) * lerpFactor * clampedRatio;

        // Map normalized coordinates (0..1) to actual canvas dimensions
        const px = box.x * w;
        const py = box.y * h;
        const pw = box.w * w;
        const ph = box.h * h;

        const classKey = (box.class || 'car').toLowerCase();
        const color = CLASS_COLORS[classKey] || '#00e5ff';

        // Update and Render motion trail
        if (!box.trail) {
          box.trail = [];
        }

        const cx = px + pw / 2;
        const cy = py + ph; // Ground/bottom center

        if (box.localSpeedKmh > 1) {
          box.trail.push({ x: cx, y: cy });
          if (box.trail.length > 12) {
            box.trail.shift();
          }
        } else if (box.trail.length > 0) {
          // Slow decay when stopped
          if (Math.random() < 0.15) {
            box.trail.shift();
          }
        }

        // Draw motion trail with beautiful color gradient segment by segment
        if (box.trail.length > 1) {
          ctx.save();
          for (let j = 0; j < box.trail.length - 1; j++) {
            const pt1 = box.trail[j];
            const pt2 = box.trail[j + 1];
            const alpha = (j / box.trail.length) * 0.45; // max 45% opacity
            ctx.beginPath();
            ctx.moveTo(pt1.x, pt1.y);
            ctx.lineTo(pt2.x, pt2.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 + (j / box.trail.length) * 2;
            ctx.globalAlpha = alpha;
            ctx.stroke();
          }
          ctx.restore();
        }

        // Bounding Box Fill Overlay & Pulsing for Emergency Vehicles (Armada Darurat 112)
        const isEmergency = classKey === 'ambulance' || classKey === 'emergency';
        let fillOpacity = '12'; // default ~7% opacity
        let strokeWidth = 2;
        let finalColor = color;

        if (isEmergency) {
          const pulse = Math.sin(Date.now() / 120); // Fast pulse
          strokeWidth = 2.5 + pulse * 1.0; // dynamic thickness
          const fillVal = Math.round(18 + pulse * 10);
          fillOpacity = Math.max(8, Math.min(40, fillVal)).toString(16).padStart(2, '0');
        }

        ctx.fillStyle = `${finalColor}${fillOpacity}`;
        ctx.fillRect(px, py, pw, ph);

        // Main Bounding Box Stroke
        ctx.strokeStyle = finalColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(px, py, pw, ph);

        // YOLOv8 Corner Accent HUD Bracket Style
        const bracketLen = Math.min(8, Math.min(pw, ph) * 0.3);
        ctx.lineWidth = strokeWidth + 1;
        ctx.beginPath();
        // Top-Left corner bracket
        ctx.moveTo(px, py + bracketLen);
        ctx.lineTo(px, py);
        ctx.lineTo(px + bracketLen, py);
        // Bottom-Right corner bracket
        ctx.moveTo(px + pw - bracketLen, py + ph);
        ctx.lineTo(px + pw, py + ph);
        ctx.lineTo(px + pw, py + ph - bracketLen);
        ctx.stroke();

        // Label Tag Fill (Class Name + Confidence Score + Speed)
        const labelText = `${classKey === 'ambulance' ? 'DARURAT 112' : classKey.toUpperCase()} ${box.confidence || 95}% (${Math.round(box.localSpeedKmh)}km/h)`;
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        const tagW = ctx.measureText(labelText).width + 8;
        const tagH = 15;

        const tagY = py - tagH >= 0 ? py - tagH : py;
        ctx.fillStyle = finalColor;
        ctx.fillRect(px, tagY, tagW, tagH);

        // Label Text
        ctx.fillStyle = '#000000';
        ctx.fillText(labelText, px + 4, tagY + 11);
      });
    }

    // 4. Chaos Mode Distortions / Glitch Static Overlay
    if (isChaosMode) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(0, 0, w, h);

      if (Math.random() < 0.6) {
        const scanY = Math.random() * h;
        const scanH = Math.random() * 8 + 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(0, scanY, w, scanH);
      }
    }

    // 5. Camera HUD Overlay (Watermark timestamp & SITS Edge AI Tag Standardized OSD)
    const CAM_CODES = {
      'dashCameraCanvas': 'CAM-01',
      'cctvCanvas1': 'CAM-01',
      'cctvCanvas2': 'CAM-02',
      'cctvCanvas3': 'CAM-03',
      'cctvCanvas4': 'CAM-04',
      'cctvZoomCanvas': 'CAM-ZOOM'
    };

    const CAM_NAMES_OSD = {
      'dashCameraCanvas': 'SIMPANG WONOKROMO UTARA',
      'cctvCanvas1': 'SIMPANG WONOKROMO UTARA',
      'cctvCanvas2': 'KORIDOR RAYA DARMO',
      'cctvCanvas3': 'BUNDARAN WARU',
      'cctvCanvas4': 'SIMPANG MARGOREJO JEMURSARI',
      'cctvZoomCanvas': 'ZOOM FEED VIEW'
    };

    const camCode = CAM_CODES[this.canvasId] || 'CAM-01';
    const camName = CAM_NAMES_OSD[this.canvasId] || this.cameraName.toUpperCase();
    const inferenceMs = (diagnostics.averageLatencyMs || 14.2).toFixed(1);
    
    // Construct Standardized OSD string
    const osdText = `[${camCode}] ${camName} | LIVE 1080p | ${this.renderFps.toFixed(1)} FPS | INFERENCE: ${inferenceMs}ms`;

    ctx.font = 'bold 9.5px "Share Tech Mono", monospace';
    const textWidth = ctx.measureText(osdText).width;
    const bannerW = textWidth + 16;

    ctx.fillStyle = 'rgba(5, 11, 20, 0.85)';
    ctx.fillRect(8, 8, bannerW, 22);
    ctx.strokeStyle = isChaosMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, bannerW, 22);

    ctx.fillStyle = isChaosMode ? '#ef4444' : '#00e5ff';
    ctx.fillText(osdText, 16, 23);

    // Live REC dot & AI Inference indicator
    ctx.fillStyle = isChaosMode ? '#ef4444' : '#10b981';
    ctx.beginPath();
    ctx.arc(w - 20, 18, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px "Share Tech Mono", monospace';
    ctx.fillText(isChaosMode ? 'ALERT' : 'AI 60Hz', w - 68, 21);

    // 6. Futuristic HUD Sidebar: Derived AI Intelligence Metrics Overlay
    if (metrics && typeof metrics.vehicleCount !== 'undefined') {
      const metricsPanelX = 8;
      const metricsPanelY = 38;
      const metricsPanelW = 145;
      const metricsPanelH = 110;

      ctx.fillStyle = 'rgba(5, 11, 20, 0.85)';
      ctx.fillRect(metricsPanelX, metricsPanelY, metricsPanelW, metricsPanelH);
      ctx.strokeStyle = isChaosMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 229, 255, 0.3)';
      ctx.strokeRect(metricsPanelX, metricsPanelY, metricsPanelW, metricsPanelH);

      ctx.fillStyle = '#00e5ff';
      ctx.font = 'bold 9px "Share Tech Mono", monospace';
      ctx.fillText('EDGE AI INTELLIGENCE', metricsPanelX + 8, metricsPanelY + 14);
      
      // Divider
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(metricsPanelX + 6, metricsPanelY + 18);
      ctx.lineTo(metricsPanelX + metricsPanelW - 6, metricsPanelY + 18);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '8px "Share Tech Mono", monospace';
      ctx.fillText(`VOLUME  : ${metrics.vehicleCount} Unit (Car:${metrics.carCount} Motor:${metrics.motorcycleCount})`, metricsPanelX + 8, metricsPanelY + 30);
      ctx.fillText(`OCCUPY  : ${metrics.laneOccupancy}%`, metricsPanelX + 8, metricsPanelY + 42);
      ctx.fillText(`QUEUE   : ${metrics.queueLengthMeters} Meter`, metricsPanelX + 8, metricsPanelY + 54);
      ctx.fillText(`AVG SPD : ${metrics.estimatedAverageSpeed} Km/jam`, metricsPanelX + 8, metricsPanelY + 66);
      
      // Color-coded density
      let densityColor = '#10b981'; // Green
      if (metrics.trafficDensity > 75) densityColor = '#ef4444'; // Red
      else if (metrics.trafficDensity > 45) densityColor = '#f59e0b'; // Yellow
      
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('DENSITY :', metricsPanelX + 8, metricsPanelY + 78);
      ctx.fillStyle = densityColor;
      ctx.fillText(`${metrics.trafficDensity}% (${metrics.estimatedAverageSpeed < 20 ? 'MACET' : metrics.trafficDensity > 70 ? 'PADAT' : 'LANCAR'})`, metricsPanelX + 54, metricsPanelY + 78);

      // Risk index
      let riskColor = '#10b981';
      if (metrics.incidentRisk > 70) riskColor = '#ef4444';
      else if (metrics.incidentRisk > 40) riskColor = '#f59e0b';

      ctx.fillStyle = '#94a3b8';
      ctx.fillText('RISK    :', metricsPanelX + 8, metricsPanelY + 90);
      ctx.fillStyle = riskColor;
      ctx.fillText(`${metrics.incidentRisk}% (${metrics.incidentRisk > 70 ? 'CRITICAL' : metrics.incidentRisk > 40 ? 'MED' : 'LOW'})`, metricsPanelX + 54, metricsPanelY + 90);

      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`AI CONF : ${metrics.aiConfidence}%`, metricsPanelX + 8, metricsPanelY + 102);
    }

    // 7. Performance & Health Telemetry Diagnostic Footer Bar
    if (diagnostics) {
      const footerH = 14;
      const footerY = h - footerH;

      ctx.fillStyle = 'rgba(5, 11, 20, 0.9)';
      ctx.fillRect(0, footerY, w, footerH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(0, footerY);
      ctx.lineTo(w, footerY);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 8px "Share Tech Mono", monospace';
      
      // Health state dot
      let hColor = '#10b981'; // ONLINE
      if (status === 'DEGRADED') hColor = '#f59e0b';
      else if (status === 'STALE') hColor = '#ef4444';
      else if (status === 'OFFLINE') hColor = '#64748b';

      ctx.fillStyle = hColor;
      ctx.beginPath();
      ctx.arc(8, footerY + 7, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(`HEALTH: ${status}`, 15, footerY + 10);

      ctx.fillStyle = '#64748b';
      ctx.fillText(`RFPS: ${this.renderFps}Hz | LAT: ${diagnostics.averageLatencyMs || 8}ms | DROP: ${diagnostics.droppedFrameCount || 0} | AGE: ${diagnostics.lastPacketAge || 0}ms`, w - 215, footerY + 10);
    }
  }
}

export class CctvController {
  constructor() {
    this.renderers = new Map();
    this.socket = null;
    this.animFrameId = null;
    this.observer = null;
    this.lastFrameTime = 0;
    this.activeCamId = 'cctvCanvas1';
    this.isActive = false;
    this.disposer = new Disposer('CctvController');

    // Advanced Pipeline properties
    this.camerasRegistry = new Map([
      ['dashCameraCanvas', { name: "Simpang Wonokromo (Frontage A. Yani)" }],
      ['cctvCanvas1', { name: "Simpang Wonokromo (Frontage A. Yani)" }],
      ['cctvCanvas2', { name: "Koridor Raya Darmo" }],
      ['cctvCanvas3', { name: "Bundaran Waru (Gerbang Kota)" }],
      ['cctvCanvas4', { name: "Simpang Margorejo - Jemursari" }],
      ['cctvZoomCanvas', { name: "Zoom Feed View" }]
    ]);

    // Track active cameras metrics state
    this.camerasState = new Map();
    this.camerasRegistry.forEach((val, id) => {
      this.camerasState.set(id, {
        id,
        name: val.name,
        status: 'ONLINE',
        lastFrameAt: Date.now(),
        consecutiveFailures: 0,
        metrics: {
          vehicleCount: 0,
          carCount: 0,
          motorcycleCount: 0,
          busCount: 0,
          truckCount: 0,
          ambulanceCount: 0,
          personCount: 0,
          laneOccupancy: 0,
          queueLengthMeters: 0,
          estimatedAverageSpeed: 0,
          trafficDensity: 0,
          incidentRisk: 0,
          aiConfidence: 96
        },
        shortWindowHistory: [],
        diagnostics: {
          droppedFrameCount: 0,
          averageLatencyMs: 8,
          lastPacketAge: 0,
          activeTracks: 0
        }
      });
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

    this._setupStoreListeners();
    this._setupVisibilityListener();
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
  }

  /**
   * Inisialisasi seluruh renderer CCTV dan koneksi WebSocket
   */
  init() {
    console.info("🚀 [CctvController] Menginisialisasi High-Fidelity Edge AI Pipeline & Renderer...");
    this.isActive = true;

    this.camerasRegistry.forEach((val, id) => {
      const el = document.getElementById(id);
      if (el) {
        // Prevent duplicate rendering attachments
        if (!this.renderers.has(id)) {
          const renderer = new CctvCanvasRenderer(id, val.name);
          this.renderers.set(id, renderer);
        }
      }
    });

    // Remove legacy DOM bounding boxes if present (fully standardizing on Canvas pipeline)
    document.querySelectorAll(".cv-rect").forEach(el => el.remove());

    this._connectSocketStream();
    this._bindControls();
    this._bindMultiCameraSwitcher();
    this._startAnimationLoop();
    this._startWatermarkClock();
    this._startHealthTelemetryWatchdog();
  }

  activate() {
    this.isActive = true;
    this.camerasRegistry.forEach((val, id) => {
      const el = document.getElementById(id);
      if (el && !this.renderers.has(id)) {
        const renderer = new CctvCanvasRenderer(id, val.name);
        this.renderers.set(id, renderer);
      }
    });
    this._bindControls();
    this._bindMultiCameraSwitcher();

    if (!document.hidden && !this.animFrameId) {
      this._startAnimationLoop();
    }
  }

  deactivate() {
    this.isActive = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Menghubungkan ke Socket.io stream server untuk event `cctv:vision-update`
   * Memproses frame melalui pipeline terstruktur: ingestion → validation → tracking → metrics → stateStore → UI
   */
  _connectSocketStream() {
    this.latestFramePayload = null;
    this.lastProcessedSeq = 0;
    this.lastReceivedTime = Date.now();

    this.disposer.addSocketListener(socketClient, 'cctv:vision-update', (framePayload) => {
      this._ingestFramePipeline(framePayload, 'server');
    });

    // Local fallback generator for offline / standalone demonstration
    // Runs when socket is disconnected or fails to send updates
    const localVehicles = new Map();
    this.camerasRegistry.forEach((val, id) => {
      localVehicles.set(id, [
        { id: `${id}-v0`, lane: 0, progress: 0.15, class: 'ambulance', speed: 0.012, conf: 98 },
        { id: `${id}-v1`, lane: 1, progress: 0.45, class: 'car', speed: 0.009, conf: 95 },
        { id: `${id}-v2`, lane: 2, progress: 0.70, class: 'bus', speed: 0.007, conf: 94 },
        { id: `${id}-v3`, lane: 3, progress: 0.85, class: 'motorcycle', speed: 0.011, conf: 92 }
      ]);
    });

    this.disposer.setInterval(() => {
      if (!this.isActive || document.hidden) return;

      const connStatus = stateStore.getState().connectionStatus;
      // Do not run local simulation if online and connected
      if (connStatus === 'connected' || connStatus === 'resyncing') {
        return;
      }

      // Standalone simulation mode
      const isChaos = stateStore.getState().isChaosMode;
      const timestamp = Date.now();
      this.lastProcessedSeq++;

      const camerasData = {};

      this.camerasRegistry.forEach((val, camId) => {
        const vehicles = localVehicles.get(camId) || [];
        const detections = [];

        vehicles.forEach(v => {
          v.progress += isChaos ? v.speed * 0.3 : v.speed;
          if (v.progress > 1.0) {
            v.progress = 0;
            v.lane = Math.floor(Math.random() * 4);
          }
          const t = v.progress;
          const vx = 0.5, vy = 0.28;
          const laneEnds = [0.12, 0.36, 0.64, 0.88];
          const bx = laneEnds[v.lane];
          const x = vx + (bx - vx) * t;
          const y = vy + (1.0 - vy) * t;
          const scale = 0.2 + t * 0.8;
          
          let baseW = 0.12, baseH = 0.09;
          if (v.class === 'bus') { baseW = 0.16; baseH = 0.12; }
          else if (v.class === 'ambulance') { baseW = 0.14; baseH = 0.10; }

          const w = baseW * scale;
          const h = baseH * scale;

          detections.push({
            id: v.id,
            trackId: v.id,
            class: v.class,
            confidence: v.conf,
            x: Math.max(0.01, Math.min(0.95, x - w / 2)),
            y: Math.max(0.01, Math.min(0.95, y - h / 2)),
            w,
            h,
            speedKmh: Math.round((isChaos ? 12 : 45) + Math.random() * 4)
          });
        });

        camerasData[camId] = {
          cameraId: camId,
          timestamp: timestamp,
          sequence: this.lastProcessedSeq,
          fps: isChaos ? 18 : 30,
          resolution: '1920x1080',
          source: 'Local Simulation Fallback',
          processingLatencyMs: isChaos ? 28 : 5,
          streamStatus: isChaos ? 'DEGRADED' : 'ONLINE',
          detections: detections
        };
      });

      const fallbackPayload = {
        seq: this.lastProcessedSeq,
        timestamp: timestamp,
        source: 'local',
        cameras: camerasData
      };

      this._ingestFramePipeline(fallbackPayload, 'local');
    }, 300);
  }

  /**
   * Pipeline Utama: ingestion → validation → tracking → metrics → stateStore → UI
   */
  _ingestFramePipeline(framePayload, source = 'server') {
    if (!framePayload) return;

    // 1. Ingestion
    const incomingSeq = framePayload.seq || 0;
    const timestamp = framePayload.timestamp || Date.now();

    // 2. Validation & Frame-Dropping Guard
    if (incomingSeq > 0 && incomingSeq < this.lastProcessedSeq) {
      // Out of order frame, drop it
      return;
    }

    const frameAge = Date.now() - timestamp;
    if (frameAge > 3000) {
      // Stale network frame backlog, drop it (backpressure)
      return;
    }

    this.lastProcessedSeq = incomingSeq;
    this.latestFramePayload = framePayload;
    this.lastReceivedTime = Date.now();

    // 3. Process each camera frame
    const dataMap = framePayload.cameras || framePayload;
    
    this.camerasState.forEach((cam, camId) => {
      const camFrame = dataMap[camId] || dataMap['dashCameraCanvas'] || null;
      if (!camFrame) return;

      const detections = Array.isArray(camFrame) ? camFrame : (camFrame.detections || []);
      const sequence = camFrame.sequence || incomingSeq;
      const latency = camFrame.processingLatencyMs || 8;
      const status = camFrame.streamStatus || 'ONLINE';

      // Parse & Validate detection objects (Ignore malformed payloads)
      const validDetections = detections.filter(d => {
        return d && typeof d.x === 'number' && typeof d.y === 'number' && typeof d.w === 'number' && typeof d.h === 'number';
      });

      // Update renderer targeted positions
      const renderer = this.renderers.get(camId);
      if (renderer) {
        renderer.updateBoxes(validDetections);
      }

      // 4. Calculate Derived Intelligence Metrics
      const metrics = this._calculateDerivedIntelligence(validDetections, isChaosMode => stateStore.getState().isChaosMode);

      // 5. Update Health Telemetry & Performance Diagnostic State
      cam.status = status;
      cam.lastFrameAt = Date.now();
      cam.consecutiveFailures = 0;
      cam.metrics = metrics;
      cam.diagnostics = {
        droppedFrameCount: cam.diagnostics.droppedFrameCount,
        averageLatencyMs: Math.round(cam.diagnostics.averageLatencyMs * 0.9 + latency * 0.1),
        lastPacketAge: frameAge,
        activeTracks: validDetections.length
      };

      // Store window aggregation history (rolling 10 items for graph trend lines)
      cam.shortWindowHistory.push(metrics.vehicleCount);
      if (cam.shortWindowHistory.length > 10) {
        cam.shortWindowHistory.shift();
      }

      // 6. Evaluate Anomaly Detection Rules
      this._evaluateAnomalyRules(camId, cam.name, metrics);

      // Sync specific camera state to UI components
      this._updateCameraDomHUD(camId, cam);
    });

    // Update global StateStore with full aggregated CCTV metrics
    stateStore.setState({
      cctvVisionData: framePayload,
      cctvCamerasMetrics: Object.fromEntries(this.camerasState.entries())
    }, { source, emitGeneric: false });
  }

  /**
   * Menghitung Metrik Kecerdasan Buatan Terderivasi (AI Derived Metrics)
   */
  _calculateDerivedIntelligence(detections, isChaosEvaluator) {
    const isChaos = isChaosEvaluator();
    const counts = { car: 0, bus: 0, truck: 0, motorcycle: 0, ambulance: 0, person: 0 };
    let speedSum = 0;
    let confidenceSum = 0;

    detections.forEach(d => {
      const cls = (d.class || 'car').toLowerCase();
      if (cls in counts) {
        counts[cls]++;
      }
      speedSum += d.speedKmh || 42;
      confidenceSum += d.confidence || 95;
    });

    const totalCount = counts.car + counts.bus + counts.truck + counts.motorcycle + counts.ambulance;
    const avgSpeed = totalCount > 0 ? Math.round(speedSum / totalCount) : (isChaos ? 8 : 45);
    const avgConfidence = detections.length > 0 ? Math.round(confidenceSum / detections.length) : 96;

    // Heuristics calculations
    // Occupancy based on bounding box areas
    let areaSum = 0;
    detections.forEach(d => {
      areaSum += d.w * d.h;
    });
    const occupancy = Math.min(100, Math.round(areaSum * 380));

    // Queue length calculation
    let queueLength = 0;
    if (totalCount > 0) {
      queueLength = Math.round(totalCount * 9 + (occupancy * 0.8));
      if (isChaos) queueLength += 65; // High artificial congestion in chaos mode
    }

    // Traffic density percentage
    const density = Math.min(100, Math.round((totalCount * 12) + (occupancy * 0.4)));

    // Incident Risk rating
    let risk = Math.min(100, Math.round((density * 0.7) + (queueLength * 0.2)));
    if (counts.ambulance > 0) risk = Math.min(100, risk + 15);

    return {
      vehicleCount: totalCount,
      carCount: counts.car,
      motorcycleCount: counts.motorcycle,
      busCount: counts.bus,
      truckCount: counts.truck,
      ambulanceCount: counts.ambulance,
      personCount: counts.person,
      laneOccupancy: occupancy,
      queueLengthMeters: queueLength,
      estimatedAverageSpeed: avgSpeed,
      trafficDensity: density,
      incidentRisk: risk,
      aiConfidence: avgConfidence
    };
  }

  /**
   * Mesin Evaluasi Anomaly Deteksi & Koordinasi Incident
   */
  _evaluateAnomalyRules(camId, camName, metrics) {
    const timestamp = Date.now();
    const anomaliesToCheck = [];

    // Rule 1: Antrean sangat panjang
    if (metrics.queueLengthMeters > 130) {
      anomaliesToCheck.push({
        type: 'CRITICAL_QUEUE_DETECTED',
        severity: 'danger',
        confidence: metrics.aiConfidence,
        message: `Peringatan: Antrean antrean kritis terdeteksi sepanjang ${metrics.queueLengthMeters}m di ${camName}.`
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

    // Process evaluated anomalies
    anomaliesToCheck.forEach(anomaly => {
      const key = `${camId}_${anomaly.type}`;
      const lastTriggered = this.anomalyCooldowns.get(key) || 0;

      // Cooldown 15 detik agar tidak membanjiri notifikasi/event log
      if (timestamp - lastTriggered > 15000) {
        this.anomalyCooldowns.set(key, timestamp);

        const anomalyEvent = {
          id: `ANM-${Date.now().toString().slice(-4)}`,
          cameraId: camId,
          sourceCamera: camName,
          type: anomaly.type,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
          firstSeenAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          message: anomaly.message,
          status: 'ACTIVE'
        };

        // Publish to global StateStore event system
        stateStore.publish('cctv:anomaly', anomalyEvent);

        // Explicit rule triggers incident creation automatically
        if (this.autoCreateConfig[anomaly.type]) {
          this._triggerAutomaticIncident(anomalyEvent);
        } else {
          // Log to system diagnostic terminal
          if (typeof window.showToast === 'function' && anomaly.type === 'EMERGENCY_VEHICLE_DETECTED') {
            window.showToast(`🚨 ${anomaly.message}`, 'warning');
            soundManager.play('alert');
          }
        }
      }
    });
  }

  /**
   * Membuat rekaman incident SITS secara otomatis berdasarkan konfigurasi aturan eksplisit
   */
  async _triggerAutomaticIncident(anomalyEvent) {
    try {
      // Create request payload matching stateful incident format
      const isAmbulance = anomalyEvent.type === 'EMERGENCY_VEHICLE_DETECTED';
      const incidentPayload = {
        title: isAmbulance ? `Kecerdasan AI: Prioritas Kendaraan Darurat (${anomalyEvent.id})` : `Kritis: Deteksi Hambatan Lajur AI (${anomalyEvent.id})`,
        category: isAmbulance ? 'congestion' : 'accident',
        severity: anomalyEvent.severity,
        location: anomalyEvent.sourceCamera,
        status: 'ACTIVE',
        priority: 'high',
        source: 'AI_VISION',
        assignedUnit: isAmbulance ? 'Operator ATCS Surabaya' : 'SITS Patroli Wilayah Selatan',
        notes: anomalyEvent.message
      };

      console.info(`⚡ [CctvController] Memicu pembuatan insiden otomatis untuk anomali: ${anomalyEvent.type}`);

      // We can append this directly to the incidents list or invoke REST API
      const response = await fetch('/api/incidents/create-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(incidentPayload)
      }).catch(() => null); // Graceful network failure

      if (response && response.ok) {
        console.log("✓ Insiden otomatis berhasil disimpan di server SITS.");
      } else {
        // Optimistic local create
        stateStore.setState(prev => {
          const currentList = [...(prev.incidents || [])];
          // Prevent duplicates
          if (currentList.some(i => i.id === anomalyEvent.id)) return {};
          
          currentList.unshift({
            id: anomalyEvent.id,
            ...incidentPayload,
            reportedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          return { incidents: currentList };
        });

        if (typeof window.showToast === 'function') {
          window.showToast(`📸 DETEKSI OTOMATIS: Insiden #${anomalyEvent.id} dibuat berdasarkan analisis kamera Edge AI!`, 'alert');
          soundManager.play('alert');
        }
      }
    } catch (err) {
      console.warn("Failed auto incident trigger:", err);
    }
  }

  /**
   * Watchdog Telemetri Kesehatan Kamera
   * Mendeteksi delay penerimaan data, latensi tinggi, dan memicu status OFFLINE/STALE secara deterministik
   * Terintegrasi secara penuh dengan status kesehatan hardware Edge Node di StateStore.
   */
  _startHealthTelemetryWatchdog() {
    this.disposer.setInterval(() => {
      if (!this.isActive || document.hidden) return;
      const now = Date.now();
      const state = stateStore.getState();
      const devices = state.devices || [];

      this.camerasState.forEach((cam, id) => {
        // Pemetaan kamera ke perangkat Edge Node fisik
        let device = null;
        if (id === 'cctvCanvas1' || id === 'dashCameraCanvas' || id === 'cctvZoomCanvas') {
          device = devices.find(d => d.deviceId === 'NODE-EDGE-01');
        } else if (id === 'cctvCanvas2') {
          device = devices.find(d => d.deviceId === 'NODE-EDGE-02');
        } else if (id === 'cctvCanvas3') {
          device = devices.find(d => d.deviceId === 'NODE-EDGE-03');
        } else if (id === 'cctvCanvas4') {
          device = devices.find(d => d.deviceId === 'NODE-CTRL-01');
        }

        if (device) {
          // Propagasikan status kesehatan device ke kamera
          const previousStatus = cam.status;
          cam.status = device.healthLevel === 'HEALTHY' ? 'ONLINE' : device.healthLevel;
          
          // Sinkronkan latensi & confidence rate
          cam.diagnostics.averageLatencyMs = device.latencyMs;
          if (device.fps > 0) {
            cam.metrics.aiConfidence = device.healthScore;
          }

          if (cam.status !== previousStatus) {
            this._updateCameraDomHUD(id, cam);
          }
        } else {
          // Fallback berbasis timeout waktu jika device tidak ditemukan
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

  /**
   * Sync camera telemetry and stats into DOM elements dynamically
   */
  _updateCameraDomHUD(camId, camState) {
    const card = document.querySelector(`[data-cam-id="${camId}"]`);
    if (!card) return;

    // Update active badges
    const livePill = card.querySelector('.pill-live');
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

    // Dynamic error/glitch panel rendering
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
    const btnToggleCV = document.getElementById("btnToggleCVBoxes");
    if (btnToggleCV) {
      btnToggleCV.addEventListener("click", () => {
        const current = stateStore.getState().cctvBoxesVisible;
        const next = !current;
        stateStore.setState({ cctvBoxesVisible: next });
        btnToggleCV.textContent = next ? "Sembunyikan Overlay AI" : "Tampilkan Overlay AI";
        if (typeof window.showToast === "function") {
          window.showToast(next ? "Visualisasi bounding box YOLOv8 AI diaktifkan." : "Visualisasi bounding box YOLOv8 AI dinonaktifkan.");
        }
      });
    }

    const btnPlayPause = document.getElementById("btnPlayPauseCctv");
    if (btnPlayPause) {
      btnPlayPause.addEventListener("click", () => {
        const current = stateStore.getState().cctvPaused;
        const next = !current;
        stateStore.setState({ cctvPaused: next });
        btnPlayPause.innerHTML = next ? '<span class="btn-icon">▶</span> Putar' : '<span class="btn-icon">⏸</span> Jeda';
        if (typeof window.showToast === "function") {
          window.showToast(next ? "Pemutaran simulasi CCTV dijeda." : "Simulasi CCTV dilanjutkan kembali.");
        }
      });
    }

    // Ambang batas slider
    const thresholdRange = document.getElementById("cctvThresholdRange");
    const thresholdVal = document.getElementById("thresholdVal");
    if (thresholdRange && thresholdVal) {
      thresholdRange.addEventListener("input", (e) => {
        const val = e.target.value;
        thresholdVal.textContent = `${val}%`;
        stateStore.setState({ cctvConfidenceThreshold: parseInt(val, 10) });
      });
    }

    // Tombol Ambil Snapshot / Bukti Pelanggaran ETLE
    document.querySelectorAll('#btnCaptureSnapshot, .btn-cam-snapshot').forEach(btn => {
      // Prevent attaching duplicate event listeners
      if (btn.dataset.hasListener) return;
      btn.dataset.hasListener = "true";

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const camId = btn.dataset.cam || this.activeCamId || 'cctvCanvas1';
        this.captureEvidence(camId);
      });
    });
  }

  /**
   * Switcher Kamera Tanpa Memory Leaks atau Listener Ganda
   */
  _bindMultiCameraSwitcher() {
    const tabs = document.querySelectorAll('.cctv-cam-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
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

        const camId = tab.dataset.cam;
        this.activeCamId = camId;
        stateStore.setState({ activeCamId: camId });

        const card = document.querySelector(`[data-cam-id="${camId}"]`);
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
   * Menangkap snapshot frame canvas + bounding box YOLOv8 sebagai bukti ETLE
   */
  async captureEvidence(camId = null) {
    const targetCamId = camId || this.activeCamId || 'cctvCanvas1';
    let renderer = this.renderers.get(targetCamId);
    if (!renderer) {
      renderer = this.renderers.get('cctvCanvas1');
    }

    if (!renderer || !renderer.canvas) {
      if (typeof window.showToast === 'function') {
        window.showToast("Feed CCTV belum aktif untuk menangkap snapshot.", "warning");
      }
      return null;
    }

    const pngDataUrl = renderer.captureSnapshot();
    if (!pngDataUrl) return null;

    const timestamp = new Date().toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
    const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const violationId = `ETLE-${Date.now().toString().slice(-4)}`;
    const camName = renderer.cameraName || "Simpang Wonokromo SITS";
    const plateLetters = ['AB', 'WZ', 'SB', 'KP', 'DX'];
    const plateNumber = `L ${Math.floor(1000 + Math.random() * 8999)} ${plateLetters[Math.floor(Math.random() * plateLetters.length)]}`;
    const speedEst = `${Math.floor(42 + Math.random() * 26)} km/jam`;

    const evidence = {
      id: violationId,
      time: `${dateStr} • ${timestamp}`,
      location: camName,
      plate: plateNumber,
      speed: speedEst,
      violationType: "Pelanggaran Garis Henti APILL (Marka Stopline)",
      category: "accident",
      status: "UNRESOLVED",
      imgDataUrl: pngDataUrl
    };

    try {
      // Dispatch centralized command to log this critical CCTV action on the server
      await commandLayer.dispatchCommand({
        action: 'cctv:snapshot',
        targetType: 'camera',
        targetId: targetCamId,
        payload: { violationId, location: camName }
      }, false); // low risk

      this._insertIncidentEvidenceToDom(evidence);
      soundManager.play('success');

      if (typeof window.showToast === 'function') {
        window.showToast(`📸 Bukti Pelanggaran ETLE #${violationId} (${plateNumber}) berhasil diamankan!`);
      }
    } catch (err) {
      console.warn("CCTV snapshot command rejected:", err);
      if (typeof window.showToast === 'function') {
        window.showToast(`❌ Gagal mengambil snapshot: ${err.message}`, "danger");
      }
    }

    return evidence;
  }

  _insertIncidentEvidenceToDom(evidence) {
    const list = document.querySelector('.incident-logs-list');
    if (!list) return;

    const item = document.createElement('div');
    item.className = 'incident-log-item unresolved etle-evidence-item';
    item.id = `incident-${evidence.id}`;
    item.innerHTML = `
      <div class="inc-meta">
        <span class="inc-type alert-red">📸 BUKTI TANGKAPAN AI: PELANGGARAN MARKA / ANTREAN KRITIS (${evidence.id})</span>
        <span class="inc-time">${evidence.time}</span>
      </div>
      <strong>${evidence.violationType} — ${evidence.location}</strong>
      <p>Terdeteksi oleh Computer Vision YOLOv8. Kendaraan <strong>${evidence.plate}</strong> melintasi batas marka stopline saat fase merah. Kecepatan estimasi: <strong>${evidence.speed}</strong>.</p>
      <div class="etle-snapshot-preview" style="margin: 10px 0; border-radius: 8px; overflow: hidden; border: 1.5px solid rgba(0, 229, 255, 0.35); max-width: 340px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);">
        <img src="${evidence.imgDataUrl}" alt="Bukti Tangkapan AI" width="340" height="226" decoding="async" style="width: 100%; height: auto; display: block;" />
      </div>
      <div class="inc-actions" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
        <a class="btn btn-primary compact" href="${evidence.imgDataUrl}" download="Bukti-AI-${evidence.id}-${evidence.plate.replace(/\\s+/g, '')}.png" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
          📥 Unduh Bukti (PNG)
        </a>
        <button class="btn btn-ghost compact resolve-btn" onclick="resolveDynamicIncident('${evidence.id}')">
          Tandai Selesai / Arsipkan
        </button>
      </div>
    `;

    list.insertBefore(item, list.firstChild);

    // Update unresolved pill count
    const pill = document.querySelector('.incidents-active .pill-danger');
    if (pill) {
      const match = pill.textContent.match(/(\d+)/);
      const count = match ? parseInt(match[1], 10) + 1 : 4;
      pill.textContent = `${count} Unresolved Alerts`;
    }

    // Update topbar notification badge count
    const notifBadge = document.getElementById('notifBadgeCount');
    if (notifBadge) {
      const c = parseInt(notifBadge.textContent, 10) || 3;
      notifBadge.textContent = c + 1;
    }
  }

  _startAnimationLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.lastFrameTime = performance.now();

    const render = (currentTime) => {
      if (!this.isActive || document.hidden) {
        this.animFrameId = null;
        return;
      }

      this.animFrameId = requestAnimationFrame(render);

      // Delta time calculation for smooth 60fps independent interpolation
      const dt = Math.min(0.1, Math.max(0.001, (currentTime - this.lastFrameTime) / 1000));
      this.lastFrameTime = currentTime;

      const state = stateStore.getState();
      const isChaos = state.isChaosMode;
      const isPaused = state.cctvPaused;
      const showBoxes = state.cctvBoxesVisible;

      this.renderers.forEach((renderer, id) => {
        if (renderer.canvas && renderer.canvas.offsetParent !== null) {
          const camState = this.camerasState.get(id);
          const metrics = camState ? camState.metrics : {};
          const diagnostics = camState ? camState.diagnostics : {};
          const status = camState ? camState.status : 'ONLINE';
          
          renderer.render(isChaos, isPaused, showBoxes, dt, metrics, diagnostics, status);
        }
      });
    };

    this.animFrameId = requestAnimationFrame(render);
  }

  updateGlitchOverlays(isChaos) {
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
      if (!this.isActive || document.hidden) return;

      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
      document.querySelectorAll(".cctv-time").forEach(el => {
        el.textContent = timeStr;
      });
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
