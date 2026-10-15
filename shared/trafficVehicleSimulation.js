import { SeededRandom } from './seededRandom.js';

const CAMERA_CONFIG = Object.freeze({
  dashCameraCanvas: { corridorId: 'corridor-ayani', nodeId: 'node-wonokromo', scene: 'intersection', seed: 1101 },
  cctvCanvas1: { corridorId: 'corridor-ayani', nodeId: 'node-wonokromo', scene: 'intersection', seed: 1101 },
  cctvCanvas2: { corridorId: 'corridor-darmo', nodeId: 'node-darmo', scene: 'boulevard', seed: 2202 },
  cctvCanvas3: { corridorId: null, nodeId: null, city3dAnchorNodeId: 'node-jemursari', city3dCoordinates: [-7.345, 112.73], scene: 'roundabout', seed: 3303 },
  cctvCanvas4: { corridorId: 'corridor-jemursari', nodeId: 'node-jemursari', scene: 'intersection', seed: 4404 }
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const TYPES = ['car', 'car', 'car', 'motorcycle', 'car', 'bus', 'truck', 'car', 'ambulance'];
const COLORS = ['#d9dfdf', '#b7c1c4', '#4e6876', '#7d463d', '#d4a84f', '#344c58', '#899385', '#e5e2d8'];

/** Small, deterministic car-following model used by the synthetic CCTV feed. */
export class TrafficVehicleSimulation {
  constructor(options = {}) {
    this.seed = options.seed ?? 'omnitraf-traffic-vehicles';
    this.random = options.randomStream || new SeededRandom(this.seed);
    this.vehiclesByCamera = new Map();
    this.reset();
  }

  reset() {
    this.random.reset?.();
    this.vehiclesByCamera.clear();
    for (const [cameraId, config] of Object.entries(CAMERA_CONFIG)) {
      const count = cameraId === 'dashCameraCanvas' ? 10 : 12;
      const vehicles = [];
      for (let index = 0; index < count; index++) {
        const type = index === 0 && cameraId !== 'dashCameraCanvas' ? 'bus' : TYPES[Math.floor(this.random.nextFloat() * TYPES.length)];
        vehicles.push({
          id: `${cameraId}-v${index}`, lane: index % 4,
          direction: config.scene === 'roundabout' ? 1 : (index % 4 < 2 ? 1 : -1),
          progress: 0.12 + (Math.floor(index / 4) * 0.43) + (index % 4) * 0.018,
          speedKmh: 0, acceleration: 0, desiredSpeedKmh: 38, type,
          color: COLORS[Math.floor(this.random.nextFloat() * COLORS.length)],
          confidence: 92 + Math.floor(this.random.nextFloat() * 7), phase: this.random.nextFloat() * Math.PI * 2,
          braking: false, stopped: false, movement: ['left', 'through', 'right', 'through'][index % 4],
          cameraScene: config.scene, active: index < 6
        });
      }
      this.vehiclesByCamera.set(cameraId, vehicles);
    }
  }

  step(simulationState = {}, deltaSeconds = 0.3) {
    const dt = clamp(Number(deltaSeconds) || 0.3, 0, 1.5);
    const model = simulationState.trafficModel || simulationState;
    const corridors = model.corridors || [];
    const intersections = simulationState.intersections || [];
    const incidents = (simulationState.incidents || []).filter(item => !['RESOLVED', 'ARCHIVED', 'CLOSED', 'CANCELLED'].includes(String(item.status || 'ACTIVE').toUpperCase()));
    const rain = Boolean(simulationState.isRainMode || simulationState.roadCondition === 'wet' || model.scenario?.rain);
    for (const [cameraId, vehicles] of this.vehiclesByCamera) {
      const config = CAMERA_CONFIG[cameraId];
      const corridor = corridors.find(item => item.corridorId === config.corridorId);
      const node = intersections.find(item => item.id === config.nodeId);
      const localIncidents = incidents.filter(item => {
        const description = `${item.location || ''} ${item.title || ''} ${item.corridorId || ''} ${item.intersectionId || ''}`.toLowerCase();
        return (config.corridorId && description.includes(config.corridorId.replace('corridor-', ''))) || (config.nodeId && description.includes(config.nodeId.replace('node-', '')));
      });
      const networkSpeed = Number(model.averageSpeedKmh) || 36;
      const desiredSpeed = clamp(Number(corridor?.speedKmh ?? networkSpeed) * (rain ? .91 : 1) * (localIncidents.length ? .70 : 1), 5, 55);
      const queueVehicles = Number(corridor?.queueVehicles ?? model.queueVehicles) || 0;
      const congestion = Number(corridor?.congestionIndex ?? model.congestionIndex) || 0;
      const visibleAgentCount = clamp(Math.round(4 + Math.max(queueVehicles / 2.2, congestion / 7)), 4, 12);
      vehicles.forEach((vehicle, index) => { vehicle.active = index < visibleAgentCount; });
      const incidentLaneClosed = localIncidents.some(item => item.laneClosed || item.laneClosure || item.closedLanes?.length);
      const red = String(node?.state || '').toLowerCase() === 'red';
      const yellow = String(node?.state || '').toLowerCase() === 'yellow';
      const lanes = new Map();
      for (const vehicle of vehicles) {
        if (!vehicle.active) continue;
        const laneKey = `${vehicle.lane}:${vehicle.direction}`;
        if (!lanes.has(laneKey)) lanes.set(laneKey, []);
        lanes.get(laneKey).push(vehicle);
      }
      const leaderByVehicle = new Map();
      for (const laneVehicles of lanes.values()) {
        laneVehicles.sort((a, b) => a.progress - b.progress);
        for (let index = 0; index < laneVehicles.length - 1; index++) leaderByVehicle.set(laneVehicles[index], laneVehicles[index + 1]);
      }
      for (const vehicle of vehicles) {
        if (!vehicle.active) continue;
        let targetSpeed = desiredSpeed;
        const laneBlocked = incidentLaneClosed && vehicle.lane === 1;
        const stopLine = config.scene === 'roundabout' ? 1.08 : .79;
        const mustStop = (red && config.nodeId && vehicle.lane < 2 && vehicle.progress < stopLine && vehicle.progress > stopLine - .18) || laneBlocked;
        if (mustStop) targetSpeed = 0;
        else if (yellow && config.nodeId && vehicle.lane < 2 && vehicle.progress > stopLine - .12) targetSpeed *= .35;

        // A simple safe time-gap rule: the vehicle follows the nearest leader in its lane.
        const leader = leaderByVehicle.get(vehicle);
        const gap = leader ? leader.progress - vehicle.progress : Infinity;
        if (leader && gap < .115) {
          const safeSpeed = Math.max(0, leader.speedKmh * clamp((gap - .035) / .08, 0, 1));
          targetSpeed = Math.min(targetSpeed, safeSpeed);
        }
        const previousSpeed = vehicle.speedKmh;
        const maxChange = (targetSpeed < previousSpeed ? 20 : 8) * dt;
        vehicle.speedKmh += clamp(targetSpeed - previousSpeed, -maxChange, maxChange);
        vehicle.acceleration = dt ? (vehicle.speedKmh - previousSpeed) / dt : 0;
        vehicle.braking = vehicle.acceleration < -1.2 || mustStop;
        vehicle.stopped = vehicle.speedKmh < .5;
        const roadMeters = config.scene === 'roundabout' ? 180 : 150;
        let progressDelta = (vehicle.speedKmh / 3.6) * dt / roadMeters;
        if (leader) {
          const remainingGap = gap - .035;
          progressDelta = Math.min(progressDelta, Math.max(0, remainingGap));
          // Convert a spatial safety clamp back into displayed speed so the
          // telemetry and visible motion remain synchronized.
          vehicle.speedKmh = dt > 0 ? progressDelta * roadMeters * 3.6 / dt : 0;
          vehicle.braking = vehicle.braking || progressDelta === 0;
          vehicle.stopped = vehicle.speedKmh < .5;
        }
        vehicle.progress += progressDelta;
        if (vehicle.progress > 1) vehicle.progress -= 1;
        vehicle.signalState = node?.state || (config.scene === 'roundabout' ? 'yield' : 'none');
        vehicle.speedKmh = Number(vehicle.speedKmh.toFixed(2));
        vehicle.acceleration = Number(vehicle.acceleration.toFixed(2));
      }
    }
    return this.vehiclesByCamera;
  }

  getVehicles(cameraId) { return (this.vehiclesByCamera.get(cameraId) || []).filter(vehicle => vehicle.active); }
  getSnapshot() { return { vehicles: Array.from(this.vehiclesByCamera.entries()), randomState: this.random.getSnapshot?.() }; }
  restoreSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.vehicles)) throw new TypeError('invalid traffic vehicle snapshot');
    const entries = new Map(snapshot.vehicles);
    if (Object.keys(CAMERA_CONFIG).some(cameraId => !Array.isArray(entries.get(cameraId)))) throw new TypeError('traffic vehicle snapshot is missing camera state');
    if (snapshot.randomState) this.random.restoreSnapshot?.(snapshot.randomState);
    this.vehiclesByCamera = entries;
  }
}

export function projectTrafficVehicle(vehicle, scene = vehicle.cameraScene) {
  const t = clamp(vehicle.progress, 0, 1);
  if (scene === 'roundabout') {
    const angle = t * Math.PI * 2 + (vehicle.phase || 0);
    const radiusX = .14 + (vehicle.lane % 2) * .035;
    const radiusY = .08 + (vehicle.lane % 2) * .018;
    return { x: .5 + Math.cos(angle) * radiusX, y: .58 + Math.sin(angle) * radiusY, angle: angle + Math.PI / 2, depth: .45 + (Math.sin(angle) + 1) * .22 };
  }
  const horizon = scene === 'boulevard' ? .27 : scene === 'intersection' ? .29 : .29;
  let laneOffset = [-.58, -.20, .20, .58][vehicle.lane] * (vehicle.direction < 0 ? -1 : 1);
  const visualProgress = vehicle.direction < 0 ? 1 - t : t;
  const spread = scene === 'boulevard' ? .15 + visualProgress * .30 : .08 + visualProgress * .36;
  const turnProgress = clamp((t - .68) / .32, 0, 1);
  if (scene === 'intersection' && vehicle.movement !== 'through') laneOffset += (vehicle.movement === 'left' ? -.32 : .32) * turnProgress * turnProgress;
  return { x: .49 + laneOffset * spread, y: horizon + .18 + visualProgress * .55, angle: vehicle.direction < 0 ? 0 : Math.PI, depth: .42 + visualProgress * .82 };
}

export function trafficCameraConfig(cameraId) { return CAMERA_CONFIG[cameraId] || null; }
