import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITS_INTERSECTIONS, SITS_CCTV_CAMERAS, SURABAYA_CENTER } from '../config/surabayaCoords.js';
import { CAMERA_DEFINITIONS } from './cctv/cameraRegistry.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const seeded = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const project = (lat, lng) => ({ x: (lng - SURABAYA_CENTER.lng) * 104, z: -(lat - SURABAYA_CENTER.lat) * 111 });
const tintByTraffic = (speed, queue) => Number(queue) >= 28 || Number(speed) < 15 ? '#ef5b62' : Number(queue) >= 12 || Number(speed) < 30 ? '#f4b94f' : '#51d8b2';
const vehicleTypes = ['car', 'car', 'car', 'motorcycle', 'motorcycle', 'bus', 'truck', 'ambulance'];
const vehicleColors = ['#d8e3e5', '#6aa2b4', '#c79554', '#9b5d60', '#59736d', '#e2ded0', '#75818a', '#f1f0e8'];

function makeRoadMesh(start, end, width, material) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const nx = -dz / length * width / 2;
  const nz = dx / length * width / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    start.x + nx, .025, start.z + nz,
    start.x - nx, .025, start.z - nz,
    end.x - nx, .025, end.z - nz,
    end.x + nx, .025, end.z + nz
  ], 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

export class City3DScene {
  constructor(host, callbacks = {}) {
    this.host = host;
    this.callbacks = callbacks;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.lastFpsAt = 0;
    this.frameCount = 0;
    this.fps = 0;
    this.pixelRatio = .65;
    this.disposed = false;
    this.selectedCamera = null;
    this.intersectionObjects = new Map();
    this.cameraObjects = new Map();
    this.incidentObjects = new Map();
    this.deviceObjects = new Map();
    this.raycastTargets = [];
    this.layerVisibility = { density: true, signals: true, devices: true, incidents: true };
    this.roadOverlays = [];
    this.tmpObject = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.clock = new THREE.Clock();
    this._onResize = () => this.resize();
    this._onPointer = (event) => this.pick(event);
    this._onVisibility = () => { if (document.hidden) this.pause(); else this.resume(); };
    this.makeRenderer();
    this.buildScene();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .08;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 24;
    this.controls.maxPolarAngle = Math.PI * .49;
    this.renderer.domElement.addEventListener('pointerup', this._onPointer);
    window.addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    this.resize();
    this.setView('isometric');
    this.resume();
  }

  makeRenderer() {
    try {
      const context = this.host.ownerDocument.createElement('canvas').getContext('webgl2', { antialias: false, powerPreference: 'low-power' });
      if (!context) throw new Error('WebGL2 unavailable');
      this.renderer = new THREE.WebGLRenderer({ canvas: context.canvas, context, antialias: false, alpha: false, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.shadowMap.enabled = false;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      this.host.replaceChildren(this.renderer.domElement);
    } catch (error) {
      this.callbacks.onFallback?.(error);
      throw error;
    }
  }

  buildScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b9c9c5');
    this.scene.fog = new THREE.Fog('#b9c9c5', 16, 34);
    this.camera = new THREE.PerspectiveCamera(48, 1, .1, 100);
    this.camera.position.set(7.5, 8.5, 8.5);
    this.scene.add(new THREE.HemisphereLight('#d9f2ff', '#394943', 2.15));
    const sun = new THREE.DirectionalLight('#fff0d3', 3.1);
    sun.position.set(-5, 11, 6);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    this.scene.add(sun);
    this.addGround();
    this.addRoadNetwork();
    this.addBlocksAndTrees();
    this.addIntersections();
    this.addCameras();
    this.addVehicleInstances();
    this.addWeatherParticles();
    this.addCityLimit();
  }

  addGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#566c5c', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.04; ground.receiveShadow = true; this.scene.add(ground);
    const water = new THREE.Mesh(new THREE.BoxGeometry(.3, .012, 18), new THREE.MeshBasicMaterial({ color: '#478a9a', toneMapped: false }));
    water.position.set(-5.1, -.018, .2); this.scene.add(water);
  }

  addRoadNetwork() {
    const nodes = SITS_INTERSECTIONS.map((node) => ({ ...node, ...project(node.lat, node.lng) }));
    const edges = [];
    const seen = new Set();
    for (const node of nodes) {
      const nearest = nodes.filter((other) => other.id !== node.id).map((other) => ({ other, distance: Math.hypot(other.x - node.x, other.z - node.z) })).sort((a, b) => a.distance - b.distance).slice(0, 2);
      for (const { other } of nearest) {
        const key = [node.id, other.id].sort().join('::');
        if (seen.has(key)) continue;
        seen.add(key); edges.push({ a: node, b: other, key });
      }
    }
    this.edges = edges;
    const road = new THREE.MeshBasicMaterial({ color: '#374247', toneMapped: false });
    const sidewalk = new THREE.MeshBasicMaterial({ color: '#829087', toneMapped: false });
    const marking = new THREE.LineBasicMaterial({ color: '#d3c99d', transparent: true, opacity: .62 });
    for (const edge of edges) {
      this.scene.add(makeRoadMesh(edge.a, edge.b, .24, road));
      this.scene.add(makeRoadMesh(edge.a, edge.b, .34, sidewalk)).position.y = -.005;
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
      const length = Math.hypot(dx, dz);
      const nx = -dz / length * .125, nz = dx / length * .125;
      const points = [new THREE.Vector3(edge.a.x + nx, .04, edge.a.z + nz), new THREE.Vector3(edge.b.x + nx, .04, edge.b.z + nz)];
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), marking));
      const overlay = makeRoadMesh(edge.a, edge.b, .2, new THREE.MeshBasicMaterial({ color: '#45dfb4', transparent: true, opacity: .72, depthWrite: false }));
      overlay.position.y = .047; this.roadOverlays.push({ edge, mesh: overlay }); this.scene.add(overlay);
    }
    const localMaterial = new THREE.MeshStandardMaterial({ color: '#424b49', roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const z = -4.6 + i * 1.15;
      if (i % 2 === 0) this.scene.add(makeRoadMesh({ x: -7.2, z }, { x: 7.2, z }, .1, localMaterial));
      const x = -6.2 + i * 1.55;
      if (i % 2 !== 0) this.scene.add(makeRoadMesh({ x, z: -7.2 }, { x, z: 7.2 }, .1, localMaterial));
    }
    this.scene.userData.nodes = nodes;
  }

  addBlocksAndTrees() {
    const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#bdc4b9', roughness: .85 }), 180);
    buildings.castShadow = true; buildings.receiveShadow = true; buildings.userData.kind = 'building';
    let buildingIndex = 0;
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(.14, .58, 5), new THREE.MeshStandardMaterial({ color: '#517d5e', roughness: 1 }), 90);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.035, .045, .25, 5), new THREE.MeshStandardMaterial({ color: '#76604a' }), 90);
    let treeIndex = 0;
    for (let ix = 0; ix < 18; ix++) for (let iz = 0; iz < 18; iz++) {
      const x = -6.7 + ix * .78, z = -6.7 + iz * .78;
      const n = ix * 18 + iz;
      if (Math.abs(Math.sin(x * .82)) < .13 || Math.abs(Math.sin(z * .82)) < .12 || seeded(n) < .22) continue;
      const width = .26 + seeded(n + 9) * .34;
      const depth = .25 + seeded(n + 17) * .34;
      const height = .35 + seeded(n + 27) * (ix % 3 === 0 ? 1.75 : .88);
      this.tmpObject.position.set(x, height / 2, z); this.tmpObject.scale.set(width, height, depth); this.tmpObject.rotation.y = seeded(n + 41) * .35; this.tmpObject.updateMatrix();
      buildings.setMatrixAt(buildingIndex, this.tmpObject.matrix);
      buildings.setColorAt(buildingIndex, new THREE.Color(['#bcc5bb', '#b8c5c4', '#cbbfae', '#aab8b7'][n % 4]));
      buildingIndex++;
      if (buildingIndex >= buildings.count) break;
      if (treeIndex < trees.count && seeded(n + 53) > .47) {
        this.tmpObject.position.set(x + .28, .38, z + .26); this.tmpObject.scale.setScalar(.75 + seeded(n + 61) * .55); this.tmpObject.updateMatrix(); trees.setMatrixAt(treeIndex, this.tmpObject.matrix);
        this.tmpObject.position.y = .13; this.tmpObject.scale.setScalar(1); this.tmpObject.updateMatrix(); trunks.setMatrixAt(treeIndex, this.tmpObject.matrix); treeIndex++;
      }
    }
    buildings.count = buildingIndex;
    trees.count = treeIndex; trunks.count = treeIndex;
    buildings.instanceMatrix.needsUpdate = true; if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    trees.instanceMatrix.needsUpdate = true; trunks.instanceMatrix.needsUpdate = true;
    this.scene.add(buildings, trees, trunks);
  }

  addIntersections() {
    const shape = new THREE.CylinderGeometry(.27, .31, .06, 20);
    const material = new THREE.MeshStandardMaterial({ color: '#5bdce1', emissive: '#146870', emissiveIntensity: .7, roughness: .42 });
    for (const data of this.scene.userData.nodes) {
      const marker = new THREE.Mesh(shape, material.clone());
      marker.position.set(data.x, .09, data.z); marker.castShadow = true;
      marker.userData = { kind: 'intersection', id: data.id, name: data.name, data };
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, .62, 6), new THREE.MeshStandardMaterial({ color: '#263637' }));
      pole.position.set(data.x + .31, .36, data.z + .22);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.075, 8, 6), new THREE.MeshStandardMaterial({ color: '#45d8b3', emissive: '#1da781', emissiveIntensity: 1.3 }));
      lamp.position.set(data.x + .31, .68, data.z + .22);
      marker.userData.signalLamp = lamp;
      this.intersectionObjects.set(data.id, marker);
      this.scene.add(marker, pole, lamp); this.raycastTargets.push(marker);
    }
  }

  addCameras() {
    const virtualCameraDefinitions = CAMERA_DEFINITIONS.filter((item) => item.id.startsWith('cctvCanvas'));
    for (const [cameraIndex, cameraData] of SITS_CCTV_CAMERAS.entries()) {
      const p = project(cameraData.lat, cameraData.lng);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, .13, 8), new THREE.MeshStandardMaterial({ color: '#33494b' }));
      base.position.set(p.x, .08, p.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.024, .035, .72, 7), new THREE.MeshStandardMaterial({ color: '#546466' }));
      pole.position.set(p.x, .47, p.z);
      const camera = new THREE.Mesh(new THREE.BoxGeometry(.2, .105, .14), new THREE.MeshStandardMaterial({ color: '#49ced9', emissive: '#0d4850', emissiveIntensity: .9 }));
      camera.position.set(p.x + .045, .85, p.z); camera.rotation.y = -.42;
      const definition = CAMERA_DEFINITIONS.find((item) => item.name === cameraData.name) || virtualCameraDefinitions[cameraIndex] || CAMERA_DEFINITIONS.find((item) => item.id === cameraData.id);
      camera.userData = { kind: 'camera', id: definition?.id || cameraData.id, name: cameraData.name, data: cameraData, x: p.x, z: p.z };
      this.cameraObjects.set(camera.userData.id, camera);
      this.scene.add(base, pole, camera); this.raycastTargets.push(camera);
    }
  }

  addVehicleInstances() {
    this.vehicles = [];
    this.vehicleMeshes = new Map();
    this.headlightMeshes = new Map();
    const geometryByType = {
      car: new THREE.BoxGeometry(.13, .085, .25), motorcycle: new THREE.BoxGeometry(.055, .075, .14),
      bus: new THREE.BoxGeometry(.17, .16, .42), truck: new THREE.BoxGeometry(.18, .14, .34), ambulance: new THREE.BoxGeometry(.14, .1, .28)
    };
    const counts = { car: 30, motorcycle: 20, bus: 5, truck: 5, ambulance: 3 };
    let index = 0;
    for (const [type, count] of Object.entries(counts)) {
      const mesh = new THREE.InstancedMesh(geometryByType[type], new THREE.MeshStandardMaterial({ color: '#dce4e3', roughness: .48, metalness: .2 }), count);
      mesh.castShadow = true; mesh.userData.kind = 'vehicle';
      mesh.userData.instances = [];
      const headlights = new THREE.InstancedMesh(new THREE.BoxGeometry(.025, .018, .035), new THREE.MeshBasicMaterial({ color: '#ffedb5' }), count * 2);
      headlights.userData.instances = [];
      for (let i = 0; i < count; i++) {
        const edgeIndex = index % this.edges.length;
        const edge = this.edges[edgeIndex];
        const reverse = index % 2 === 1;
        const vehicle = { id: `visual-${type}-${index}`, type, edgeIndex, reverse, progress: seeded(index + 3), lane: (seeded(index + 87) - .5) * .18, speed: 0, desired: 18 + seeded(index + 27) * 28, color: vehicleColors[index % vehicleColors.length], meshIndex: i, globalIndex: index };
        mesh.userData.instances.push(vehicle); this.vehicles.push(vehicle); index++;
        mesh.setColorAt(i, new THREE.Color(type === 'ambulance' ? '#f1eee4' : vehicle.color));
      }
      mesh.instanceColor.needsUpdate = true; this.vehicleMeshes.set(type, mesh); this.headlightMeshes.set(type, headlights); this.scene.add(mesh, headlights); this.raycastTargets.push(mesh);
    }
  }

  addWeatherParticles() {
    const positions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { positions[i * 3] = seeded(i + 91) * 18 - 9; positions[i * 3 + 1] = seeded(i + 191) * 8 + 1; positions[i * 3 + 2] = seeded(i + 291) * 18 - 9; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: '#c9e7ec', size: .035, transparent: true, opacity: .65 });
    this.rain = new THREE.Points(geometry, material); this.rain.visible = false; this.scene.add(this.rain);
  }

  addCityLimit() {
    const grid = new THREE.GridHelper(24, 24, '#77908a', '#72867b'); grid.position.y = -.035; grid.material.transparent = true; grid.material.opacity = .14; this.scene.add(grid);
  }

  updateState(state = {}) {
    this.state = state;
    const model = state.trafficModel || {};
    this.corridors = model.corridors || [];
    this.rain.visible = Boolean(state.isRainMode || state.roadCondition === 'wet');
    const night = Number(model.hour) >= 18 || Number(model.hour) < 6;
    this.night = night;
    this.scene.background.set(night ? '#101b2a' : '#b9c9c5');
    this.scene.fog.color.set(night ? '#101b2a' : '#b9c9c5');
    this.scene.traverse((object) => { if (object.isLight && object.type === 'DirectionalLight') object.intensity = night ? 1.15 : 3.1; });
    for (const node of state.intersections || []) {
      const object = this.intersectionObjects.get(String(node.id)); if (!object) continue;
      const corridor = this.corridors.find((item) => item.intersectionId === node.id);
      const trafficColor = tintByTraffic(corridor?.speedKmh ?? node.speedKmh, corridor?.queueVehicles ?? node.queueVehicles);
      object.material.color.set(trafficColor);
      object.material.emissive.set(trafficColor);
      object.material.emissiveIntensity = String(node.state || '').toLowerCase() === 'red' ? .1 : .5;
      object.userData.data = { ...object.userData.data, ...node, corridor };
      if (object.userData.signalLamp) object.userData.signalLamp.material.color.set(String(node.state || '').toLowerCase() === 'red' ? '#ff5f64' : String(node.state || '').toLowerCase() === 'yellow' ? '#f4b94f' : '#45dfb4');
    }
    for (const { edge, mesh } of this.roadOverlays) {
      const traffic = this.corridors.find((item) => item.intersectionId === edge.b.id || item.intersectionId === edge.a.id);
      mesh.visible = this.layerVisibility.density;
      mesh.material.color.set(tintByTraffic(traffic?.speedKmh, traffic?.queueVehicles));
    }
    this.syncIncidents(state.incidents || []);
    this.syncDevices(state.devices || []);
    this._updateAmbientForWeather(Boolean(state.isRainMode || state.roadCondition === 'wet'), night);
  }

  _updateAmbientForWeather(rain, night) { this.rain.visible = rain; this.rain.material.opacity = night ? .44 : .65; }

  syncIncidents(incidents) {
    const active = incidents.filter((item) => !['RESOLVED', 'ARCHIVED', 'CLOSED', 'CANCELLED'].includes(String(item.status || 'ACTIVE').toUpperCase()));
    const keep = new Set(active.map((item) => String(item.id)));
    for (const [id, object] of this.incidentObjects) if (!keep.has(id)) { this.scene.remove(object); object.geometry.dispose(); object.material.dispose(); this.raycastTargets = this.raycastTargets.filter((target) => target !== object); this.incidentObjects.delete(id); }
    for (const item of active) {
      const id = String(item.id);
      if (this.incidentObjects.has(id)) continue;
      const node = this.scene.userData.nodes.find((candidate) => candidate.id === item.intersectionId || candidate.name.toLowerCase().includes(String(item.location || '').toLowerCase().split(' ')[0])) || this.scene.userData.nodes[0];
      const pos = item.coordinates && item.coordinates.length >= 2 ? project(Number(item.coordinates[0]), Number(item.coordinates[1])) : node;
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.19, 0), new THREE.MeshStandardMaterial({ color: '#ff5964', emissive: '#8a1625', emissiveIntensity: 1.4 }));
      marker.position.set(pos.x, .35, pos.z); marker.userData = { kind: 'incident', id, name: item.title || `Insiden ${id}`, data: item };
      this.incidentObjects.set(id, marker); this.scene.add(marker); this.raycastTargets.push(marker);
    }
  }

  syncDevices(devices) {
    const keep = new Set(devices.map((device) => String(device.deviceId || device.id)));
    for (const [id, object] of this.deviceObjects) if (!keep.has(id)) { this.scene.remove(object); object.geometry.dispose(); object.material.dispose(); this.raycastTargets = this.raycastTargets.filter((target) => target !== object); this.deviceObjects.delete(id); }
    const nodes = this.scene.userData.nodes;
    devices.slice(0, 60).forEach((device, index) => {
      const id = String(device.deviceId || device.id || index);
      if (this.deviceObjects.has(id)) return;
      const nodeId = device.intersectionId || device.nodeId;
      const node = nodes.find((candidate) => candidate.id === nodeId) || nodes[index % nodes.length];
      const marker = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, .12), new THREE.MeshStandardMaterial({ color: '#8bd4a8', emissive: '#23683d', emissiveIntensity: .6 }));
      marker.position.set(node.x + .28, .13, node.z - .24); marker.userData = { kind: 'device', id, name: device.deviceName || device.name || id, data: device };
      this.deviceObjects.set(id, marker); this.scene.add(marker); this.raycastTargets.push(marker);
    });
  }

  setLayer(name, visible) {
    this.layerVisibility[name] = Boolean(visible);
    if (name === 'density') this.roadOverlays.forEach(({ mesh }) => { mesh.visible = Boolean(visible); });
    if (name === 'signals') this.intersectionObjects.forEach((object) => { object.visible = Boolean(visible); if (object.userData.signalLamp) object.userData.signalLamp.visible = Boolean(visible); });
    if (name === 'devices') this.deviceObjects.forEach((object) => { object.visible = Boolean(visible); });
    if (name === 'incidents') this.incidentObjects.forEach((object) => { object.visible = Boolean(visible); });
  }

  updateVehicles(delta) {
    const signalByNode = new Map((this.state?.intersections || []).map((item) => [item.id, String(item.state || '').toLowerCase()]));
    const trafficByNode = new Map(this.corridors.map((item) => [item.intersectionId, item]));
    const dt = Math.min(delta, .08);
    const ahead = this.vehicles.map((vehicle) => this.vehicles.filter((other) => other !== vehicle && other.edgeIndex === vehicle.edgeIndex && other.reverse === vehicle.reverse && other.lane === vehicle.lane && other.progress > vehicle.progress && other.progress - vehicle.progress < .12).sort((a, b) => a.progress - b.progress)[0]);
    this.vehicleMeshes.forEach((mesh) => {
      for (const vehicle of mesh.userData.instances) {
        const edge = this.edges[vehicle.edgeIndex];
        const a = vehicle.reverse ? edge.b : edge.a, b = vehicle.reverse ? edge.a : edge.b;
        const traffic = trafficByNode.get(b.id);
        const state = signalByNode.get(b.id);
        const desired = clamp((traffic?.speedKmh ?? vehicle.desired) * .045, .12, .9);
        const shouldStop = state === 'red' && vehicle.progress > .78 && vehicle.progress < .86;
        const lead = ahead[this.vehicles.indexOf(vehicle)];
        const blocked = lead && lead.progress - vehicle.progress < .065;
        const targetSpeed = shouldStop || blocked ? 0 : desired;
        vehicle.speed = mix(vehicle.speed, targetSpeed, Math.min(1, dt * (targetSpeed < vehicle.speed ? 4 : 1.3)));
        vehicle.progress += vehicle.speed * dt * .09;
        if (vehicle.progress >= 1) {
          vehicle.progress -= 1;
          if (seeded(vehicle.globalIndex + Math.floor(performance.now() / 900)) > .55) {
            const destinationId = b.id;
            const options = this.edges.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).filter(({ candidate }) => candidate.a.id === destinationId || candidate.b.id === destinationId);
            const next = options[Math.floor(seeded(vehicle.globalIndex + Math.floor(performance.now() / 1200)) * options.length) % Math.max(1, options.length)];
            if (next) { vehicle.edgeIndex = next.candidateIndex; vehicle.reverse = next.candidate.a.id === destinationId; }
          }
        }
        const t = vehicle.progress;
        const x = mix(a.x, b.x, t), z = mix(a.z, b.z, t);
        const dx = b.x - a.x, dz = b.z - a.z;
        this.tmpObject.position.set(x + (-dz * vehicle.lane), vehicle.type === 'bus' || vehicle.type === 'truck' ? .15 : .105, z + (dx * vehicle.lane));
        this.tmpObject.rotation.set(0, Math.atan2(dx, dz) + (vehicle.reverse ? Math.PI : 0), 0);
        this.tmpObject.scale.set(1, 1, 1); this.tmpObject.updateMatrix();
        mesh.setMatrixAt(vehicle.meshIndex, this.tmpObject.matrix);
        const lights = this.headlightMeshes.get(vehicle.type);
        lights.visible = Boolean(this.night);
        const angle = Math.atan2(dx, dz) + (vehicle.reverse ? Math.PI : 0);
        for (let lightIndex = 0; lightIndex < 2; lightIndex++) {
          const side = lightIndex === 0 ? -.035 : .035;
          this.tmpObject.position.set(x + (-dz * vehicle.lane) + Math.sin(angle) * .15 + Math.cos(angle) * side, .105, z + (dx * vehicle.lane) + Math.cos(angle) * .15 - Math.sin(angle) * side);
          this.tmpObject.rotation.set(0, angle, 0); this.tmpObject.scale.setScalar(1); this.tmpObject.updateMatrix();
          lights.setMatrixAt(vehicle.meshIndex * 2 + lightIndex, this.tmpObject.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      const lights = this.headlightMeshes.get(mesh.userData.instances[0]?.type); if (lights) lights.instanceMatrix.needsUpdate = true;
    });
    if (this.rain.visible) this.rain.position.z += dt * .28;
  }

  setView(view) {
    const presets = {
      top: { position: [0, 12, .01], target: [0, 0, 0] },
      isometric: { position: [7.5, 8.5, 8.5], target: [0, 0, 0] },
      street: { position: [0, 2.2, 5.2], target: [0, .6, 0] }
    };
    const preset = presets[view] || presets.isometric;
    this.camera.position.set(...preset.position); this.controls.target.set(...preset.target); this.controls.update();
  }

  setVirtualCamera(cameraId) {
    const mesh = this.cameraObjects.get(String(cameraId)); if (!mesh) return;
    this.selectedCamera = mesh;
    const data = mesh.userData.data;
    const definition = CAMERA_DEFINITIONS.find((item) => item.id === cameraId);
    const node = this.scene.userData.nodes.find((item) => item.id === definition?.nodeId) || data;
    this.previewCamera = new THREE.PerspectiveCamera(50, 1.25, .1, 30);
    this.previewCamera.position.set(node.x + 1.25, 1.35, node.z + 1.25);
    this.previewCamera.lookAt(node.x, .05, node.z - 1.3);
    this.callbacks.onCamera?.({ id: cameraId, name: data.name, nodeId: definition?.nodeId });
    const mapCamera = this.camera;
    this.camera.position.copy(this.previewCamera.position).add(new THREE.Vector3(2.1, 1.4, 2.1));
    this.controls.target.set(node.x, .25, node.z - 1.2); this.controls.update();
    this._lastViewCamera = mapCamera;
  }

  pick(event) {
    if (event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObjects(this.raycastTargets, false);
    if (!hits.length) return;
    const hit = hits[0];
    let entity = hit.object.userData;
    if (entity.kind === 'vehicle') entity = hit.object.userData.instances[hit.instanceId] || entity;
    if (!entity.kind && hit.object.userData.kind === 'vehicle') entity = hit.object.userData.instances[hit.instanceId];
    if (entity.kind === 'intersection') this.controls.target.set(hit.object.position.x, 0, hit.object.position.z);
    this.callbacks.onSelect?.({ ...entity, object: hit.object });
  }

  resize() {
    if (!this.renderer || !this.host.clientWidth) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  render(now) {
    if (this.disposed || document.hidden) return;
    this.raf = requestAnimationFrame((time) => this.render(time));
    if (now - this.lastFrame < 1000 / 30) return;
    const delta = this.lastFrame ? (now - this.lastFrame) / 1000 : .033;
    this.lastFrame = now; this.frameCount++; this.controls.update(); this.updateVehicles(delta);
    const width = this.renderer.domElement.clientWidth, height = this.renderer.domElement.clientHeight;
    this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, width, height); this.renderer.render(this.scene, this.camera);
    if (this.selectedCamera && this.previewCamera) {
      const insetW = Math.min(205, Math.floor(width * .28)), insetH = Math.floor(insetW / 1.25), margin = 14;
      this.renderer.setScissorTest(true); this.renderer.setScissor(width - insetW - margin, margin, insetW, insetH); this.renderer.setViewport(width - insetW - margin, margin, insetW, insetH); this.renderer.setClearColor('#142326', 1); this.renderer.clearDepth(); this.renderer.render(this.scene, this.previewCamera); this.renderer.setScissorTest(false);
    }
    if (now - this.lastFpsAt >= 1800) {
      const elapsed = now - (this.lastFpsAt || now - 1800); this.fps = Math.round(this.frameCount * 1000 / elapsed); this.frameCount = 0; this.lastFpsAt = now;
      this.callbacks.onFps?.(this.fps);
      if (this.fps < 29 && this.pixelRatio > .45) { this.pixelRatio = Math.max(.45, this.pixelRatio - .1); this.renderer.setPixelRatio(this.pixelRatio); this.resize(); }
      else if (this.fps > 34 && this.pixelRatio < .9) { this.pixelRatio = Math.min(.9, this.pixelRatio + .05); this.renderer.setPixelRatio(this.pixelRatio); this.resize(); }
    }
  }

  resume() { if (!this.raf && !document.hidden) { this.lastFrame = 0; this.clock.start(); this.raf = requestAnimationFrame((time) => this.render(time)); } }
  pause() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); window.removeEventListener('resize', this._onResize); document.removeEventListener('visibilitychange', this._onVisibility);
    this.renderer?.domElement.removeEventListener('pointerup', this._onPointer);
    this.controls?.dispose();
    this.scene?.traverse((object) => { object.geometry?.dispose?.(); if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose()); else object.material?.dispose?.(); });
    this.renderer?.renderLists?.dispose?.(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.host.replaceChildren();
    this.intersectionObjects.clear(); this.cameraObjects.clear(); this.incidentObjects.clear(); this.deviceObjects.clear(); this.vehicleMeshes.clear();
    this.headlightMeshes.clear();
  }
}
