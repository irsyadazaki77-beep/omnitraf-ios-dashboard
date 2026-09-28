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
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';
import { ROLES } from '../config/constants.js';

export function getDiagnosticHealth(req, res) {
  const dbReady = dbManager.isInitialized && dbManager.db !== null;
  let dbStatus = HEALTH_STATUS.UNAVAILABLE;
  let dbLatencyMs = 0;

  if (dbReady) {
    const t0 = Date.now();
    try {
      dbManager.db.exec('SELECT 1;');
      dbLatencyMs = Date.now() - t0;
      dbStatus = HEALTH_STATUS.HEALTHY;
    } catch (err) {
      dbStatus = HEALTH_STATUS.DEGRADED;
    }
  }

  const clientsCount = backendState.io?.engine?.clientsCount || 0;
  const socketStatus = backendState.io ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.DEGRADED;
  const stateStatus = backendState.isHydrated ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.STARTING;

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

  const isHealthy = dbStatus === HEALTH_STATUS.HEALTHY && stateStatus === HEALTH_STATUS.HEALTHY;
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
        database: {
          status: dbStatus,
          readiness: dbReady,
          latencyMs: dbLatencyMs,
          path: '[LOCAL_EMBEDDED_SQLITE]'
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
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const category = req.query.category || null;
  const level = req.query.level || null;

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

export function injectChaosFault(req, res) {
  const { targetSubsystem, intendedEffect, durationMs, deterministicSeed, params } = req.body || {};
  const correlationId = req.headers['x-correlation-id'] || `CORR-FLT-${Date.now()}`;
  const faultId = req.body?.faultId || `FLT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

  if (!targetSubsystem || !intendedEffect) {
    return res.status(400).json(createApiErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Field targetSubsystem dan intendedEffect wajib disertakan.',
      { field: !targetSubsystem ? 'targetSubsystem' : 'intendedEffect' }
    ));
  }

  try {
    const fault = diagnosticEngine.injectFault({
      faultId,
      targetSubsystem,
      intendedEffect,
      durationMs: durationMs || 15000,
      deterministicSeed: deterministicSeed || 42,
      params: params || {}
    });

    // Mirror to backendState chaos mode if whole-system chaos target
    if (targetSubsystem === 'system' || intendedEffect === 'chaos_spike') {
      backendState.toggleChaos(true);
    }

    if (backendState.io) {
      backendState.io.emit('chaos:fault-injected', {
        fault,
        correlationId
      });
    }

    res.status(200).json(createApiResponse({
      type: 'chaos_fault_injected',
      data: fault
    }));
  } catch (err) {
    return res.status(403).json(createApiErrorResponse(
      403,
      'FAULT_INJECTION_PROHIBITED',
      err.message
    ));
  }
}

export function clearChaosFault(req, res) {
  const faultId = req.params.faultId || req.body?.faultId;

  if (faultId === 'all' || !faultId) {
    const count = diagnosticEngine.clearAllFaults();
    if (backendState.state.isChaosMode) {
      backendState.toggleChaos(false);
    }
    return res.status(200).json(createApiResponse({
      type: 'chaos_faults_cleared',
      data: { clearedCount: count }
    }));
  }

  const success = diagnosticEngine.clearFault(faultId);
  if (!success) {
    return res.status(404).json(createApiErrorResponse(
      404,
      'NOT_FOUND',
      `Fault dengan ID '${faultId}' tidak ditemukan di active fault matrix.`
    ));
  }

  res.status(200).json(createApiResponse({
    type: 'chaos_fault_cleared',
    data: { faultId, status: 'CLEARED' }
  }));
}
