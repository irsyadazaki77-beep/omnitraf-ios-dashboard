/**
 * Explicit safety boundary for the current prototype.
 * Physical control remains disabled in code until a separately reviewed,
 * verified hardware adapter and safety interlocks exist.
 */
export const SAFETY_BOUNDARY = Object.freeze({
  operationMode: 'SIMULATION_ONLY',
  dataProvenance: 'SIMULATED',
  physicalControlEnabled: false,
  hardwareAdapter: 'NONE',
  safetyInterlocksVerified: false,
  userActionsAffect: 'SIMULATION_STATE_ONLY'
});

// Fail closed: a new command cannot reach dispatch until it is explicitly
// reviewed and classified as simulation-only.
const simulationOnlyActions = new Set([
  'device:config',
  'device:fault',
  'device:ping',
  'signal:override',
  'green-split:update',
  'green-wave:toggle',
  'ai:apply-recommendation',
  'chaos:toggle',
  'chaos:fault-inject',
  'chaos:fault-clear',
  'simulation:control',
  'emergency:activate',
  'emergency:cancel',
  'incident:acknowledge',
  'incident:create',
  'incident:update-status',
  'incident:dispatch',
  'incident:resolve',
  'siren:mute',
  'cctv:snapshot'
]);

export function assertSimulationOnlyAction(action) {
  if (!simulationOnlyActions.has(action)) {
    const error = new Error(`Perintah '${action}' ditolak: aksi belum disetujui untuk batas simulasi-only.`);
    error.code = 'SIMULATION_BOUNDARY_REJECTED';
    error.statusCode = 403;
    throw error;
  }
}
