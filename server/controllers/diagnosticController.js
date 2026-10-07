/**
 * OmniTRAF SITS Surabaya - Diagnostics & Chaos Matrix REST Controller (Phase 17)
 * Endpoints for:
 * - Comprehensive Readiness/Health Checks (/ready, /healthz, /api/diagnostics/health)
 * - Structured Diagnostic Snapshot & Event Feed (/api/diagnostics/snapshot, /api/diagnostics/events)
 * - Safe Deterministic Chaos / Fault Injection (/api/chaos/faults/inject, /api/chaos/faults/clear)
 */

import { backendState } from '../services/stateManager.js';
import { dbManager } from '../db/database.js';
import { diagnosticEngine, HEALTH_STATUS, SUBSYSTEMS, EVENT_CATEGORIES, DIAGNOSTIC_LEVELS } from '../services/diagnosticEngine.js';
import { createApiResponse, createApiErrorResponse, createCommandErrorResponse, getCommandErrorStatus } from '../middlewares/errorHandler.js';
import { ROLES } from '../config/constants.js';
import { commandExecutor } from '../services/commandExecutor.js';
import { SAFETY_BOUNDARY } from '../config/safetyBoundary.js';
import { clusterRuntime } from '../infrastructure/redis/clusterRuntimeSingleton.js';
import { runtimeInstanceId } from '../infrastructure/redis/simulationLeadership.js';
import { OMNITRAF_RUNTIME_MODE } from '../config/env.js';
import { validateDiagnosticEventsQuery } from '../config/contracts.js';

export function getDiagnosticHealth(req, res) {
  const dbReady = dbManager.isInitialized && dbManager.ping();
  let dbStatus = HEALTH_STATUS.UNAVAILABLE;
  let dbLatencyMs = 0;

  if (dbReady) {
    const t0 = Date.now();
    try {
      if (!dbManager.ping()) throw new Error('DATABASE_PING_FAILED');
      dbLatencyMs = Date.now() - t0;
      dbStatus = HEALTH_STATUS.HEALTHY;
    } catch (err) {
      dbStatus = HEALTH_STATUS.DEGRADED;
    }
  }

  const clientsCount = backendState.io?.engine?.clientsCount || 0;
  const socketStatus = backendState.io ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.DEGRADED;
  const stateStatus = backendState.isHydrated ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.STARTING;
  const leadership = clusterRuntime.leadership?.getDiagnostics() || { mode: OMNITRAF_RUNTIME_MODE, instanceId: runtimeInstanceId, role: 'UNAVAILABLE', redisStatus: OMNITRAF_RUNTIME_MODE === 'single' ? 'NOT_REQUIRED' : 'UNAVAILABLE', leaderId: null, leaseExpiresInMs: 0, synchronized: false };
  const clusterReady = OMNITRAF_RUNTIME_MODE === 'single' || (clusterRuntime.redis?.isConnected() && leadership.synchronized && ['LEADER', 'FOLLOWER'].includes(leadership.role));

  // Check if simulated fault on database or socket is active
  if (diagnosticEngine.isFaultActive(SUBSYSTEMS.DATABASE)) {
    dbStatus = HEALTH_STATUS.DEGRADED;
  }
  if (diagnosticEngine.isFaultActive(SUBSYSTEMS.SOCKET)) {
    dbStatus = HEALTH_STATUS.DEGRADED;
  }

  diagnosticEngine.setSubsystemHealth(SUBSYSTEMS.DATABASE, dbStatus, `DB Latency: ${dbLatencyMs}ms`);
  diagnosticEngine.setSubsystemHealth(SUBSYSTEMS.STATE_MANAGER, stateStatus, `Hydrated: ${backendState.isHydrated}`);
  diagnosticEngine.setSubsystemHealth(SUBSYSTEMS.SOCKET, socketStatus, `Clients: ${clientsCount}`);

  const isHealthy = dbStatus === HEALTH_STATUS.HEALTHY && stateStatus === HEALTH_STATUS.HEALTHY && clusterReady;
  const overallStatus = isHealthy ? (diagnosticEngine.activeFaults.size > 0 ? HEALTH_STATUS.DEGRADED : HEALTH_STATUS.HEALTHY) : HEALTH_STATUS.UNAVAILABLE;

  res.status(isHealthy ? 200 : 503).json(createApiResponse({
    type: 'diagnostic_health_report',
    status: overallStatus,
    data: {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      subsystems: {
        cluster: {
          ...leadership,
          ...clusterRuntime.getDiagnostics()
        },
        database: {
          status: dbStatus,
          readiness: dbReady,
          latencyMs: dbLatencyMs,
          persistence: dbManager.getHealth()
        },
        stateManager: {
          status: stateStatus,
          isHydrated: backendState.isHydrated,
          sequence: backendState.sequence,
          lastUpdated: backendState.lastUpdated
        },
        socketServer: {
          status: socketStatus,
          activeClients: clientsCount,
          adapter: process.env.REDIS_URL ? 'Redis' : 'Memory'
        },
        devices: {
          total: backendState.devicesRegistry.length,
          online: backendState.devicesRegistry.filter(d => d.healthLevel === 'HEALTHY').length,
          degraded: backendState.devicesRegistry.filter(d => d.healthLevel === 'DEGRADED').length,
          offline: backendState.devicesRegistry.filter(d => d.healthLevel === 'OFFLINE' || d.healthLevel === 'STALE').length
        },
        chaosMode: {
          active: backendState.state.isChaosMode,
          level: backendState.state.chaosLevel,
          injectedFaultsCount: diagnosticEngine.activeFaults.size
        }
      }
    }
  }));
}

export function getDiagnosticSnapshot(req, res) {
  const snapshot = diagnosticEngine.captureSnapshot({
    sequence: backendState.sequence,
    activeEmergencies: backendState.state.activeEmergencies?.length || 0,
    incidentsCount: backendState.state.incidents?.length || 0,
    isChaosMode: backendState.state.isChaosMode,
    clientsCount: backendState.io?.engine?.clientsCount || 0
  });

  res.status(200).json(createApiResponse({
    type: 'diagnostic_snapshot',
    sequence: backendState.sequence,
    data: snapshot
  }));
}

export function getDiagnosticEvents(req, res) {
  let query;
  try { query = validateDiagnosticEventsQuery(req.query); }
  catch (error) { return res.status(error.statusCode || 422).json(createCommandErrorResponse(error)); }
  const { limit, category, level } = query;

  let filtered = diagnosticEngine.events;
  if (category) {
    filtered = filtered.filter(e => e.category === category);
  }
  if (level) {
    filtered = filtered.filter(e => e.level === level.toUpperCase());
  }

  res.status(200).json(createApiResponse({
    type: 'diagnostic_events',
    data: filtered.slice(0, limit)
  }));
}

export async function injectChaosFault(req, res) {
  const { targetSubsystem, intendedEffect, durationMs, deterministicSeed, params } = req.body || {};
  const correlationId = req.headers['x-correlation-id'] || `CORR-FLT-${Date.now()}`;
  const faultId = req.body?.faultId ?? null;

  try {
    const outcome = await commandExecutor.executeCommand({
      action: 'chaos:fault-inject', targetId: faultId,
      payload: { faultId, targetSubsystem, intendedEffect, durationMs,
        deterministicSeed, params },
      commandId: req.body?.commandId, idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey,
      correlationId, authenticatedUser: req.user, sourceChannel: 'rest'
    });
    const fault = outcome.newState;

    res.status(200).json(createApiResponse({
      type: 'chaos_fault_injected',
      data: fault,
      extra: { command: outcome }
    }));
  } catch (err) {
    const response = createCommandErrorResponse(err);
    const statusCode = getCommandErrorStatus(err);
    return res.status(statusCode).json(response);
  }
}

export async function clearChaosFault(req, res) {
  const faultId = req.params.faultId || req.body?.faultId;

  if (faultId === 'all' || !faultId) {
    let outcome;
    try {
      outcome = await commandExecutor.executeCommand({ action: 'chaos:fault-clear', targetId: 'all',
        payload: { faultId: 'all' }, commandId: req.body?.commandId,
        idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey,
        correlationId: req.headers['x-correlation-id'], authenticatedUser: req.user, sourceChannel: 'rest' });
    } catch (err) { return res.status(getCommandErrorStatus(err, 500)).json(createCommandErrorResponse(err, 500)); }
    return res.status(200).json(createApiResponse({
      type: 'chaos_faults_cleared',
      data: { clearedCount: outcome.newState.clearedCount }, extra: { command: outcome }
    }));
  }

  let outcome;
  try {
    outcome = await commandExecutor.executeCommand({ action: 'chaos:fault-clear', targetId: faultId,
      payload: { faultId }, commandId: req.body?.commandId,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey,
      correlationId: req.headers['x-correlation-id'], authenticatedUser: req.user, sourceChannel: 'rest' });
  } catch (err) {
    return res.status(getCommandErrorStatus(err)).json(createCommandErrorResponse(err));
  }

  res.status(200).json(createApiResponse({
    type: 'chaos_fault_cleared',
    data: outcome.newState, extra: { command: outcome }
  }));
}

export function getSimulationDiagnostics(req, res) {
  const simEngine = backendState.simEngine;
  const clock = backendState.clock;
  const engineDiagnostics = simEngine.getDiagnostics();

  res.status(200).json(createApiResponse({
    type: 'simulation_diagnostics',
    data: {
      mode: clock.mode,
      clockBehavior: clock.mode === 'LIVE' ? 'REALTIME_SIMULATION' : clock.mode,
      safetyBoundary: SAFETY_BOUNDARY,
      seed: backendState.simConfig.seed,
      simulationTimeMs: clock.now(),
      simulationTimeIso: clock.nowIso(),
      simulationTimeWib: clock.nowWibString(),
      wallTimeMs: clock.wallNow(),
      wallTimeIso: clock.wallNowIso(),
      speedMultiplier: clock.speedMultiplier,
      paused: clock.paused,
      tickResolution: backendState.simConfig.tickResolution,
      tickSequence: simEngine.tickSequence,
      eventSequence: simEngine.eventSequence,
      lastTickDurationMs: simEngine.lastTickDurationMs,
      health: engineDiagnostics.health,
      eventQueueSize: engineDiagnostics.eventQueueSize,
      lastEventType: engineDiagnostics.lastEventType,
      moduleErrors: engineDiagnostics.errors,
      journalLength: simEngine.eventJournal.length,
      activeDomains: Array.from(simEngine.domains.keys()),
      devicesCount: backendState.devicesRegistry.length,
      activeEmergenciesCount: backendState.state.activeEmergencies.length,
      checkpoint: {
        supported: true,
        schemaVersion: "v19.0.0-deterministic"
      }
    }
  }));
}

export async function controlSimulation(req, res) {
  const { action, ...payload } = req.body || {};
  try {
    const outcome = await commandExecutor.executeCommand({
      action: 'simulation:control', targetId: 'simulation-runtime', payload: { ...payload, operation: action },
      commandId: req.body?.commandId, idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey,
      correlationId: req.headers['x-correlation-id'], authenticatedUser: req.user, sourceChannel: 'rest'
    });
    res.status(200).json(createApiResponse({ type: 'simulation_control_applied', data: {
      action, ...outcome.newState, simTimeIso: backendState.clock.nowIso(), seed: backendState.simConfig.seed
    }, extra: { command: outcome } }));
  } catch (err) {
    res.status(getCommandErrorStatus(err)).json(createCommandErrorResponse(err));
  }
}
