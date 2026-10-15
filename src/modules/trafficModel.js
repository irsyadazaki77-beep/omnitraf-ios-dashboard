import { calculateDiurnalIntensity, CORRIDORS_CONFIG } from './forecastEngine.js';

export const TRAFFIC_MODEL_PARAMETERS = Object.freeze({
  version: 'aggregate-flow-v1',
  horizonMinutes: 15,
  rushDemandMultiplier: 1.45,
  rainCapacityMultiplier: 0.78,
  rainSpeedMultiplier: 0.82,
  incidentCapacityLoss: { low: 0.12, medium: 0.25, high: 0.42, critical: 0.58 },
  greenCapacitySensitivity: 0.003,
  greenCapacityReferenceSec: 35,
  minGreenSec: 15,
  maxGreenSec: 90,
  minFairShare: 0.3,
  queueVehicleSpacingMeters: 7.5,
  minimumSpeedKmh: 6,
  assumptions: [
    'Demand follows a deterministic diurnal curve with seeded corridor variation.',
    'Corridor capacities and free-flow speeds are model assumptions, not field-calibrated measurements.',
    'Queue conservation is evaluated over the selected finite horizon; no lane-level behavior is represented.',
    'Rain changes modeled capacity and speed; incident effects apply only to a matching corridor/location.',
    'Workflow status does not clear a road impact; an explicit road recovery acknowledgement does.',
    'Adaptive split nudges the current green by 50 × (demandShare − 0.5) + 8 × (pressure − 0.5), then enforces a 30% minimum approach share.'
  ]
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Workflow status and physical-model impact are separate. Resolving an incident
// does not imply that the simulated road has recovered; only an explicit
// roadImpactRecoveredAt acknowledgement removes its traffic effect.
const activeIncident = incident => !incident?.roadImpactRecoveredAt && incident?.roadImpactRecovered !== true;
const CORRIDOR_NODES = {
  'corridor-ayani': 'node-wonokromo',
  'corridor-jemursari': 'node-jemursari',
  'corridor-darmo': 'node-darmo',
  'corridor-tunjungan': 'node-tunjungan',
  'corridor-merr': 'node-merr',
  'corridor-diponegoro': 'node-darmo'
};

export const EMERGENCY_ROUTES = Object.freeze({
  'route-yani-darmo': { label: 'Ahmad Yani → Darmo → RSUD Dr. Soetomo', corridors: ['corridor-ayani', 'corridor-jemursari', 'corridor-darmo'], junctions: ['node-jemursari', 'node-wonokromo', 'node-darmo'] },
  'route-merr-soetomo': { label: 'MERR Kertajaya → Gubeng → RSUD Dr. Soetomo', corridors: ['corridor-merr', 'corridor-darmo'], junctions: ['node-merr', 'node-darmo'] }
});

function seededUnit(seed, key) {
  let value = (Number(seed) || 0) >>> 0;
  const input = `${key}`;
  for (let index = 0; index < input.length; index++) value = Math.imul(value ^ input.charCodeAt(index), 16777619) >>> 0;
  value += 0x6D2B79F5;
  let mixed = value;
  mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
  return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
}

function corridorGreenShare(corridor, state, control, demandVehPerHour, initialQueueVehicles, seed) {
  const node = (state.intersections || []).find(item => item.id === CORRIDOR_NODES[corridor.id]);
  const split = control === 'adaptive'
    ? recommendAdaptiveSignal({
      ...(node || {}),
      id: node?.id || CORRIDOR_NODES[corridor.id],
      greenSplit: node?.greenSplit ?? 35,
      vehicleDemandVehPerHour: demandVehPerHour,
      queueVehicles: node?.queueVehicles ?? initialQueueVehicles,
      opposingDemandShare: node?.opposingDemandShare ?? (0.3 + seededUnit(seed, `${corridor.id}-approach`) * 0.4)
    }, state).targetGreenSec
    : Number(node?.greenSplit ?? state.greenSplitWonokromo ?? 35);
  return { split: clamp(split, TRAFFIC_MODEL_PARAMETERS.minGreenSec, TRAFFIC_MODEL_PARAMETERS.maxGreenSec), node };
}

function incidentLoss(corridor, incidents) {
  const matched = incidents.filter(incident => {
    if (incident.corridorId || incident.intersectionId) {
      return incident.corridorId ? incident.corridorId === corridor.id : incident.intersectionId === CORRIDOR_NODES[corridor.id];
    }
    const text = `${incident.location || ''} ${incident.title || ''} ${incident.corridorId || ''} ${incident.intersectionId || ''}`.toLowerCase();
    return text.includes(corridor.name.split(/[ /-]/)[0].toLowerCase()) ||
      (corridor.id === 'corridor-ayani' && /ayani|wonokromo|demo 01/.test(text)) ||
      (corridor.id === 'corridor-jemursari' && /jemursari|demo 02/.test(text)) ||
      (corridor.id === 'corridor-darmo' && /darmo|bungkul|demo 03/.test(text)) ||
      text.includes(corridor.id.replace('corridor-', '').replace('-', ' '));
  });
  return matched.reduce((loss, incident) => {
    const severity = String(incident.severity || incident.priority || 'medium').toLowerCase();
    const mapped = severity === 'danger' ? 'high' : severity;
    const severityLoss = TRAFFIC_MODEL_PARAMETERS.incidentCapacityLoss[mapped] ?? 0.25;
    const laneCount = Math.max(0, Number(incident.closedLanes ?? incident.lanesClosed ?? 0));
    const totalLanes = Math.max(1, Number(incident.totalLanes ?? incident.lanesAvailable ?? 3));
    const laneLoss = clamp(laneCount / totalLanes, 0, 0.85);
    const reportedLoss = clamp(Number(incident.capacityReductionPct ?? 0) / 100, 0, 0.9);
    const incidentLossValue = Math.max(severityLoss, laneLoss, reportedLoss);
    return 1 - (1 - loss) * (1 - incidentLossValue);
  }, 0);
}

function emergencyCapacityEffect(corridorId, state, options) {
  const enabled = options.emergencyGreenWave ?? options.greenWave ?? state.greenWaveActive;
  if (!enabled) return 1;
  const active = (options.activeEmergencies ?? state.activeEmergencies ?? [])
    .filter(item => !['ARRIVED', 'COMPLETED', 'CANCELLED', 'TERMINAL_ARCHIVED'].includes(String(item.status || '').toUpperCase()));
  const routeIds = [options.emergencyRouteId, ...active.map(item => item.routeId || item.assignedRoute)].filter(Boolean);
  if (!routeIds.length && enabled) routeIds.push('route-yani-darmo');
  const selectedRoutes = routeIds.map(id => EMERGENCY_ROUTES[id]).filter(Boolean);
  if (selectedRoutes.some(route => route.corridors.includes(corridorId))) return 1.04;
  const conflictCorridors = new Set(selectedRoutes.flatMap(route => route.corridors));
  return conflictCorridors.size ? 0.97 : 1;
}

function resolveSimulationHour(state, requestedHour) {
  if (Number.isFinite(Number(requestedHour))) return clamp(Number(requestedHour), 0, 23.99);
  if (Number.isFinite(Number(state.simulatedHour))) return clamp(Number(state.simulatedHour), 0, 23.99);
  const timeMatch = String(state.timestamp || '').match(/(?:T|\s)?(\d{1,2}):\d{2}/);
  if (timeMatch) return clamp(Number(timeMatch[1]), 0, 23.99);
  if (Number.isFinite(Number(state.timestampMs)) && Number(state.timestampMs) > 0) {
    const hourText = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(new Date(Number(state.timestampMs)));
    return clamp(Number(hourText), 0, 23.99);
  }
  return 8;
}

function resolveInitialQueues(state) {
  if (Array.isArray(state.trafficModel?.corridors)) {
    return Object.fromEntries(state.trafficModel.corridors.map(corridor => [corridor.corridorId, Math.max(0, Number(corridor.queueVehicles) || 0)]));
  }
  const intersections = new Map((state.intersections || []).map(node => [node.id, Math.max(0, Number(node.queueVehicles) || 0)]));
  return Object.fromEntries(CORRIDORS_CONFIG.map(corridor => [corridor.id, intersections.get(CORRIDOR_NODES[corridor.id]) || 0]));
}

export function recommendAdaptiveSignal(intersection, state = {}) {
  const minGreenSec = TRAFFIC_MODEL_PARAMETERS.minGreenSec;
  const maxGreenSec = TRAFFIC_MODEL_PARAMETERS.maxGreenSec;
  const currentGreenSec = clamp(Number(intersection?.pendingGreenSplit ?? intersection?.greenSplit ?? 35), minGreenSec, maxGreenSec);
  const arrivals = Math.max(0, Number(intersection?.vehicleDemandVehPerHour ?? intersection?.demandVehPerHour ?? 0));
  const queue = Math.max(0, Number(intersection?.queueVehicles ?? 0));
  const opposingShare = clamp(Number(intersection?.opposingDemandShare ?? 0.5), TRAFFIC_MODEL_PARAMETERS.minFairShare, 1 - TRAFFIC_MODEL_PARAMETERS.minFairShare);
  const pressure = clamp(arrivals / 1200 + queue / 180, 0, 1);
  const demandShare = clamp(0.5 + (opposingShare - 0.5) * 0.7 + (pressure - 0.5) * 0.12, TRAFFIC_MODEL_PARAMETERS.minFairShare, 1 - TRAFFIC_MODEL_PARAMETERS.minFairShare);
  const clearance = Number(intersection?.redDuration ?? 25) + Number(intersection?.yellowDuration ?? 3);
  const fairMinimum = Math.max(minGreenSec, Math.ceil(clearance * TRAFFIC_MODEL_PARAMETERS.minFairShare / (1 - TRAFFIC_MODEL_PARAMETERS.minFairShare)));
  const fairMaximum = Math.min(maxGreenSec, Math.floor(clearance * (1 - TRAFFIC_MODEL_PARAMETERS.minFairShare) / TRAFFIC_MODEL_PARAMETERS.minFairShare));
  const adjustment = (demandShare - 0.5) * 50 + (pressure - 0.5) * 8;
  const targetGreenSec = clamp(Math.round(currentGreenSec + adjustment), fairMinimum, fairMaximum);
  const delta = targetGreenSec - currentGreenSec;
  const reason = `Demand sintetis ${Math.round(arrivals)} kendaraan/jam, antrean ${Math.round(queue)} kendaraan; pembagian hijau minimum ${Math.round(TRAFFIC_MODEL_PARAMETERS.minFairShare * 100)}% menjaga fairness.`;
  return {
    intersectionId: intersection?.id || null,
    currentGreenSec,
    targetGreenSec,
    minimumGreenSec: minGreenSec,
    maximumGreenSec: maxGreenSec,
    deltaGreenSec: delta,
    demandVehPerHour: Math.round(arrivals),
    queueVehicles: Math.round(queue),
    opposingDemandShare: Number(opposingShare.toFixed(3)),
    reason,
    safety: { minGreenSec, maxGreenSec, minimumApproachShare: TRAFFIC_MODEL_PARAMETERS.minFairShare, transition: 'pending next signal cycle; yellow/all-red timings unchanged' },
    provenance: 'SIMULATED'
  };
}

export function simulateTrafficNetwork(state = {}, options = {}) {
  const horizonMinutes = clamp(Number(options.horizonMinutes ?? TRAFFIC_MODEL_PARAMETERS.horizonMinutes), 1, 120);
  const hour = resolveSimulationHour(state, options.hour);
  const seed = Number(options.seed ?? state.simulation?.seed ?? 42);
  const intensity = calculateDiurnalIntensity(hour);
  const rushHour = options.rushHour ?? false;
  const rain = options.rain ?? !!(state.isRainMode || state.roadCondition === 'wet');
  const greenWave = options.greenWave ?? !!state.greenWaveActive;
  const emergencies = options.emergencyGreenWave ?? (greenWave && !!(state.activeEmergencies || []).some(item => !['COMPLETED', 'CANCELLED'].includes(item.status)));
  const baseIncidents = (options.incidents ?? state.incidents ?? []).filter(activeIncident);
  const incidents = options.majorIncident
    ? [...baseIncidents, { id: 'scenario-incident', title: 'Major incident (scenario)', location: options.incidentLocation || 'A. Yani / Wonokromo', severity: 'critical', status: 'ACTIVE' }]
    : baseIncidents;
  const control = options.signalControl || 'fixed';
  const demandMultiplier = clamp(Number(options.demandMultiplier ?? (rushHour ? TRAFFIC_MODEL_PARAMETERS.rushDemandMultiplier : 1)), 0.5, 1.75);
  const corridorDemandMultipliers = options.corridorDemandMultipliers && typeof options.corridorDemandMultipliers === 'object'
    ? options.corridorDemandMultipliers : {};
  const initialQueues = options.initialQueues ?? resolveInitialQueues(state);
  const perCorridor = CORRIDORS_CONFIG.map(corridor => {
    const variation = 0.96 + seededUnit(seed, corridor.id) * 0.08;
    const corridorMultiplier = clamp(Number(corridorDemandMultipliers[corridor.id] ?? 1), 0.5, 1.75);
    const emergencyRelief = emergencyCapacityEffect(corridor.id, state, { ...options, emergencyGreenWave: emergencies });
    const demandVehPerHour = corridor.capacity * clamp(intensity * 0.78 + 0.12, 0.08, 0.98) * variation * demandMultiplier * corridorMultiplier;
    const loss = incidentLoss(corridor, incidents);
    const startingQueue = Math.max(0, Number(initialQueues[corridor.id] || 0));
    const { split } = corridorGreenShare(corridor, state, control, demandVehPerHour, startingQueue, seed);
    const signalCapacityFactor = clamp(0.82 + (split - TRAFFIC_MODEL_PARAMETERS.greenCapacityReferenceSec) * TRAFFIC_MODEL_PARAMETERS.greenCapacitySensitivity, 0.72, 1.12);
    const capacityVehPerHour = corridor.capacity * (rain ? TRAFFIC_MODEL_PARAMETERS.rainCapacityMultiplier : 1) * (1 - loss) * signalCapacityFactor * emergencyRelief;
    const arrivals = demandVehPerHour * horizonMinutes / 60;
    const served = Math.min(arrivals + startingQueue, capacityVehPerHour * horizonMinutes / 60);
    const queueVehicles = Math.max(0, startingQueue + arrivals - served);
    const volumeCapacityRatio = capacityVehPerHour > 0 ? demandVehPerHour / capacityVehPerHour : 1;
    const freeSpeed = corridor.baselineSpeedKmh;
    const speedKmh = clamp(freeSpeed * (1 - 0.62 * clamp(volumeCapacityRatio, 0, 1.5) ** 2) * (rain ? TRAFFIC_MODEL_PARAMETERS.rainSpeedMultiplier : 1), TRAFFIC_MODEL_PARAMETERS.minimumSpeedKmh, freeSpeed);
    return {
      corridorId: corridor.id,
      intersectionId: CORRIDOR_NODES[corridor.id],
      name: corridor.name,
      demandVehPerHour: Math.round(demandVehPerHour),
      throughputVehPerHour: Math.round(served * 60 / horizonMinutes),
      arrivalsInHorizon: Number(arrivals.toFixed(2)),
      throughputInHorizon: Number(served.toFixed(2)),
      initialQueueVehicles: startingQueue,
      queueVehicles: Number(queueVehicles.toFixed(2)),
      queueMeters: Math.round(queueVehicles * TRAFFIC_MODEL_PARAMETERS.queueVehicleSpacingMeters),
      capacityVehPerHour: Math.round(capacityVehPerHour),
      speedKmh: Number(speedKmh.toFixed(1)),
      travelTimeMinutes: Number((corridor.lengthKm / speedKmh * 60).toFixed(2)),
      congestionIndex: Math.round(clamp(volumeCapacityRatio, 0, 1.5) / 1.5 * 100),
      greenSplitSec: split,
      incidentCapacityLossPct: Math.round(loss * 100),
      emergencyPriorityCapacityEffectPct: Math.round((emergencyRelief - 1) * 100)
    };
  });
  const demand = perCorridor.reduce((sum, item) => sum + item.demandVehPerHour, 0);
  const throughput = perCorridor.reduce((sum, item) => sum + item.throughputVehPerHour, 0);
  const queue = perCorridor.reduce((sum, item) => sum + item.queueVehicles, 0);
  const weighted = key => perCorridor.reduce((sum, item) => sum + item[key] * item.demandVehPerHour, 0) / Math.max(1, demand);
  const initialQueue = perCorridor.reduce((sum, item) => sum + item.initialQueueVehicles, 0);
  const arrivalsHorizon = perCorridor.reduce((sum, item) => sum + item.arrivalsInHorizon, 0);
  const throughputHorizon = perCorridor.reduce((sum, item) => sum + item.throughputInHorizon, 0);
  return {
    modelVersion: TRAFFIC_MODEL_PARAMETERS.version,
    seed,
    horizonMinutes,
    hour,
    intensity: Number(intensity.toFixed(3)),
    demandVehPerHour: demand,
    throughputVehPerHour: throughput,
    averageSpeedKmh: Number(weighted('speedKmh').toFixed(1)),
    averageTravelTimeMinutes: Number(weighted('travelTimeMinutes').toFixed(2)),
    queueVehicles: Number(queue.toFixed(2)),
    queueMeters: Math.round(queue * TRAFFIC_MODEL_PARAMETERS.queueVehicleSpacingMeters),
    congestionIndex: Math.round(weighted('congestionIndex')),
    arrivalsInHorizon: Number(arrivalsHorizon.toFixed(2)),
    throughputInHorizon: Number(throughputHorizon.toFixed(2)),
    initialQueueVehicles: Number(initialQueue.toFixed(2)),
    queueConservationResidual: Number((initialQueue + arrivalsHorizon - throughputHorizon - queue).toFixed(6)),
    scenario: { rushHour, demandMultiplier, rain, majorIncident: !!options.majorIncident, signalControl: control, greenWave, emergencyGreenWave: emergencies, incidentCount: incidents.length },
    corridors: perCorridor,
    assumptions: TRAFFIC_MODEL_PARAMETERS.assumptions,
    provenance: 'SIMULATED'
  };
}

export function analyzeIncidentImpact(incident, state = {}) {
  if (incident?.roadImpactRecoveredAt || incident?.roadImpactRecovered === true) {
    return {
      affectedCorridors: [],
      networkTravelTimeDeltaMinutes: 0,
      networkQueueDeltaVehicles: 0,
      severity: String(incident?.severity || incident?.priority || 'medium').toUpperCase(),
      recommendation: 'Jalan sudah ditandai pulih pada simulator; lanjutkan pemantauan model bila diperlukan.',
      provenance: 'SIMULATED',
      reason: 'Pemulihan jalan telah dikonfirmasi; insiden ini tidak lagi mengurangi kapasitas koridor pada model.'
    };
  }
  const baselineState = {
    ...state,
    incidents: (state.incidents || []).filter(item => String(item.id) !== String(incident?.id))
  };
  const current = simulateTrafficNetwork(baselineState);
  const withIncident = simulateTrafficNetwork(baselineState, {
    incidents: [...baselineState.incidents, { ...incident, status: incident?.status || 'ACTIVE' }]
  });
  const severity = String(incident?.severity || incident?.priority || 'medium').toUpperCase();
  const affected = withIncident.corridors.filter(corridor => corridor.incidentCapacityLossPct > 0);
  const worst = affected.reduce((item, corridor) => !item || corridor.incidentCapacityLossPct > item.incidentCapacityLossPct ? corridor : item, null);
  const status = String(incident?.status || 'ACTIVE').toUpperCase();
  const laneCount = Math.max(0, Number(incident?.closedLanes ?? incident?.lanesClosed ?? 0));
  let recommendation = 'Verifikasi lokasi dan kondisi lajur pada simulasi, lalu perbarui status setelah ditinjau operator.';
  if (['CRITICAL', 'DANGER', 'HIGH'].includes(severity)) recommendation = 'Akui alert, tetapkan unit sintetis, lalu evaluasi rute alternatif sebelum disposisi.';
  else if (laneCount > 0) recommendation = `Tinjau penutupan ${laneCount} lajur dan kapasitas sisa; gunakan rute alternatif bila antrean model bertambah.`;
  if (status === 'MITIGATED') recommendation = 'Pantau antrean yang tersisa; lanjutkan ke selesai setelah dampak model stabil.';
  return {
    affectedCorridors: affected.map(item => ({ corridorId: item.corridorId, name: item.name, capacityLossPct: item.incidentCapacityLossPct, queueDelta: Number((item.queueVehicles - (current.corridors.find(base => base.corridorId === item.corridorId)?.queueVehicles || 0)).toFixed(2)) })),
    networkTravelTimeDeltaMinutes: Number((withIncident.averageTravelTimeMinutes - current.averageTravelTimeMinutes).toFixed(2)),
    networkQueueDeltaVehicles: Number((withIncident.queueVehicles - current.queueVehicles).toFixed(2)),
    severity, recommendation, provenance: 'SIMULATED',
    reason: `${affected.length} koridor cocok dengan lokasi/ID insiden; kehilangan kapasitas terburuk ${worst?.incidentCapacityLossPct ?? 0}%${laneCount ? ` dengan ${laneCount} lajur ditutup` : ''}.`
  };
}

export function planEmergencyRoutes(state = {}, options = {}) {
  const traffic = simulateTrafficNetwork(state);
  const incidents = (state.incidents || []).filter(activeIncident);
  const evaluations = Object.entries(EMERGENCY_ROUTES).map(([routeId, route]) => {
    const segments = route.corridors.map(id => traffic.corridors.find(corridor => corridor.corridorId === id)).filter(Boolean);
    const junctions = route.junctions.map(id => (state.intersections || []).find(node => node.id === id)).filter(Boolean);
    const incidentCount = incidents.filter(incident => route.corridors.some(id => incidentLoss(CORRIDORS_CONFIG.find(corridor => corridor.id === id), [incident]) > 0)).length;
    const intersectionDelayMinutes = junctions.reduce((sum, node) => sum + Math.min(2, Math.max(0, Number(node.queueVehicles || 0)) / 90), 0);
    const travelTimeMinutes = Number((segments.reduce((sum, segment) => sum + segment.travelTimeMinutes, 0) + intersectionDelayMinutes).toFixed(2));
    const bottleneck = [...segments].sort((a, b) => b.congestionIndex - a.congestionIndex)[0];
    return { routeId, label: route.label, corridors: route.corridors, junctions: route.junctions, travelTimeMinutes, incidentCount, averageSpeedKmh: Number((segments.reduce((sum, item) => sum + item.speedKmh, 0) / Math.max(1, segments.length)).toFixed(1)), congestionIndex: Math.round(segments.reduce((sum, item) => sum + item.congestionIndex, 0) / Math.max(1, segments.length)), bottleneck: bottleneck?.name || 'Koridor belum tersedia', reason: `${incidentCount} insiden aktif pada koridor rute; antrean simpang menambah ${intersectionDelayMinutes.toFixed(1)} menit.`, provenance: 'SIMULATED' };
  }).sort((a, b) => a.travelTimeMinutes - b.travelTimeMinutes || a.routeId.localeCompare(b.routeId));
  const selectedRouteId = EMERGENCY_ROUTES[options.routeId] ? options.routeId : evaluations[0]?.routeId || null;
  const baseline = simulateTrafficNetwork(state);
  const withPriority = simulateTrafficNetwork(state, { emergencyGreenWave: true, emergencyRouteId: selectedRouteId });
  return { routes: evaluations, recommendedRouteId: evaluations[0]?.routeId || null, selectedRouteId, estimatedTripMinutes: evaluations.find(item => item.routeId === selectedRouteId)?.travelTimeMinutes ?? null, trafficImpact: { baselineQueueVehicles: baseline.queueVehicles, priorityQueueVehicles: withPriority.queueVehicles, queueDeltaVehicles: Number((withPriority.queueVehicles - baseline.queueVehicles).toFixed(2)), baselineAverageTravelTimeMinutes: baseline.averageTravelTimeMinutes, priorityAverageTravelTimeMinutes: withPriority.averageTravelTimeMinutes, travelTimeDeltaMinutes: Number((withPriority.averageTravelTimeMinutes - baseline.averageTravelTimeMinutes).toFixed(2)) }, provenance: 'SIMULATED', seed: baseline.seed };
}

export function compareTrafficScenarios(state = {}, options = {}) {
  const seed = Number(options.seed ?? state.simulation?.seed ?? 42);
  const common = {
    ...options,
    seed,
    initialQueues: options.initialQueues ?? resolveInitialQueues(state),
    rushHour: false,
    rain: false,
    majorIncident: false,
    incidents: [],
    greenWave: false,
    emergencyGreenWave: false,
    signalControl: 'fixed'
  };
  const cases = [
    ['normal', common],
    ['rushHour', { ...common, rushHour: true }],
    ['heavyRain', { ...common, rain: true }],
    ['majorIncident', { ...common, majorIncident: true }],
    ['adaptiveSignals', { ...common, signalControl: 'adaptive' }],
    ['emergencyGreenWave', { ...common, emergencyGreenWave: true, greenWave: true }]
  ];
  const results = Object.fromEntries(cases.map(([name, scenario]) => [name, simulateTrafficNetwork(state, scenario)]));
  const baseline = results.normal;
  return {
    modelVersion: TRAFFIC_MODEL_PARAMETERS.version,
    seed,
    horizonMinutes: baseline.horizonMinutes,
    initialStateVersion: state.stateVersion ?? state.seq ?? null,
    sameInitialState: true,
    scenarios: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {
      metrics: result,
      deltaFromNormal: Object.fromEntries(['averageTravelTimeMinutes', 'queueVehicles', 'congestionIndex', 'throughputVehPerHour'].map(key => [key, Number((result[key] - baseline[key]).toFixed(2))]))
    }])),
    assumptions: TRAFFIC_MODEL_PARAMETERS.assumptions,
    provenance: 'SIMULATED'
  };
}
