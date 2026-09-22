/**
 * OmniTRAF Surabaya - CCTV Controller & AI Vision Canvas Renderer
 * Mendengarkan stream real-time WebSockets berisi data bounding box [{x, y, w, h, class, confidence}]
 * dari server backend, dan menggambar visualisasi deteksi objek YOLOv8 secara langsung pada Canvas API.
 * Menggunakan sistem Interpolasi (Tweening / Lerp) 60 FPS dan estimasi lebar label matematis tanpa GPU bottleneck.
 */

import { stateStore } from '../core/stateStore.js';
import { soundManager } from '../core/soundManager.js';

// Color map for YOLOv8 object classes
const CLASS_COLORS = {
  car: '#00e5ff',        // Cyan
  bus: '#eab308',        // Yellow
  truck: '#10b981',      // Emerald Green
  motorcycle: '#8b5cf6', // Purple
  ambulance: '#ef4444',  // Bright Red
  person: '#ff007c'      // Magenta
};

export class CctvCanvasRenderer {
  constructor(canvasId, cameraName = 'SITS CCTV') {
    this.canvasId = canvasId;
    this.cameraName = cameraName;
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.trackedBoxes = new Map();
    this.isVisible = true;
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
   * Menerima target bounding box baru dari server WebSocket (dikirim per 300ms)
   * dan mencatat target koordinat untuk diinterpolasi secara mulus di loop render 60 FPS.
   * @param {Array} boxes
   */
  updateBoxes(boxes) {
    const incomingList = Array.isArray(boxes) ? boxes : [];
    const activeIds = new Set();

    incomingList.forEach((box, index) => {
      const boxId = box.id || `box-${index}`;
      activeIds.add(boxId);

      if (this.trackedBoxes.has(boxId)) {
        const existing = this.trackedBoxes.get(boxId);
        existing.targetX = box.x;
        existing.targetY = box.y;
        existing.targetW = box.w;
        existing.targetH = box.h;
        existing.class = box.class;
        existing.confidence = box.confidence;
        existing.speedKmh = box.speedKmh;

        // Jika terjadi lonjakan koordinat drastis (misal kendaraan me-reset progress dari 1 ke 0),
        // lakukan snap instan agar tidak meluncur mundur di layar
        if (Math.abs(existing.targetX - existing.x) > 0.4 || Math.abs(existing.targetY - existing.y) > 0.4) {
          existing.x = existing.targetX;
          existing.y = existing.targetY;
          existing.w = existing.targetW;
          existing.h = existing.targetH;
        }
      } else {
        // Objek baru pertama kali terdeteksi
        this.trackedBoxes.set(boxId, {
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
          speedKmh: box.speedKmh
        });
      }
    });

    // Hapus bounding box yang sudah tidak ada di frame terkini
    for (const id of this.trackedBoxes.keys()) {
      if (!activeIds.has(id)) {
        this.trackedBoxes.delete(id);
      }
    }
  }

  /**
   * Render frame kanvas 60 FPS dengan Lerp Tweening dan estimasi teks tanpa pemanggilan ctx.measureText()
   * @param {boolean} isChaosMode
   * @param {boolean} isPaused
   * @param {boolean} showBoxes
   * @param {number} dt - Waktu delta antar frame dalam detik
   */
  render(isChaosMode, isPaused, showBoxes, dt = 0.016) {
    if (!this.canvas || !this.ctx) {
      this.canvas = document.getElementById(this.canvasId);
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return;
    }

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Clear & Background Perspective Road Canvas
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
    const lanesX = [w * 0.12, w * 0.36, w * 0.64, w * 0.88];
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.setLineDash([4, 4]);
    lanesX.forEach(lx => {
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(lx, h);
      ctx.stroke();
    });
    ctx.setLineDash([]); // Reset dash

    // 2. Render Real-Time Bounding Boxes with Lerp Interpolation
    if (showBoxes && !isPaused && this.trackedBoxes.size > 0) {
      // Faktor interpolasi eksponensial (Lerp speed 10x per detik)
      const lerpFactor = Math.min(1, dt * 10);

      this.trackedBoxes.forEach(box => {
        // Update posisi & ukuran secara halus (Lerp)
        box.x += (box.targetX - box.x) * lerpFactor;
        box.y += (box.targetY - box.y) * lerpFactor;
        box.w += (box.targetW - box.w) * lerpFactor;
        box.h += (box.targetH - box.h) * lerpFactor;

        // Map normalized server coordinates (0..1) to actual pixel dimensions
        const px = box.x * w;
        const py = box.y * h;
        const pw = box.w * w;
        const ph = box.h * h;

        const classKey = (box.class || 'car').toLowerCase();
        const color = CLASS_COLORS[classKey] || '#00e5ff';

        // Bounding Box Fill Overlay
        ctx.fillStyle = `${color}18`; // 10% opacity hex
        ctx.fillRect(px, py, pw, ph);

        // Main Bounding Box Stroke
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);

        // YOLOv8 Corner Accent HUD Bracket Style
        const bracketLen = Math.min(8, Math.min(pw, ph) * 0.3);
        ctx.lineWidth = 3;

        // Top-Left corner bracket
        ctx.beginPath();
        ctx.moveTo(px, py + bracketLen);
        ctx.lineTo(px, py);
        ctx.lineTo(px + bracketLen, py);
        // Bottom-Right corner bracket
        ctx.moveTo(px + pw - bracketLen, py + ph);
        ctx.lineTo(px + pw, py + ph);
        ctx.lineTo(px + pw, py + ph - bracketLen);
        ctx.stroke();

        // Label Tag Fill (Class Name + Confidence Score)
        const labelText = `${classKey.toUpperCase()} ${box.confidence || 95}%`;
        
        // Optimasi Performa: Hapus ctx.measureText() dan gunakan aproksimasi matematis (panjang * 6px + 10px padding)
        const tagW = labelText.length * 6 + 10;
        const tagH = 15;

        const tagY = py - tagH >= 0 ? py - tagH : py;
        ctx.fillStyle = color;
        ctx.fillRect(px, tagY, tagW, tagH);

        // Label Text
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px "Share Tech Mono", monospace, sans-serif';
        ctx.fillText(labelText, px + 4, tagY + 11);
      });
    }

    // 3. Chaos Mode Distortions / Glitch Static Overlay
    if (isChaosMode) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(0, 0, w, h);

      // Random Scanline Glitch
      if (Math.random() < 0.6) {
        const scanY = Math.random() * h;
        const scanH = Math.random() * 8 + 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(0, scanY, w, scanH);
      }
    }

    // 4. Camera HUD Overlay (Watermark timestamp & SITS Edge AI Tag)
    ctx.fillStyle = 'rgba(5, 11, 20, 0.85)';
    ctx.fillRect(8, 8, 220, 22);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, 220, 22);

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px "Share Tech Mono", monospace, sans-serif';
    const nowStr = new Date().toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
    ctx.fillText(`SITS • ${this.cameraName.substring(0, 18)} • ${nowStr}`, 12, 23);

    // Live REC dot & AI Inference indicator
    ctx.fillStyle = isChaosMode ? '#ef4444' : '#10b981';
    ctx.beginPath();
    ctx.arc(w - 20, 18, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px "Share Tech Mono", monospace, sans-serif';
    ctx.fillText(isChaosMode ? 'ALERT' : 'AI 60Hz', w - 68, 21);
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

    this._setupStoreListeners();
  }

  _setupStoreListeners() {
    stateStore.subscribe('state:isChaosMode', ({ value }) => {
      this.updateGlitchOverlays(value);
    });

    stateStore.subscribe('state:cctvBoxesVisible', ({ value }) => {
      // Broadcast or update state toggle
      const btnToggleCV = document.getElementById("btnToggleCVBoxes");
      if (btnToggleCV) {
        btnToggleCV.textContent = value ? "Sembunyikan Overlay AI" : "Tampilkan Overlay AI";
      }
    });
  }

  /**
   * Inisialisasi seluruh renderer CCTV dan koneksi WebSocket
   */
  init() {
    console.info("🚀 [CctvController] Menginisialisasi Real-Time Canvas AI Vision Renderer...");

    const cameraConfig = [
      { id: "dashCameraCanvas", name: "Simpang Wonokromo (Frontage A. Yani)" },
      { id: "cctvCanvas1", name: "Simpang Wonokromo (Frontage A. Yani)" },
      { id: "cctvCanvas2", name: "Koridor Raya Darmo" },
      { id: "cctvCanvas3", name: "Bundaran Waru (Gerbang Kota)" },
      { id: "cctvCanvas4", name: "Simpang Margorejo - Jemursari" },
      { id: "cctvZoomCanvas", name: "Zoom Feed View" }
    ];

    cameraConfig.forEach(cfg => {
      const el = document.getElementById(cfg.id);
      if (el) {
        const renderer = new CctvCanvasRenderer(cfg.id, cfg.name);
        this.renderers.set(cfg.id, renderer);
      }
    });

    // Remove legacy DOM bounding boxes if present
    document.querySelectorAll(".cv-rect").forEach(el => el.remove());

    this._connectSocketStream();
    this._bindControls();
    this._bindMultiCameraSwitcher();
    this._startAnimationLoop();
    this._startWatermarkClock();
  }

  /**
   * Menghubungkan ke Socket.io stream server untuk event `cctv:vision-update`
   * dengan fallback local generator jika server offline.
   */
  _connectSocketStream() {
    let lastReceivedTime = 0;

    const attachSocket = (s) => {
      if (!s) return;
      s.on('cctv:vision-update', (framePayload) => {
        if (!framePayload) return;
        lastReceivedTime = Date.now();
        this.renderers.forEach((renderer, camId) => {
          const boxes = framePayload[camId] || framePayload['dashCameraCanvas'] || [];
          renderer.updateBoxes(boxes);
        });
      });
    };

    if (typeof window.io !== "undefined") {
      this.socket = window.io();
      attachSocket(this.socket);
    } else {
      let attempts = 0;
      const checkIo = setInterval(() => {
        attempts++;
        if (typeof window.io !== "undefined") {
          clearInterval(checkIo);
          this.socket = window.io();
          attachSocket(this.socket);
        } else if (attempts > 8) {
          clearInterval(checkIo);
        }
      }, 300);
    }

    // Local fallback generator for offline / standalone demonstration
    const classes = ['car', 'bus', 'truck', 'motorcycle', 'ambulance'];
    const localVehicles = [
      { id: 'v0', lane: 0, progress: 0.15, class: 'ambulance', speed: 0.012, conf: 98 },
      { id: 'v1', lane: 1, progress: 0.45, class: 'car', speed: 0.009, conf: 95 },
      { id: 'v2', lane: 2, progress: 0.70, class: 'bus', speed: 0.007, conf: 94 },
      { id: 'v3', lane: 3, progress: 0.85, class: 'motorcycle', speed: 0.011, conf: 92 }
    ];

    setInterval(() => {
      // Jika dalam 1.5 detik tidak ada stream dari server, jalankan local fallback
      if (Date.now() - lastReceivedTime > 1500) {
        const isChaos = stateStore.getState().isChaosMode;
        const boxes = localVehicles.map(v => {
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
          const w = (v.class === 'bus' ? 0.16 : v.class === 'ambulance' ? 0.14 : 0.12) * scale;
          const h = (v.class === 'bus' ? 0.12 : v.class === 'ambulance' ? 0.10 : 0.09) * scale;

          return {
            id: v.id,
            class: v.class,
            confidence: v.conf,
            x: Math.max(0.01, Math.min(0.95, x - w / 2)),
            y: Math.max(0.01, Math.min(0.95, y - h / 2)),
            w,
            h,
            speedKmh: Math.round((isChaos ? 12 : 45) + Math.random() * 4)
          };
        });

        this.renderers.forEach(renderer => renderer.updateBoxes(boxes));
      }
    }, 300);
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

    // Tombol Ambil Snapshot / Bukti Pelanggaran ETLE
    document.querySelectorAll('#btnCaptureSnapshot, .btn-cam-snapshot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const camId = btn.dataset.cam || this.activeCamId || 'cctvCanvas1';
        this.captureEvidence(camId);
      });
    });
  }

  /**
   * Switcher Multi-Kamera Langsung
   */
  _bindMultiCameraSwitcher() {
    const tabs = document.querySelectorAll('.cctv-cam-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const camId = tab.dataset.cam;
        this.activeCamId = camId;

        const card = document.querySelector(`[data-cam-id="${camId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          card.classList.add('camera-card-spotlight');
          setTimeout(() => card.classList.remove('camera-card-spotlight'), 2000);
        }

        soundManager.play('click');
        if (typeof window.showToast === 'function') {
          window.showToast(`Kamera Aktif: ${tab.textContent.trim()}`);
        }
      });
    });
  }

  /**
   * Menangkap snapshot frame canvas + bounding box YOLOv8 sebagai bukti ETLE
   * @param {string} [camId]
   */
  captureEvidence(camId = null) {
    const targetCamId = camId || this.activeCamId || 'cctvCanvas1';
    let renderer = this.renderers.get(targetCamId);
    if (!renderer) {
      renderer = this.renderers.values().next().value;
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

    this._insertIncidentEvidenceToDom(evidence);
    soundManager.play('success');

    if (typeof window.showToast === 'function') {
      window.showToast(`📸 Bukti Pelanggaran ETLE #${violationId} (${plateNumber}) berhasil diamankan!`);
    }

    return evidence;
  }

  /**
   * Memasukkan bukti snapshot ke riwayat insiden dan notifikasi
   */
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
      const match = pill.textContent.match(/(\\d+)/);
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
    this.lastFrameTime = performance.now();

    const render = (currentTime) => {
      this.animFrameId = requestAnimationFrame(render);

      if (document.hidden) {
        this.lastFrameTime = currentTime;
        return;
      }

      // Hitung delta time per frame untuk interpolasi (Lerp) yang akurat dan konsisten
      const dt = Math.min(0.1, Math.max(0.001, (currentTime - this.lastFrameTime) / 1000));
      this.lastFrameTime = currentTime;

      const state = stateStore.getState();
      const isChaos = state.isChaosMode;
      const isPaused = state.cctvPaused;
      const showBoxes = state.cctvBoxesVisible;

      this.renderers.forEach(renderer => {
        if (renderer.isVisible && renderer.canvas && renderer.canvas.offsetParent !== null) {
          renderer.render(isChaos, isPaused, showBoxes, dt);
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
    setInterval(() => {
      if (document.hidden) return;

      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
      document.querySelectorAll(".cctv-time").forEach(el => {
        el.textContent = timeStr;
      });
    }, 1000);
  }

  destroy() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

export const cctvController = new CctvController();
