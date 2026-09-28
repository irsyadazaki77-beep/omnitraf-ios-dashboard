/**
 * OmniTRAF Surabaya - Formal Incident & Emergency State Machine Definitions
 * Phase 14D: Hardened, deterministic, transactional, server-authoritative state transitions.
 */

// ============================================================================
// INCIDENT LIFECYCLE STATE MACHINE
// ============================================================================

export const INCIDENT_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  DISPATCHED: 'DISPATCHED',
  RESPONDING: 'RESPONDING',
  MITIGATED: 'MITIGATED',
  RESOLVED: 'RESOLVED',
  ARCHIVED: 'ARCHIVED'
});

export const VALID_INCIDENT_STATUSES = Object.freeze(Object.values(INCIDENT_STATES));

/**
 * Incident State Transition Matrix
 * Key: Current State
 * Value: Array of valid target states
 * 
 * Rules:
 * - ACTIVE -> ACKNOWLEDGED, DISPATCHED, RESOLVED
 * - ACKNOWLEDGED -> DISPATCHED, RESPONDING, RESOLVED
 * - DISPATCHED -> RESPONDING, MITIGATED, RESOLVED
 * - RESPONDING -> MITIGATED, RESOLVED
 * - MITIGATED -> RESOLVED
 * - RESOLVED -> ARCHIVED (Terminal business state, cannot reactivate)
 * - ARCHIVED -> [] (Terminal immutable archive)
 */
export const INCIDENT_TRANSITION_MATRIX = Object.freeze({
  [INCIDENT_STATES.ACTIVE]: [
    INCIDENT_STATES.ACKNOWLEDGED,
    INCIDENT_STATES.DISPATCHED,
    INCIDENT_STATES.RESOLVED
  ],
  [INCIDENT_STATES.ACKNOWLEDGED]: [
    INCIDENT_STATES.DISPATCHED,
    INCIDENT_STATES.RESPONDING,
    INCIDENT_STATES.RESOLVED
  ],
  [INCIDENT_STATES.DISPATCHED]: [
    INCIDENT_STATES.RESPONDING,
    INCIDENT_STATES.MITIGATED,
    INCIDENT_STATES.RESOLVED
  ],
  [INCIDENT_STATES.RESPONDING]: [
    INCIDENT_STATES.MITIGATED,
    INCIDENT_STATES.RESOLVED
  ],
  [INCIDENT_STATES.MITIGATED]: [
    INCIDENT_STATES.RESOLVED
  ],
  [INCIDENT_STATES.RESOLVED]: [
    INCIDENT_STATES.ARCHIVED
  ],
  [INCIDENT_STATES.ARCHIVED]: []
});

/**
 * Normalizes legacy status strings like 'DISPATCHED/RESPONDING' into formal canonical state
 * @param {string} rawStatus 
 * @returns {string} canonical status
 */
export function normalizeIncidentStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return '';
  const clean = rawStatus.trim().toUpperCase();
  if (clean === 'DISPATCHED/RESPONDING') {
    return INCIDENT_STATES.DISPATCHED;
  }
  return clean;
}

/**
 * Validates whether an incident state transition is valid
 * @param {string} currentState 
 * @param {string} targetState 
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateIncidentTransition(currentState, targetState) {
  const current = normalizeIncidentStatus(currentState);
  const target = normalizeIncidentStatus(targetState);

  if (!VALID_INCIDENT_STATUSES.includes(current)) {
    return {
      valid: false,
      reason: `Status awal '${currentState}' tidak valid dalam state machine insiden.`
    };
  }

  if (!VALID_INCIDENT_STATUSES.includes(target)) {
    return {
      valid: false,
      reason: `Status tujuan '${targetState}' tidak valid dalam state machine insiden. Status yang diizinkan: ${VALID_INCIDENT_STATUSES.join(', ')}.`
    };
  }

  if (current === target) {
    return { valid: true, noOp: true };
  }

  const allowedTransitions = INCIDENT_TRANSITION_MATRIX[current] || [];
  if (!allowedTransitions.includes(target)) {
    return {
      valid: false,
      reason: `Transisi tidak sah dari '${current}' ke '${target}'. Transisi yang diizinkan dari '${current}' adalah: [${allowedTransitions.join(', ') || 'NONE - State Terminal'}].`
    };
  }

  return { valid: true };
}


// ============================================================================
// EMERGENCY 112 LIFECYCLE STATE MACHINE
// ============================================================================

export const EMERGENCY_STATES = Object.freeze({
  REQUESTED: 'REQUESTED',
  VERIFIED: 'VERIFIED',
  DISPATCHED: 'DISPATCHED',
  ROUTE_PREEMPTION: 'ROUTE_PREEMPTION',
  EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  TERMINAL_ARCHIVED: 'TERMINAL_ARCHIVED'
});

export const VALID_EMERGENCY_STATUSES = Object.freeze(Object.values(EMERGENCY_STATES));

/**
 * Emergency State Transition Matrix
 * Key: Current State
 * Value: Array of valid target states
 *
 * Rules:
 * - REQUESTED -> VERIFIED, CANCELLED
 * - VERIFIED -> DISPATCHED, CANCELLED
 * - DISPATCHED -> ROUTE_PREEMPTION, EN_ROUTE, CANCELLED
 * - ROUTE_PREEMPTION -> EN_ROUTE, CANCELLED
 * - EN_ROUTE -> ARRIVED, CANCELLED
 * - ARRIVED -> COMPLETED, CANCELLED
 * - CANCELLED -> TERMINAL_ARCHIVED
 * - COMPLETED -> TERMINAL_ARCHIVED
 * - TERMINAL_ARCHIVED -> []
 */
export const EMERGENCY_TRANSITION_MATRIX = Object.freeze({
  [EMERGENCY_STATES.REQUESTED]: [
    EMERGENCY_STATES.VERIFIED,
    EMERGENCY_STATES.CANCELLED
  ],
  [EMERGENCY_STATES.VERIFIED]: [
    EMERGENCY_STATES.DISPATCHED,
    EMERGENCY_STATES.CANCELLED
  ],
  [EMERGENCY_STATES.DISPATCHED]: [
    EMERGENCY_STATES.ROUTE_PREEMPTION,
    EMERGENCY_STATES.EN_ROUTE,
    EMERGENCY_STATES.CANCELLED
  ],
  [EMERGENCY_STATES.ROUTE_PREEMPTION]: [
    EMERGENCY_STATES.EN_ROUTE,
    EMERGENCY_STATES.CANCELLED
  ],
  [EMERGENCY_STATES.EN_ROUTE]: [
    EMERGENCY_STATES.ARRIVED,
    EMERGENCY_STATES.CANCELLED
  ],
  [EMERGENCY_STATES.ARRIVED]: [
    EMERGENCY_STATES.COMPLETED,
    EMERGENCY_STATES.CANCELLED
  ],
  [EMERGENCY_STATES.CANCELLED]: [
    EMERGENCY_STATES.TERMINAL_ARCHIVED
  ],
  [EMERGENCY_STATES.COMPLETED]: [
    EMERGENCY_STATES.TERMINAL_ARCHIVED
  ],
  [EMERGENCY_STATES.TERMINAL_ARCHIVED]: []
});

/**
 * Normalizes legacy emergency status string
 * @param {string} rawStatus 
 * @returns {string} canonical status
 */
export function normalizeEmergencyStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return '';
  const clean = rawStatus.trim().toUpperCase();
  if (clean === 'PRIORITAS AKTIF') {
    return EMERGENCY_STATES.ROUTE_PREEMPTION;
  }
  return clean;
}

/**
 * Validates whether an emergency state transition is valid
 * @param {string} currentState 
 * @param {string} targetState 
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateEmergencyTransition(currentState, targetState) {
  const current = normalizeEmergencyStatus(currentState);
  const target = normalizeEmergencyStatus(targetState);

  if (!VALID_EMERGENCY_STATUSES.includes(current)) {
    return {
      valid: false,
      reason: `Status awal emergency '${currentState}' tidak dikenali dalam state machine.`
    };
  }

  if (!VALID_EMERGENCY_STATUSES.includes(target)) {
    return {
      valid: false,
      reason: `Status target emergency '${targetState}' tidak sah. Status yang diizinkan: ${VALID_EMERGENCY_STATUSES.join(', ')}.`
    };
  }

  if (current === target) {
    return { valid: true, noOp: true };
  }

  const allowed = EMERGENCY_TRANSITION_MATRIX[current] || [];
  if (!allowed.includes(target)) {
    return {
      valid: false,
      reason: `Transisi emergency tidak diizinkan dari '${current}' ke '${target}'. Transisi yang valid: [${allowed.join(', ') || 'NONE - State Terminal'}].`
    };
  }

  return { valid: true };
}

/**
 * Constructs a standardized, immutable domain event envelope for state transitions
 */
export function createDomainEventEnvelope({
  entityId,
  entityType,
  previousState,
  nextState,
  commandId,
  correlationId,
  actor,
  reason,
  source = 'server',
  sequence = 0,
  details = null
}) {
  return Object.freeze({
    entityId: String(entityId),
    entityType: String(entityType),
    previousState: previousState ? (typeof previousState === 'object' ? previousState.status || previousState : previousState) : null,
    nextState: nextState ? (typeof nextState === 'object' ? nextState.status || nextState : nextState) : null,
    commandId: commandId || `CMD-${Date.now()}`,
    correlationId: correlationId || `CORR-${Date.now()}`,
    actor: actor || 'SITS Automation',
    timestamp: Date.now(),
    isoTimestamp: new Date().toISOString(),
    reason: reason || 'STATE_TRANSITION',
    source,
    sequence,
    details: details || {}
  });
}
