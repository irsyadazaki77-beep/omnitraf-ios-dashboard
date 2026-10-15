import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { adaptiveQualityAction, validateCity3DScene, validateInstancedMesh } from '../../src/modules/city3dValidation.js';
import { resolveCity3DRoadTopology } from '../../src/modules/city3dTopology.js';
import { SITS_INTERSECTIONS } from '../../src/config/surabayaCoords.js';
import { City3DScene } from '../../src/modules/city3dScene.js';
import { trafficCameraConfig } from '../../shared/trafficVehicleSimulation.js';
import { getCameraMapFeatureCollection } from '../../src/modules/cctv/cameraRegistry.js';

test('InstancedMesh active count cannot exceed allocated matrix capacity', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 180);
  mesh.count = 180;
  assert.equal(validateInstancedMesh(mesh), true);
  mesh.count = 184;
  assert.throws(() => validateInstancedMesh(mesh), /capacity 180/);
});

test('City3D scene validation rejects non-finite transforms, corrupt indices, and invalid draw ranges', () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  mesh.count = 1; scene.add(mesh);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(Number.NaN, 0, 0));
  assert.throws(() => validateCity3DScene(scene), /Non-finite instance transform/);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.geometry.setIndex([0, 1, 999]);
  assert.throws(() => validateCity3DScene(scene), /exceeds/);
  mesh.geometry.setIndex(null);
  mesh.geometry.setDrawRange(0, 9999);
  assert.throws(() => validateCity3DScene(scene), /draw range/);
  mesh.geometry.setDrawRange(0, Infinity);
  mesh.geometry.getAttribute('position').array[0] = Number.NaN;
  assert.throws(() => validateCity3DScene(scene), /non-finite position buffer/);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('explicit City3D road topology maps every SITS intersection and rejects disconnected maps', () => {
  const nodes = SITS_INTERSECTIONS.map((node) => ({ ...node }));
  const edges = resolveCity3DRoadTopology(nodes);
  assert.equal(edges.length, 6);
  assert.throws(() => resolveCity3DRoadTopology(nodes, [['node-wonokromo', 'node-darmo']]), /disconnected/);
  assert.throws(() => resolveCity3DRoadTopology(nodes, [['node-wonokromo', 'missing-node']]), /Invalid City3D road link/);
});

test('City3D location resolution leaves unknown entities unmapped instead of snapping to the first intersection', () => {
  const scene = Object.create(City3DScene.prototype);
  scene.scene = { userData: { nodes: SITS_INTERSECTIONS.map((node) => ({ ...node })) } };
  assert.equal(scene.resolveSpatialPosition({ intersectionId: 'unknown-node', location: 'Atlantis' }), null);
  assert.equal(scene.resolveSpatialPosition({ location: 'A. Yani / Wonokromo' }).id, 'node-wonokromo');
  const coordinatePosition = scene.resolveSpatialPosition({ coordinates: [-7.2985, 112.7345] });
  assert.ok(Math.abs(coordinatePosition.x - (112.7345 - 112.7424) * 104) < .01);
  assert.ok(Math.abs(coordinatePosition.z - (-(-7.2985 + 7.2756) * 111)) < .01);
});

test('unattached Waru CCTV feed uses its explicit mapped camera location and route anchor', () => {
  const camera = trafficCameraConfig('cctvCanvas3');
  assert.equal(camera.nodeId, null);
  assert.equal(camera.city3dAnchorNodeId, 'node-jemursari');
  assert.deepEqual(camera.city3dCoordinates, [-7.345, 112.73]);
});

test('Map 2D camera features use the same stable CCTV IDs and coordinates as the registry', () => {
  const collection = getCameraMapFeatureCollection();
  assert.deepEqual(collection.features.map(({ properties }) => properties.cameraId), ['cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4']);
  assert.deepEqual(collection.features.map(({ geometry }) => geometry.coordinates), [
    [112.7345, -7.2985], [112.7395, -7.281], [112.73, -7.345], [112.7315, -7.332]
  ]);
  assert.ok(collection.features.every(({ properties }) => properties.id === properties.cameraId));
  collection.features[0].geometry.coordinates[0] = 0;
  assert.equal(getCameraMapFeatureCollection().features[0].geometry.coordinates[0], 112.7345);
});

test('adaptive quality can recover while rendered FPS is capped at its target', () => {
  assert.equal(adaptiveQualityAction({ fps: 30, targetFps: 30, workMs: 4, pixelRatio: .6, minimum: .35, maximum: .75 }), 'raise');
  assert.equal(adaptiveQualityAction({ fps: 24, targetFps: 30, workMs: 4, pixelRatio: .6, minimum: .35, maximum: .75 }), 'lower');
  assert.equal(adaptiveQualityAction({ fps: 30, targetFps: 30, workMs: 4, pixelRatio: .75, minimum: .35, maximum: .75 }), null);
});
