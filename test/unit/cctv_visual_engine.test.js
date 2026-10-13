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

test('vehicles stay visible with detection overlay off and seeded vehicles repeat', () => {
  const a = makeRenderer('cctvCanvas1');
  const b = makeRenderer('cctvCanvas1');
  assert.deepEqual(a.vehicles, b.vehicles);
  a.render(false, false, false, .016);
  assert.equal(a.vehicles.length, 17);
  assert.equal(a.captureSnapshot(), 'data:image/png;base64,simulated');
});

test('pause freezes traffic and day/night/weather rebuilds the cached scene', () => {
  const renderer = makeRenderer('cctvCanvas2');
  renderer.render(false, false, false, .016);
  const initialKey = renderer._sceneKey;
  const initialProgress = renderer.vehicles[0].progress;
  renderer.render(false, true, false, .5);
  assert.equal(renderer.vehicles[0].progress, initialProgress);
  renderer.setEnvironment({ timeOfDay: 'night', weather: 'heavy-rain' });
  renderer.render(false, false, false, .016);
  assert.notEqual(renderer._sceneKey, initialKey);
  assert.equal(renderer.environment.timeOfDay, 'night');
  assert.equal(renderer.environment.weather, 'heavy-rain');
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

test('detection tracks bind to stable vehicle identities and stale/offline status reaches the renderer', () => {
  const renderer = makeRenderer('cctvCanvas1');
  renderer.updateBoxes([{ id: 'track-17', x: .2, y: .3, w: .06, h: .08, class: 'car', speedKmh: 32, confidence: 92 }]);
  renderer.render(false, false, true, .016);
  const track = renderer.trackedBoxes.get('track-17');
  assert.ok(Number.isInteger(track._simVehicleIndex));
  const vehicleIndex = track._simVehicleIndex;
  renderer.updateBoxes([{ id: 'track-17', x: .21, y: .31, w: .06, h: .08, class: 'car', speedKmh: 31, confidence: 93 }]);
  renderer.render(false, false, true, .016);
  assert.equal(track._simVehicleIndex, vehicleIndex);

  const statuses = [];
  renderer._drawOsd = (_ctx, _w, _h, _metrics, status) => statuses.push(status);
  renderer.render(false, false, false, .016, {}, {}, 'STALE');
  renderer.render(false, false, false, .016, {}, {}, 'OFFLINE');
  assert.deepEqual(statuses, ['STALE', 'OFFLINE']);
});
