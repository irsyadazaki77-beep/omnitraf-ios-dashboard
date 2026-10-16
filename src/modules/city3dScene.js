import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITS_INTERSECTIONS, SURABAYA_CENTER } from '../config/surabayaCoords.js';
import { CAMERA_DEFINITIONS } from './cctv/cameraRegistry.js';
import { projectTrafficVehicle, trafficCameraConfig } from '../../shared/trafficVehicleSimulation.js';
import { adaptiveQualityAction, validateCity3DScene, validateInstancedMesh } from './city3dValidation.js';
import { resolveCity3DRoadTopology } from './city3dTopology.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const seeded = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const project = (lat, lng) => ({ x: (lng - SURABAYA_CENTER.lng) * 104, z: -(lat - SURABAYA_CENTER.lat) * 111 });
const tintByTraffic = (speed, queue) => Number(queue) >= 28 || Number(speed) < 15 ? '#ef5b62' : Number(queue) >= 12 || Number(speed) < 30 ? '#f4b94f' : '#51d8b2';
const VEHICLE_TYPES = ['car', 'motorcycle', 'bus', 'truck', 'ambulance'];
const VEHICLE_PALETTE = { car: '#d8e3e5', motorcycle: '#c79554', bus: '#e2ded0', truck: '#75818a', ambulance: '#f1f0e8' };
const QUALITY_PROFILES = Object.freeze({ low: { pixelRatio: .55, targetFps: 30, shadows: false }, balanced: { pixelRatio: .75, targetFps: 30, shadows: false }, high: { pixelRatio: 1, targetFps: 30, shadows: true } });
const VEHICLE_DIMENSIONS = Object.freeze({
  car: [ .14, .075, .27 ], motorcycle: [ .065, .07, .16 ], bus: [ .19, .15, .43 ],
  truck: [ .19, .13, .35 ], ambulance: [ .15, .095, .29 ]
});

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
    this.lastPerformanceAt = 0;
    this.frameCount = 0;
    this.fps = 0;
    this.quality = 'balanced';
    this.pixelRatio = QUALITY_PROFILES[this.quality].pixelRatio;
    this.targetFps = QUALITY_PROFILES[this.quality].targetFps;
    this.frameTimeSamples = new Float32Array(90);
    this.frameTimeCount = 0;
    this.frameTimeCursor = 0;
    this.frameTimeP95 = 0;
    this.gpuQueries = [];
    this.gpuTimeMs = null;
    this.cpuFrameMs = 0;
    this.lastQualityAdjustAt = 0;
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this._onContextLost = (event) => { event.preventDefault(); this.pause(); this.activeGpuQuery = null; this.gpuQueries = []; this.callbacks.onContextLost?.(); };
    this._onContextRestored = () => {
      this.renderer?.resetState();
      this.scene?.traverse((object) => {
        for (const attribute of Object.values(object.geometry?.attributes || {})) attribute.needsUpdate = true;
        if (object.geometry?.index) object.geometry.index.needsUpdate = true;
        if (object.isInstancedMesh) { object.instanceMatrix.needsUpdate = true; if (object.instanceColor) object.instanceColor.needsUpdate = true; }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => { if (material) material.needsUpdate = true; });
      });
      this.resize(); this.callbacks.onContextRestored?.(); this.resume();
    };
    this.disposed = false;
    this.selectedCamera = null;
    this.intersectionObjects = new Map();
    this.cameraObjects = new Map();
    this.incidentObjects = new Map();
    this.deviceObjects = new Map();
    this.unmappedSpatialEntities = new Set();
    this.raycastTargets = [];
    this.layerVisibility = { density: true, signals: true, devices: true, incidents: true };
    this.roadOverlays = [];
    this.tmpObject = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.vehicleVisuals = new Map();
    this.vehicleColors = new Map(VEHICLE_TYPES.map((type) => [type, new THREE.Color(VEHICLE_PALETTE[type])]));
    this.vehicleColors.set('camera-highlight', new THREE.Color('#f1d87a'));
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
    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false);
    window.addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    this.resizeObserver?.observe(this.host);
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
      this.gl = this.renderer.getContext();
      this.gpuTimerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
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
    this.ambientLight = new THREE.HemisphereLight('#d9f2ff', '#394943', 2.15);
    this.scene.add(this.ambientLight);
    const sun = new THREE.DirectionalLight('#fff0d3', 3.1);
    sun.position.set(-5, 11, 6);
    sun.castShadow = false;
    this.sun = sun;
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
    validateCity3DScene(this.scene);
  }

  addGround() {
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: '#566c5c', roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), this.groundMaterial);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.04; ground.receiveShadow = true; this.scene.add(ground);
    const water = new THREE.Mesh(new THREE.BoxGeometry(.3, .012, 18), new THREE.MeshBasicMaterial({ color: '#478a9a', toneMapped: false }));
    water.position.set(-5.1, -.018, .2); this.scene.add(water);
  }

  addRoadNetwork() {
    const nodes = SITS_INTERSECTIONS.map((node) => ({ ...node, ...project(node.lat, node.lng) }));
    const edges = resolveCity3DRoadTopology(nodes);
    this.edges = edges;
    this.nodeById = new Map(nodes.map((node) => [String(node.id), node]));
    this.edgeIndicesByNode = new Map(nodes.map((node) => [String(node.id), []]));
    edges.forEach((edge, index) => {
      this.edgeIndicesByNode.get(String(edge.a.id))?.push(index);
      this.edgeIndicesByNode.get(String(edge.b.id))?.push(index);
    });
    this.cameraRouteCache = new Map();
    for (const cameraId of ['cctvCanvas1', 'cctvCanvas2', 'cctvCanvas3', 'cctvCanvas4']) {
      const config = trafficCameraConfig(cameraId);
      const cameraDefinition = CAMERA_DEFINITIONS.find((item) => item.id === cameraId);
      const anchorId = config?.city3dAnchorNodeId || cameraDefinition?.city3dAnchorNodeId || config?.nodeId || cameraDefinition?.nodeId;
      const anchor = anchorId ? this.nodeById.get(String(anchorId)) || null : null;
      this.cameraRouteCache.set(cameraId, { config, anchor, edges: anchor ? this.edgeIndicesByNode.get(String(anchor.id)) || [] : [] });
    }
    const road = new THREE.MeshStandardMaterial({ color: '#374247', roughness: .88, metalness: .02 });
    this.roadMaterial = road;
    const sidewalk = new THREE.MeshStandardMaterial({ color: '#829087', roughness: .94, metalness: 0 });
    const marking = new THREE.LineBasicMaterial({ color: '#d3c99d', transparent: true, opacity: .62 });
    const roadData = { positions: [], indices: [] }, sidewalkData = { positions: [], indices: [] };
    const overlayData = { positions: [], indices: [], colors: [] }, markingPositions = [];
    const appendQuad = (data, edge, width, y, color) => {
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
      const length = Math.max(.001, Math.hypot(dx, dz));
      const nx = -dz / length * width / 2, nz = dx / length * width / 2;
      const offset = data.positions.length / 3;
      data.positions.push(edge.a.x + nx, y, edge.a.z + nz, edge.a.x - nx, y, edge.a.z - nz, edge.b.x - nx, y, edge.b.z - nz, edge.b.x + nx, y, edge.b.z + nz);
      data.indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
      if (data.colors && color) for (let index = 0; index < 4; index++) data.colors.push(color.r, color.g, color.b);
    };
    const addBatch = (data, material) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      if (data.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
      geometry.setIndex(data.indices); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
    };
    for (const edge of edges) {
      appendQuad(roadData, edge, .24, .025);
      appendQuad(sidewalkData, edge, .34, -.005);
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
      const length = Math.hypot(dx, dz);
      const nx = -dz / length * .125, nz = dx / length * .125;
      markingPositions.push(edge.a.x + nx, .04, edge.a.z + nz, edge.b.x + nx, .04, edge.b.z + nz);
      const vertexStart = overlayData.positions.length / 3;
      appendQuad(overlayData, edge, .2, .047, new THREE.Color('#45dfb4'));
      this.roadOverlays.push({ edge, vertexStart });
    }
    const localEdges = [];
    for (let i = 0; i < 9; i++) {
      const z = -4.6 + i * 1.15;
      if (i % 2 === 0) localEdges.push({ a: { x: -7.2, z }, b: { x: 7.2, z } });
      const x = -6.2 + i * 1.55;
      if (i % 2 !== 0) localEdges.push({ a: { x, z: -7.2 }, b: { x, z: 7.2 } });
    }
    localEdges.forEach((edge) => appendQuad(roadData, edge, .1, .018));
    const streetLightPoints = [];
    for (const edge of localEdges) {
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
      const length = Math.hypot(dx, dz), nx = -dz / length, nz = dx / length;
      for (let distance = 1.35; distance < length; distance += 3.5) {
        const side = distance % 7 < 3.5 ? 1 : -1;
        streetLightPoints.push({ x: edge.a.x + dx / length * distance + nx * side * .3, z: edge.a.z + dz / length * distance + nz * side * .3 });
      }
    }
    const streetPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.012, .02, 1, 5), new THREE.MeshStandardMaterial({ color: '#3b4645', roughness: .65, metalness: .55 }), streetLightPoints.length);
    const streetLamps = new THREE.InstancedMesh(new THREE.SphereGeometry(.055, 6, 5), new THREE.MeshStandardMaterial({ color: '#f7e6b7', emissive: '#f0ba65', emissiveIntensity: .08, roughness: .3 }), streetLightPoints.length);
    streetLightPoints.forEach((point, index) => {
      this.tmpObject.position.set(point.x, .52, point.z); this.tmpObject.scale.set(1, 1.1, 1); this.tmpObject.updateMatrix(); streetPoles.setMatrixAt(index, this.tmpObject.matrix);
      this.tmpObject.position.set(point.x, 1.08, point.z); this.tmpObject.scale.set(1, 1, 1); this.tmpObject.updateMatrix(); streetLamps.setMatrixAt(index, this.tmpObject.matrix);
    });
    streetPoles.instanceMatrix.needsUpdate = true; streetLamps.instanceMatrix.needsUpdate = true;
    this.streetLampMesh = streetLamps; this.scene.add(streetPoles, streetLamps);
    addBatch(roadData, road); addBatch(sidewalkData, sidewalk);
    this.roadOverlayMesh = addBatch(overlayData, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .72, depthWrite: false, toneMapped: false }));
    this.roadOverlayMesh.position.y = .001;
    const markingGeometry = new THREE.BufferGeometry(); markingGeometry.setAttribute('position', new THREE.Float32BufferAttribute(markingPositions, 3));
    this.scene.add(new THREE.LineSegments(markingGeometry, marking));
    const crosswalkPositions = [];
    for (const node of nodes) {
      const connected = this.edgeIndicesByNode.get(String(node.id)) || [];
      if (!connected.length) continue;
      for (const edgeIndex of connected.slice(0, 2)) {
        const edge = edges[edgeIndex];
        const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
        const length = Math.max(.001, Math.hypot(dx, dz));
        const nx = -dz / length, nz = dx / length;
        const towardA = edge.a.id === node.id ? 1 : -1;
        for (let stripe = 0; stripe < 5; stripe++) {
          const center = .12 + stripe * .045;
          const x = node.x + dx / length * center * towardA;
          const z = node.z + dz / length * center * towardA;
          const half = .014;
          crosswalkPositions.push(x + nx * half, .052, z + nz * half, x - nx * half, .052, z - nz * half);
        }
      }
    }
    const crosswalkGeometry = new THREE.BufferGeometry();
    crosswalkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(crosswalkPositions, 3));
    const crosswalk = new THREE.LineSegments(crosswalkGeometry, new THREE.LineBasicMaterial({ color: '#ebe5cc', transparent: true, opacity: .78 }));
    crosswalk.renderOrder = 2; this.scene.add(crosswalk);
    this.scene.userData.nodes = nodes;
  }

  addBlocksAndTrees() {
    const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#bdc4b9', roughness: .85 }), 180);
    buildings.castShadow = true; buildings.receiveShadow = true; buildings.userData.kind = 'building';
    let buildingIndex = 0;
    const windowMatrices = [];
    const windowColors = [];
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(.14, .58, 5), new THREE.MeshStandardMaterial({ color: '#517d5e', roughness: 1 }), 90);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.035, .045, .25, 5), new THREE.MeshStandardMaterial({ color: '#76604a' }), 90);
    let treeIndex = 0;
    buildingGrid: for (let ix = 0; ix < 18; ix++) for (let iz = 0; iz < 18; iz++) {
      const x = -6.7 + ix * .78, z = -6.7 + iz * .78;
      const n = ix * 18 + iz;
      if (Math.abs(Math.sin(x * .82)) < .13 || Math.abs(Math.sin(z * .82)) < .12 || seeded(n) < .22) continue;
      if (buildingIndex >= buildings.instanceMatrix.count) break buildingGrid;
      const width = .26 + seeded(n + 9) * .34;
      const depth = .25 + seeded(n + 17) * .34;
      const height = .35 + seeded(n + 27) * (ix % 3 === 0 ? 1.75 : .88);
      this.tmpObject.position.set(x, height / 2, z); this.tmpObject.scale.set(width, height, depth); this.tmpObject.rotation.y = seeded(n + 41) * .35; this.tmpObject.updateMatrix();
      buildings.setMatrixAt(buildingIndex, this.tmpObject.matrix);
      buildings.setColorAt(buildingIndex, new THREE.Color(['#bcc5bb', '#b8c5c4', '#cbbfae', '#aab8b7'][n % 4]));
      const floors = Math.max(1, Math.floor(height / .32));
      const panes = Math.max(1, Math.floor(width / .15));
      for (let floor = 0; floor < floors; floor++) for (let pane = 0; pane < panes; pane++) {
        const paneX = x - width * .34 + pane * width * .68 / Math.max(1, panes - 1);
        const paneY = .12 + floor * .27;
        const paneWidth = Math.min(.085, width * .23);
        const warm = seeded(n + floor * 19 + pane * 7) > .78;
        const paneColor = new THREE.Color(warm ? '#edbd73' : '#83a9aa');
        for (const side of [-1, 1]) {
          this.tmpObject.position.set(paneX, paneY, z + side * (depth / 2 + .006));
          this.tmpObject.scale.set(paneWidth, .082, .009); this.tmpObject.rotation.set(0, 0, 0); this.tmpObject.updateMatrix();
          windowMatrices.push(this.tmpObject.matrix.clone()); windowColors.push(paneColor);
        }
        for (const side of [-1, 1]) {
          this.tmpObject.position.set(x + side * (width / 2 + .006), paneY, z - depth * .28 + pane * depth * .56 / Math.max(1, panes - 1));
          this.tmpObject.scale.set(paneWidth, .082, .009); this.tmpObject.rotation.set(0, side * Math.PI / 2, 0); this.tmpObject.updateMatrix();
          windowMatrices.push(this.tmpObject.matrix.clone()); windowColors.push(paneColor);
        }
      }
      buildingIndex++;
      if (treeIndex < trees.count && seeded(n + 53) > .47) {
        this.tmpObject.position.set(x + .28, .38, z + .26); this.tmpObject.scale.setScalar(.75 + seeded(n + 61) * .55); this.tmpObject.updateMatrix(); trees.setMatrixAt(treeIndex, this.tmpObject.matrix);
        this.tmpObject.position.y = .13; this.tmpObject.scale.setScalar(1); this.tmpObject.updateMatrix(); trunks.setMatrixAt(treeIndex, this.tmpObject.matrix); treeIndex++;
      }
    }
    buildings.count = Math.min(buildingIndex, buildings.instanceMatrix.count);
    trees.count = treeIndex; trunks.count = treeIndex;
    buildings.instanceMatrix.needsUpdate = true; if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    trees.instanceMatrix.needsUpdate = true; trunks.instanceMatrix.needsUpdate = true;
    this.scene.add(buildings, trees, trunks);
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#fff4ce', roughness: .3, metalness: .08, emissive: '#263536', emissiveIntensity: .2 }), Math.max(1, windowMatrices.length));
    windows.count = windowMatrices.length;
    windowMatrices.forEach((matrix, index) => { windows.setMatrixAt(index, matrix); windows.setColorAt(index, windowColors[index]); });
    windows.instanceMatrix.needsUpdate = true; if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    windows.userData.kind = 'building-detail'; this.buildingWindows = windows; this.scene.add(windows);
  }

  addIntersections() {
    const nodes = this.scene.userData.nodes;
    const marker = new THREE.InstancedMesh(new THREE.CylinderGeometry(.27, .31, .06, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#146870', emissiveIntensity: .45, roughness: .42 }), nodes.length);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.018, .025, .62, 6), new THREE.MeshStandardMaterial({ color: '#263637' }), nodes.length);
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(.075, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#1da781', emissiveIntensity: 1.3 }), nodes.length);
    this.intersectionInstances = nodes.map((data, index) => ({ kind: 'intersection', id: data.id, name: data.name, data, x: data.x, z: data.z, index }));
    nodes.forEach((data, index) => {
      this.tmpObject.position.set(data.x, .09, data.z); this.tmpObject.updateMatrix(); marker.setMatrixAt(index, this.tmpObject.matrix);
      this.tmpObject.position.set(data.x + .31, .36, data.z + .22); this.tmpObject.updateMatrix(); poles.setMatrixAt(index, this.tmpObject.matrix);
      this.tmpObject.position.set(data.x + .31, .68, data.z + .22); this.tmpObject.updateMatrix(); lamps.setMatrixAt(index, this.tmpObject.matrix);
      marker.setColorAt(index, new THREE.Color('#5bdce1')); lamps.setColorAt(index, new THREE.Color('#45d8b3'));
      this.intersectionObjects.set(data.id, index);
    });
    this.intersectionMarkerMesh = marker; this.intersectionPoleMesh = poles; this.intersectionLampMesh = lamps;
    marker.userData.kind = 'intersection'; marker.castShadow = true;
    this.scene.add(marker, poles, lamps); this.raycastTargets.push(marker);
  }

  addCameras() {
    const virtualCameraDefinitions = CAMERA_DEFINITIONS.filter((item) => item.id.startsWith('cctvCanvas'));
    const baseMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.08, .12, .13, 8), new THREE.MeshStandardMaterial({ color: '#33494b' }), virtualCameraDefinitions.length);
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.024, .035, .72, 7), new THREE.MeshStandardMaterial({ color: '#546466' }), virtualCameraDefinitions.length);
    const cameraMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, .105, .14), new THREE.MeshStandardMaterial({ color: '#49ced9', emissive: '#0d4850', emissiveIntensity: .9 }), virtualCameraDefinitions.length);
    this.cameraInstances = [];
    for (const [cameraIndex, definition] of virtualCameraDefinitions.entries()) {
      const config = trafficCameraConfig(definition.id);
      const mappedNode = config?.nodeId ? this.nodeById.get(String(config.nodeId)) : null;
      const coordinates = config?.city3dCoordinates;
      const p = mappedNode ? { x: mappedNode.x, z: mappedNode.z } : Array.isArray(coordinates) && coordinates.length === 2 ? project(Number(coordinates[0]), Number(coordinates[1])) : null;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const row = { kind: 'camera', id: definition.id, name: definition.name, data: definition, nodeId: config?.nodeId || null, x: p.x, z: p.z, index: cameraIndex };
      this.cameraInstances.push(row); this.cameraObjects.set(row.id, row);
      this.tmpObject.position.set(p.x, .08, p.z); this.tmpObject.rotation.set(0, 0, 0); this.tmpObject.updateMatrix(); baseMesh.setMatrixAt(cameraIndex, this.tmpObject.matrix);
      this.tmpObject.position.set(p.x, .47, p.z); this.tmpObject.updateMatrix(); poleMesh.setMatrixAt(cameraIndex, this.tmpObject.matrix);
      this.tmpObject.position.set(p.x + .045, .85, p.z); this.tmpObject.rotation.set(0, -.42, 0); this.tmpObject.updateMatrix(); cameraMesh.setMatrixAt(cameraIndex, this.tmpObject.matrix);
    }
    cameraMesh.userData.kind = 'camera'; this.cameraBodyMesh = cameraMesh;
    this.scene.add(baseMesh, poleMesh, cameraMesh); this.raycastTargets.push(cameraMesh);
  }

  addVehicleInstances() {
    const capacity = 60;
    const maxVehicles = capacity * VEHICLE_TYPES.length;
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-.40, -.5); bodyShape.lineTo(.40, -.5); bodyShape.lineTo(.5, -.32); bodyShape.lineTo(.5, .32);
    bodyShape.lineTo(.40, .5); bodyShape.lineTo(-.40, .5); bodyShape.lineTo(-.5, .32); bodyShape.lineTo(-.5, -.32); bodyShape.closePath();
    const bodyGeometry = new THREE.ExtrudeGeometry(bodyShape, { depth: .72, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .035, bevelThickness: .035 });
    bodyGeometry.rotateX(-Math.PI / 2); bodyGeometry.translate(0, .36, 0); bodyGeometry.computeVertexNormals();
    const makePart = (geometry, material, kind, count = maxVehicles) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.count = 0; mesh.userData.kind = kind; mesh.userData.instances = [];
      this.scene.add(mesh); return mesh;
    };
    this.vehicleBodyMesh = makePart(bodyGeometry, new THREE.MeshStandardMaterial({ color: '#dce4e3', roughness: .34, metalness: .3 }), 'vehicle');
    this.vehicleCabinMesh = makePart(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#71868a', roughness: .26, metalness: .22 }), 'vehicle-detail');
    this.vehicleGlassMesh = makePart(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#27444b', roughness: .18, metalness: .28, emissive: '#071316', emissiveIntensity: .3 }), 'vehicle-detail');
    this.vehicleWheelMesh = makePart(new THREE.CylinderGeometry(1, 1, .34, 8), new THREE.MeshStandardMaterial({ color: '#202728', roughness: .92 }), 'vehicle-detail', maxVehicles * 4);
    this.vehicleHeadlightMesh = makePart(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#fff0bf', toneMapped: false }), 'vehicle-detail', maxVehicles * 2);
    this.vehicleTailLightMesh = makePart(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ed5c51', toneMapped: false }), 'vehicle-detail', maxVehicles * 2);
    this.vehicleShadowMesh = makePart(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: '#0b1114', transparent: true, opacity: .24, depthWrite: false }), 'vehicle-detail');
    this.vehicleShadowMesh.renderOrder = 1;
    this.vehicleMeshes = new Map([['all', this.vehicleBodyMesh]]);
    this.headlightMeshes = new Map([['all', this.vehicleHeadlightMesh]]);
    this.raycastTargets.push(this.vehicleBodyMesh);
    this.vehicleFrame = null;
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
    const trafficByNode = new Map(this.corridors.map((item) => [String(item.intersectionId), item]));
    const hour = Number(model.hour);
    const visualEnvironment = state.visualEnvironment || {};
    const timeOfDay = ['morning', 'day', 'evening', 'night'].includes(visualEnvironment.timeOfDay) ? visualEnvironment.timeOfDay : null;
    const weather = ['clear', 'cloudy', 'light-rain', 'heavy-rain'].includes(visualEnvironment.weather) ? visualEnvironment.weather : null;
    const night = timeOfDay ? timeOfDay === 'night' : hour >= 19 || hour < 6;
    const evening = timeOfDay ? timeOfDay === 'evening' : hour >= 16 && hour < 19;
    const morning = timeOfDay ? timeOfDay === 'morning' : hour >= 6 && hour < 11;
    const simulationWet = Boolean(state.isRainMode || state.roadCondition === 'wet');
    const wet = Boolean(simulationWet || weather?.includes('rain'));
    const effectiveWeather = simulationWet && !weather?.includes('rain') ? 'light-rain' : weather || (wet ? 'light-rain' : 'clear');
    const cloudy = Boolean(weather === 'cloudy' || state.isCloudy || state.weather === 'cloudy');
    const heavyRain = weather === 'heavy-rain' || state.weather === 'heavy-rain';
    this.night = night;
    if (this.host?.dataset) this.host.dataset.visualEnvironment = `${timeOfDay || (night ? 'night' : evening ? 'evening' : morning ? 'morning' : 'day')}:${effectiveWeather}`;
    const environmentKey = `${timeOfDay || ''}:${weather || ''}:${night}:${evening}:${wet}:${cloudy}`;
    if (environmentKey !== this.environmentKey) {
      this.environmentKey = environmentKey;
      const sky = night ? '#101a29' : cloudy ? '#98a9aa' : evening ? '#d5aa91' : morning ? '#bdcdd0' : '#c5d6d1';
      this.scene.background.set(sky); this.scene.fog.color.set(sky);
      this.sun.intensity = night ? 0.42 : cloudy ? 1.65 : 3.1;
      this.ambientLight.intensity = night ? 1.35 : cloudy ? 2.35 : 2.15;
      this.sun.color.set(night ? '#8ba9df' : cloudy ? '#d4e0df' : evening ? '#ffd0a0' : '#fff0d3');
      if (this.streetLampMesh) this.streetLampMesh.material.emissiveIntensity = night ? 1.35 : .08;
      this.renderer.toneMappingExposure = night ? 1.16 : cloudy ? 1.02 : 1.1;
      this.rain.visible = wet;
      this.rain.geometry.setDrawRange(0, wet ? (heavyRain ? 900 : 460) : 0);
      this.groundMaterial.roughness = wet ? .42 : 1;
      this.groundMaterial.metalness = wet ? .12 : 0;
      this.roadMaterial.roughness = wet ? .33 : .88;
      this.roadMaterial.metalness = wet ? .18 : .02;
      this.roadMaterial.color.set(wet ? '#435257' : '#374247');
      this.vehicleHeadlightMesh.visible = night;
      this.vehicleTailLightMesh.visible = night;
      this.buildingWindows.material.emissiveIntensity = night ? .8 : .12;
    }
    for (const node of state.intersections || []) {
      const index = this.intersectionObjects.get(String(node.id)); if (index == null) continue;
      const corridor = trafficByNode.get(String(node.id));
      const trafficColor = tintByTraffic(corridor?.speedKmh ?? node.speedKmh, corridor?.queueVehicles ?? node.queueVehicles);
      this.intersectionMarkerMesh.setColorAt(index, new THREE.Color(trafficColor));
      this.intersectionInstances[index] = { ...this.intersectionInstances[index], data: { ...this.intersectionInstances[index].data, ...node, corridor } };
      this.intersectionLampMesh.setColorAt(index, new THREE.Color(String(node.state || '').toLowerCase() === 'red' ? '#ff5f64' : String(node.state || '').toLowerCase() === 'yellow' ? '#f4b94f' : '#45dfb4'));
    }
    if (this.intersectionMarkerMesh.instanceColor) this.intersectionMarkerMesh.instanceColor.needsUpdate = true;
    if (this.intersectionLampMesh.instanceColor) this.intersectionLampMesh.instanceColor.needsUpdate = true;
    const colors = this.roadOverlayMesh?.geometry.getAttribute('color');
    for (const { edge, vertexStart } of this.roadOverlays) {
      const traffic = trafficByNode.get(String(edge.b.id)) || trafficByNode.get(String(edge.a.id));
      this.tmpColor.set(tintByTraffic(traffic?.speedKmh, traffic?.queueVehicles));
      for (let index = 0; index < 4; index++) colors?.setXYZ(vertexStart + index, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    }
    if (colors) colors.needsUpdate = true;
    if (this.roadOverlayMesh) this.roadOverlayMesh.visible = this.layerVisibility.density;
    this.syncIncidents(state.incidents || []);
    this.syncDevices(state.devices || []);
    if (state.cctvVisionData && state.cctvVisionData !== this.vehicleFrame) this.syncCctvVehicles(state.cctvVisionData);
    this._updateAmbientForWeather(wet, night, heavyRain);
  }

  setQuality(name) {
    const profile = QUALITY_PROFILES[name];
    if (!profile || name === this.quality) return;
    this.quality = name;
    this.targetFps = profile.targetFps;
    this.pixelRatio = profile.pixelRatio;
    this.renderer?.setPixelRatio(this.pixelRatio);
    const showFineDetails = name !== 'low';
    if (this.buildingWindows) this.buildingWindows.visible = showFineDetails;
    if (this.streetLampMesh) this.streetLampMesh.visible = showFineDetails;
    if (this.vehicleWheelMesh) this.vehicleWheelMesh.visible = showFineDetails;
    if (this.vehicleGlassMesh) this.vehicleGlassMesh.visible = showFineDetails;
    if (this.renderer && this.sun) {
      this.renderer.shadowMap.enabled = profile.shadows;
      this.sun.castShadow = profile.shadows;
      this.sun.shadow.mapSize.set(profile.shadows ? 768 : 256, profile.shadows ? 768 : 256);
      this.sun.shadow.needsUpdate = true;
    }
    this.resize();
    this.callbacks.onQuality?.(name);
  }

  syncCctvVehicles(framePayload = {}) {
    if (!framePayload || !framePayload.cameras) return;
    this.cameraFrames ||= new Map();
    const changedCameraIds = [];
    for (const [cameraId, cameraFrame] of Object.entries(framePayload.cameras)) {
      const previous = this.cameraFrames.get(cameraId);
      const sequence = Number(cameraFrame.sequence || cameraFrame.seq || 0);
      const previousSequence = Number(previous?.sequence || previous?.seq || 0);
      const timestamp = Number(cameraFrame.timestamp || 0);
      const previousTimestamp = Number(previous?.timestamp || 0);
      if (!previous || sequence > previousSequence || (sequence === previousSequence && timestamp >= previousTimestamp)) {
        if (cameraFrame !== previous) changedCameraIds.push(cameraId);
        this.cameraFrames.set(cameraId, cameraFrame);
      }
    }
    const nextByType = new Map(VEHICLE_TYPES.map((type) => [type, []]));
    this.vehicleRowsByCamera ||= new Map();
    for (const cameraId of changedCameraIds) {
      const cameraFrame = this.cameraFrames.get(cameraId);
      const route = this.cameraRouteCache.get(cameraId);
      const config = route?.config;
      if (!cameraFrame || !config) continue;
      const anchor = route.anchor;
      const connected = route.edges;
      if (!connected.length) continue;
      const detectionRows = Array.isArray(cameraFrame.detections) ? cameraFrame.detections : [];
      const cameraRows = [];
      for (const detection of detectionRows) {
        const type = VEHICLE_TYPES.includes(detection.class) ? detection.class : 'car';
        const edge = this.edges[connected[(Number(detection.lane || 0) + (detection.movement === 'left' ? 1 : detection.movement === 'right' ? connected.length - 1 : 0) + connected.length) % connected.length]];
        const near = edge.a.id === anchor.id ? edge.a : edge.b;
        const far = edge.a.id === anchor.id ? edge.b : edge.a;
        const reversed = Number(detection.direction) < 0;
        const start = reversed ? near : far;
        const end = reversed ? far : near;
        const progress = clamp(Number(detection.progress) || 0, 0, 1);
        const cameraProjection = projectTrafficVehicle({ ...detection, progress, cameraScene: config.scene }, config.scene);
        const t = progress;
        const dx = end.x - start.x, dz = end.z - start.z;
        const length = Math.max(.001, Math.hypot(dx, dz));
        const laneOffset = (Number(detection.lane || 0) - 1.5) * .035 * (reversed ? -1 : 1);
        const turnBlend = detection.movement === 'through' ? 0 : clamp((progress - .68) / .32, 0, 1);
        const turnSign = detection.movement === 'left' ? 1 : detection.movement === 'right' ? -1 : 0;
        const curve = turnSign * turnBlend * turnBlend * .22;
        const id = String(detection.id || detection.trackId || `${cameraId}-vehicle-${cameraRows.length}`);
        const previousVisual = this.vehicleVisuals.get(id);
        const x = mix(start.x, end.x, t) - (dz / length) * (laneOffset + curve);
        const z = mix(start.z, end.z, t) + (dx / length) * (laneOffset + curve);
        const heading = Math.atan2(dx, dz) + (reversed ? Math.PI : 0) + turnSign * turnBlend * .42;
        const vehicle = {
          ...detection,
          id,
          type,
          cameraId,
          simulationSequence: Number(cameraFrame.sequence || framePayload.seq || 0),
          simulationTimestamp: Number(cameraFrame.timestamp || framePayload.timestamp || 0),
          provenance: 'SIMULATED',
          x, z, heading,
          visualX: previousVisual?.x ?? x,
          visualZ: previousVisual?.z ?? z,
          visualHeading: previousVisual?.heading ?? heading,
          transitionElapsed: 0,
          visualDepth: cameraProjection.depth,
          braking: Boolean(detection.braking || detection.stopped),
          speedKmh: Number(detection.speedKmh) || 0
        };
        cameraRows.push(vehicle);
      }
      this.vehicleRowsByCamera.set(cameraId, cameraRows);
    }

    this.vehicleFrame = framePayload;
    const vehicleRows = [];
    for (const rows of this.vehicleRowsByCamera.values()) for (const vehicle of rows) vehicleRows.push(vehicle);
    const liveVehicleIds = new Set(vehicleRows.map((vehicle) => vehicle.id));
    for (const id of this.vehicleVisuals.keys()) if (!liveVehicleIds.has(id)) this.vehicleVisuals.delete(id);
    let sequence = Number(framePayload.seq || framePayload.sequence || 0), timestamp = Number(framePayload.timestamp || 0);
    if (!sequence || !timestamp) for (const frame of this.cameraFrames.values()) {
      sequence = Math.max(sequence, Number(frame.sequence || frame.seq || 0));
      timestamp = Math.max(timestamp, Number(frame.timestamp || 0));
    }
    this.vehicleFrameMetadata = { sequence, timestamp, source: framePayload.source || 'SIMULATED', vehicleCount: vehicleRows.length, vehicleIds: vehicleRows.map((vehicle) => vehicle.id) };
    for (const vehicle of vehicleRows) nextByType.get(vehicle.type)?.push(vehicle);
    const vehicles = [];
    for (const type of VEHICLE_TYPES) for (const vehicle of nextByType.get(type).slice(0, 60)) { vehicle.meshType = type; vehicle.meshIndex = vehicles.length; vehicles.push(vehicle); }
    for (const mesh of [this.vehicleBodyMesh, this.vehicleCabinMesh, this.vehicleGlassMesh, this.vehicleShadowMesh]) { mesh.count = vehicles.length; mesh.userData.instances = vehicles; }
    this.vehicleWheelMesh.count = vehicles.length * 4;
    this.vehicleHeadlightMesh.count = vehicles.length * 2;
    this.vehicleTailLightMesh.count = vehicles.length * 2;
    vehicles.forEach((vehicle, index) => {
      const type = vehicle.meshType;
      const color = this.vehicleColors.get(vehicle.cameraId === 'cctvCanvas3' ? 'camera-highlight' : type);
      this.vehicleBodyMesh.setColorAt(index, color);
      this.vehicleCabinMesh.setColorAt(index, type === 'ambulance' ? new THREE.Color('#e7e9e3') : new THREE.Color('#52666a'));
    });
    this.vehicleBodyMesh.instanceMatrix.needsUpdate = true;
    if (this.vehicleBodyMesh.instanceColor) this.vehicleBodyMesh.instanceColor.needsUpdate = true;
    if (this.vehicleCabinMesh.instanceColor) this.vehicleCabinMesh.instanceColor.needsUpdate = true;
    this.updateVehicles(0);
    for (const mesh of [this.vehicleBodyMesh, this.vehicleCabinMesh, this.vehicleGlassMesh, this.vehicleWheelMesh, this.vehicleHeadlightMesh, this.vehicleTailLightMesh, this.vehicleShadowMesh]) validateInstancedMesh(mesh);
    this.callbacks.onVehicleFrame?.(this.vehicleFrameMetadata);
  }

  updateVehicles(delta) {
    const dt = Math.min(.1, Math.max(0, Number(delta) || 0));
    const vehicles = this.vehicleBodyMesh.userData.instances || [];
    const setPart = (mesh, slot, vehicle, heading, lx, ly, lz, sx, sy, sz, rotationX = 0) => {
      const c = Math.cos(heading), s = Math.sin(heading);
      this.tmpObject.position.set(vehicle.renderX + c * lx + s * lz, ly, vehicle.renderZ - s * lx + c * lz);
      this.tmpObject.rotation.set(rotationX, heading, 0); this.tmpObject.scale.set(sx, sy, sz); this.tmpObject.updateMatrix(); mesh.setMatrixAt(slot, this.tmpObject.matrix);
    };
    for (let index = 0; index < vehicles.length; index++) {
      const vehicle = vehicles[index], [width, height, length] = VEHICLE_DIMENSIONS[vehicle.meshType] || VEHICLE_DIMENSIONS.car;
      vehicle.transitionElapsed = Math.min(.3, vehicle.transitionElapsed + dt);
      const t = vehicle.transitionElapsed >= .3 ? 1 : vehicle.transitionElapsed / .3;
      const eased = t * t * (3 - 2 * t);
      const x = vehicle.visualX + (vehicle.x - vehicle.visualX) * eased;
      const z = vehicle.visualZ + (vehicle.z - vehicle.visualZ) * eased;
      const angleDelta = ((vehicle.heading - vehicle.visualHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const heading = vehicle.visualHeading + angleDelta * eased;
      vehicle.renderX = x; vehicle.renderZ = z; vehicle.renderHeading = heading;
      let visual = this.vehicleVisuals.get(vehicle.id);
      if (!visual) { visual = { x, z, heading }; this.vehicleVisuals.set(vehicle.id, visual); }
      else { visual.x = x; visual.z = z; visual.heading = heading; }
      const bodyY = height * .52;
      setPart(this.vehicleBodyMesh, index, vehicle, heading, 0, bodyY, 0, width, height, length);
      setPart(this.vehicleShadowMesh, index, vehicle, heading, 0, .033, 0, width * .68, 1, length * .55, -Math.PI / 2);
      const cabinWidth = width * (vehicle.meshType === 'bus' ? .84 : .68);
      const cabinHeight = height * (vehicle.meshType === 'motorcycle' ? .28 : .56);
      const cabinLength = length * (vehicle.meshType === 'bus' ? .63 : .46);
      setPart(this.vehicleCabinMesh, index, vehicle, heading, 0, bodyY + height * .48, -length * .055, cabinWidth, cabinHeight, cabinLength);
      setPart(this.vehicleGlassMesh, index, vehicle, heading, 0, bodyY + height * .52, length * .17, cabinWidth * .83, cabinHeight * .17, Math.max(.014, length * .12));
      for (let wheel = 0; wheel < 4; wheel++) {
        const side = wheel % 2 ? 1 : -1, axle = wheel < 2 ? 1 : -1;
        setPart(this.vehicleWheelMesh, index * 4 + wheel, vehicle, heading, side * width * .45, Math.max(.022, height * .28), axle * length * .29, Math.max(.012, width * .11), Math.max(.018, height * .32), Math.max(.018, width * .22), Math.PI / 2);
      }
      for (let lamp = 0; lamp < 2; lamp++) {
        const side = lamp ? 1 : -1;
        setPart(this.vehicleHeadlightMesh, index * 2 + lamp, vehicle, heading, side * width * .31, bodyY + height * .05, length * .49, width * .15, height * .16, Math.max(.012, length * .055));
        setPart(this.vehicleTailLightMesh, index * 2 + lamp, vehicle, heading, side * width * .34, bodyY + height * .04, -length * .49, width * .11, height * .2, Math.max(.01, length * .025));
      }
    }
    if (vehicles.length) for (const mesh of [this.vehicleBodyMesh, this.vehicleCabinMesh, this.vehicleGlassMesh, this.vehicleWheelMesh, this.vehicleHeadlightMesh, this.vehicleTailLightMesh, this.vehicleShadowMesh]) mesh.instanceMatrix.needsUpdate = true;
    if (this.rain.visible) this.rain.position.z += dt * .28;
  }

  _updateAmbientForWeather(rain, night, heavy = false) { this.rain.visible = rain; this.rain.material.opacity = night ? (heavy ? .56 : .42) : (heavy ? .76 : .58); }

  resolveSpatialPosition(entity = {}) {
    const nodes = this.scene.userData.nodes;
    const nodeId = entity.intersectionId || entity.nodeId;
    const byId = nodeId == null ? null : nodes.find((node) => String(node.id) === String(nodeId));
    if (byId) return byId;
    const coordinates = entity.coordinates;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const [first, second] = coordinates.map(Number);
      const latitude = Math.abs(first) <= 90 ? first : second;
      const longitude = Math.abs(first) <= 90 ? second : first;
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -7.5 && latitude <= -7.1 && longitude >= 112.5 && longitude <= 113) {
        return project(latitude, longitude);
      }
    }
    const location = String(entity.location || entity.name || '').toLowerCase();
    if (!location) return null;
    const aliases = {
      'node-wonokromo': ['wonokromo', 'a. yani', 'ahmad yani', 'dtc'],
      'node-jemursari': ['jemursari'], 'node-darmo': ['darmo', 'bungkul'],
      'node-tunjungan': ['tunjungan', 'siola'], 'node-kertajaya': ['kertajaya', 'dharmawangsa'],
      'node-sungkono': ['sungkono', 'tvri'], 'node-merr': ['merr']
    };
    return nodes.find((node) => (aliases[node.id] || []).some((alias) => location.includes(alias))) || null;
  }

  reportUnmappedSpatialEntities() {
    this.callbacks.onLocationIntegrity?.({ unmappedCount: this.unmappedSpatialEntities.size, entityKeys: [...this.unmappedSpatialEntities] });
  }

  syncIncidents(incidents) {
    const impacting = incidents.filter((item) => !item.roadImpactRecoveredAt && item.roadImpactRecovered !== true);
    const keep = new Set(impacting.map((item) => String(item.id)));
    for (const [id, object] of this.incidentObjects) if (!keep.has(id)) { this.scene.remove(object); object.geometry.dispose(); object.material.dispose(); this.raycastTargets = this.raycastTargets.filter((target) => target !== object); this.incidentObjects.delete(id); }
    for (const key of this.unmappedSpatialEntities) if (key.startsWith('incident:') && !keep.has(key.slice('incident:'.length))) this.unmappedSpatialEntities.delete(key);
    for (const item of impacting) {
      const id = String(item.id);
      const pos = this.resolveSpatialPosition(item);
      if (!pos) {
        this.unmappedSpatialEntities.add(`incident:${id}`);
        const previous = this.incidentObjects.get(id);
        if (previous) { this.scene.remove(previous); previous.geometry.dispose(); previous.material.dispose(); this.incidentObjects.delete(id); this.raycastTargets = this.raycastTargets.filter((target) => target !== previous); }
        continue;
      }
      this.unmappedSpatialEntities.delete(`incident:${id}`);
      if (this.incidentObjects.has(id)) { const existing = this.incidentObjects.get(id); existing.position.set(pos.x, .35, pos.z); existing.userData.data = item; continue; }
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.19, 0), new THREE.MeshStandardMaterial({ color: '#ff5964', emissive: '#8a1625', emissiveIntensity: 1.4 }));
      marker.position.set(pos.x, .35, pos.z); marker.userData = { kind: 'incident', id, name: item.title || `Insiden ${id}`, data: item };
      this.incidentObjects.set(id, marker); this.scene.add(marker); this.raycastTargets.push(marker);
    }
    this.reportUnmappedSpatialEntities();
  }

  syncDevices(devices) {
    const keep = new Set(devices.map((device) => String(device.deviceId || device.id)));
    for (const [id, object] of this.deviceObjects) if (!keep.has(id)) { this.scene.remove(object); object.geometry.dispose(); object.material.dispose(); this.raycastTargets = this.raycastTargets.filter((target) => target !== object); this.deviceObjects.delete(id); }
    for (const key of this.unmappedSpatialEntities) if (key.startsWith('device:') && !keep.has(key.slice('device:'.length))) this.unmappedSpatialEntities.delete(key);
    devices.slice(0, 60).forEach((device, index) => {
      const id = String(device.deviceId || device.id || index);
      const node = this.resolveSpatialPosition(device);
      if (!node) {
        this.unmappedSpatialEntities.add(`device:${id}`);
        const previous = this.deviceObjects.get(id);
        if (previous) { this.scene.remove(previous); previous.geometry.dispose(); previous.material.dispose(); this.deviceObjects.delete(id); this.raycastTargets = this.raycastTargets.filter((target) => target !== previous); }
        return;
      }
      this.unmappedSpatialEntities.delete(`device:${id}`);
      if (this.deviceObjects.has(id)) { const existing = this.deviceObjects.get(id); existing.position.set(node.x + .28, .13, node.z - .24); existing.userData.data = device; return; }
      const marker = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, .12), new THREE.MeshStandardMaterial({ color: '#8bd4a8', emissive: '#23683d', emissiveIntensity: .6 }));
      marker.position.set(node.x + .28, .13, node.z - .24); marker.userData = { kind: 'device', id, name: device.deviceName || device.name || id, data: device };
      this.deviceObjects.set(id, marker); this.scene.add(marker); this.raycastTargets.push(marker);
    });
    this.reportUnmappedSpatialEntities();
  }

  setLayer(name, visible) {
    this.layerVisibility[name] = Boolean(visible);
    if (name === 'density' && this.roadOverlayMesh) this.roadOverlayMesh.visible = Boolean(visible);
    if (name === 'signals') [this.intersectionMarkerMesh, this.intersectionPoleMesh, this.intersectionLampMesh].forEach((mesh) => { if (mesh) mesh.visible = Boolean(visible); });
    if (name === 'devices') this.deviceObjects.forEach((object) => { object.visible = Boolean(visible); });
    if (name === 'incidents') this.incidentObjects.forEach((object) => { object.visible = Boolean(visible); });
  }

  setView(view, options = {}) {
    this.followedVehicleId = null;
    const presets = {
      top: { position: [0, 14, .01], target: [0, 0, 0] },
      isometric: { position: [7.5, 8.5, 8.5], target: [0, 0, 0] },
      street: { position: [0, 2.2, 5.2], target: [0, .6, 0] },
      wonokromo: { position: [-0.8, 4.2, 4.8], target: [-0.94, .2, 1.76] },
      darmo: { position: [1.2, 3.8, 2.2], target: [0.93, .1, -0.79] },
      jemursari: { position: [4.2, 4.5, 5.5], target: [2.86, .2, 3.76] },
      follow: { position: [0, 1.8, 3.5], target: [0, .4, 0] }
    };
    if (view === 'follow') {
      const vehicles = this.vehicleBodyMesh?.userData?.instances || [];
      const targetVehicle = options.vehicleId
        ? vehicles.find((v) => v.id === options.vehicleId)
        : vehicles[0];
      if (targetVehicle) {
        this.followedVehicleId = targetVehicle.id;
        const h = targetVehicle.renderHeading || targetVehicle.heading || 0;
        const camDist = 2.2, camHeight = 1.1;
        const cx = targetVehicle.renderX - Math.sin(h) * camDist;
        const cz = targetVehicle.renderZ - Math.cos(h) * camDist;
        this.camera.position.set(cx, camHeight, cz);
        this.controls.target.set(targetVehicle.renderX, .35, targetVehicle.renderZ);
        this.controls.update();
        return;
      }
    }
    const preset = presets[view] || presets.isometric;
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.target);
    this.controls.update();
  }

  setVirtualCamera(cameraId) {
    const mesh = this.cameraObjects.get(String(cameraId)); if (!mesh) return;
    this.selectedCamera = mesh;
    this.followedVehicleId = null;
    const data = mesh.data;
    const definition = CAMERA_DEFINITIONS.find((item) => item.id === cameraId);
    const node = this.scene.userData.nodes.find((item) => item.id === definition?.nodeId) || mesh;
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
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.raycastTargets, false);
    if (!hits.length) return;
    const hit = hits[0];
    let entity = hit.object.userData;
    if (entity.kind === 'intersection' && hit.instanceId != null) entity = this.intersectionInstances[hit.instanceId];
    if (entity.kind === 'camera' && hit.instanceId != null) entity = this.cameraInstances[hit.instanceId];
    if (entity.kind === 'vehicle') entity = hit.object.userData.instances[hit.instanceId] || entity;
    if (!entity.kind && hit.object.userData.kind === 'vehicle') entity = hit.object.userData.instances[hit.instanceId];
    if (entity.kind === 'intersection') this.controls.target.set(entity.x, 0, entity.z);
    this.callbacks.onSelect?.({ ...entity, object: hit.object });
  }

  resize() {
    if (!this.renderer || !this.host.clientWidth) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  render(now) {
    if (this.disposed || document.hidden) { this.raf = 0; return; }
    this.raf = requestAnimationFrame((time) => this.render(time));
    if (now - this.lastFrame < 1000 / this.targetFps) return;
    const delta = this.lastFrame ? Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000)) : 0;
    if (delta > 0) {
      this.frameTimeSamples[this.frameTimeCursor] = delta * 1000;
      this.frameTimeCursor = (this.frameTimeCursor + 1) % this.frameTimeSamples.length;
      this.frameTimeCount = Math.min(this.frameTimeSamples.length, this.frameTimeCount + 1);
    }
    this.lastFrame = now; this.frameCount++; this.controls.update(); this.updateVehicles(delta);
    if (this.followedVehicleId) {
      const vehicles = this.vehicleBodyMesh?.userData?.instances || [];
      const followed = vehicles.find((v) => v.id === this.followedVehicleId);
      if (followed) {
        const h = followed.renderHeading || followed.heading || 0;
        const camDist = 2.2, camHeight = 1.1;
        const targetX = followed.renderX - Math.sin(h) * camDist;
        const targetZ = followed.renderZ - Math.cos(h) * camDist;
        const lerpFactor = Math.min(1, delta * 5);
        this.camera.position.x += (targetX - this.camera.position.x) * lerpFactor;
        this.camera.position.y += (camHeight - this.camera.position.y) * lerpFactor;
        this.camera.position.z += (targetZ - this.camera.position.z) * lerpFactor;
        this.controls.target.x += (followed.renderX - this.controls.target.x) * lerpFactor;
        this.controls.target.y += (.35 - this.controls.target.y) * lerpFactor;
        this.controls.target.z += (followed.renderZ - this.controls.target.z) * lerpFactor;
      }
    }
    const width = this.renderer.domElement.clientWidth, height = this.renderer.domElement.clientHeight;
    const cpuStart = performance.now();
    this.beginGpuTimer();
    this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, width, height); this.renderer.render(this.scene, this.camera);
    if (this.selectedCamera && this.previewCamera) {
      const insetW = Math.min(205, Math.floor(width * .28)), insetH = Math.floor(insetW / 1.25), margin = 14;
      this.renderer.setScissorTest(true); this.renderer.setScissor(width - insetW - margin, margin, insetW, insetH); this.renderer.setViewport(width - insetW - margin, margin, insetW, insetH); this.renderer.setClearColor('#142326', 1); this.renderer.clearDepth(); this.renderer.render(this.scene, this.previewCamera); this.renderer.setScissorTest(false);
    }
    this.endGpuTimer();
    this.cpuFrameMs = performance.now() - cpuStart;
    if (now - this.lastPerformanceAt >= 500) {
      const frameTimes = Array.from(this.frameTimeSamples.subarray(0, this.frameTimeCount)).sort((a, b) => a - b);
      this.frameTimeP95 = frameTimes.length ? frameTimes[Math.ceil(frameTimes.length * .95) - 1] : 0;
      this.callbacks.onPerformance?.({ cpuMs: this.cpuFrameMs, gpuMs: this.gpuTimeMs, frameTimeP95Ms: this.frameTimeP95, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, quality: this.quality, pixelRatio: this.pixelRatio });
      this.lastPerformanceAt = now;
    }
    if (now - this.lastFpsAt >= 1800) {
      const elapsed = now - (this.lastFpsAt || now - 1800); this.fps = Math.round(this.frameCount * 1000 / elapsed); this.frameCount = 0; this.lastFpsAt = now;
      this.callbacks.onFps?.(this.fps);
      if (now - this.lastQualityAdjustAt >= 4000) {
        const maximum = QUALITY_PROFILES[this.quality].pixelRatio;
        const minimum = Math.max(.35, maximum * .55);
        const measuredWorkMs = Math.max(this.cpuFrameMs, Number(this.gpuTimeMs) || 0);
        const action = adaptiveQualityAction({ fps: this.fps, targetFps: this.targetFps, workMs: measuredWorkMs, pixelRatio: this.pixelRatio, minimum, maximum });
        if (action === 'lower') this.pixelRatio = Math.max(minimum, this.pixelRatio - .08);
        else if (action === 'raise') this.pixelRatio = Math.min(maximum, this.pixelRatio + .04);
        if (action) { this.renderer.setPixelRatio(this.pixelRatio); this.resize(); }
        this.lastQualityAdjustAt = now;
      }
    }
  }

  beginGpuTimer() {
    if (!this.gpuTimerExt || this.activeGpuQuery) return;
    this.pollGpuTimer();
    if (this.gpuQueries.length >= 3) return;
    this.activeGpuQuery = this.gl.createQuery();
    this.gl.beginQuery(this.gpuTimerExt.TIME_ELAPSED_EXT, this.activeGpuQuery);
  }

  endGpuTimer() {
    if (!this.activeGpuQuery) return;
    this.gl.endQuery(this.gpuTimerExt.TIME_ELAPSED_EXT);
    this.gpuQueries.push(this.activeGpuQuery);
    this.activeGpuQuery = null;
    this.pollGpuTimer();
  }

  pollGpuTimer() {
    if (!this.gpuTimerExt || !this.gpuQueries.length) return;
    const query = this.gpuQueries[0];
    try {
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) return;
      if (!this.gl.getParameter(this.gpuTimerExt.GPU_DISJOINT_EXT)) this.gpuTimeMs = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) / 1e6;
      this.gl.deleteQuery(query); this.gpuQueries.shift();
    } catch { this.gpuQueries.shift(); }
  }

  resume() { if (!this.raf && !document.hidden && !this.disposed) { this.lastFrame = 0; this.raf = requestAnimationFrame((time) => this.render(time)); } }
  pause() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.lastFrame = 0; this.lastFpsAt = 0; this.frameCount = 0; this.lastPerformanceAt = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pause(); window.removeEventListener('resize', this._onResize); document.removeEventListener('visibilitychange', this._onVisibility);
    this.resizeObserver?.disconnect();
    this.renderer?.domElement.removeEventListener('pointerup', this._onPointer);
    this.renderer?.domElement.removeEventListener('webglcontextlost', this._onContextLost);
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this._onContextRestored);
    if (this.activeGpuQuery) this.gl?.deleteQuery(this.activeGpuQuery);
    this.gpuQueries.forEach((query) => this.gl?.deleteQuery(query)); this.gpuQueries = [];
    this.controls?.dispose();
    const geometries = new Set(), materials = new Set();
    this.scene?.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    this.renderer?.renderLists?.dispose?.(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.host.replaceChildren();
    this.intersectionObjects.clear(); this.cameraObjects.clear(); this.incidentObjects.clear(); this.deviceObjects.clear(); this.vehicleMeshes.clear();
    this.cameraFrames?.clear();
    this.vehicleRowsByCamera?.clear(); this.cameraRouteCache?.clear(); this.vehicleVisuals.clear(); this.vehicleColors.clear();
    this.headlightMeshes.clear();
  }
}
