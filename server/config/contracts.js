import { INCIDENT_STATES } from './stateMachine.js';
import { ROUTES_DB } from './constants.js';

/** Canonical error envelope shared by REST, Socket.IO and the command gateway. */
export class ContractValidationError extends Error {
  constructor(code, message, { field = null, expected = null, actual = null, statusCode = 422 } = {}) {
    super(message);
    this.name = 'ContractValidationError';
    this.code = code;
    this.field = field;
    this.expected = expected;
    this.actual = actual;
    this.statusCode = statusCode;
    this.error = { code, message, field, expected, actual };
  }
}

export const DEVICE_FAULTS = Object.freeze(['recover', 'clear', 'latency_spike', 'low_fps', 'packet_loss', 'thermal_warning', 'heartbeat_timeout']);
export const DEVICE_RESOLUTIONS = Object.freeze(['720p', '1080p', '4k']);
export const INCIDENT_CATEGORIES = Object.freeze(['accident', 'congestion', 'roadblock', 'hazard', 'weather', 'infrastructure']);
export const INCIDENT_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const INCIDENT_STATUS_VALUES = Object.freeze([...Object.values(INCIDENT_STATES), 'DISPATCHED/RESPONDING']);
export const CHAOS_SUBSYSTEMS = Object.freeze(['database', 'persistence', 'state_store', 'state_manager', 'socket', 'sse', 'auth', 'command_pipeline', 'incident', 'emergency', 'device', 'signal', 'cctv', 'map', 'analytics', 'report', 'system']);
export const CHAOS_EFFECTS = Object.freeze(['latency_spike', 'packet_loss', 'low_fps', 'thermal_warning', 'heartbeat_timeout', 'sqlite_io_error', 'database_write_failure', 'database_write_rejection', 'database_unavailable', 'delayed_ack', 'chaos_spike', 'disconnect', 'degraded']);
const INTERSECTION_ID = /^[a-z][a-z0-9-]{1,63}$/;
const DEVICE_ID = /^[A-Z0-9][A-Z0-9_-]{1,63}$/i;
const ENTITY_ID = /^[A-Z0-9][A-Z0-9_-]{1,63}$/i;

const field = (type, options = {}) => Object.freeze({ type, ...options });
/**
 * Command contracts describe target type, required/optional inputs, normalization
 * and business bounds. Unknown extra payload keys are tolerated for wire compatibility;
 * actor and transport metadata keys are always removed before domain execution.
 * Shape errors return INVALID_COMMAND; bad target shapes return INVALID_TARGET;
 * well-formed but unknown entity identifiers return NOT_FOUND.
 */
export const COMMAND_CONTRACTS = Object.freeze({
  'device:config': { target: 'deviceId', targetType: 'device-identifier', required: ['targetId'], atLeastOne: ['fps', 'resolution', 'mode', 'greenWaveSync'], fields: { fps: field('integer', { min: 5, max: 60, optional: true }), resolution: field('enum', { values: DEVICE_RESOLUTIONS, optional: true }), mode: field('string', { maxLength: 60, optional: true }), greenWaveSync: field('boolean', { optional: true }) } },
  'device:fault': { target: 'deviceId', targetType: 'device-identifier', required: ['targetId', 'type'], fields: { type: field('enum', { values: DEVICE_FAULTS }), duration: field('integer', { min: 1, max: 300000, default: 30000, optional: true }) } },
  'device:ping': { target: 'deviceId', targetType: 'device-identifier', required: ['targetId'], fields: {} },
  'signal:override': { target: 'intersectionId', targetType: 'intersection-identifier', required: ['targetId'], fields: { duration: field('integer', { min: 15, max: 90, default: 45, optional: true }) } },
  'green-split:update': { target: 'intersectionId', targetType: 'intersection-identifier', required: ['targetId', 'value'], fields: { value: field('integer', { min: 15, max: 90 }) } },
  'ai:apply-recommendation': { target: 'intersectionId', targetType: 'intersection-identifier', required: ['targetId'], fields: { targetSplit: field('integer', { min: 15, max: 90, optional: true, nullable: true }) } },
  'green-wave:toggle': { target: 'corridorId', targetType: 'corridor-identifier', required: ['targetId', 'active'], fields: { active: field('boolean') } },
  'chaos:toggle': { target: 'networkId', targetType: 'network-identifier', required: ['targetId'], fields: { active: field('boolean', { optional: true, omittedMeans: 'toggle-current-state' }) } },
  'chaos:fault-inject': { target: 'faultId', targetType: 'fault-identifier', targetGeneratedIfOmitted: true, required: ['targetSubsystem', 'intendedEffect'], fields: { targetSubsystem: field('enum', { values: CHAOS_SUBSYSTEMS }), intendedEffect: field('enum', { values: CHAOS_EFFECTS }), durationMs: field('integer', { min: 1, max: 3600000, default: 15000, optional: true }), deterministicSeed: field('non-negative-safe-integer', { default: 42, optional: true }), params: field('object', { default: {}, optional: true }) } },
  'chaos:fault-clear': { target: 'faultId', targetType: 'fault-identifier-or-all-sentinel', required: ['targetId'], fields: {} },
  'simulation:control': { target: 'runtimeId', targetType: 'simulation-runtime-identifier', required: ['targetId', 'operation'], fields: { operation: field('enum', { values: ['pause', 'resume', 'step', 'set_speed', 'set_mode', 'reset_seed'] }), speedMultiplier: field('number', { min: 0.1, max: 10, optional: true }), seed: field('non-negative-safe-integer-or-string', { optional: true }), deltaMs: field('integer', { min: 1, max: 60000, default: 1000, optional: true }), mode: field('enum', { values: ['realtime', 'accelerated', 'deterministic'], optional: true }) } },
  'emergency:activate': { target: 'vehicleId', targetType: 'vehicle-identifier', required: ['targetId', 'code'], fields: { code: field('identifier', { maxLength: 50 }), route: field('route-id', { default: 'route-soetomo', optional: true }), type: field('string', { maxLength: 40, optional: true }), incidentId: field('identifier', { optional: true }) } },
  'emergency:cancel': { target: 'emergencyId', targetType: 'emergency-identifier', required: ['targetId'], fields: { id: field('identifier', { optional: true }) } },
  'incident:create': { target: 'incidentId', targetType: 'incident-identifier', targetGeneratedIfOmitted: true, required: ['title', 'location'], fields: { id: field('identifier', { optional: true, generatedIfOmitted: true }), title: field('string', { maxLength: 200 }), category: field('enum', { values: INCIDENT_CATEGORIES, default: 'congestion', optional: true, case: 'lower' }), severity: field('enum', { values: INCIDENT_SEVERITIES, default: 'medium', optional: true, case: 'lower' }), location: field('string', { maxLength: 250 }), assignedUnit: field('string', { maxLength: 120, default: 'Menunggu Disposisi Petugas', optional: true }), notes: field('string', { maxLength: 1000, default: 'Laporan insiden baru masuk antrean verifikasi SITS.', optional: true }) } },
  'incident:acknowledge': { target: 'incidentId', targetType: 'incident-identifier', required: ['targetId'], fields: { id: field('identifier', { optional: true }), assignedUnit: field('string', { maxLength: 120, optional: true }), notes: field('string', { maxLength: 1000, optional: true }) } },
  'incident:update-status': { target: 'incidentId', targetType: 'incident-identifier', required: ['targetId', 'status'], fields: { id: field('identifier', { optional: true }), status: field('enum', { values: INCIDENT_STATUS_VALUES, case: 'upper', legacyAlias: { 'DISPATCHED/RESPONDING': 'DISPATCHED' } }), assignedUnit: field('string', { maxLength: 120, optional: true }), notes: field('string', { maxLength: 1000, optional: true }) } },
  'incident:dispatch': { target: 'incidentId', targetType: 'incident-identifier', required: ['targetId'], fields: { id: field('identifier', { optional: true }), status: field('enum', { values: INCIDENT_STATUS_VALUES, default: 'DISPATCHED', optional: true, case: 'upper' }), assignedUnit: field('string', { maxLength: 120, default: 'Patroli Dishub & Tim 112 Surabaya', optional: true }), notes: field('string', { maxLength: 1000, default: 'Tim lapangan telah didisposisikan ke lokasi.', optional: true }) } },
  'incident:resolve': { target: 'incidentId', targetType: 'incident-identifier', required: ['targetId'], fields: { id: field('identifier', { optional: true }), assignedUnit: field('string', { maxLength: 120, optional: true }), notes: field('string', { maxLength: 1000, optional: true }) } },
  'siren:mute': { target: 'audioId', targetType: 'audio-identifier', required: ['targetId', 'muted'], fields: { muted: field('boolean') } },
  'cctv:snapshot': { target: 'cameraId', targetType: 'camera-identifier', required: ['targetId'], fields: {} }
});

function fail(field, expected, actual, code = 'INVALID_COMMAND') {
  throw new ContractValidationError(code, `Command contract validation failed for '${field}'.`, {
    field, expected, actual: actual === undefined ? 'missing' : actual,
    statusCode: code === 'NOT_FOUND' ? 404 : 422
  });
}

function requireString(value, field, { max = 128, pattern = null, trim = true, code = null } = {}) {
  const errorCode = code || (field === 'targetId' || field.endsWith('Id') || field === 'code' || field === 'route' ? 'INVALID_TARGET' : 'INVALID_COMMAND');
  if (typeof value !== 'string') fail(field, 'non-empty string', value, errorCode);
  const normalized = trim ? value.trim() : value;
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail(field, `non-empty string (max ${max})${pattern ? ' matching identifier format' : ''}`, value, errorCode);
  }
  return normalized;
}

function integer(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    fail(field, `integer ${min}..${max}`, value);
  }
  return value;
}

function optionalString(payload, field, max, { allowEmpty = false } = {}) {
  if (payload[field] === undefined || payload[field] === null) return;
  if (typeof payload[field] !== 'string' || payload[field].length > max || (!allowEmpty && !payload[field].trim())) {
    fail(field, `string${allowEmpty ? '' : ' (non-empty)'} max ${max}`, payload[field]);
  }
  payload[field] = payload[field].trim();
}

function resolveTarget(action, targetId, payload) {
  const contract = COMMAND_CONTRACTS[action];
  if (!contract) throw new ContractValidationError('INVALID_COMMAND', `Unknown command action '${action}'.`, { field: 'action', expected: Object.keys(COMMAND_CONTRACTS), actual: action });
  const targetField = contract.target;
  const payloadTarget = payload[targetField] ?? (targetField === 'incidentId' ? payload.id : targetField === 'emergencyId' ? (payload.id ?? payload.vehicleId) : targetField === 'vehicleId' ? payload.code ?? payload.vehicleId : targetField === 'deviceId' ? payload.deviceId : targetField === 'intersectionId' ? payload.intersectionId : targetField === 'faultId' ? payload.faultId : targetField === 'cameraId' ? payload.cameraId : undefined);
  const explicitTarget = typeof targetId === 'string' ? targetId.trim() : targetId;
  const explicitPayloadTarget = typeof payloadTarget === 'string' ? payloadTarget.trim() : payloadTarget;
  if (explicitTarget !== undefined && explicitTarget !== null && explicitPayloadTarget !== undefined && explicitTarget !== explicitPayloadTarget) {
    fail(targetField, `same value in targetId and payload.${targetField}`, { targetId, payloadTarget }, 'INVALID_TARGET');
  }
  let target = explicitTarget ?? explicitPayloadTarget;
  if (action === 'chaos:fault-inject' && target === undefined) target = `FLT-${Date.now()}`;
  const pattern = targetField === 'intersectionId' ? INTERSECTION_ID : targetField === 'deviceId' ? DEVICE_ID : targetField === 'runtimeId' ? /^simulation-runtime$/ : targetField === 'networkId' ? /^global-network$/ : targetField === 'corridorId' ? /^corridor-ayani-darmo$/ : targetField === 'audioId' ? /^global-audio$/ : targetField === 'faultId' && target === 'all' ? /^all$/ : ENTITY_ID;
  const normalizedTarget = requireString(target, 'targetId', { max: 64, pattern });
  payload[targetField] = normalizedTarget;
  return normalizedTarget;
}

/** Parse the transport-shaped command without changing its business meaning. */
export function parseCommandInput(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('command', 'object', command);
  const source = command.payload === undefined ? {} : command.payload;
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('payload', 'object', source);
  if (typeof command.action !== 'string' || !command.action.trim()) fail('action', 'known command action', command.action);
  return { ...command, payload: source };
}

/** Apply the documented wire aliases and defaults, producing a canonical intent. */
export function normalizeCommand(parsed) {
  const action = parsed.action.trim();
  const payload = Object.fromEntries(Object.entries(parsed.payload).filter(([, value]) => value !== undefined));
  for (const key of ['commandId', 'idempotencyKey', 'correlationId', 'actor', 'actorId', 'userId', 'username', 'role']) delete payload[key];
  if (action === 'incident:create' && parsed.targetId == null && payload.id == null) {
    payload.id = `INC-${Date.now().toString(36).toUpperCase()}`;
  }

  // Explicit compatibility mapping for the legacy emergency:priority event payload.
  if (action === 'emergency:activate') {
    if (payload.code === undefined && payload.vehicleId !== undefined) payload.code = payload.vehicleId;
    if (payload.route === undefined && payload.routeId !== undefined) payload.route = payload.routeId;
    delete payload.vehicleId;
    delete payload.routeId;
  }
  return { ...parsed, action, payload };
}

/** Validate a normalized intent. This function is pure and has no side effects. */
export function validateCommand(normalized) {
  const command = normalized;
  let normalizedAction = command.action;
  const payload = { ...command.payload };
  const action = normalizedAction;
  const targetId = resolveTarget(action, command.targetId, payload);

  for (const key of ['commandId', 'idempotencyKey', 'correlationId']) {
    if (command[key] !== undefined && command[key] !== null && (typeof command[key] !== 'string' || !command[key].trim() || command[key].length > 160)) {
      fail(key, 'non-empty string max 160', command[key]);
    }
  }

  switch (normalizedAction) {
    case 'device:config': {
      const fields = COMMAND_CONTRACTS[normalizedAction].atLeastOne;
      if (!fields.some(field => payload[field] !== undefined)) fail('payload', `at least one of ${fields.join(', ')}`, payload);
      if (payload.fps !== undefined) payload.fps = integer(payload.fps, 'fps', 5, 60);
      if (payload.resolution !== undefined && !DEVICE_RESOLUTIONS.includes(payload.resolution)) fail('resolution', DEVICE_RESOLUTIONS, payload.resolution);
      optionalString(payload, 'mode', 60);
      if (payload.greenWaveSync !== undefined && typeof payload.greenWaveSync !== 'boolean') fail('greenWaveSync', 'boolean', payload.greenWaveSync);
      break;
    }
    case 'device:fault':
      if (!DEVICE_FAULTS.includes(payload.type)) fail('type', DEVICE_FAULTS, payload.type);
      payload.duration = payload.duration === undefined ? 30000 : integer(payload.duration, 'duration', 1, 300000);
      break;
    case 'signal:override': payload.duration = payload.duration === undefined ? 45 : integer(payload.duration, 'duration', 15, 90); break;
    case 'green-split:update': payload.value = integer(payload.value, 'value', 15, 90); break;
    case 'ai:apply-recommendation': if (payload.targetSplit !== undefined && payload.targetSplit !== null) payload.targetSplit = integer(payload.targetSplit, 'targetSplit', 15, 90); break;
    case 'green-wave:toggle':
    case 'siren:mute':
      if (typeof payload[normalizedAction === 'green-wave:toggle' ? 'active' : 'muted'] !== 'boolean') fail(normalizedAction === 'green-wave:toggle' ? 'active' : 'muted', 'boolean', payload[normalizedAction === 'green-wave:toggle' ? 'active' : 'muted']);
      break;
    case 'chaos:toggle': if (payload.active !== undefined && typeof payload.active !== 'boolean') fail('active', 'boolean', payload.active); break;
    case 'chaos:fault-inject': {
      if (!CHAOS_SUBSYSTEMS.includes(payload.targetSubsystem)) fail('targetSubsystem', CHAOS_SUBSYSTEMS, payload.targetSubsystem);
      if (!CHAOS_EFFECTS.includes(payload.intendedEffect)) fail('intendedEffect', CHAOS_EFFECTS, payload.intendedEffect);
      payload.durationMs = payload.durationMs === undefined ? 15000 : integer(payload.durationMs, 'durationMs', 1, 3600000);
      if (payload.deterministicSeed !== undefined && (!Number.isSafeInteger(payload.deterministicSeed) || payload.deterministicSeed < 0)) fail('deterministicSeed', 'non-negative safe integer', payload.deterministicSeed);
      if (payload.params !== undefined && (!payload.params || typeof payload.params !== 'object' || Array.isArray(payload.params))) fail('params', 'object', payload.params);
      payload.deterministicSeed = payload.deterministicSeed === undefined ? 42 : payload.deterministicSeed;
      payload.params = payload.params === undefined ? {} : payload.params;
      break;
    }
    case 'chaos:fault-clear': payload.faultId = targetId; break;
    case 'simulation:control': {
      const operations = ['pause', 'resume', 'step', 'set_speed', 'set_mode', 'reset_seed'];
      if (!operations.includes(payload.operation)) fail('operation', operations, payload.operation);
      if (payload.operation === 'step') payload.deltaMs = payload.deltaMs === undefined ? 1000 : integer(payload.deltaMs, 'deltaMs', 1, 60000);
      if (payload.operation === 'set_speed' && (typeof payload.speedMultiplier !== 'number' || !Number.isFinite(payload.speedMultiplier) || payload.speedMultiplier < 0.1 || payload.speedMultiplier > 10)) fail('speedMultiplier', 'finite number 0.1..10', payload.speedMultiplier);
      if (payload.operation === 'set_mode' && !['realtime', 'accelerated', 'deterministic'].includes(payload.mode)) fail('mode', ['realtime', 'accelerated', 'deterministic'], payload.mode);
      if (payload.operation === 'reset_seed' && !(typeof payload.seed === 'string' && payload.seed.length > 0 && payload.seed.length <= 128) && !(Number.isSafeInteger(payload.seed) && payload.seed >= 0)) fail('seed', 'non-empty string max 128 or non-negative safe integer', payload.seed);
      break;
    }
    case 'emergency:activate': {
      payload.code = requireString(payload.code, 'code', { max: 50, pattern: ENTITY_ID });
      payload.route = payload.route === undefined ? 'route-soetomo' : requireString(payload.route, 'route', { max: 64, pattern: /^route-[a-z0-9-]+$/ });
      if (!ROUTES_DB[payload.route]) fail('route', Object.keys(ROUTES_DB), payload.route, 'INVALID_TARGET');
      if (payload.incidentId !== undefined) payload.incidentId = requireString(payload.incidentId, 'incidentId', { max: 64, pattern: ENTITY_ID });
      optionalString(payload, 'type', 40);
      break;
    }
    case 'emergency:cancel':
      payload.id = targetId;
      if (payload.id === 'all') fail('id', 'one emergency identifier', payload.id, 'INVALID_TARGET');
      break;
    case 'incident:create': {
      payload.id = targetId;
      payload.title = requireString(payload.title, 'title', { max: 200 });
      payload.location = requireString(payload.location, 'location', { max: 250 });
      if (payload.category !== undefined && typeof payload.category !== 'string') fail('category', INCIDENT_CATEGORIES, payload.category);
      if (payload.severity !== undefined && typeof payload.severity !== 'string') fail('severity', INCIDENT_SEVERITIES, payload.severity);
      payload.category = payload.category === undefined ? 'congestion' : payload.category.trim().toLowerCase();
      payload.severity = payload.severity === undefined ? 'medium' : payload.severity.trim().toLowerCase();
      if (!INCIDENT_CATEGORIES.includes(payload.category)) fail('category', INCIDENT_CATEGORIES, payload.category);
      if (!INCIDENT_SEVERITIES.includes(payload.severity)) fail('severity', INCIDENT_SEVERITIES, payload.severity);
      if (payload.assignedUnit === undefined) payload.assignedUnit = 'Menunggu Disposisi Petugas';
      if (payload.notes === undefined) payload.notes = 'Laporan insiden baru masuk antrean verifikasi SITS.';
      optionalString(payload, 'assignedUnit', 120);
      optionalString(payload, 'notes', 1000, { allowEmpty: true });
      break;
    }
    case 'incident:acknowledge': payload.id = targetId; optionalString(payload, 'assignedUnit', 120); optionalString(payload, 'notes', 1000, { allowEmpty: true }); break;
    case 'incident:update-status':
    case 'incident:dispatch': {
      payload.id = targetId;
      if (payload.status === undefined && normalizedAction === 'incident:dispatch') payload.status = INCIDENT_STATES.DISPATCHED;
      if (typeof payload.status !== 'string') fail('status', Object.values(INCIDENT_STATES), payload.status);
      const legacy = payload.status.trim().toUpperCase();
      payload.status = legacy === 'DISPATCHED/RESPONDING' ? INCIDENT_STATES.DISPATCHED : legacy;
      if (payload.status !== 'DISPATCHED/RESPONDING' && !Object.values(INCIDENT_STATES).includes(payload.status)) fail('status', INCIDENT_STATUS_VALUES, payload.status);
      if (normalizedAction === 'incident:update-status' && payload.status === INCIDENT_STATES.ACKNOWLEDGED) normalizedAction = 'incident:acknowledge';
      if (normalizedAction === 'incident:update-status' && payload.status === INCIDENT_STATES.RESOLVED) normalizedAction = 'incident:resolve';
      if (normalizedAction === 'incident:dispatch' && payload.assignedUnit === undefined) payload.assignedUnit = 'Patroli Dishub & Tim 112 Surabaya';
      if (normalizedAction === 'incident:dispatch' && payload.notes === undefined) payload.notes = 'Tim lapangan telah didisposisikan ke lokasi.';
      optionalString(payload, 'assignedUnit', 120); optionalString(payload, 'notes', 1000, { allowEmpty: true });
      break;
    }
    case 'incident:resolve': payload.id = targetId; optionalString(payload, 'assignedUnit', 120); optionalString(payload, 'notes', 1000, { allowEmpty: true }); break;
    case 'cctv:snapshot': break;
  }

  return { ...command, action: normalizedAction, targetId, payload };
}

/** Convenience composition for adapters and domain entry points. */
export function normalizeAndValidateCommand(command) {
  return validateCommand(normalizeCommand(parseCommandInput(command)));
}

/** Protect direct domain entry points with the exact same contract implementation. */
export function validateDomainCommand(action, targetId, payload) {
  return normalizeAndValidateCommand({ action, targetId, payload }).payload;
}

export function validateDiagnosticEventsQuery(query = {}) {
  const limit = query.limit === undefined ? 30 : (typeof query.limit === 'string' && /^\d+$/.test(query.limit) ? Number(query.limit) : NaN);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('limit', 'integer 1..100', query.limit);
  const categories = ['operational', 'state_transition', 'performance', 'security', 'fault'];
  const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
  let category = query.category;
  let level = query.level;
  if (category !== undefined) {
    if (typeof category !== 'string') fail('category', categories, category);
    category = category.trim().toLowerCase();
    if (!categories.includes(category)) fail('category', categories, query.category);
  }
  if (level !== undefined) {
    if (typeof level !== 'string') fail('level', levels, level);
    level = level.trim().toUpperCase();
    if (!levels.includes(level)) fail('level', levels, query.level);
  }
  return { limit, category: category || null, level: level || null };
}

export function validateForecastQuery(rawHour, fallbackHour) {
  if (rawHour === undefined) return fallbackHour;
  if (typeof rawHour !== 'string' || !/^(?:\d+)(?:\.\d+)?$/.test(rawHour.trim())) fail('hour', 'number in range [0, 24)', rawHour);
  const hour = Number(rawHour);
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) fail('hour', 'number in range [0, 24)', rawHour);
  return hour;
}
