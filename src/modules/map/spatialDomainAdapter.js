/**
 * OmniTRAF Surabaya - Spatial Domain Adapter
 * Mengubah canonical domain state / entity menjadi lightweight map projection model.
 * Leaflet map / marker hanya menerima projection model dan TIDAK mengakses business domain secara langsung.
 */

import { geoJsonToLeaflet } from './coordinateUtils.js';

/**
 * @typedef {Object} SignalMarkerProjection
 * @property {string} id
 * @property {string} name
 * @property {string} district
 * @property {number} lat
 * @property {number} lng
 * @property {string} stateColor 'green' | 'yellow' | 'red'
 * @property {string} statusLabel
 * @property {number} timer
 * @property {number} defaultGreen
 * @property {number} greenSplit
 * @property {number} waitTime
 * @property {string} rippleClass
 * @property {string} nodeClass
 * @property {string} popupColor
 */

/**
 * @typedef {Object} IncidentMarkerProjection
 * @property {string} id
 * @property {string} title
 * @property {string} category
 * @property {string} severity 'danger' | 'warning'
 * @property {string} status
 * @property {string} location
 * @property {string} assignedUnit
 * @property {string} notes
 * @property {number} lat
 * @property {number} lng
 */

/**
 * @typedef {Object} EmergencyVehicleProjection
 * @property {string} id
 * @property {string} vehicleId
 * @property {string} vehicleType 'AMBULANS' | 'PMK'
 * @property {string} status
 * @property {number} speed
 * @property {string} origin
 * @property {string} destination
 * @property {string} nextIntersection
 * @property {[number, number]} position [lat, lng]
 * @property {number} progress 0.0 to 1.0
 * @property {string} routeId
 */

/**
 * Map canonical intersection entity to projection model
 * @param {Object} rawFeature SITS GeoJSON Feature
 * @param {Object} [liveNodeState] State from stateStore
 * @returns {SignalMarkerProjection}
 */
export function toSignalMarkerProjection(rawFeature, liveNodeState) {
  const p = rawFeature.properties || {};
  const [lat, lng] = geoJsonToLeaflet(rawFeature.geometry.coordinates);

  const stateColor = (liveNodeState?.state || (p.status === 'danger' ? 'red' : p.status === 'warning' ? 'yellow' : 'green')).toLowerCase();

  let rippleClass = 'ripple-success';
  let nodeClass = 'node-success';
  let popupColor = '#22c55e';
  let statusLabel = 'JALAN (HIJAU)';

  if (stateColor === 'red') {
    rippleClass = 'ripple-danger';
    nodeClass = 'node-danger';
    popupColor = '#ef4444';
    statusLabel = 'BERHENTI (MERAH)';
  } else if (stateColor === 'yellow') {
    rippleClass = 'ripple-warning';
    nodeClass = 'node-warning';
    popupColor = '#f59e0b';
    statusLabel = 'PERSIAPAN (KUNING)';
  }

  return {
    id: p.id,
    name: p.name || 'Simpang APILL',
    district: p.district || 'Surabaya',
    lat,
    lng,
    stateColor,
    statusLabel,
    timer: liveNodeState?.timer ?? (p.currentTimer || p.defaultGreen || 35),
    defaultGreen: p.defaultGreen || 35,
    greenSplit: liveNodeState?.greenSplit ?? (p.defaultGreen || 35),
    waitTime: liveNodeState?.waitTime ?? (p.currentWait || 30),
    rippleClass,
    nodeClass,
    popupColor
  };
}

/**
 * Map canonical incident entity to projection model
 * @param {Object} inc Incident entity from stateStore
 * @returns {IncidentMarkerProjection}
 */
export function toIncidentMarkerProjection(inc) {
  const severity = inc.severity === 'danger' ? 'danger' : 'warning';
  let lat = -7.2985;
  let lng = 112.7345;

  if (Array.isArray(inc.coordinates) && inc.coordinates.length >= 2) {
    lat = inc.coordinates[0];
    lng = inc.coordinates[1];
  } else if (inc.lat !== undefined && inc.lng !== undefined) {
    lat = inc.lat;
    lng = inc.lng;
  }

  return {
    id: inc.id || `inc-${Date.now()}`,
    title: inc.title || inc.name || 'Insiden Lalu Lintas',
    category: inc.category || 'TRAFFIC',
    severity,
    status: inc.status || 'ACTIVE',
    location: inc.location || 'Surabaya',
    assignedUnit: inc.assignedUnit || inc.petugas || 'Belum Ditugaskan',
    notes: inc.notes || inc.jenis || 'Hambatan lajur terdeteksi.',
    lat,
    lng
  };
}

/**
 * Map canonical emergency vehicle entity to projection model
 * @param {Object} emg Emergency vehicle from stateStore
 * @returns {EmergencyVehicleProjection}
 */
export function toEmergencyVehicleProjection(emg) {
  const rawPosition = emg?.currentPosition;
  const position = Array.isArray(rawPosition) && rawPosition.length >= 2
    && rawPosition.slice(0, 2).every(value => value !== null && value !== '' && Number.isFinite(Number(value)))
    ? [Number(rawPosition[0]), Number(rawPosition[1])]
    : null;
  const rawSpeed = emg?.speed === null || emg?.speed === undefined || emg?.speed === '' ? NaN : Number(emg.speed);

  return {
    id: emg.id || emg.vehicleId || `emg-${Date.now()}`,
    vehicleId: emg.vehicleId || 'EMG-01',
    vehicleType: (emg.vehicleType || 'AMBULANS').toUpperCase(),
    status: emg.status || 'EN_ROUTE',
    speed: Number.isFinite(rawSpeed) && rawSpeed >= 0 ? rawSpeed : null,
    origin: emg.origin || 'Posko',
    destination: emg.destination || 'RSUD Dr. Soetomo',
    nextIntersection: emg.nextIntersection || 'Menuju UGD',
    position,
    progress: typeof emg.progress === 'number' ? emg.progress : 0.0,
    routeId: emg.routeId || 'route-soetomo'
  };
}
