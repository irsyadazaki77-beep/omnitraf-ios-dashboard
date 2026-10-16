/**
 * Procedural CCTV scene renderer. Scene vehicles and detection boxes are two
 * views of the same SIMULATED traffic frame; hiding boxes leaves vehicles visible.
 */
import { TrackingEngine } from './trackingEngine.js';
import { SmoothingEngine } from './smoothingEngine.js';
import { cameraRegistry } from './cameraRegistry.js';

export const CLASS_COLORS = Object.freeze({
  car: '#7dd3fc', motorcycle: '#fbbf24', bus: '#c4b5fd', truck: '#cbd5e1',
  ambulance: '#fca5a5', person: '#f472b6'
});

const CAMERA_SCENES = Object.freeze({
  cctvCanvas1: { type: 'intersection', seed: 1101, horizon: .29, roadTop: .20, roadBottom: .91, skyline: 1, trees: false, signal: true, label: 'WONOKROMO' },
  cctvCanvas2: { type: 'boulevard', seed: 2202, horizon: .27, roadTop: .17, roadBottom: .88, skyline: 2, trees: true, signal: false, label: 'RAYA DARMO' },
  cctvCanvas3: { type: 'roundabout', seed: 3303, horizon: .32, roadTop: .27, roadBottom: .92, skyline: 0, trees: true, signal: false, label: 'BUNDARAN WARU' },
  cctvCanvas4: { type: 'intersection', variant: 'jemursari', seed: 4404, horizon: .30, roadTop: .19, roadBottom: .90, skyline: 3, trees: false, signal: true, label: 'JEMURSARI' }
});

export function getCameraScene(canvasId) {
  const scene = CAMERA_SCENES[canvasId] || CAMERA_SCENES.cctvCanvas1;
  return { ...scene };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const SIGNAL_LAMPS = Object.freeze([{ dy: 0, color: '#ff514b', phase: 'red' }, { dy: 7, color: '#ffc44f', phase: 'yellow' }, { dy: 14, color: '#4ee0a6', phase: 'green' }]);
const compareVehicleDepth = (a, b) => a.depth - b.depth;
const seeded = (seed) => {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
};

export class CctvCanvasRenderer {
  constructor(canvasId, cameraName = 'SITS CCTV') {
    this.canvasId = canvasId;
    this.cameraName = cameraName;
    this.canvas = typeof document !== 'undefined' ? document.getElementById(canvasId) : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this._trackingEngine = new TrackingEngine();
    this.filterMode = 'none';
    this.environment = { timeOfDay: 'day', weather: 'clear' };
    this.scene = getCameraScene(canvasId);
    this.vehicles = [];
    this._vehicleVisuals = new Map();
    this.renderFps = 0;
    this.fpsCounter = 0;
    this.fpsTimer = 0;
    this._resolutionScale = 1;
    this.targetFps = 55;
    this._resolutionSampleAt = 0;
    this._renderDurations = new Float32Array(120);
    this._renderDurationCount = 0;
    this._renderDurationCursor = 0;
    this._nextStatsAt = 0;
    this._positioned = [];
    this._rainStreaks = Array.from({ length: 100 }, (_, index) => {
      const random = seeded(this.scene.seed + 461 + index * 7);
      return { x: random(), y: random(), speed: random() };
    });
    this._cachedWidth = 0;
    this._cachedHeight = 0;
    this._sceneCanvas = null;
    this._sceneKey = '';
    this._osdGradient = null;
    this._osdTimestampSecond = -1;
    this._osdTimestamp = '';
    this._frame = 0;
  }

  get trackedBoxes() { return this._trackingEngine.trackedBoxes; }
  set trackedBoxes(value) { this._trackingEngine.trackedBoxes = value; }
  get boxPool() { return this._trackingEngine.boxPool; }
  set boxPool(value) { this._trackingEngine.boxPool = value; }

  setFilter(mode = 'none') {
    this.filterMode = ['none', 'mono', 'night', 'thermal'].includes(mode) ? mode : 'none';
  }

  setEnvironment({ timeOfDay, weather } = {}) {
    let changed = false;
    if (['morning', 'day', 'evening', 'night'].includes(timeOfDay) && this.environment.timeOfDay !== timeOfDay) { this.environment.timeOfDay = timeOfDay; changed = true; }
    if (['clear', 'cloudy', 'light-rain', 'heavy-rain'].includes(weather) && this.environment.weather !== weather) { this.environment.weather = weather; changed = true; }
    if (changed) this._sceneKey = '';
  }

  captureSnapshot() {
    if (!this.canvas) return null;
    try { return this.canvas.toDataURL('image/png'); } catch (_) { return null; }
  }
  updateVehicles(vehicles) {
    this.vehicles = Array.isArray(vehicles) ? vehicles.map((vehicle) => ({
      ...vehicle, type: vehicle.class || vehicle.type || 'car',
      color: vehicle.color || (vehicle.class === 'ambulance' ? '#e6e7df' : '#899385')
    })) : [];
    const liveIds = new Set(this.vehicles.map((vehicle, index) => String(vehicle.trackId || vehicle.id || `anonymous-${index}`)));
    for (const id of this._vehicleVisuals.keys()) if (!liveIds.has(id)) this._vehicleVisuals.delete(id);
    if (this.canvas?.dataset) this.canvas.dataset.inputVehicles = String(this.vehicles.length);
  }
  updateBoxes(boxes) { this._trackingEngine.updateBoxes(boxes); }
  clear() { this._trackingEngine.clear(); this.vehicles = []; this._vehicleVisuals.clear(); this._sceneCanvas = null; this._sceneKey = ''; }

  _dimensions() {
    const rect = this.canvas.getBoundingClientRect?.();
    const cssWidth = Math.max(1, Math.round(rect?.width || this.canvas.clientWidth || this.canvas.width || 640));
    const cssHeight = Math.max(1, Math.round(rect?.height || this.canvas.clientHeight || this.canvas.height || 360));
    const dpr = clamp((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) * this._resolutionScale, .75, 1.5);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this._sceneKey = '';
    }
    return { width, height };
  }

  _ensureScene(width, height) {
    const key = `${width}x${height}:${this.environment.timeOfDay}:${this.environment.weather}:${this.scene.type}:${this.scene.variant || ''}`;
    if (this._sceneCanvas && this._sceneKey === key) return;
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    if (typeof canvas.getContext !== 'function') return;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this._drawEnvironment(ctx, width, height);
    this._drawSensorArtifacts(ctx, width, height);
    this._sceneCanvas = canvas;
    this._sceneKey = key;
  }

  _drawSensorArtifacts(ctx, w, h) {
    // Light fixed-pattern noise and scan texture suggest an encoded camera feed
    // while staying below detection-box contrast and keeping the layer cached.
    ctx.save();
    ctx.fillStyle = 'rgba(17,24,27,.022)';
    for (let y = 3; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    ctx.strokeStyle = 'rgba(205,220,220,.018)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 48; x < w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 36; y < h; y += 36) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.restore();
  }

  _drawEnvironment(ctx, w, h) {
    const { type, horizon } = this.scene;
    const hy = h * horizon;
    const cx = w * (type === 'roundabout' ? .50 : .49);
    const palette = {
      morning: ['#9bb9c5', '#e4b994', '#73848a'], day: ['#83afc2', '#d8d0b4', '#788078'],
      evening: ['#6d8193', '#d18f6d', '#48535c'], night: ['#172332', '#48505a', '#202831']
    }[this.environment.timeOfDay];
    const rain = this.environment.weather.includes('rain');
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, palette[0]); sky.addColorStop(1, palette[1]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Atmospheric skyline and low-rise Indonesian urban blocks.
    ctx.fillStyle = palette[2];
    const random = seeded(this.scene.seed + 3);
    for (let i = 0; i < 19; i++) {
      const bw = w * (.025 + random() * .045), bh = h * (.035 + random() * .10);
      const x = (i / 19) * w;
      ctx.fillRect(x, hy - bh, bw, bh);
      ctx.fillStyle = 'rgba(224,215,185,.30)';
      const columns = Math.max(1, Math.floor(bw / 8)), rows = Math.max(1, Math.floor(bh / 7));
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        if (random() > .38) ctx.fillRect(x + 3 + column * 7, hy - bh + 4 + row * 7, 2, 2.5);
      }
      ctx.fillStyle = palette[2];
      if (this.environment.timeOfDay === 'night') {
        ctx.fillStyle = 'rgba(238,190,111,.48)';
        for (let wy = hy - bh + 4; wy < hy - 3; wy += 7) ctx.fillRect(x + 3, wy, 2, 2);
        ctx.fillStyle = palette[2];
      }
    }
    this._drawRoad(ctx, w, h, cx, hy);
    this._drawStreetFurniture(ctx, w, h, cx, hy);
    if (this.environment.timeOfDay === 'night') this._drawNightLighting(ctx, w, h);
    if (this.environment.weather === 'cloudy') {
      ctx.fillStyle = 'rgba(90,103,111,.16)'; ctx.fillRect(0, 0, w, h);
    }
    const vignette = ctx.createRadialGradient(cx, h * .53, h * .1, cx, h * .53, w * .72);
    vignette.addColorStop(.55, 'rgba(8,13,17,0)'); vignette.addColorStop(1, 'rgba(8,13,17,.32)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
  }

  _drawRoad(ctx, w, h, cx, hy) {
    const wet = this.environment.weather.includes('rain');
    const night = this.environment.timeOfDay === 'night';
    const road = ctx.createLinearGradient(0, hy, 0, h);
    road.addColorStop(0, night ? (wet ? '#343e45' : '#30383e') : wet ? '#56636a' : '#555957');
    road.addColorStop(1, night ? (wet ? '#1e272d' : '#20272c') : wet ? '#292f34' : '#343a3a');
    const verge = ctx.createLinearGradient(0, hy, 0, h);
    verge.addColorStop(0, '#747c6d'); verge.addColorStop(1, '#586557');
    ctx.fillStyle = verge; ctx.fillRect(0, hy, w, h - hy);
    ctx.beginPath(); ctx.moveTo(cx - w * .09, hy); ctx.lineTo(cx + w * .09, hy);
    ctx.lineTo(w * .96, h); ctx.lineTo(w * .04, h); ctx.closePath(); ctx.fillStyle = road; ctx.fill();
    // Narrow concrete paving on the road shoulders, widening naturally toward camera.
    ctx.fillStyle = '#85867c';
    ctx.beginPath(); ctx.moveTo(cx - w * .09, hy); ctx.lineTo(cx - w * .105, hy); ctx.lineTo(w * .008, h); ctx.lineTo(w * .04, h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + w * .09, hy); ctx.lineTo(cx + w * .105, hy); ctx.lineTo(w * .992, h); ctx.lineTo(w * .96, h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(222,219,198,.16)'; ctx.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const t = i / 7, y = hy + t * (h - hy), lx = cx - w * (.09 + t * .392), rx = cx + w * (.09 + t * .392);
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx - w * (.006 + t * .02), y); ctx.moveTo(rx, y); ctx.lineTo(rx + w * (.006 + t * .02), y); ctx.stroke();
    }
    // Curb, sidewalk and soft contact shadow.
    ctx.fillStyle = 'rgba(19,25,24,.26)';
    ctx.beginPath(); ctx.moveTo(cx - w * .10, hy); ctx.lineTo(w * .02, h); ctx.lineTo(w * .07, h); ctx.lineTo(cx - w * .08, hy); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + w * .10, hy); ctx.lineTo(w * .98, h); ctx.lineTo(w * .93, h); ctx.lineTo(cx + w * .08, hy); ctx.fill();
    ctx.strokeStyle = 'rgba(218,218,197,.62)'; ctx.lineWidth = Math.max(1, w / 500);
    ctx.beginPath(); ctx.moveTo(cx - w * .09, hy); ctx.lineTo(w * .04, h); ctx.moveTo(cx + w * .09, hy); ctx.lineTo(w * .96, h); ctx.stroke();
    // Asphalt grain is deterministic and part of the cached static layer.
    const grain = seeded(this.scene.seed + 51);
    for (let i = 0; i < 180; i++) {
      const y = hy + grain() * (h - hy), t = (y - hy) / (h - hy);
      const left = cx - w * (.09 + .42 * t), right = cx + w * (.09 + .42 * t);
      ctx.fillStyle = `rgba(225,229,221,${.025 + grain() * .035})`;
      ctx.fillRect(left + grain() * (right - left), y, 1 + t * 2, 1);
    }
    if (wet) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(cx - w * .09, hy); ctx.lineTo(cx + w * .09, hy); ctx.lineTo(w * .96, h); ctx.lineTo(w * .04, h); ctx.closePath(); ctx.clip();
      for (let i = 0; i < 12; i++) {
        const t = .12 + i * .068, y = hy + t * (h - hy), spread = w * (.04 + t * .13);
        ctx.fillStyle = `rgba(203,220,220,${.025 + t * .045})`;
        ctx.beginPath(); ctx.ellipse(cx + (grain() - .5) * spread, y, w * (.002 + t * .009), h * (.002 + t * .009), -.04, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    // Perspective road repairs and fine tar seams add scale cues without a screen-wide noise filter.
    ctx.save();
    ctx.beginPath(); ctx.moveTo(cx - w * .09, hy); ctx.lineTo(cx + w * .09, hy); ctx.lineTo(w * .96, h); ctx.lineTo(w * .04, h); ctx.closePath();
    if (typeof ctx.clip === 'function') {
      ctx.clip();
      const repairs = seeded(this.scene.seed + 97);
      for (let i = 0; i < 14; i++) {
        const t = .18 + repairs() * .78, y = hy + t * (h - hy), spread = w * (.09 + t * .40);
        const x = cx + (repairs() - .5) * spread;
        ctx.strokeStyle = `rgba(17,22,23,${.10 + repairs() * .10})`;
        ctx.lineWidth = Math.max(.5, t * 1.6);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (repairs() - .5) * w * .035, y + h * (.006 + t * .008)); ctx.stroke();
      }
    }
    ctx.restore();
    if (this.scene.type === 'roundabout') this._drawRoundabout(ctx, w, h, cx, hy);
    else if (this.scene.type === 'intersection') this._drawIntersection(ctx, w, h, cx, hy);
    else this._drawBoulevardLanes(ctx, w, h, cx, hy);
  }

  _drawIntersection(ctx, w, h, cx, hy) {
    const jemursari = this.scene.variant === 'jemursari', barY = jemursari ? .665 : .70;
    ctx.fillStyle = 'rgba(224,222,207,.70)'; ctx.fillRect(w * .10, h * barY, w * .80, h * .009);
    ctx.fillStyle = 'rgba(244,242,227,.78)';
    for (let i = 0; i < 10; i++) {
      const x = w * (.12 + i * .076), stripeY = h * (barY + .024), stripeW = w * (.044 - i * .0009);
      ctx.beginPath(); ctx.moveTo(x, stripeY); ctx.lineTo(x + stripeW, stripeY); ctx.lineTo(x + stripeW * .78, stripeY + h * .055); ctx.lineTo(x + stripeW * .10, stripeY + h * .055); ctx.closePath(); ctx.fill();
    }
    if (!jemursari) {
      // Wonokromo frontage divider and planted median.
      ctx.fillStyle = 'rgba(176,171,147,.82)'; ctx.beginPath(); ctx.moveTo(cx - w * .012, hy + h * .06); ctx.lineTo(cx + w * .012, hy + h * .06); ctx.lineTo(cx + w * .025, h * .69); ctx.lineTo(cx - w * .025, h * .69); ctx.closePath(); ctx.fill();
      for (const t of [.20, .34, .48, .62]) this._drawTree(ctx, cx, hy + t * (h - hy), h * (.009 + t * .009));
    } else {
      // Jemursari's open cross traffic and near-side stop line.
      ctx.strokeStyle = 'rgba(236,238,226,.46)'; ctx.lineWidth = Math.max(1, w / 900);
      ctx.beginPath(); ctx.moveTo(w * .12, h * .61); ctx.lineTo(w * .88, h * .61); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(245,232,185,.72)'; ctx.lineWidth = Math.max(1, w / 500);
    ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(w * .5, h); ctx.moveTo(cx + w * .004, hy); ctx.lineTo(w * .5 + w * .009, h); ctx.stroke();
    for (const end of (jemursari ? [.24, .40, .60, .76] : [.30, .70])) {
      ctx.strokeStyle = 'rgba(236,238,226,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, hy + 2); ctx.lineTo(w * end, h); ctx.stroke();
    }
  }

  _drawBoulevardLanes(ctx, w, h, cx, hy) {
    ctx.strokeStyle = 'rgba(237,239,229,.58)'; ctx.lineWidth = 1;
    for (const end of [.27, .43, .57, .73]) {
      ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(w * end, h); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(243,194,88,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(w * .50, h); ctx.stroke();
  }

  _drawRoundabout(ctx, w, h, cx, hy) {
    ctx.fillStyle = '#777c65'; ctx.beginPath(); ctx.ellipse(cx, h * .57, w * .16, h * .075, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d0d0b8'; ctx.lineWidth = h * .018; ctx.beginPath();
    ctx.ellipse(cx, h * .58, w * .24, h * .13, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(237,239,229,.65)'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.ellipse(cx, h * .58, w * .20, h * .105, 0, .15, Math.PI * 1.9); ctx.stroke();
    ctx.fillStyle = '#6d765c';
    for (let i = 0; i < 7; i++) { const a = i * .87; this._drawTree(ctx, cx + Math.cos(a) * w * .105, h * .57 + Math.sin(a) * h * .035, h * .018); }
  }

  _drawTree(ctx, x, y, size) {
    ctx.fillStyle = 'rgba(31,48,36,.8)'; ctx.fillRect(x - size * .08, y, size * .16, size * .62);
    ctx.fillStyle = '#426149'; ctx.beginPath(); ctx.arc(x, y - size * .15, size * .52, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(148,164,119,.32)'; ctx.beginPath(); ctx.arc(x - size * .14, y - size * .28, size * .20, 0, Math.PI * 2); ctx.fill();
  }

  _drawStreetFurniture(ctx, w, h, cx, hy) {
    const random = seeded(this.scene.seed + 7);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const t = .12 + i * .16, y = hy + t * (h - hy), x = cx + side * (w * (.12 + t * .42));
        const size = h * (.014 + t * .045);
        if (this.scene.trees) this._drawTree(ctx, x, y, size * 2.4);
        else {
          ctx.fillStyle = '#727775'; ctx.fillRect(x - size * .08, y - size * 1.6, size * .16, size * 1.6);
          ctx.fillStyle = '#c7c5b0'; ctx.fillRect(x - size * .56, y - size * 1.8, size * 1.12, size * .24);
          if (random() > .45) { ctx.fillStyle = '#d5ceb0'; ctx.fillRect(x + side * size * .7, y - size * 1.7, size * .9, size * .48); }
        }
      }
    }
    if (this.scene.signal) {
      const x = w * .78, y = h * .58;
      ctx.fillStyle = '#303638'; ctx.fillRect(x, y, w * .006, h * .17);
      ctx.fillStyle = '#202629'; ctx.beginPath(); ctx.roundRect?.(x - 5, y - 13, 11, 24, 3); ctx.fill();
    }
    // A few tropical trees also frame camera 1 and 4 junctions.
    if (this.scene.type === 'intersection') {
      this._drawTree(ctx, w * .045, h * .62, h * .08); this._drawTree(ctx, w * .95, h * .56, h * .10);
    }
  }

  _drawNightLighting(ctx, w, h) {
    for (const x of [w * .12, w * .88]) {
      const glow = ctx.createRadialGradient(x, h * .45, 1, x, h * .45, w * .18);
      glow.addColorStop(0, 'rgba(255,220,156,.15)'); glow.addColorStop(1, 'rgba(255,220,156,0)');
      ctx.fillStyle = glow; ctx.fillRect(x - w * .18, h * .25, w * .36, h * .45);
    }
  }

  _drawSignal(ctx, w, h, state) {
    if (!this.scene.signal) return;
    const x = w * .78 + .5, y = h * .58 - 8;
    const phase = String(state || 'none').toLowerCase();
    const activeColor = phase === 'red' ? '#ff514b' : phase === 'yellow' || phase === 'yield' ? '#ffc44f' : phase === 'green' ? '#4ee0a6' : null;
    for (const lamp of SIGNAL_LAMPS) {
      const enabled = phase === lamp.phase || (phase === 'yield' && lamp.phase === 'yellow');
      ctx.fillStyle = enabled ? lamp.color : 'rgba(11,15,17,.92)';
      ctx.beginPath(); ctx.arc(x, y + lamp.dy, 2.1, 0, Math.PI * 2); ctx.fill();
    }
    if (activeColor && this.environment.timeOfDay === 'night') {
      const glow = ctx.createRadialGradient(x, y + (phase === 'green' ? 14 : phase === 'yellow' || phase === 'yield' ? 7 : 0), 0, x, y + (phase === 'green' ? 14 : phase === 'yellow' || phase === 'yield' ? 7 : 0), 16);
      glow.addColorStop(0, `${activeColor}66`); glow.addColorStop(1, `${activeColor}00`);
      ctx.fillStyle = glow; ctx.fillRect(x - 16, y - 16, 32, 48);
    }
  }

  _drawRain(ctx, w, h, count) {
    ctx.strokeStyle = this.environment.weather === 'heavy-rain' ? 'rgba(210,222,226,.19)' : 'rgba(218,229,232,.13)';
    ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const streak = this._rainStreaks[i];
      const speed = 2 + streak.speed * (this.environment.weather === 'heavy-rain' ? 7 : 4);
      const x = streak.x * w, y = (streak.y * h + this._frame * speed) % h;
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + (this.environment.weather === 'heavy-rain' ? 10 : 6));
    }
    ctx.stroke();
  }

  _vehiclePosition(vehicle, position = {}) {
    if (Number.isFinite(vehicle.x) && Number.isFinite(vehicle.y)) {
      position.x = vehicle.x + vehicle.w / 2; position.y = vehicle.y + vehicle.h / 2;
      position.angle = vehicle.direction < 0 ? 0 : Math.PI; position.depth = clamp(vehicle.h / .075, .42, 1.2);
      return position;
    }
    const t = vehicle.progress;
    if (this.scene.type === 'roundabout') {
      const angle = t * Math.PI * 2 + vehicle.phase;
      const rx = .14 + (vehicle.lane % 2) * .035, ry = .08 + (vehicle.lane % 2) * .018;
      position.x = .5 + Math.cos(angle) * rx; position.y = .58 + Math.sin(angle) * ry;
      position.angle = angle + Math.PI / 2; position.depth = .45 + (Math.sin(angle) + 1) * .22;
      return position;
    }
    const y = this.scene.horizon + .18 + t * .55;
    const spread = .08 + t * .36;
    let laneOffset = [-.58, -.20, .20, .58][vehicle.lane];
    let x = .49 + laneOffset * spread;
    if (this.scene.type === 'boulevard') x = .5 + laneOffset * (.15 + t * .30);
    if (vehicle.direction < 0) x = .49 - laneOffset * spread;
    position.x = x; position.y = y; position.angle = vehicle.direction < 0 ? Math.PI : 0; position.depth = .42 + t * .82;
    return position;
  }

  _drawVehicle(ctx, vehicle, pos, w, h) {
    const depth = clamp(pos.depth, .44, 1.25);
    const typeSize = { car: 1, motorcycle: .58, bus: 1.48, truck: 1.34, ambulance: 1.08 }[vehicle.type] || 1;
    const width = Number.isFinite(vehicle.w) ? vehicle.w * w * .84 : w * .034 * depth * typeSize;
    const height = Number.isFinite(vehicle.h) ? vehicle.h * h * .84 : h * .026 * depth * typeSize;
    const x = pos.x * w, y = pos.y * h;
    const isNight = this.environment.timeOfDay === 'night';
    const isWet = this.environment.weather.includes('rain');

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pos.angle);

    // Wet asphalt mirror reflection with directional ground spread
    if (isWet) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const reflectionGrad = ctx.createLinearGradient(0, height * .1, 0, height * 1.1);
      reflectionGrad.addColorStop(0, isNight ? 'rgba(255,214,140,.24)' : 'rgba(180,210,218,.16)');
      reflectionGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = reflectionGrad;
      ctx.beginPath();
      ctx.ellipse(0, height * .48, width * .42, height * .78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Soft multi-layered ambient contact shadow
    ctx.fillStyle = 'rgba(4,8,10,.38)';
    ctx.beginPath();
    ctx.ellipse(0, height * .16, width * .66, height * .44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(2,4,6,.22)';
    ctx.beginPath();
    ctx.ellipse(0, height * .16, width * .74, height * .52, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4 detailed tires with hub caps & tire tread accents
    const tireW = Math.max(1.2, width * .13), tireH = Math.max(1.5, height * .24);
    for (const tx of [-.41, .41]) {
      for (const ty of [-.19, .19]) {
        ctx.fillStyle = '#111516';
        ctx.beginPath();
        ctx.ellipse(width * tx, height * ty, tireW * .5, tireH * .5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(185,195,193,.75)';
        ctx.beginPath();
        ctx.arc(width * tx, height * ty, Math.max(.7, tireW * .22), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Chassis body with sculpted curvature
    const baseColor = vehicle.type === 'ambulance' ? '#f0f3ee' : vehicle.color;
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(-width * .48, height * .35);
    ctx.lineTo(-width * .53, height * .12);
    ctx.lineTo(-width * .48, -height * .25);
    ctx.lineTo(-width * .29, -height * .41);
    ctx.quadraticCurveTo(0, -height * .47, width * .29, -height * .41);
    ctx.lineTo(width * .48, -height * .25);
    ctx.lineTo(width * .53, height * .12);
    ctx.lineTo(width * .48, height * .35);
    ctx.closePath();
    ctx.fill();

    // Side metallic gradient bevel
    const bevelGrad = ctx.createLinearGradient(-width * .5, 0, width * .5, 0);
    bevelGrad.addColorStop(0, 'rgba(0,0,0,.22)');
    bevelGrad.addColorStop(.15, 'rgba(255,255,255,.18)');
    bevelGrad.addColorStop(.85, 'rgba(255,255,255,.12)');
    bevelGrad.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.fillStyle = bevelGrad;
    ctx.fill();

    // Aerodynamic tinted glass cabin & windshield
    const cabin = ctx.createLinearGradient(-width * .26, -height * .35, width * .26, height * .04);
    cabin.addColorStop(0, 'rgba(145,178,182,.96)');
    cabin.addColorStop(.35, 'rgba(38,62,69,.98)');
    cabin.addColorStop(1, 'rgba(18,32,38,.99)');
    ctx.fillStyle = cabin;
    ctx.beginPath();
    ctx.moveTo(-width * .30, -height * .27);
    ctx.lineTo(-width * .19, -height * .37);
    ctx.quadraticCurveTo(0, -height * .41, width * .19, -height * .37);
    ctx.lineTo(width * .30, -height * .27);
    ctx.lineTo(width * .31, height * .11);
    ctx.lineTo(-width * .31, height * .11);
    ctx.closePath();
    ctx.fill();

    // Center roof ridge highlight
    ctx.strokeStyle = 'rgba(230,242,240,.40)';
    ctx.lineWidth = Math.max(.7, width * .014);
    ctx.beginPath();
    ctx.moveTo(0, -height * .35);
    ctx.lineTo(0, height * .09);
    ctx.stroke();

    // Rear window glare strip
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.beginPath();
    ctx.moveTo(-width * .44, height * .19);
    ctx.lineTo(width * .44, height * .19);
    ctx.lineTo(width * .40, height * .28);
    ctx.lineTo(-width * .40, height * .28);
    ctx.closePath();
    ctx.fill();

    // Night headlights & realistic roadway light cones
    if (isNight) {
      const cone = ctx.createRadialGradient(0, -height * .52, 0, 0, -height * 2.2, height * 4.0);
      cone.addColorStop(0, isWet ? 'rgba(255,232,165,.22)' : 'rgba(255,232,165,.14)');
      cone.addColorStop(.4, isWet ? 'rgba(255,220,140,.09)' : 'rgba(255,220,140,.05)');
      cone.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(-width * .25, -height * .36);
      ctx.lineTo(-width * 1.35, -height * 4.4);
      ctx.lineTo(width * 1.35, -height * 4.4);
      ctx.lineTo(width * .25, -height * .36);
      ctx.closePath();
      ctx.fill();
    }

    // Headlight emitter lenses
    ctx.fillStyle = isNight ? '#fff5cf' : '#ece4cb';
    ctx.fillRect(-width * .38, -height * .37, width * .14, height * .06);
    ctx.fillRect(width * .24, -height * .37, width * .14, height * .06);

    // Brake / Tail lights (dynamic glowing red if braking)
    if (vehicle.braking) {
      ctx.fillStyle = '#ff3b30';
      ctx.fillRect(-width * .44, height * .26, width * .12, height * .085);
      ctx.fillRect(width * .32, height * .26, width * .12, height * .085);
      // Brake flare
      const flare = ctx.createRadialGradient(0, height * .32, 0, 0, height * .32, width * .65);
      flare.addColorStop(0, 'rgba(255,59,48,.25)');
      flare.addColorStop(1, 'rgba(255,59,48,0)');
      ctx.fillStyle = flare;
      ctx.fillRect(-width * .6, height * .18, width * 1.2, height * .3);
    } else {
      ctx.fillStyle = isNight ? '#d93829' : '#88322c';
      ctx.fillRect(-width * .43, height * .26, width * .10, height * .075);
      ctx.fillRect(width * .33, height * .26, width * .10, height * .075);
    }

    // Vehicle specific overlays
    if (vehicle.type === 'bus') {
      ctx.fillStyle = 'rgba(24,46,52,.92)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(-width * .36 + i * width * .15, -height * .26, width * .11, height * .12);
      }
    } else if (vehicle.type === 'truck') {
      ctx.fillStyle = '#6b7270';
      ctx.fillRect(-width * .11, -height * .33, width * .50, height * .51);
      ctx.strokeStyle = '#525856';
      ctx.strokeRect(-width * .11, -height * .33, width * .50, height * .51);
    } else if (vehicle.type === 'motorcycle') {
      ctx.fillStyle = '#23292a';
      ctx.beginPath();
      ctx.arc(0, -height * .1, height * .28, 0, Math.PI * 2);
      ctx.fill();
    } else if (vehicle.type === 'ambulance') {
      ctx.fillStyle = '#d93829';
      ctx.fillRect(-width * .09, height * .04, width * .22, height * .085);
      // Flashing emergency siren bar
      const sirenColor = (Math.floor(Date.now() / 240) % 2 === 0) ? '#ff3b30' : '#007aff';
      ctx.fillStyle = sirenColor;
      ctx.fillRect(-width * .09, -height * .43, width * .18, height * .055);
    }

    ctx.restore();
  }

  _drawDetectionOverlay(ctx, w, h, dt) {
    const drawnLabels = [];
    const lerp = SmoothingEngine.computeLerpFactor(dt, 12);
    this.trackedBoxes.forEach((box) => {
      const speed = box.speedKmh || 40;
      if (typeof box.localSpeedKmh !== 'number') box.localSpeedKmh = speed;
      box.localSpeedKmh = Math.min(speed, box.localSpeedKmh + dt * 14);
      SmoothingEngine.smoothBox(box, lerp, 1);
      const bw = box.w * w, bh = box.h * h;
      const x = box.x * w, y = box.y * h;
      const cls = String(box.class || 'car').toLowerCase(), color = CLASS_COLORS[cls] || '#7dd3fc';

      // Crisp cornered bounding box styling
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, w / 850);
      ctx.strokeRect(x, y, bw, bh);

      // Corner notch accents for high-tech CCTV HUD aesthetic
      const corner = Math.min(bw * .22, bh * .22, 6);
      ctx.lineWidth = Math.max(1.8, w / 600);
      ctx.beginPath();
      ctx.moveTo(x, y + corner); ctx.lineTo(x, y); ctx.lineTo(x + corner, y);
      ctx.moveTo(x + bw - corner, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + corner);
      ctx.moveTo(x + bw, y + bh - corner); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - corner, y + bh);
      ctx.moveTo(x + corner, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - corner);
      ctx.stroke();

      const rawId = String(box.trackId || box.id || 'SIM');
      const id = rawId.match(/\d+$/)?.[0] ? `#${rawId.match(/\d+$/)[0].padStart(2, '0')}` : rawId.slice(0, 8);
      const shortClass = ({ motorcycle: 'MOTO', ambulance: 'AMB' })[cls] || cls.toUpperCase();
      const text = `${id} ${shortClass} ${Math.round(box.localSpeedKmh)} km/h`;
      ctx.font = `600 ${Math.max(8, w / 115)}px sans-serif`;
      const labelW = ctx.measureText(text).width + 8, labelH = Math.max(14, h / 27);

      // Intelligent anti-collision candidates: above, below, right-shifted, or clamped inside
      const candidates = [
        y - labelH - 3,
        y + bh + 3,
        y - (labelH + 4) * 2,
        y + bh + labelH + 4,
        y + 2
      ];

      let chosenY = null;
      let chosenX = x;
      for (const candY of candidates) {
        if (candY < 22 || candY + labelH > h - 4) continue;
        const testX = clamp(x, 4, w - labelW - 4);
        const collides = drawnLabels.some((r) =>
          testX < r.x + r.w && testX + labelW > r.x && candY < r.y + r.h && candY + labelH > r.y
        );
        if (!collides) {
          chosenY = candY;
          chosenX = testX;
          break;
        }
      }

      if (chosenY !== null) {
        drawnLabels.push({ x: chosenX, y: chosenY, w: labelW, h: labelH });
        ctx.fillStyle = 'rgba(9,16,18,.82)';
        ctx.fillRect(chosenX, chosenY, labelW, labelH);
        ctx.fillStyle = color;
        ctx.fillRect(chosenX, chosenY, 2.5, labelH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, chosenX + 5, chosenY + labelH * .72);
      }
    });
  }

  render(isChaosMode, isPaused, showBoxes, dt = .016, metrics = {}, diagnostics = {}, status = 'ONLINE', signalState = 'green', provenance = 'SIMULATED') {
    if (!this.canvas || !this.ctx) {
      if (typeof document !== 'undefined') { this.canvas = document.getElementById(this.canvasId); this.ctx = this.canvas?.getContext('2d') || null; }
      if (!this.ctx) return;
    }
    const renderStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { width: w, height: h } = this._dimensions();
    const ctx = this.ctx;
    this._frame++;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.fpsCounter++;
    if (!this.fpsTimer) this.fpsTimer = now;
    if (now - this.fpsTimer >= 1000) { this.renderFps = Math.min(60, Math.round(this.fpsCounter * 1000 / (now - this.fpsTimer))); this.fpsCounter = 0; this.fpsTimer = now; }
    this._ensureScene(w, h);
    ctx.save();
    if (this.filterMode === 'mono') ctx.filter = 'grayscale(1) contrast(1.08)';
    else if (this.filterMode === 'night') ctx.filter = 'brightness(.72) hue-rotate(178deg) saturate(1.15)';
    else if (this.filterMode === 'thermal') ctx.filter = 'invert(.82) hue-rotate(238deg) saturate(1.8)';
    else ctx.filter = 'contrast(1.02) saturate(.96)';
    if (this._sceneCanvas) ctx.drawImage(this._sceneCanvas, 0, 0, w, h);
    else this._drawEnvironment(ctx, w, h);
    if (this.environment.weather.includes('rain')) this._drawRain(ctx, w, h, this.environment.weather === 'heavy-rain' ? 100 : 45);
    this._drawSignal(ctx, w, h, signalState);

    const alpha = isPaused ? 0 : 1 - Math.exp(-Math.max(.001, dt) * 9);
    const positioned = this._positioned;
    positioned.length = 0;
    for (let index = 0; index < this.vehicles.length; index++) {
      const vehicle = this.vehicles[index];
      const id = String(vehicle.trackId || vehicle.id || `anonymous-${index}`);
      let visual = this._vehicleVisuals.get(id);
      if (!visual) {
        visual = this._vehiclePosition(vehicle);
        visual.target = { x: visual.x, y: visual.y, depth: visual.depth, angle: visual.angle };
        visual.vehicle = vehicle;
        this._vehicleVisuals.set(id, visual);
      } else {
        this._vehiclePosition(vehicle, visual.target);
        visual.vehicle = vehicle;
      }
      if (visual.target !== visual) {
        const target = visual.target;
        if (!visual.initialized) {
          visual.x = target.x; visual.y = target.y; visual.depth = target.depth; visual.angle = target.angle;
          visual.initialized = true;
        } else {
          visual.x += (target.x - visual.x) * alpha;
          visual.y += (target.y - visual.y) * alpha;
          visual.depth += (target.depth - visual.depth) * alpha;
          visual.angle += (target.angle - visual.angle) * alpha;
        }
      }
      positioned.push(visual);
    }
    positioned.sort(compareVehicleDepth);
    for (let index = 0; index < positioned.length; index++) {
      const visual = positioned[index];
      this._drawVehicle(ctx, visual.vehicle, visual, w, h);
    }
    if (showBoxes) this._drawDetectionOverlay(ctx, w, h, dt);

    // Mild sensor texture/noise, deliberately restrained.
    if (this._frame % 3 === 0) {
      ctx.fillStyle = 'rgba(220,230,220,.018)';
      const seed = seeded(this.scene.seed + this._frame);
      for (let i = 0; i < 24; i++) ctx.fillRect(seed() * w, seed() * h, 1, 1);
    }
    if (isChaosMode) { ctx.fillStyle = 'rgba(140,35,30,.035)'; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
    this._drawOsd(ctx, w, h, metrics, status, isPaused, provenance);
    const renderEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const renderDuration = renderEnd - renderStart;
    this._renderDurations[this._renderDurationCursor] = renderDuration;
    this._renderDurationCursor = (this._renderDurationCursor + 1) % this._renderDurations.length;
    this._renderDurationCount = Math.min(this._renderDurationCount + 1, this._renderDurations.length);
    if (this.canvas.dataset) {
      this.canvas.dataset.renderFps = String(this.renderFps);
      this.canvas.dataset.renderFrameMs = renderDuration.toFixed(3);
      if (now >= this._nextStatsAt) {
        const samples = Array.from(this._renderDurations.subarray(0, this._renderDurationCount));
        samples.sort((a, b) => a - b);
        const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * .95))] || 0;
        this.canvas.dataset.renderP95Ms = p95.toFixed(3);
        this.canvas.dataset.sceneVehicles = String(this.vehicles.length);
        this._nextStatsAt = now + 1000;
      }
    }
    if (now - this._resolutionSampleAt >= 3000 && this.fpsTimer) {
      if (this.renderFps < this.targetFps - 5) this._resolutionScale = clamp(this._resolutionScale - .15, .65, 1.5);
      else if (this.renderFps >= this.targetFps + 3) this._resolutionScale = clamp(this._resolutionScale + .05, .65, 1.5);
      this._resolutionSampleAt = now;
    }
  }

  _drawOsd(ctx, w, h, metrics, status, isPaused, provenance) {
    const meta = cameraRegistry.getMetadata(this.canvasId);
    const code = meta?.code || this.canvasId.replace('cctvCanvas', 'CAM-0') || 'CAM-01';
    if (!this._osdGradient) {
      this._osdGradient = ctx.createLinearGradient(0, 0, 0, 34);
      this._osdGradient.addColorStop(0, 'rgba(9,15,17,.62)');
      this._osdGradient.addColorStop(1, 'rgba(9,15,17,0)');
    }
    const gradient = this._osdGradient;
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, 36);
    const provenanceLabel = this.filterMode === 'night' ? 'SIM · NIGHT VISION' : this.filterMode === 'thermal' ? 'SIM · THERMAL' : provenance === 'LIVE' ? 'LIVE FEED' : 'SIMULATED';
    ctx.fillStyle = 'rgba(9,18,19,.72)'; ctx.fillRect(9, 8, this.filterMode === 'none' ? 92 : 136, 17);
    ctx.fillStyle = '#c9d6d2'; ctx.font = `600 ${Math.max(8, w / 100)}px sans-serif`;
    ctx.fillText(provenanceLabel, 15, 20);
    ctx.fillStyle = '#f2f4ed'; ctx.fillText(`${code}  ·  ${meta?.shortName || this.cameraName}`, 112, 20);
    const second = Math.floor(Date.now() / 1000);
    if (second !== this._osdTimestampSecond) {
      const date = new Date(second * 1000);
      this._osdTimestamp = `${date.toLocaleDateString('en-CA')} ${date.toLocaleTimeString('en-GB')}`;
      this._osdTimestampSecond = second;
    }
    ctx.textAlign = 'right'; ctx.fillText(this._osdTimestamp, w - 10, 20); ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(7,14,16,.62)'; ctx.fillRect(10, h - 31, 172, 20);
    ctx.fillStyle = '#d3ddd8'; ctx.font = `600 ${Math.max(8, w / 110)}px sans-serif`;
    ctx.fillText(`SIM · ${this.renderFps} FPS · ${this.vehicles.length} SCENE VEH`, 17, h - 18);
    if (isPaused || status === 'OFFLINE' || status === 'STALE') {
      ctx.fillStyle = 'rgba(5,10,12,.58)'; ctx.fillRect(0, 0, w, h);
      const message = status === 'OFFLINE' ? 'CAMERA OFFLINE' : status === 'STALE' ? 'STREAM STALE · SIMULATED' : 'SIMULATION PAUSED';
      ctx.fillStyle = status === 'OFFLINE' ? '#ffc0b8' : '#f5d38d'; ctx.textAlign = 'center';
      ctx.font = `600 ${Math.max(13, w / 35)}px sans-serif`; ctx.fillText(message, w / 2, h / 2); ctx.textAlign = 'left';
    }
  }
}
