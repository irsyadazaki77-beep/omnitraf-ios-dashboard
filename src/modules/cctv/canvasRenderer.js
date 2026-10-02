/**
 * OmniTRAF Surabaya - CCTV Canvas Renderer (Phase 7 Refactor)
 * Bertanggung jawab khusus untuk canvas drawing lifecycle:
 * - 60 FPS requestAnimationFrame rendering
 * - Urban perspective background drawing (cached gradients)
 * - Vehicle vector models & bounding box overlays
 * - Video stream filter effects (none, mono, night, thermal)
 * - HUD OSD broadcast strip with transparent provenance badge
 * - Camera Insights bottom panel
 * - Stream status overlay (OFFLINE, STALE, PAUSED)
 * 
 * JANGAN:
 * - Mengubah domain state langsung
 * - Fetch API atau dispatch command
 * - Mengatur WebSocket connections
 */

import { TrackingEngine } from './trackingEngine.js';
import { SmoothingEngine } from './smoothingEngine.js';
import { cameraRegistry } from './cameraRegistry.js';

// Color map for object classes
export const CLASS_COLORS = Object.freeze({
  car: '#38bdf8',        // Elegant Light Blue (Sky-400)
  motorcycle: '#fbbf24', // Elegant Warm Amber (Amber-400)
  bus: '#a78bfa',        // Elegant Soft Violet (Violet-400)
  truck: '#94a3b8',      // Elegant Cool Slate (Slate-400)
  ambulance: '#f87171',  // Critical Emergency Soft Red (Red-400)
  person: '#f472b6'      // Soft Pink (Pink-400)
});

export class CctvCanvasRenderer {
  constructor(canvasId, cameraName = 'SITS CCTV') {
    this.canvasId = canvasId;
    this.cameraName = cameraName;
    this.canvas = typeof document !== 'undefined' ? document.getElementById(canvasId) : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this._trackingEngine = new TrackingEngine();
    this.lanesNorm = [0.12, 0.36, 0.64, 0.88];
    this.isVisible = true;

    // Filter mode: 'none', 'mono', 'night', 'thermal'
    this.filterMode = 'none';

    // Smoothing & validation history
    this.lastFrameSeq = 0;
    this.lastFrameTime = 0;
    this.renderFps = 60;
    this.fpsTimer = Date.now();
    this.fpsCounter = 0;

    // Gradient & geometry cache to eliminate per-frame allocations
    this._cachedWidth = 0;
    this._cachedHeight = 0;
    this._skyGrad = null;
    this._roadGrad = null;
    this._topGrad = null;
  }

  get trackedBoxes() {
    return this._trackingEngine.trackedBoxes;
  }

  set trackedBoxes(val) {
    this._trackingEngine.trackedBoxes = val;
  }

  get boxPool() {
    return this._trackingEngine.boxPool;
  }

  setFilter(filterMode = 'none') {
    const validModes = ['none', 'mono', 'night', 'thermal'];
    this.filterMode = validModes.includes(filterMode) ? filterMode : 'none';
  }

  /**
   * Mengambil cuplikan frame visualisasi simulasi pada Canvas.
   * @returns {string|null} Data URL gambar PNG
   */
  captureSnapshot() {
    if (!this.canvas) return null;
    try {
      return this.canvas.toDataURL('image/png');
    } catch (_) {
      return null;
    }
  }

  /**
   * Menerima target bounding box baru dari pipeline data terstruktur
   * @param {Array} boxes Bounding boxes
   */
  updateBoxes(boxes) {
    this._trackingEngine.updateBoxes(boxes);
  }

  clear() {
    this._trackingEngine.clear();
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
   * @param {string} signalState - State lampu APILL ('green', 'red', 'yellow')
   * @param {string} provenance - Provenance data status ('SIMULATED', 'LIVE', etc.)
   */
  render(isChaosMode, isPaused, showBoxes, dt = 0.016, metrics = {}, diagnostics = {}, status = 'ONLINE', signalState = 'green', provenance = 'SIMULATED') {
    if (!this.canvas || !this.ctx) {
      if (typeof document !== 'undefined') {
        this.canvas = document.getElementById(this.canvasId);
        if (this.canvas) this.ctx = this.canvas.getContext('2d');
      }
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

    // 2. Procedural Urban Roadway Scene
    const vy = h * 0.28; // Horizon Y
    const vx = w * 0.5;  // Vanishing point X

    if (this._cachedWidth !== w || this._cachedHeight !== h || !this._skyGrad || !this._roadGrad || !this._topGrad) {
      this._cachedWidth = w;
      this._cachedHeight = h;

      this._skyGrad = ctx.createLinearGradient(0, 0, 0, vy);
      this._skyGrad.addColorStop(0, '#0f172a');
      this._skyGrad.addColorStop(0.65, '#1e293b');
      this._skyGrad.addColorStop(1, '#334155');

      this._roadGrad = ctx.createLinearGradient(0, vy, 0, h);
      this._roadGrad.addColorStop(0, '#1e293b');
      this._roadGrad.addColorStop(1, '#334155');

      this._topGrad = ctx.createLinearGradient(0, 0, 0, 26);
      this._topGrad.addColorStop(0, 'rgba(15, 23, 42, 0.78)');
      this._topGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    }

    // Apply color filter effects
    ctx.save();
    if (this.filterMode === 'mono') {
      ctx.filter = 'grayscale(100%) contrast(1.1)';
    } else if (this.filterMode === 'night') {
      ctx.filter = 'brightness(0.7) hue-rotate(180deg) saturate(1.2)';
    } else if (this.filterMode === 'thermal') {
      ctx.filter = 'invert(85%) hue-rotate(240deg) saturate(2.5)';
    } else {
      ctx.filter = 'none';
    }

    // 2a. Sky & Sky Silhouette
    ctx.fillStyle = this._skyGrad;
    ctx.fillRect(0, 0, w, vy);

    // Subtle Distant Skyline Silhouette (Depth layer)
    ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
    const bHeights = [12, 22, 10, 18, 25, 14, 20, 11, 16];
    const bWidths = [w * 0.05, w * 0.04, w * 0.06, w * 0.045, w * 0.04, w * 0.06, w * 0.04, w * 0.05, w * 0.05];
    let bX = w * 0.03;
    for (let i = 0; i < bHeights.length; i++) {
      if (bX + bWidths[i] < w) {
        ctx.fillRect(bX, vy - bHeights[i], bWidths[i], bHeights[i]);
        bX += bWidths[i] + w * 0.025;
      }
    }

    // Overhead CCTV Frame Gantry Structure Line
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.04, vy - 3);
    ctx.lineTo(w * 0.96, vy - 3);
    ctx.stroke();

    // 2b. Road Shoulders & Greenery
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, vy, w, h - vy);

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, vy);
    ctx.lineTo(vx - w * 0.06, vy);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w, vy);
    ctx.lineTo(vx + w * 0.06, vy);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 2c. Asphalt Road Surface
    ctx.fillStyle = this._roadGrad;
    ctx.beginPath();
    ctx.moveTo(vx - w * 0.05, vy);
    ctx.lineTo(vx + w * 0.05, vy);
    ctx.lineTo(w * 0.94, h);
    ctx.lineTo(w * 0.06, h);
    ctx.closePath();
    ctx.fill();

    // Curb / Shoulder Edge Lines
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(vx - w * 0.05, vy);
    ctx.lineTo(w * 0.06, h);
    ctx.moveTo(vx + w * 0.05, vy);
    ctx.lineTo(w * 0.94, h);
    ctx.stroke();

    // 2d. Center Double Yellow Divide Line
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vx - 0.5, vy);
    ctx.lineTo(w * 0.5 - 1, h);
    ctx.moveTo(vx + 0.5, vy);
    ctx.lineTo(w * 0.5 + 1, h);
    ctx.stroke();

    // 2e. Perspective Dashed Lane Lines
    const drawPerspectiveDashedLine = (xStart, yStart, xEnd, yEnd) => {
      const segments = 9;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      for (let i = 0; i < segments; i++) {
        const t1 = i / segments;
        const t2 = (i + 0.45) / segments;

        const p1 = Math.pow(t1, 2.2);
        const p2 = Math.pow(t2, 2.2);

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

    const sepBottoms = [w * 0.28, w * 0.72];
    for (let i = 0; i < sepBottoms.length; i++) {
      drawPerspectiveDashedLine(vx, vy, sepBottoms[i], h);
    }

    // 2f. Road Markings (Stop Line & Crosswalk)
    const stopY = h * 0.72;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.12, stopY);
    ctx.lineTo(w * 0.88, stopY);
    ctx.stroke();

    // Zebra crosswalk stripes
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    const zebraCount = 12;
    const zebraY1 = stopY + 4;
    const zebraY2 = stopY + 14;
    for (let i = 0; i < zebraCount; i++) {
      const zx1 = w * 0.14 + (i / zebraCount) * (w * 0.72);
      ctx.fillRect(zx1, zebraY1, 10, zebraY2 - zebraY1);
    }

    // 3. Render Real-Time Bounding Boxes & Vector Vehicles
    const drawnLabels = [];
    if (showBoxes && !isPaused && this.trackedBoxes.size > 0) {
      const lerpFactor = SmoothingEngine.computeLerpFactor(dt, 12);

      this.trackedBoxes.forEach(box => {
        const targetSpeed = box.speedKmh || 45;
        if (typeof box.localSpeedKmh === 'undefined') {
          box.localSpeedKmh = targetSpeed;
        }

        if (signalState === 'red') {
          box.localSpeedKmh = Math.max(0, box.localSpeedKmh - dt * 25);
        } else {
          box.localSpeedKmh = Math.min(targetSpeed, box.localSpeedKmh + dt * 35);
        }

        const speedRatio = targetSpeed > 0 ? (box.localSpeedKmh / targetSpeed) : 1;
        SmoothingEngine.smoothBox(box, lerpFactor, speedRatio);

        const px = box.x * w;
        const py = box.y * h;
        const pw = box.w * w;
        const ph = box.h * h;

        const classKey = (box.class || 'car').toLowerCase();
        const color = CLASS_COLORS[classKey] || '#38bdf8';
        const isEmergency = classKey === 'ambulance' || classKey === 'emergency';

        // 3a. Subtle Tracking Trajectory
        const cx = px + pw / 2;
        const cy = py + ph;

        if (!box.trail) {
          box.trail = [];
        }

        if (box.localSpeedKmh > 1) {
          box.trail.push({ x: cx, y: cy });
          if (box.trail.length > 4) {
            box.trail.shift();
          }
        } else if (box.trail.length > 0) {
          if (Math.random() < 0.2) {
            box.trail.shift();
          }
        }

        if (box.trail.length > 1) {
          ctx.save();
          for (let j = 0; j < box.trail.length; j++) {
            const pt = box.trail[j];
            const trailAlpha = ((j + 1) / box.trail.length) * 0.35;
            ctx.fillStyle = color;
            ctx.globalAlpha = trailAlpha;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 1.2 + (j / box.trail.length) * 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // 3b. Draw Recognizable Vector Vehicle Graphic
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.beginPath();
        ctx.ellipse(cx, py + ph - 1, pw * 0.42, ph * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();

        if (classKey === 'car') {
          const carColors = ['#e2e8f0', '#94a3b8', '#475569', '#3b82f6', '#1e293b'];
          const idNum = parseInt(String(box.id).replace(/\D/g, ''), 10) || 0;
          const mainColor = carColors[idNum % carColors.length];

          ctx.fillStyle = mainColor;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(px + pw * 0.08, py + ph * 0.38, pw * 0.84, ph * 0.54, Math.max(1, pw * 0.08));
          } else {
            ctx.rect(px + pw * 0.08, py + ph * 0.38, pw * 0.84, ph * 0.54);
          }
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(px + pw * 0.16, py + ph * 0.12, pw * 0.68, ph * 0.32, Math.max(1, pw * 0.06));
          } else {
            ctx.rect(px + pw * 0.16, py + ph * 0.12, pw * 0.68, ph * 0.32);
          }
          ctx.fill();

          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(px + pw * 0.22, py + ph * 0.78, Math.max(1, pw * 0.06), 0, Math.PI * 2);
          ctx.arc(px + pw * 0.78, py + ph * 0.78, Math.max(1, pw * 0.06), 0, Math.PI * 2);
          ctx.fill();
        } else if (classKey === 'motorcycle') {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px + pw * 0.36, py + ph * 0.32, pw * 0.28, ph * 0.6);
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(cx, py + ph * 0.24, Math.max(1.5, pw * 0.18), 0, Math.PI * 2);
          ctx.fill();
        } else if (classKey === 'bus' || classKey === 'truck') {
          const bodyColor = classKey === 'bus' ? '#1e3a8a' : '#475569';
          ctx.fillStyle = bodyColor;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(px + pw * 0.05, py + ph * 0.05, pw * 0.9, ph * 0.88, Math.max(1, pw * 0.04));
          } else {
            ctx.rect(px + pw * 0.05, py + ph * 0.05, pw * 0.9, ph * 0.88);
          }
          ctx.fill();
        } else if (isEmergency) {
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(px + pw * 0.05, py + ph * 0.08, pw * 0.9, ph * 0.84, Math.max(1, pw * 0.05));
          } else {
            ctx.rect(px + pw * 0.05, py + ph * 0.08, pw * 0.9, ph * 0.84);
          }
          ctx.fill();

          ctx.fillStyle = '#ef4444';
          ctx.fillRect(px + pw * 0.05, py + ph * 0.5, pw * 0.9, ph * 0.1);
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.fillRect(px, py, pw, ph);
        }
        ctx.restore();

        // 3c. Thin Bounding Box
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.0;
        ctx.strokeRect(px, py, pw, ph);

        ctx.fillStyle = isEmergency ? 'rgba(239, 68, 68, 0.04)' : 'rgba(255, 255, 255, 0.02)';
        ctx.fillRect(px, py, pw, ph);
        ctx.restore();

        // 3d. Clean Compact Object Tag
        ctx.save();
        const displayClass = classKey === 'ambulance' ? 'EMERGENCY' : classKey.toUpperCase();
        const displaySpeed = Math.round(box.localSpeedKmh);
        const labelText = `${displayClass} · ${displaySpeed} km/h`;
        
        ctx.font = '600 8.5px "Plus Jakarta Sans", sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        
        const padX = 5;
        const padY = 3;
        const labelW = textWidth + padX * 2;
        const labelH = 13;

        let labelX = Math.max(4, Math.min(w - labelW - 4, px));
        let labelY = py - labelH - 3;
        if (labelY < 24) labelY = py + ph + 3;

        const isLabelOverlapping = (x, y, wl, hl) => {
          for (const rect of drawnLabels) {
            if (x < rect.x + rect.w && x + wl > rect.x && y < rect.y + rect.h && y + hl > rect.y) {
              return true;
            }
          }
          return false;
        };

        let shiftAttempts = 0;
        while (isLabelOverlapping(labelX, labelY, labelW, labelH) && shiftAttempts < 4) {
          labelY += labelH + 2;
          shiftAttempts++;
        }
        drawnLabels.push({ x: labelX, y: labelY, w: labelW, h: labelH });

        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(labelX, labelY, labelW, labelH, 3);
        } else {
          ctx.rect(labelX, labelY, labelW, labelH);
        }
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(labelX, labelY, labelW, labelH);

        ctx.fillStyle = '#f8fafc';
        ctx.fillText(labelText, labelX + padX, labelY + 9.5);
        ctx.restore();
      });
    }

    // 4. Subtle Chaos Warning Accent
    if (isChaosMode) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.03)';
      ctx.fillRect(0, 0, w, h);
    }

    // 5. Refined OSD Broadcast Strip (Honest Provenance Badge & Telemetry)
    ctx.save();
    const camDef = cameraRegistry.getMetadata(this.canvasId);
    const camCode = camDef ? camDef.code : 'CAM-01';
    const camName = camDef ? camDef.shortName : this.cameraName.toUpperCase();

    // Top overlay gradient strip
    ctx.fillStyle = this._topGrad;
    ctx.fillRect(0, 0, w, 26);

    // Provenance Badge (Always honest: SIMULATED VISION for procedural/simulated sources)
    const provBadgeText = 'SIMULATED VISION';
    ctx.font = '700 7.5px "Plus Jakarta Sans", sans-serif';
    
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(8, 5, 86, 14, 3);
    } else {
      ctx.rect(8, 5, 86, 14);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(provBadgeText, 12, 15);

    // Camera Identifier & Location Name
    ctx.font = '600 8.5px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${camCode} · ${camName}`, 102, 15);

    // Live clock
    const formatTime = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const osdTime = formatTime();
    ctx.font = '600 8.5px "Share Tech Mono", monospace';
    const timeWidth = ctx.measureText(osdTime).width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(osdTime, w - timeWidth - 10, 15);
    ctx.restore();

    // 6. Compact Camera Insight Overlay (Bottom-left corner)
    if (metrics && typeof metrics.vehicleCount !== 'undefined') {
      ctx.save();
      const panelW = 126;
      const panelH = 64;
      const panelX = 10;
      const panelY = h - panelH - 22;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(panelX, panelY, panelW, panelH, 4);
      } else {
        ctx.rect(panelX, panelY, panelW, panelH);
      }
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.75;
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 7px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('CAMERA INSIGHTS', panelX + 7, panelY + 10);

      ctx.font = '500 7.5px "Plus Jakarta Sans", sans-serif';
      
      // Density
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('Density', panelX + 7, panelY + 22);
      let densityColor = '#10b981';
      if (metrics.trafficDensity > 75) densityColor = '#f87171';
      else if (metrics.trafficDensity > 45) densityColor = '#f59e0b';
      ctx.fillStyle = densityColor;
      ctx.fillText(`${metrics.trafficDensity}%`, panelX + 48, panelY + 22);

      // Queue
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('Queue', panelX + 72, panelY + 22);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${metrics.queueLengthMeters}m`, panelX + 100, panelY + 22);

      // Avg Speed
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('Avg Speed', panelX + 7, panelY + 34);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${metrics.estimatedAverageSpeed} km/h`, panelX + 48, panelY + 34);

      // Risk
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('Risk', panelX + 7, panelY + 46);
      let riskColor = '#10b981';
      if (metrics.incidentRisk > 70) riskColor = '#f87171';
      else if (metrics.incidentRisk > 40) riskColor = '#f59e0b';
      ctx.fillStyle = riskColor;
      ctx.fillText(metrics.incidentRisk > 60 ? 'High' : metrics.incidentRisk > 35 ? 'Moderate' : 'Low', panelX + 48, panelY + 46);

      // Detection Confidence
      ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
      ctx.fillText('Confidence', panelX + 7, panelY + 57);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`${metrics.aiConfidence}%`, panelX + 54, panelY + 57);

      ctx.restore();
    }

    // 7. Visual Stream State Overlay (Paused, Stale, Offline)
    if (isPaused || status === 'OFFLINE' || status === 'STALE') {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fillRect(0, 0, w, h);

      ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      let stateMsg = 'FEED PAUSED';
      let stateColor = '#f59e0b';
      
      if (status === 'OFFLINE') {
        stateMsg = 'CAMERA FEED OFFLINE';
        stateColor = '#f87171';
      } else if (status === 'STALE') {
        stateMsg = 'STREAM RECONNECTING...';
        stateColor = '#f59e0b';
      }

      ctx.fillStyle = stateColor;
      const msgWidth = ctx.measureText(stateMsg).width;
      ctx.fillText(stateMsg, (w - msgWidth) / 2, h / 2);
      ctx.restore();
    }

    ctx.restore(); // Restore filter context
  }
}
