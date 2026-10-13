/**
 * Procedural CCTV scene renderer. Scene traffic is independent from the synthetic
 * detection/tracking pipeline so hiding detections never hides vehicles.
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
  cctvCanvas4: { type: 'intersection', seed: 4404, horizon: .30, roadTop: .19, roadBottom: .90, skyline: 3, trees: false, signal: true, label: 'JEMURSARI' }
});

export function getCameraScene(canvasId) {
  const scene = CAMERA_SCENES[canvasId] || CAMERA_SCENES.cctvCanvas1;
  return { ...scene };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const seeded = (seed) => {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
};

const VEHICLE_PALETTES = ['#d9dfdf', '#b7c1c4', '#4e6876', '#7d463d', '#d4a84f', '#344c58', '#899385', '#e5e2d8'];
const VEHICLE_TYPES = ['car', 'car', 'car', 'motorcycle', 'car', 'bus', 'truck', 'car', 'ambulance'];

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
    this.vehicles = this._createVehicles(this.scene.seed);
    this.renderFps = 0;
    this.fpsCounter = 0;
    this.fpsTimer = 0;
    this._cachedWidth = 0;
    this._cachedHeight = 0;
    this._sceneCanvas = null;
    this._sceneKey = '';
    this._osdGradient = null;
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
    if (['morning', 'day', 'evening', 'night'].includes(timeOfDay)) this.environment.timeOfDay = timeOfDay;
    if (['clear', 'cloudy', 'light-rain', 'heavy-rain'].includes(weather)) this.environment.weather = weather;
  }

  captureSnapshot() {
    if (!this.canvas) return null;
    try { return this.canvas.toDataURL('image/png'); } catch (_) { return null; }
  }
  updateBoxes(boxes) { this._trackingEngine.updateBoxes(boxes); }
  clear() { this._trackingEngine.clear(); }

  _createVehicles(seed) {
    const random = seeded(seed);
    return Array.from({ length: 17 }, (_, index) => ({
      id: `${this.canvasId}-v${index + 1}`,
      type: VEHICLE_TYPES[Math.floor(random() * VEHICLE_TYPES.length)],
      lane: Math.floor(random() * 4), direction: index % 6 === 0 ? -1 : 1,
      progress: random(), speed: .018 + random() * .027, phase: random() * Math.PI * 2,
      color: VEHICLE_PALETTES[Math.floor(random() * VEHICLE_PALETTES.length)],
      braking: false
    }));
  }

  _dimensions() {
    const rect = this.canvas.getBoundingClientRect?.();
    const cssWidth = Math.max(1, Math.round(rect?.width || this.canvas.clientWidth || this.canvas.width || 640));
    const cssHeight = Math.max(1, Math.round(rect?.height || this.canvas.clientHeight || this.canvas.height || 360));
    const dpr = clamp(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1, 1.5);
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
    const key = `${width}x${height}:${this.environment.timeOfDay}:${this.environment.weather}:${this.scene.type}`;
    if (this._sceneCanvas && this._sceneKey === key) return;
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    if (typeof canvas.getContext !== 'function') return;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this._drawEnvironment(ctx, width, height);
    this._sceneCanvas = canvas;
    this._sceneKey = key;
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
    if (rain) this._drawRain(ctx, w, h, this.environment.weather === 'heavy-rain' ? 100 : 45);
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
    ctx.fillStyle = '#687267'; ctx.fillRect(0, hy, w, h - hy);
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
    if (this.scene.type === 'roundabout') this._drawRoundabout(ctx, w, h, cx, hy);
    else if (this.scene.type === 'intersection') this._drawIntersection(ctx, w, h, cx, hy);
    else this._drawBoulevardLanes(ctx, w, h, cx, hy);
  }

  _drawIntersection(ctx, w, h, cx, hy) {
    ctx.fillStyle = 'rgba(226,225,211,.68)'; ctx.fillRect(w * .10, h * .70, w * .80, h * .012);
    ctx.fillStyle = 'rgba(242,241,229,.62)';
    for (let i = 0; i < 10; i++) ctx.fillRect(w * (.12 + i * .076), h * .72, w * .045, h * .045);
    ctx.strokeStyle = 'rgba(245,232,185,.72)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(w * .5, h); ctx.moveTo(cx + 3, hy); ctx.lineTo(w * .5 + 5, h); ctx.stroke();
    for (const end of [.30, .70]) {
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
      ctx.fillStyle = '#b74637'; ctx.beginPath(); ctx.arc(x + .5, y - 8, 2, 0, Math.PI * 2); ctx.fill();
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

  _drawRain(ctx, w, h, count) {
    const random = seeded(this.scene.seed + this._frame % 5);
    ctx.strokeStyle = this.environment.weather === 'heavy-rain' ? 'rgba(210,222,226,.19)' : 'rgba(218,229,232,.13)';
    ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = random() * w, y = random() * h;
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + (this.environment.weather === 'heavy-rain' ? 10 : 6));
    }
    ctx.stroke();
  }

  _vehiclePosition(vehicle) {
    const t = vehicle.progress;
    if (this.scene.type === 'roundabout') {
      const angle = t * Math.PI * 2 + vehicle.phase;
      const rx = .14 + (vehicle.lane % 2) * .035, ry = .08 + (vehicle.lane % 2) * .018;
      return { x: .5 + Math.cos(angle) * rx, y: .58 + Math.sin(angle) * ry, angle: angle + Math.PI / 2, depth: .45 + (Math.sin(angle) + 1) * .22 };
    }
    const y = this.scene.horizon + .18 + t * .55;
    const spread = .08 + t * .36;
    let laneOffset = [-.58, -.20, .20, .58][vehicle.lane];
    let x = .49 + laneOffset * spread;
    if (this.scene.type === 'boulevard') x = .5 + laneOffset * (.15 + t * .30);
    if (vehicle.direction < 0) x = .49 - laneOffset * spread;
    return { x, y, angle: vehicle.direction < 0 ? Math.PI : 0, depth: .42 + t * .82 };
  }

  _drawVehicle(ctx, vehicle, pos, w, h) {
    const depth = clamp(pos.depth, .44, 1.2);
    const typeSize = { car: 1, motorcycle: .62, bus: 1.42, truck: 1.28, ambulance: 1.05 }[vehicle.type] || 1;
    const width = w * .034 * depth * typeSize, height = h * .026 * depth * typeSize;
    const x = pos.x * w, y = pos.y * h;
    ctx.save(); ctx.translate(x, y); ctx.rotate(pos.angle);
    // Ground shadow and tires.
    ctx.fillStyle = 'rgba(8,12,12,.38)'; ctx.beginPath(); ctx.ellipse(0, height * .20, width * .62, height * .30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#171b1b'; ctx.fillRect(-width * .43, -height * .17, width * .86, height * .38);
    // Curved body silhouette with roof and glass.
    ctx.fillStyle = vehicle.type === 'ambulance' ? '#e6e7df' : vehicle.color;
    ctx.beginPath(); ctx.moveTo(-width * .50, height * .24); ctx.quadraticCurveTo(-width * .62, 0, -width * .43, -height * .25);
    ctx.lineTo(-width * .22, -height * .38); ctx.quadraticCurveTo(0, -height * .47, width * .24, -height * .34);
    ctx.lineTo(width * .46, -height * .17); ctx.quadraticCurveTo(width * .57, 0, width * .48, height * .23); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(38,60,67,.92)'; ctx.beginPath();
    ctx.moveTo(-width * .23, -height * .29); ctx.lineTo(width * .18, -height * .28); ctx.lineTo(width * .33, -height * .10);
    ctx.lineTo(-width * .34, -height * .10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(-width * .38, height * .13, width * .70, height * .035);
    ctx.fillStyle = this.environment.timeOfDay === 'night' ? '#fff1bd' : '#f1dfb0';
    ctx.fillRect(-width * .35, -height * .29, width * .12, height * .07); ctx.fillRect(width * .25, -height * .28, width * .12, height * .07);
    ctx.fillStyle = vehicle.braking ? '#fa5448' : '#a7443d';
    ctx.fillRect(-width * .43, height * .14, width * .10, height * .08); ctx.fillRect(width * .34, height * .14, width * .10, height * .08);
    if (vehicle.type === 'bus') {
      ctx.fillStyle = 'rgba(29,53,60,.85)';
      for (let i = 0; i < 4; i++) ctx.fillRect(-width * .34 + i * width * .17, -height * .25, width * .12, height * .12);
    } else if (vehicle.type === 'truck') {
      ctx.fillStyle = '#777c78'; ctx.fillRect(-width * .10, -height * .32, width * .48, height * .49);
    } else if (vehicle.type === 'motorcycle') {
      ctx.fillStyle = '#292f30'; ctx.beginPath(); ctx.arc(0, -height * .1, height * .28, 0, Math.PI * 2); ctx.fill();
    } else if (vehicle.type === 'ambulance') {
      ctx.fillStyle = '#c94f48'; ctx.fillRect(-width * .08, height * .05, width * .2, height * .08);
      ctx.fillStyle = '#d94b41'; ctx.fillRect(-width * .08, -height * .42, width * .16, height * .045);
    }
    ctx.restore();
  }

  _drawDetectionOverlay(ctx, w, h, dt) {
    const drawnLabels = [];
    const lerp = SmoothingEngine.computeLerpFactor(dt, 12);
    this.trackedBoxes.forEach((box) => {
      const trackKey = String(box.trackId || box.id || 'SIM');
      if (box._simVehicleTrackId !== trackKey) {
        box._simVehicleTrackId = trackKey;
        box._simVehicleIndex = null;
      }
      const speed = box.speedKmh || 40;
      if (typeof box.localSpeedKmh !== 'number') box.localSpeedKmh = speed;
      box.localSpeedKmh = Math.min(speed, box.localSpeedKmh + dt * 14);
      SmoothingEngine.smoothBox(box, lerp, 1);
      if (box._simVehicleIndex == null && this.vehicles.length) {
        const used = new Set([...this.trackedBoxes.values()].map((track) => track._simVehicleIndex).filter(Number.isInteger));
        let candidate = (this._nextVehicleAssociation || 0) % this.vehicles.length;
        while (used.has(candidate) && used.size < this.vehicles.length) candidate = (candidate + 1) % this.vehicles.length;
        box._simVehicleIndex = candidate;
        this._nextVehicleAssociation = candidate + 1;
      }
      const vehicle = this.vehicles[box._simVehicleIndex];
      const pos = vehicle ? this._vehiclePosition(vehicle) : null;
      const depth = pos ? clamp(pos.depth, .44, 1.2) : 1;
      const classKey = String(box.class || vehicle?.type || 'car').toLowerCase();
      const size = { car: 1, motorcycle: .62, bus: 1.42, truck: 1.28, ambulance: 1.05 }[classKey] || 1;
      const bw = pos ? w * .034 * depth * size * 1.22 : box.w * w;
      const bh = pos ? h * .026 * depth * size * 1.75 : box.h * h;
      const x = pos ? pos.x * w - bw / 2 : box.x * w;
      const y = pos ? pos.y * h - bh * .58 : box.y * h;
      const cls = classKey, color = CLASS_COLORS[cls] || '#7dd3fc';
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, w / 900); ctx.strokeRect(x, y, bw, bh);
      const rawId = String(box.trackId || box.id || 'SIM');
      const id = rawId.match(/\d+$/)?.[0] ? `TRK ${rawId.match(/\d+$/)[0].padStart(2, '0')}` : rawId.slice(0, 12);
      const text = `${id} · ${cls.toUpperCase()} · ${Math.round(box.localSpeedKmh)} km/h`;
      ctx.font = `${Math.max(8, w / 90)}px sans-serif`;
      const labelW = ctx.measureText(text).width + 8, labelH = Math.max(14, h / 24);
      let labelY = Math.max(24, y - labelH - 2);
      while (drawnLabels.some((r) => x < r.x + r.w && x + labelW > r.x && labelY < r.y + r.h && labelY + labelH > r.y)) labelY += labelH;
      drawnLabels.push({ x, y: labelY, w: labelW, h: labelH });
      ctx.fillStyle = 'rgba(13,20,21,.78)'; ctx.fillRect(x, labelY, labelW, labelH);
      ctx.fillStyle = '#fff'; ctx.fillText(text, x + 4, labelY + labelH * .72);
    });
  }

  render(isChaosMode, isPaused, showBoxes, dt = .016, metrics = {}, diagnostics = {}, status = 'ONLINE', signalState = 'green', provenance = 'SIMULATED') {
    if (!this.canvas || !this.ctx) {
      if (typeof document !== 'undefined') { this.canvas = document.getElementById(this.canvasId); this.ctx = this.canvas?.getContext('2d') || null; }
      if (!this.ctx) return;
    }
    const { width: w, height: h } = this._dimensions();
    const ctx = this.ctx;
    this._frame++;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.fpsCounter++;
    if (!this.fpsTimer) this.fpsTimer = now;
    if (now - this.fpsTimer >= 1000) { this.renderFps = Math.round(this.fpsCounter * 1000 / (now - this.fpsTimer)); this.fpsCounter = 0; this.fpsTimer = now; }
    this._ensureScene(w, h);
    ctx.save();
    if (this.filterMode === 'mono') ctx.filter = 'grayscale(1) contrast(1.08)';
    else if (this.filterMode === 'night') ctx.filter = 'brightness(.72) hue-rotate(178deg) saturate(1.15)';
    else if (this.filterMode === 'thermal') ctx.filter = 'invert(.82) hue-rotate(238deg) saturate(1.8)';
    else ctx.filter = 'none';
    if (this._sceneCanvas) ctx.drawImage(this._sceneCanvas, 0, 0, w, h);
    else this._drawEnvironment(ctx, w, h);

    this.vehicles.forEach((vehicle) => {
      const stopping = signalState === 'red' && this.scene.signal && vehicle.lane < 2;
      vehicle.braking = stopping && vehicle.progress > .60;
      if (!isPaused) {
        if (vehicle.braking) vehicle.progress = Math.min(.63, vehicle.progress);
        else vehicle.progress += vehicle.speed * dt * 2.6 * (this.environment.weather === 'heavy-rain' ? .62 : 1);
        if (vehicle.progress > 1) vehicle.progress = 0;
      }
    });
    [...this.vehicles].sort((a, b) => this._vehiclePosition(a).depth - this._vehiclePosition(b).depth)
      .forEach((vehicle) => this._drawVehicle(ctx, vehicle, this._vehiclePosition(vehicle), w, h));
    if (showBoxes && !isPaused) this._drawDetectionOverlay(ctx, w, h, dt);

    // Mild sensor texture/noise, deliberately restrained.
    if (this._frame % 3 === 0) {
      ctx.fillStyle = 'rgba(220,230,220,.018)';
      const seed = seeded(this.scene.seed + this._frame);
      for (let i = 0; i < 24; i++) ctx.fillRect(seed() * w, seed() * h, 1, 1);
    }
    if (isChaosMode) { ctx.fillStyle = 'rgba(140,35,30,.035)'; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
    this._drawOsd(ctx, w, h, metrics, status, isPaused, provenance);
    if (this.canvas.dataset) this.canvas.dataset.renderFps = String(this.renderFps);
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
    const date = new Date();
    const stamp = `${date.toLocaleDateString('en-CA')} ${date.toLocaleTimeString('en-GB')}`;
    ctx.textAlign = 'right'; ctx.fillText(stamp, w - 10, 20); ctx.textAlign = 'left';
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
