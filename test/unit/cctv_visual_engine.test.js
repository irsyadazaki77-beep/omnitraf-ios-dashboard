import { test } from 'node:test';
import assert from 'node:assert/strict';

function createContext() {
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: (text) => ({ width: String(text).length * 5 }),
    roundRect() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
    fill() {}, stroke() {}, clip() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    drawImage() {}, setLineDash() {}, translate() {}, rotate() {}, fillText() {}
  }, { set(target, key, value) { target[key] = value; return true; } });
  return ctx;
}

const canvases = new Map();
globalThis.document = {
  getElementById: (id) => canvases.get(id) || null,
  createElement: () => ({ width: 0, height: 0, getContext: () => createContext() })
};
globalThis.devicePixelRatio = 1;

const { CctvCanvasRenderer, getCameraScene } = await import('../../src/modules/cctv/canvasRenderer.js');

function makeRenderer(id) {
  const canvas = {
    width: 640, height: 360, clientWidth: 640, clientHeight: 360,
    getContext: () => createContext(),
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    toDataURL: () => 'data:image/png;base64,simulated'
  };
  canvases.set(id, canvas);
  return new CctvCanvasRenderer(id);
}

test('each camera has its own deterministic scene geometry', () => {
  const ids = ['cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4'];
  const scenes = ids.map(getCameraScene);
  assert.deepEqual(scenes.map((scene) => scene.type), ['intersection', 'boulevard', 'roundabout', 'intersection']);
  assert.equal(new Set(scenes.map((scene) => scene.seed)).size, 4);
  assert.notEqual(scenes[0].seed, scenes[3].seed);
});

test('vehicle frame remains visible with detection overlay off and is supplied by simulation', () => {
  const a = makeRenderer('cctvCanvas1');
  const b = makeRenderer('cctvCanvas1');
  assert.deepEqual(a.vehicles, b.vehicles);
  assert.equal(a.vehicles.length, 0, 'renderer must not invent an independent traffic stream');
  const frameVehicles = [{ id: 'cctvCanvas1-v0', trackId: 'cctvCanvas1-v0', class: 'car', x: .3, y: .5, w: .04, h: .05, speedKmh: 24, progress: .4, lane: 1 }];
  a.updateVehicles(frameVehicles);
  a.updateBoxes(frameVehicles);
  a.render(false, false, false, .016);
  assert.equal(a.vehicles.length, 1);
  assert.equal(a.vehicles[0].id, frameVehicles[0].id);
  assert.equal(a.trackedBoxes.size, 1);
  assert.equal(a.captureSnapshot(), 'data:image/png;base64,simulated');
});

test('pause freezes traffic and day/night/weather rebuilds the cached scene', () => {
  const renderer = makeRenderer('cctvCanvas2');
  renderer.render(false, false, false, .016);
  const initialKey = renderer._sceneKey;
  renderer.updateVehicles([{ id: 'v1', class: 'car', x: .3, y: .5, w: .04, h: .05, progress: .45 }]);
  const initialProgress = renderer.vehicles[0].progress;
  renderer.render(false, true, false, .5);
  assert.equal(renderer.vehicles[0].progress, initialProgress);
  renderer.setEnvironment({ timeOfDay: 'night', weather: 'heavy-rain' });
  renderer.render(false, false, false, .016);
  assert.notEqual(renderer._sceneKey, initialKey);
  assert.equal(renderer.environment.timeOfDay, 'night');
  assert.equal(renderer.environment.weather, 'heavy-rain');
});

test('wet road reflections are rendered beneath simulation-sourced vehicles', () => {
  const renderer = makeRenderer('cctvCanvas1');
  let ellipseCalls = 0;
  const ctx = createContext();
  ctx.ellipse = () => { ellipseCalls++; };
  const vehicle = { type: 'car', color: '#899385', braking: false };
  renderer._drawVehicle(ctx, vehicle, { x: .5, y: .6, angle: 0, depth: .8 }, 640, 360);
  const dryEllipseCalls = ellipseCalls;
  renderer.setEnvironment({ weather: 'light-rain' });
  renderer._drawVehicle(ctx, vehicle, { x: .5, y: .6, angle: 0, depth: .8 }, 640, 360);
  assert.equal(ellipseCalls - dryEllipseCalls, dryEllipseCalls + 1, 'wet mode retains vehicle geometry and adds one low-cost reflection');
});

test('stable vehicle IDs ease between camera frames and stop interpolating while paused', () => {
  const renderer = makeRenderer('cctvCanvas1');
  renderer.updateVehicles([{ id: 'track-stable', trackId: 'track-stable', class: 'car', x: .2, y: .4, w: .05, h: .06 }]);
  renderer.render(false, false, false, .016);
  const firstX = renderer._vehicleVisuals.get('track-stable').x;
  renderer.updateVehicles([{ id: 'track-stable', trackId: 'track-stable', class: 'car', x: .6, y: .4, w: .05, h: .06 }]);
  renderer.render(false, false, false, .016);
  const easedX = renderer._vehicleVisuals.get('track-stable').x;
  assert.ok(easedX > firstX && easedX < .625, 'new coordinates should be approached over several frames');
  renderer.updateVehicles([{ id: 'track-stable', trackId: 'track-stable', class: 'car', x: .8, y: .4, w: .05, h: .06 }]);
  renderer.render(false, true, false, .016);
  assert.equal(renderer._vehicleVisuals.get('track-stable').x, easedX, 'pause must preserve the last rendered position');
});

test('intersection signal lamps follow the authoritative signal phase', () => {
  const renderer = makeRenderer('cctvCanvas1');
  const colors = [];
  const ctx = createContext();
  ctx.fill = () => colors.push(ctx.fillStyle);
  renderer._drawSignal(ctx, 640, 360, 'red');
  assert.equal(colors[0], '#ff514b');
  colors.length = 0;
  renderer._drawSignal(ctx, 640, 360, 'green');
  assert.equal(colors[2], '#4ee0a6');
});

test('unsupported environment and filter values safely fall back', () => {
  const renderer = makeRenderer('cctvCanvas4');
  renderer.setEnvironment({ timeOfDay: 'dusk-ish', weather: 'storm' });
  renderer.setFilter('thermal');
  assert.deepEqual(renderer.environment, { timeOfDay: 'day', weather: 'clear' });
  assert.equal(renderer.filterMode, 'thermal');
  renderer.setFilter('unknown');
  assert.equal(renderer.filterMode, 'none');
});

test('detection tracks retain stable identities and stale/offline status reaches the renderer', () => {
  const renderer = makeRenderer('cctvCanvas1');
  renderer.updateBoxes([{ id: 'track-17', x: .2, y: .3, w: .06, h: .08, class: 'car', speedKmh: 32, confidence: 92 }]);
  renderer.render(false, false, true, .016);
  const track = renderer.trackedBoxes.get('track-17');
  assert.equal(track.id, 'track-17');
  renderer.updateBoxes([{ id: 'track-17', x: .21, y: .31, w: .06, h: .08, class: 'car', speedKmh: 31, confidence: 93 }]);
  renderer.render(false, false, true, .016);
  assert.equal(renderer.trackedBoxes.get('track-17').id, 'track-17');

  const statuses = [];
  renderer._drawOsd = (_ctx, _w, _h, _metrics, status) => statuses.push(status);
  renderer.render(false, false, false, .016, {}, {}, 'STALE');
  renderer.render(false, false, false, .016, {}, {}, 'OFFLINE');
  assert.deepEqual(statuses, ['STALE', 'OFFLINE']);
});
