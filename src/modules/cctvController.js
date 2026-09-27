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
import { authManager } from '../core/authManager.js';

// Color map for YOLOv8 object classes
const CLASS_COLORS = {
  car: '#38bdf8',        // Elegant Light Blue (Sky-400)
  motorcycle: '#fbbf24', // Elegant Warm Amber (Amber-400)
  bus: '#a78bfa',        // Elegant Soft Violet (Violet-400)
  truck: '#94a3b8',      // Elegant Cool Slate (Slate-400)
  ambulance: '#f87171',  // Critical Emergency Soft Red (Red-400)
  person: '#f472b6'      // Soft Pink (Pink-400)
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

    // 2. Procedural Roadway Scene (Beautiful, Natural Sunset/Senja Glow with Perspective)
    // 2a. Sky Linear Gradient (Sunset atmosphere)
    const vy = h * 0.28;
    const vx = w * 0.5;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, vy);
    skyGrad.addColorStop(0, '#111827');   // Dark slate-indigo top
    skyGrad.addColorStop(0.5, '#1e293b'); // Refined dark-blue mid
    skyGrad.addColorStop(1, '#fdba74');   // Beautiful warm peach golden sunset glow at horizon
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, vy);

    // 2b. Warm Ambient Sun Glow near center horizon
    const sunGrad = ctx.createRadialGradient(vx, vy, 0, vx, vy, w * 0.22);
    sunGrad.addColorStop(0, 'rgba(254, 215, 170, 0.4)');
    sunGrad.addColorStop(1, 'rgba(254, 215, 170, 0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(vx, vy, w * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // 2c. Distant Skyline Silhouettes (Subtle buildings for depth)
    ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
    const bHeights = [14, 25, 11, 19, 29, 13, 23, 12, 17];
    const bWidths = [w * 0.05, w * 0.045, w * 0.06, w * 0.05, w * 0.04, w * 0.065, w * 0.04, w * 0.05, w * 0.05];
    let bX = w * 0.04;
    for (let i = 0; i < bHeights.length; i++) {
      if (bX + bWidths[i] < w) {
        ctx.fillRect(bX, vy - bHeights[i], bWidths[i], bHeights[i]);
        bX += bWidths[i] + w * 0.025;
      }
    }

    // 2d. Roadway Base & Ground Shoulders
    ctx.fillStyle = '#0f172a'; // Deep slate base
    ctx.fillRect(0, vy, w, h - vy);

    // Subdued side green/olive shoulder lands for perspective depth
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, vy);
    ctx.lineTo(vx - w * 0.05, vy);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(w, vy);
    ctx.lineTo(vx + w * 0.05, vy);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 2e. Asphalt Road Trapezoid
    const roadGrad = ctx.createLinearGradient(0, vy, 0, h);
    roadGrad.addColorStop(0, '#1e293b'); // Darker asphalt far away
    roadGrad.addColorStop(1, '#2d3748'); // Detailed lighter road up close
    ctx.fillStyle = roadGrad;
    ctx.beginPath();
    ctx.moveTo(vx - w * 0.04, vy);
    ctx.lineTo(vx + w * 0.04, vy);
    ctx.lineTo(w * 0.95, h);
    ctx.lineTo(w * 0.05, h);
    ctx.closePath();
    ctx.fill();

    // 2f. Left & Right Concrete Curb Borders
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.2;
    // Left border
    ctx.beginPath();
    ctx.moveTo(vx - w * 0.04, vy);
    ctx.lineTo(w * 0.05, h);
    ctx.stroke();
    // Right border
    ctx.beginPath();
    ctx.moveTo(vx + w * 0.04, vy);
    ctx.lineTo(w * 0.95, h);
    ctx.stroke();

    // 2g. Perspective-Correct Dashed Lane Lines
    const drawPerspectiveDashedLine = (xStart, yStart, xEnd, yEnd) => {
      const segments = 10;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      for (let i = 0; i < segments; i++) {
        const t1 = i / segments;
        const t2 = (i + 0.42) / segments;

        const p1 = Math.pow(t1, 2.5);
        const p2 = Math.pow(t2, 2.5);

        const lx1 = xStart + (xEnd - xStart) * p1;
        const ly1 = yStart + (yEnd - yStart) * p1;
        const lx2 = xStart + (xEnd - xStart) * p2;
        const ly2 = yStart + (yEnd - yStart) * p2;

        ctx.lineWidth = 0.5 + p1 * 1.5;
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
      }
      ctx.restore();
    };

    // 3 lane dividing lines on the 4-lane roadway
    const sepBottoms = [w * 0.275, w * 0.5, w * 0.725];
    for (let i = 0; i < sepBottoms.length; i++) {
      drawPerspectiveDashedLine(vx, vy, sepBottoms[i], h);
    }

    // 2h. Highly aesthetic minimalist side streetlight
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.02, h);
    ctx.quadraticCurveTo(w * 0.02, vy + 40, w * 0.06, vy + 30);
    ctx.stroke();
    ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
    ctx.beginPath();
    ctx.arc(w * 0.06, vy + 30, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // 3. Render Real-Time Bounding Boxes & Stylized Vector Vehicles
    const drawnLabels = [];
    if (showBoxes && !isPaused && this.trackedBoxes.size > 0) {
      const lerpFactor = 1 - Math.exp(-12 * dt);

      // Determine intersection signalState for speed and movement sync
      const CAMERA_TO_NODE_MAP = {
        'dashCameraCanvas': 'node-wonokromo',
        'cctvCanvas1': 'node-wonokromo',
        'cctvCanvas2': 'node-darmo',
        'cctvCanvas3': 'node-wonokromo',
        'cctvCanvas4': 'node-jemursari',
        'cctvZoomCanvas': 'node-wonokromo'
      };

      const targetCamId = this.canvasId;
      const nodeId = CAMERA_TO_NODE_MAP[targetCamId] || 'node-wonokromo';
      const state = stateStore.getState();
      const node = state.intersections?.find(n => n.id === nodeId);
      const signalState = node ? node.state : 'green';

      this.trackedBoxes.forEach(box => {
        const targetSpeed = box.speedKmh || 45;
        if (typeof box.localSpeedKmh === 'undefined') {
          box.localSpeedKmh = targetSpeed;
        }

        // Adjust speed based on APILL signalState
        if (signalState === 'red') {
          box.localSpeedKmh = Math.max(0, box.localSpeedKmh - dt * 25);
        } else {
          box.localSpeedKmh = Math.min(targetSpeed, box.localSpeedKmh + dt * 35);
        }

        const speedRatio = targetSpeed > 0 ? (box.localSpeedKmh / targetSpeed) : 1;
        const clampedRatio = Math.max(0, Math.min(1, speedRatio));

        // Update positions using stable LERP factor
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
        const color = CLASS_COLORS[classKey] || '#38bdf8';
        const isEmergency = classKey === 'ambulance' || classKey === 'emergency';

        // 3a. Subtle Tracking Trajectory (Minimal, soft path)
        const cx = px + pw / 2;
        const cy = py + ph;

        if (!box.trail) {
          box.trail = [];
        }

        if (box.localSpeedKmh > 1) {
          box.trail.push({ x: cx, y: cy });
          if (box.trail.length > 5) { // very short history for restraint
            box.trail.shift();
          }
        } else if (box.trail.length > 0) {
          if (Math.random() < 0.25) {
            box.trail.shift();
          }
        }

        if (box.trail.length > 1) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(box.trail[0].x, box.trail[0].y);
          for (let j = 1; j < box.trail.length; j++) {
            ctx.lineTo(box.trail[j].x, box.trail[j].y);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.12; // Extremely soft transparent path
          ctx.stroke();
          ctx.restore();
        }

        // 3b. Draw High-Fidelity Simplified Vector Vehicle
        ctx.save();
        
        // Soft bottom ambient shadow
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.beginPath();
        ctx.ellipse(cx, py + ph - 2, pw * 0.44, ph * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();

        if (classKey === 'car') {
          const carColors = ['#e2e8f0', '#94a3b8', '#475569', '#3b82f6', '#1e293b'];
          const idNum = parseInt(box.id.replace(/\D/g, ''), 10) || 0;
          const mainColor = carColors[idNum % carColors.length];

          // Car body base
          ctx.fillStyle = mainColor;
          ctx.beginPath();
          ctx.roundRect(px + pw * 0.08, py + ph * 0.4, pw * 0.84, ph * 0.52, Math.max(1, pw * 0.08));
          ctx.fill();

          // Car cabin (on top of chassis)
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.roundRect(px + pw * 0.16, py + ph * 0.12, pw * 0.68, ph * 0.32, Math.max(1, pw * 0.06));
          ctx.fill();

          // Windshield reflection line
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.beginPath();
          ctx.moveTo(px + pw * 0.22, py + ph * 0.16);
          ctx.lineTo(px + pw * 0.45, py + ph * 0.16);
          ctx.lineTo(px + pw * 0.38, py + ph * 0.34);
          ctx.lineTo(px + pw * 0.22, py + ph * 0.34);
          ctx.closePath();
          ctx.fill();

          // Headlights
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(px + pw * 0.22, py + ph * 0.76, Math.max(1, pw * 0.06), 0, Math.PI * 2);
          ctx.arc(px + pw * 0.78, py + ph * 0.76, Math.max(1, pw * 0.06), 0, Math.PI * 2);
          ctx.fill();
        } 
        else if (classKey === 'motorcycle') {
          // Rider back chassis
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px + pw * 0.36, py + ph * 0.32, pw * 0.28, ph * 0.6);
          
          // Helmet
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(cx, py + ph * 0.24, Math.max(1.5, pw * 0.18), 0, Math.PI * 2);
          ctx.fill();

          // Front light
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, py + ph * 0.72, Math.max(1, pw * 0.08), 0, Math.PI * 2);
          ctx.fill();
        } 
        else if (classKey === 'bus' || classKey === 'truck') {
          const bodyColor = classKey === 'bus' ? '#1e3a8a' : '#475569';
          
          // Large solid chassis
          ctx.fillStyle = bodyColor;
          ctx.beginPath();
          ctx.roundRect(px + pw * 0.05, py + ph * 0.05, pw * 0.9, ph * 0.88, Math.max(1, pw * 0.04));
          ctx.fill();

          // Windshield
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(px + pw * 0.12, py + ph * 0.15, pw * 0.76, ph * 0.28);

          // Dual Headlights
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(px + pw * 0.14, py + ph * 0.78, pw * 0.12, ph * 0.08);
          ctx.fillRect(px + pw * 0.74, py + ph * 0.78, pw * 0.12, ph * 0.08);
        } 
        else if (isEmergency) {
          // Ambulance
          ctx.fillStyle = '#f8fafc'; // Clean white body
          ctx.beginPath();
          ctx.roundRect(px + pw * 0.05, py + ph * 0.08, pw * 0.9, ph * 0.84, Math.max(1, pw * 0.05));
          ctx.fill();

          // Emergency red side stripe
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(px + pw * 0.05, py + ph * 0.5, pw * 0.9, ph * 0.1);

          // Front window
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(px + pw * 0.12, py + ph * 0.16, pw * 0.76, ph * 0.24);

          // Headlights
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(px + pw * 0.22, py + ph * 0.74, Math.max(1, pw * 0.06), 0, Math.PI * 2);
          ctx.arc(px + pw * 0.78, py + ph * 0.74, Math.max(1, pw * 0.06), 0, Math.PI * 2);
          ctx.fill();

          // Pulsing lightbar siren
          const flash = Math.sin(Date.now() / 80) > 0;
          ctx.fillStyle = flash ? '#3b82f6' : '#ef4444';
          ctx.fillRect(px + pw * 0.35, py + ph * 0.01, pw * 0.3, ph * 0.08);
        }
        else {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.fillRect(px, py, pw, ph);
        }
        ctx.restore();

        // 3c. Thin Precise Bounding Box Stroke
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.0; // Restrained thin stroke
        ctx.strokeRect(px, py, pw, ph);

        // Very faint box fill for identification contrast
        ctx.fillStyle = isEmergency ? 'rgba(239, 68, 68, 0.04)' : 'rgba(255, 255, 255, 0.02)';
        ctx.fillRect(px, py, pw, ph);
        ctx.restore();

        // 3d. Clean, Modern, Compact Label Tag (No overlap, unboxed, consistent spacing)
        ctx.save();
        const displayClass = classKey === 'ambulance' ? 'EMERGENCY' : classKey.toUpperCase();
        const displaySpeed = Math.round(box.localSpeedKmh);
        const labelText = `${displayClass} · ${displaySpeed} km/h`;
        
        ctx.font = '600 8.5px "Plus Jakarta Sans", sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        
        const padX = 5;
        const padY = 3;
        const labelW = textWidth + padX * 2;
        const labelH = 12 + padY;

        // Smart coordinates layout to prevent overlapping labels
        let labelX = Math.max(4, Math.min(w - labelW - 4, px));
        let labelY = py - labelH - 2;

        if (labelY < 20) {
          labelY = py + ph + 2; // draw below if hitting top edge
        }

        const isLabelOverlapping = (x, y, wl, hl) => {
          for (const rect of drawnLabels) {
            if (x < rect.x + rect.w && x + wl > rect.x && y < rect.y + rect.h && y + hl > rect.y) {
              return true;
            }
          }
          return false;
        };

        let shiftAttempts = 0;
        while (isLabelOverlapping(labelX, labelY, labelW, labelH) && shiftAttempts < 3) {
          labelY -= labelH + 2; // offset vertically
          shiftAttempts++;
        }

        drawnLabels.push({ x: labelX, y: labelY, w: labelW, h: labelH });

        // Draw pill tag container (soft glass slate)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.beginPath();
        ctx.roundRect(labelX, labelY, labelW, labelH, 3);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(labelX, labelY, labelW, labelH);

        // Print compact text
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(labelText, labelX + padX, labelY + 10.5);
        ctx.restore();
      });
    }

    // 4. Subtle Chaos Mode / Ambient Hue Overlay (Restrained warning indicator)
    if (isChaosMode) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.03)';
      ctx.fillRect(0, 0, w, h);
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, vy);
      ctx.lineTo(w, vy);
      ctx.stroke();
    }

    // 5. Refined SITS Camera Telemetry Strip (Minimalist broadcast style)
    ctx.save();
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
      'cctvCanvas4': 'SIMPANG JEMURSARI',
      'cctvZoomCanvas': 'ZOOM VIEW'
    };

    const camCode = CAM_CODES[this.canvasId] || 'CAM-01';
    const camName = CAM_NAMES_OSD[this.canvasId] || this.cameraName.toUpperCase();

    // Subtle dark gradient strip background at top
    const headerH = 22;
    const headerGrad = ctx.createLinearGradient(0, 0, 0, headerH);
    headerGrad.addColorStop(0, 'rgba(15, 23, 42, 0.65)');
    headerGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, w, headerH);

    // Render Camera Code & Location Info
    const osdTextLeft = `${camCode}  ·  ${camName}`;
    ctx.font = '500 8px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(osdTextLeft, 12, 14);

    // Render OSD live clock
    const formatTime = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const osdTextRight = formatTime();
    ctx.font = '600 8px "Share Tech Mono", monospace'; // tabular figures
    const rightWidth = ctx.measureText(osdTextRight).width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText(osdTextRight, w - rightWidth - 12, 14);
    ctx.restore();

    // 6. Compact Camera Insight Overlay Card (Elegant analytics widget)
    if (metrics && typeof metrics.vehicleCount !== 'undefined') {
      ctx.save();
      
      const panelW = 120;
      const panelH = 74;
      const panelX = 12;
      const panelY = 28;

      // Dark slate translucent background with subtle glow
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelW, panelH, 6);
      ctx.fill();

      // Delicate hairline border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Card Header Title
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 7px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('ANALYTICS INSIGHTS', panelX + 8, panelY + 12);

      // Fine divider
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(panelX + 6, panelY + 16);
      ctx.lineTo(panelX + panelW - 6, panelY + 16);
      ctx.stroke();

      // Key-Value rows
      ctx.font = '500 7.5px "Plus Jakarta Sans", sans-serif';
      
      // Row 1: Volume & Speed
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('VOL', panelX + 8, panelY + 28);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(metrics.vehicleCount, panelX + 32, panelY + 28);

      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('SPD', panelX + 62, panelY + 28);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${metrics.estimatedAverageSpeed} km/h`, panelX + 84, panelY + 28);

      // Row 2: Queue & Density
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('Q_LEN', panelX + 8, panelY + 41);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${metrics.queueLengthMeters}m`, panelX + 32, panelY + 41);

      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('DENS', panelX + 62, panelY + 41);
      
      let densityColor = '#34d399'; // Emerald-400
      if (metrics.trafficDensity > 75) densityColor = '#f87171'; // Red-400
      else if (metrics.trafficDensity > 45) densityColor = '#fbbf24'; // Amber-400
      ctx.fillStyle = densityColor;
      ctx.fillText(`${metrics.trafficDensity}%`, panelX + 84, panelY + 41);

      // Row 3: Risk rating & AI confidence rate
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('RISK', panelX + 8, panelY + 54);
      
      let riskColor = '#34d399';
      if (metrics.incidentRisk > 70) riskColor = '#f87171';
      else if (metrics.incidentRisk > 40) riskColor = '#fbbf24';
      ctx.fillStyle = riskColor;
      ctx.fillText(`${metrics.incidentRisk}%`, panelX + 32, panelY + 54);

      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('CONF', panelX + 62, panelY + 54);
      ctx.fillStyle = '#38bdf8'; // Sky-400
      ctx.fillText(`${metrics.aiConfidence}%`, panelX + 84, panelY + 54);

      // Row 4: AI pipeline status
      ctx.fillStyle = 'rgba(248, 250, 252, 0.5)';
      ctx.fillText('AI MODULE', panelX + 8, panelY + 66);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('ACTIVE (YOLO)', panelX + 54, panelY + 66);

      ctx.restore();
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
    this._isInitialized = false;

    // Advanced Pipeline properties
    this.camerasRegistry = new Map([
      ['dashCameraCanvas', { name: "Simpang Wonokromo (Frontage A. Yani)" }],
      ['cctvCanvas1', { name: "Simpang Wonokromo (Frontage A. Yani)" }],
      ['cctvCanvas2', { name: "Koridor Raya Darmo" }],
      ['cctvCanvas3', { name: "Bundaran Waru (Gerbang Kota)" }],
      ['cctvCanvas4', { name: "Simpang Jemursari" }],
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
    if (this._isInitialized) return;
    this._isInitialized = true;
    console.info("🚀 [CctvController] Menginisialisasi High-Fidelity Edge AI Pipeline & Renderer...");
  }

  activate() {
    this.deactivate(); // Ensure deterministic cleanup first
    this.isActive = true;

    this.camerasRegistry.forEach((val, id) => {
      const el = document.getElementById(id);
      if (el) {
        if (!this.renderers.has(id)) {
          const renderer = new CctvCanvasRenderer(id, val.name);
          this.renderers.set(id, renderer);
        }
      }
    });

    // Remove legacy DOM bounding boxes if present (fully standardizing on Canvas pipeline)
    document.querySelectorAll(".cv-rect").forEach(el => el.remove());

    this._setupStoreListeners();
    this._setupVisibilityListener();
    this._connectSocketStream();
    this._bindControls();
    this._bindMultiCameraSwitcher();
    this._startWatermarkClock();
    this._startHealthTelemetryWatchdog();

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
    this.disposer.clear();
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
      const authToken = authManager.getToken();
      const response = await fetch('/api/incidents/create-auto', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
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
      this.disposer.addEventListener(btnToggleCV, "click", () => {
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

    // Ambang batas slider
    const thresholdRange = document.getElementById("cctvThresholdRange");
    const thresholdVal = document.getElementById("thresholdVal");
    if (thresholdRange && thresholdVal) {
      this.disposer.addEventListener(thresholdRange, "input", (e) => {
        const val = e.target.value;
        thresholdVal.textContent = `${val}%`;
        stateStore.setState({ cctvConfidenceThreshold: parseInt(val, 10) });
      });
    }

    // Tombol Ambil Snapshot / Bukti Pelanggaran ETLE
    document.querySelectorAll('#btnCaptureSnapshot, .btn-cam-snapshot').forEach(btn => {
      this.disposer.addEventListener(btn, 'click', (e) => {
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
