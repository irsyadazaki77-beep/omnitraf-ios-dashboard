import { backendState } from '../services/stateManager.js';
import { dbManager } from '../db/database.js';
import { isActionAuthorized, getRequiredRoles } from '../config/capabilities.js';
import { ROLES } from '../config/constants.js';
import { diagnosticEngine } from './diagnosticEngine.js';
import { parseCommandInput, normalizeCommand, validateCommand, ContractValidationError } from '../config/contracts.js';
import {
  INCIDENT_STATES,
  EMERGENCY_STATES,
  validateIncidentTransition,
  validateEmergencyTransition,
  normalizeEmergencyStatus,
  createDomainEventEnvelope
} from '../config/stateMachine.js';

export const VALID_RESOLUTIONS = ['720p', '1080p', '4k'];
export const VALID_FAULTS = ["recover", "clear", "latency_spike", "packet_loss", "low_fps", "thermal_warning", "heartbeat_timeout"];

function commandError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * Authoritative Command Execution Engine (Phase 14C)
 * Single source of truth for executing all device, traffic, incident, and system mutations.
 * Shared directly by Socket.IO Command Gateway and REST Controllers.
 */
export class CommandExecutor {
  constructor() {
    this.inFlightKeys = new Set();
  }

  /**
   * Main Execution Entrypoint
   * @param {Object} params
   * @param {string} params.action - e.g. 'device:config', 'incident:resolve', 'signal:override'
   * @param {string} [params.targetId] - target entity identifier
   * @param {Object} [params.payload] - command payload
   * @param {string} [params.commandId] - stable client/intent command ID
   * @param {string} [params.idempotencyKey] - idempotency deduplication key
   * @param {string} [params.correlationId] - tracing correlation ID
   * @param {Object} params.authenticatedUser - verified principal (req.user or socket.user)
   * @param {string} [params.sourceChannel] - 'socket' | 'rest'
   * @returns {Promise<Object>} Execution result with authoritative resultingState
   */
  async executeCommand({
    action,
    targetId = null,
    payload = {},
    commandId = null,
    idempotencyKey = null,
    correlationId = null,
    authenticatedUser = null,
    sourceChannel = 'socket'
  }) {
    // Canonical parse/normalize/validate happens before authorization, idempotency,
    // domain lookup, persistence, or any event/audit side effect.
    const parsed = parseCommandInput({ action, targetId, payload, commandId, idempotencyKey, correlationId });
    const normalized = normalizeCommand(parsed);
    const canonical = validateCommand(normalized);
    action = canonical.action;
    targetId = canonical.targetId;
    payload = canonical.payload;

    const actorRole = authenticatedUser?.role;
    const actorName = authenticatedUser?.name;
    const actorId = authenticatedUser?.id;

    // 1. Establish stable identifiers
    const finalCommandId = commandId || `CMD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const finalCorrelationId = correlationId || `CORR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const finalIdempotencyKey = idempotencyKey || finalCommandId || `IDEMP-${action}-${targetId || 'global'}-${JSON.stringify(payload || {})}`;

    // Resolve explicit entity targets before authorization so malformed and unknown
    // targets share one canonical rejection and cannot fall through to another entity.
    this._assertKnownTarget(action, targetId, payload);

    // 2. Strict Server-Side RBAC Enforcement
    if (!actorId || !actorName || !Object.values(ROLES).includes(actorRole) || !isActionAuthorized(actorRole, action)) {
      const requiredRoles = getRequiredRoles(action);
      const errMsg = !actorId || !actorName || !Object.values(ROLES).includes(actorRole)
        ? `Akses ditolak untuk '${action}': principal terverifikasi wajib disertakan.`
        : `Akses ditolak untuk '${action}'. Memerlukan hak akses [${requiredRoles.join('/')}], peran akun Anda: '${actorRole}'.`;
      
      const rejectionResult = {
        success: false,
        commandId: finalCommandId,
        correlationId: finalCorrelationId,
        idempotencyKey: finalIdempotencyKey,
        action,
        status: 'REJECTED',
        result: 'FORBIDDEN',
        timestamp: Date.now(),
        code: 'FORBIDDEN',
        error: {
          code: 'FORBIDDEN',
          message: errMsg,
          details: { requiredRoles, currentRole: actorRole }
        }
      };

      return rejectionResult;
    }

    // 3. Idempotency Check & In-Flight Protection
    if (backendState.processedCommands && backendState.processedCommands.has(finalIdempotencyKey)) {
      const cached = backendState.processedCommands.get(finalIdempotencyKey);

      // Verify that key is not colliding with a materially different action or target
      if (cached.action && cached.action !== action) {
        throw commandError('IDEMPOTENCY_CONFLICT', `Key '${finalIdempotencyKey}' has already been used for action '${cached.action}', not '${action}'.`, 409);
      }
      if (cached.targetId !== undefined && cached.targetId !== targetId) {
        throw commandError('IDEMPOTENCY_CONFLICT', `Key '${finalIdempotencyKey}' has already been used for target '${cached.targetId}', not '${targetId}'.`, 409);
      }
      if (cached.payloadFingerprint !== undefined && cached.payloadFingerprint !== JSON.stringify(payload || {})) {
        throw commandError('IDEMPOTENCY_CONFLICT', `Key '${finalIdempotencyKey}' has already been used with a different payload.`, 409);
      }

      console.info(`🔄 [Idempotency Backend] Returning cached authoritative result for key: ${finalIdempotencyKey}`);
      return {
        success: true,
        commandId: cached.commandId || finalCommandId,
        correlationId: cached.correlationId || finalCorrelationId,
        idempotencyKey: finalIdempotencyKey,
        action,
        status: cached.status || 'SERVER_APPLIED',
        result: 'SUCCESS',
        timestamp: cached.timestamp || Date.now(),
        resultingState: cached.resultingState,
        data: cached.resultingState,
        previousState: cached.previousState,
        newState: cached.newState,
        normalizedCommand: cached.normalizedCommand,
        isIdempotentReplay: true,
        error: null
      };
    }

    if (this.inFlightKeys.has(finalIdempotencyKey)) {
      throw commandError('COMMAND_IN_PROGRESS', `Command [${action}] with idempotency key '${finalIdempotencyKey}' is already executing.`, 409);
    }

    this.inFlightKeys.add(finalIdempotencyKey);


    try {
      // 4. Authoritative Business Logic Execution by Action Domain
      const execOutcome = await this._dispatchBusinessLogic({
        action,
        targetId,
        payload,
        actorId,
        actorName,
        actorRole,
        finalCommandId,
        finalCorrelationId
      });

      const { resultingState, previousState, newState, entityId, domainSequence, domainUpdateEvent, customAudit } = execOutcome;

      // 5. Store in Processed Commands History (Authoritative Cache)
      if (!backendState.processedCommands) {
        backendState.processedCommands = new Map();
      }

      const record = {
        success: true,
        status: 'SERVER_APPLIED',
        action,
        targetId,
        commandId: finalCommandId,
        correlationId: finalCorrelationId,
        idempotencyKey: finalIdempotencyKey,
        payloadFingerprint: JSON.stringify(payload || {}),
        resultingState,
        previousState,
        newState,
        normalizedCommand: { action, targetId, payload },
        actor: actorName,
        actorId,
        timestamp: Date.now()
      };

      backendState.processedCommands.set(finalIdempotencyKey, record);
      backendState.processedCommands.set(finalCommandId, record);
      backendState.processedCommands.set(finalCorrelationId, record);

      // Keep bounded LRU
      if (backendState.processedCommands.size > 300) {
        const firstKey = backendState.processedCommands.keys().next().value;
        backendState.processedCommands.delete(firstKey);
      }

      // 6. Authoritative Audit Trail Persistence & Broadcast
      const auditLog = {
        actorId,
        operator: actorName,
        action: action.toUpperCase().replace(/[-:]/g, '_'),
        entity: entityId || targetId || 'SITS Core',
        result: `SUCCESS (CorrelationID: ${finalCorrelationId})`,
        timestamp: new Date().toISOString()
      };
      backendState.auditLogs.unshift(auditLog);
      if (backendState.auditLogs.length > 250) backendState.auditLogs.pop();

      if (backendState.io) {
        backendState.io.emit('audit:log', {
          type: 'command:acknowledged',
          timestamp: new Date().toISOString(),
          entity: entityId || targetId || 'System Core',
          source: actorName,
          actorId,
          reasonCode: 'SERVER_APPLIED',
          result: 'SUCCESS',
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          details: customAudit?.details || `Perintah [${action}] berhasil diterapkan secara otoritatif di server.`
        });

        // Emit command:ack event
        backendState.io.emit('command:ack', {
          success: true,
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          action,
          status: 'SERVER_APPLIED',
          result: 'SUCCESS',
          timestamp: Date.now(),
          resultingState,
          data: resultingState,
          error: null
        });
      }

      return {
        success: true,
        commandId: finalCommandId,
        correlationId: finalCorrelationId,
        idempotencyKey: finalIdempotencyKey,
        action,
        status: 'SERVER_APPLIED',
        result: 'SUCCESS',
        timestamp: Date.now(),
        resultingState,
        data: resultingState,
        previousState,
        newState,
        normalizedCommand: record.normalizedCommand,
        sequence: domainSequence || backendState.sequence,
        error: null
      };

    } catch (err) {
      console.error(`❌ [CommandExecutor Error] [${action}]:`, err.message);
      if (!err.code) {
        if (err.message.startsWith('PERSISTENCE_FAILED')) err.code = 'PERSISTENCE_FAILED';
        else if (err.message.startsWith('STATE_CONFLICT')) err.code = 'STATE_CONFLICT';
        else if (err.message.startsWith('FAULT_INJECTION_PROHIBITED')) err.code = 'FAULT_INJECTION_PROHIBITED';
        else if (err.message.includes('tidak ditemukan')) err.code = 'NOT_FOUND';
        else err.code = 'EXECUTION_FAIL';
      }

      if (backendState.io) {
        backendState.io.emit('audit:log', {
          type: 'command:failed',
          timestamp: new Date().toISOString(),
          entity: targetId || 'System Core',
          source: actorName,
          reasonCode: err.code,
          result: 'FAILED',
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          details: `Perintah [${action}] gagal: ${err.message}`
        });

        backendState.io.emit('command:ack', {
          success: false,
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          action,
          status: 'REJECTED',
          result: 'FAILED',
          timestamp: Date.now(),
          code: err.code,
          message: err.message,
          error: {
            code: err.code,
            message: err.message,
            field: err.field || null,
            expected: err.expected ?? null,
            actual: err.actual ?? null
          }
        });
      }

      throw err;
    } finally {
      this.inFlightKeys.delete(finalIdempotencyKey);
    }
  }

  _assertKnownTarget(action, targetId, payload) {
    const notFound = (type) => { throw new ContractValidationError('NOT_FOUND', `${type} '${targetId}' was not found.`, { field: 'targetId', expected: `known ${type}`, actual: targetId, statusCode: 404 }); };
    if (['device:config', 'device:fault', 'device:ping'].includes(action) && !backendState.devicesRegistry.some(device => device.deviceId === targetId)) notFound('device');
    if (['signal:override', 'green-split:update', 'ai:apply-recommendation'].includes(action) && !backendState.state.intersections.some(node => node.id === targetId)) notFound('intersection');
    if (['incident:acknowledge', 'incident:update-status', 'incident:dispatch', 'incident:resolve'].includes(action) && !(backendState.state.incidents || []).some(incident => String(incident.id) === targetId)) notFound('incident');
    if (action === 'emergency:cancel' && !(backendState.state.activeEmergencies || []).some(emergency => String(emergency.id) === targetId || String(emergency.vehicleId) === targetId)) notFound('emergency');
    if (action === 'chaos:fault-clear' && targetId !== 'all' && !diagnosticEngine.activeFaults.has(targetId)) notFound('fault');
    if (action === 'emergency:activate' && payload.incidentId && !(backendState.state.incidents || []).some(incident => String(incident.id) === payload.incidentId)) notFound('incident');
  }

  /**
   * Dispatches business logic with strict atomic persistence and rollback
   */
  async _dispatchBusinessLogic({ action, targetId, payload, actorId, actorName, actorRole, finalCommandId, finalCorrelationId }) {
    switch (action) {
      case 'device:config': {
        const { deviceId, fps, resolution, mode, greenWaveSync } = payload || {};
        const devId = deviceId;

        const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);

        // Snapshot previous state BEFORE mutation
        const previousState = {
          fps: dev.fps,
          resolution: dev.resolution,
          mode: dev.mode || 'Adaptive AI (YOLOv8)',
          greenWaveSync: dev.greenWaveSync ?? true
        };

        const newState = {
          fps: fps !== undefined ? fps : dev.fps,
          resolution: resolution !== undefined ? resolution : dev.resolution,
          mode: mode !== undefined ? mode : (dev.mode || 'Adaptive AI (YOLOv8)'),
          greenWaveSync: greenWaveSync !== undefined ? !!greenWaveSync : (dev.greenWaveSync ?? true)
        };

        // Mutate in-memory
        if (fps !== undefined) dev.fps = fps;
        if (resolution !== undefined) dev.resolution = resolution;
        if (mode !== undefined) dev.mode = mode;
        if (greenWaveSync !== undefined) dev.greenWaveSync = !!greenWaveSync;
        dev.updatedAt = new Date().toISOString();

        // Atomic Persistence
        try {
          dbManager.upsertDeviceTelemetry(dev, true);
        } catch (persistErr) {
          // Rollback on persistence failure
          dev.fps = previousState.fps;
          dev.resolution = previousState.resolution;
          dev.mode = previousState.mode;
          dev.greenWaveSync = previousState.greenWaveSync;
          throw new Error(`PERSISTENCE_FAILED: Gagal menyimpan konfigurasi perangkat ke SQLite: ${persistErr.message}`);
        }

        backendState.deviceSequence++;
        const resultingState = backendState.state;

        const actionId = `ACT-CFG-${finalCommandId || Date.now()}`;
        const auditRecord = {
          actionId,
          deviceId: devId,
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actor: actorName,
          actorId,
          previousState,
          newState,
          result: 'SUCCESS',
          status: 'APPLIED'
        };

        if (!backendState.deviceAuditTrail) backendState.deviceAuditTrail = [];
        backendState.deviceAuditTrail.unshift(auditRecord);
        if (backendState.deviceAuditTrail.length > 100) backendState.deviceAuditTrail.pop();

        if (backendState.io) {
          backendState.io.emit('device:config-transition', {
            actionId,
            deviceId: devId,
            status: 'APPLIED',
            timestamp: Date.now(),
            actor: actorName,
            previousState,
            newState
          });

          backendState.io.emit('device:update', {
            seq: backendState.deviceSequence,
            timestamp: Date.now(),
            source: 'server',
            deviceId: devId,
            deviceData: dev
          });
        }

        return {
          resultingState,
          previousState,
          newState,
          entityId: devId,
          domainSequence: backendState.deviceSequence,
          customAudit: { details: `Konfigurasi perangkat ${devId} berhasil diperbarui (FPS: ${dev.fps}, Resolusi: ${dev.resolution}).` }
        };
      }

      case 'device:fault': {
        const { deviceId, type, duration } = payload || {};
        const devId = deviceId;

        const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);

        // Snapshot previous state BEFORE mutation
        const previousState = {
          latencyMs: dev.latencyMs,
          packetLossPercent: dev.packetLossPercent,
          fps: dev.fps,
          temperatureC: dev.temperatureC,
          healthLevel: dev.healthLevel,
          status: dev.status
        };

        if (type === 'recover' || type === 'clear') {
          delete backendState.activeFaults[devId];
          dev.consecutiveFailures = 0;
          dev.errorCount = 0;
        } else {
          backendState.activeFaults[devId] = {
            type,
            duration,
            timestamp: Date.now()
          };
        }

        backendState.tickDevices();
        backendState.deviceSequence++;
        const resultingState = backendState.state;

        const newState = {
          latencyMs: dev.latencyMs,
          packetLossPercent: dev.packetLossPercent,
          fps: dev.fps,
          temperatureC: dev.temperatureC,
          healthLevel: dev.healthLevel,
          status: dev.status
        };

        const actionId = `ACT-FAULT-${finalCommandId || Date.now()}`;
        const auditRecord = {
          actionId,
          deviceId: devId,
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actor: actorName,
          previousState,
          newState,
          result: 'SUCCESS',
          errorCode: null
        };

        if (!backendState.deviceAuditTrail) backendState.deviceAuditTrail = [];
        backendState.deviceAuditTrail.unshift(auditRecord);

        if (backendState.io) {
          backendState.io.emit('device:update', {
            seq: backendState.deviceSequence,
            timestamp: Date.now(),
            source: 'server',
            deviceId: devId,
            deviceData: dev
          });
        }

        return {
          resultingState,
          previousState,
          newState,
          entityId: devId,
          domainSequence: backendState.deviceSequence,
          customAudit: { details: `Gangguan '${type}' disuntikkan pada ${devId} oleh ${actorName}.` }
        };
      }

      case 'device:ping': {
        const devId = payload.deviceId;

        const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);

        // Snapshot previousState BEFORE mutation
        const previousState = {
          latencyMs: dev.latencyMs,
          packetLossPercent: dev.packetLossPercent,
          status: dev.status,
          healthScore: dev.healthScore
        };

        const latency = Math.floor(Math.random() * 5) + 6;
        dev.latencyMs = latency;
        dev.packetLossPercent = 0;
        dev.lastSeenAt = new Date().toISOString();
        dev.lastHeartbeatAt = new Date().toISOString();
        dev.consecutiveFailures = 0;
        dev.updatedAt = new Date().toISOString();

        backendState.tickDevices();
        backendState.deviceSequence++;

        const newState = {
          latencyMs: dev.latencyMs,
          packetLossPercent: dev.packetLossPercent,
          status: dev.status,
          healthScore: dev.healthScore
        };

        const actionId = `ACT-PING-${finalCommandId || Date.now()}`;
        const auditRecord = {
          actionId,
          deviceId: devId,
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actor: actorName,
          previousState,
          newState,
          result: 'SUCCESS',
          errorCode: null
        };

        if (!backendState.deviceAuditTrail) backendState.deviceAuditTrail = [];
        backendState.deviceAuditTrail.unshift(auditRecord);

        if (backendState.io) {
          backendState.io.emit('device:update', {
            seq: backendState.deviceSequence,
            timestamp: Date.now(),
            source: 'server',
            deviceId: devId,
            deviceData: dev
          });
        }

        return {
          resultingState: backendState.state,
          previousState,
          newState,
          entityId: devId,
          domainSequence: backendState.deviceSequence,
          customAudit: { details: `Ping ke perangkat ${devId} berhasil (Latency: ${latency}ms).` }
        };
      }

      case 'signal:override': {
        const intersectionId = targetId;
        const duration = payload.duration;

        const node = backendState.state.intersections.find(n => n.id === intersectionId);
        if (!node) throw new Error(`Simpang dengan ID ${intersectionId} tidak ditemukan.`);
        const previousState = {
          state: node.state,
          timer: node.timer,
          status: node.status,
          isOverrideActive: !!node.isOverrideActive
        };

        const res = backendState.signalOverride(intersectionId, duration);
        backendState.signalSequence++;

        if (backendState.io) {
          backendState.io.emit('traffic:update', res.state);
          backendState.io.emit('signal:update', {
            seq: backendState.signalSequence,
            timestamp: Date.now(),
            source: 'server',
            nodeId: intersectionId,
            signalData: { state: 'green', timer: duration, status: 'Manual Override' }
          });
          backendState.io.emit('system:toast', {
            message: `🛠️ Manual Override Aktif: Durasi ${res.nodeName} dikunci ${res.duration}s!`,
            type: 'warning'
          });
        }

        return {
          resultingState: res.state,
          previousState,
          newState: { state: 'green', timer: res.duration, status: 'Manual Override', nodeName: res.nodeName },
          entityId: intersectionId,
          domainSequence: backendState.signalSequence,
          customAudit: { details: `Manual Override sinyal ${res.nodeName} aktif selama ${duration}s.` }
        };
      }

      case 'green-split:update': {
        const intersectionId = targetId;
        const value = payload.value;

        const node = backendState.state.intersections.find(n => n.id === intersectionId);
        if (!node) throw new Error(`Simpang dengan ID ${intersectionId} tidak ditemukan.`);
        const previousState = {
          greenSplit: node.greenSplit,
          pendingGreenSplit: node.pendingGreenSplit
        };

        const resultingState = backendState.setGreenSplit(value, intersectionId);
        backendState.signalSequence++;

        if (backendState.io) {
          backendState.io.emit('traffic:update', resultingState);
          backendState.io.emit('signal:update', {
            seq: backendState.signalSequence,
            timestamp: Date.now(),
            source: 'server',
            nodeId: intersectionId,
            signalData: { greenSplit: value }
          });
        }

        return {
          resultingState,
          previousState,
          newState: { greenSplit: value },
          entityId: intersectionId,
          domainSequence: backendState.signalSequence,
          customAudit: { details: `Green Split ${intersectionId} disesuaikan ke ${value}s.` }
        };
      }

      case 'green-wave:toggle': {
        const active = payload.active;
        const previousState = { greenWaveActive: !!backendState.state.greenWaveActive };
        const resultingState = backendState.toggleGreenWave(active);

        backendState.emergencySequence++;

        if (backendState.io) {
          backendState.io.emit('traffic:update', resultingState);
          backendState.io.emit('emergency:update', {
            seq: backendState.emergencySequence,
            timestamp: Date.now(),
            source: 'server',
            payload: { greenWaveActive: active }
          });
          backendState.io.emit('system:toast', {
            message: active ? '🚨 Emergency Green Wave Aktif! Sinyal A. Yani - Darmo dikunci Hijau.' : 'Green Wave Dinonaktifkan. Sinyal SITS kembali ke mode otomatis.',
            type: active ? 'alert' : 'info'
          });
        }

        return {
          resultingState,
          previousState,
          newState: { greenWaveActive: active },
          entityId: 'corridor-ayani-darmo',
          domainSequence: backendState.emergencySequence,
          customAudit: { details: `Green Wave Koridor Utama diubah ke: ${active ? 'AKTIF' : 'NON-AKTIF'}.` }
        };
      }

      case 'ai:apply-recommendation': {
        const intersectionId = targetId;
        const targetSplit = payload.targetSplit ?? null;

        const res = backendState.applyAiRecommendation(intersectionId, targetSplit);
        backendState.signalSequence++;

        if (backendState.io) {
          backendState.io.emit('traffic:update', res.state);
          backendState.io.emit('signal:update', {
            seq: backendState.signalSequence,
            timestamp: Date.now(),
            source: 'server',
            nodeId: intersectionId,
            signalData: { greenSplit: res.optimizedSplit, status: 'AI Optimized' }
          });
          backendState.io.emit('system:toast', {
            message: `✨ Rekomendasi AI Diterapkan: Green Split ${res.nodeName} dioptimalkan ke ${res.optimizedSplit}s!`,
            type: 'success'
          });
        }

        return {
          resultingState: res.state,
          previousState: null,
          newState: { greenSplit: res.optimizedSplit, nodeName: res.nodeName },
          entityId: intersectionId,
          domainSequence: backendState.signalSequence,
          customAudit: { details: `Rekomendasi AI diterapkan untuk ${res.nodeName} (${res.optimizedSplit}s).` }
        };
      }

      case 'chaos:toggle': {
        const targetActive = payload.active === undefined ? !backendState.state.isChaosMode : payload.active;
        const previousState = { isChaosMode: !!backendState.state.isChaosMode, chaosLevel: backendState.state.chaosLevel };
        const resultingState = backendState.toggleChaos(targetActive);

        if (backendState.io) {
          backendState.io.emit('traffic:update', resultingState);
          backendState.io.emit('system:toast', {
            message: targetActive ? '🔥 MODE KEOS DIAKTIFKAN SERVER: Lonjakan beban jaringan SITS & gridlock!' : 'Sistem ATCS Surabaya pulih dari kondisi darurat.',
            type: targetActive ? 'danger' : 'success'
          });
        }

        return {
          resultingState,
          previousState,
          newState: { isChaosMode: targetActive, chaosLevel: resultingState.chaosLevel },
          entityId: 'global-network',
          domainSequence: backendState.sequence,
          customAudit: { details: `Mode Keos diubah menjadi: ${targetActive ? 'AKTIF' : 'NON-AKTIF'}.` }
        };
      }

      case 'chaos:fault-inject': {
        const fault = diagnosticEngine.injectFault(payload);
        if (payload.targetSubsystem === 'system' || payload.intendedEffect === 'chaos_spike') {
          const resultingState = backendState.toggleChaos(true);
          if (backendState.io) backendState.io.emit('traffic:update', resultingState);
        }
        if (backendState.io) backendState.io.emit('chaos:fault-injected', { fault, correlationId: finalCorrelationId });
        return { resultingState: backendState.state, previousState: null, newState: fault,
          entityId: fault.faultId, domainSequence: backendState.sequence,
          customAudit: { details: `Fault ${fault.faultId} diinjeksikan ke ${payload.targetSubsystem}.` } };
      }

      case 'chaos:fault-clear': {
        const faultId = targetId;
        const clearedCount = faultId === 'all' ? diagnosticEngine.clearAllFaults() : (diagnosticEngine.clearFault(faultId) ? 1 : 0);
        if (!clearedCount && faultId !== 'all') throw new Error(`Fault dengan ID '${faultId}' tidak ditemukan di active fault matrix.`);
        if ((faultId === 'all' || diagnosticEngine.activeFaults.size === 0) && backendState.state.isChaosMode) {
          const resultingState = backendState.toggleChaos(false);
          if (backendState.io) backendState.io.emit('traffic:update', resultingState);
        }
        return { resultingState: backendState.state, previousState: null,
          newState: { faultId, clearedCount, status: 'CLEARED' }, entityId: faultId || 'all-faults',
          domainSequence: backendState.sequence,
          customAudit: { details: `Fault ${faultId || 'all'} dibersihkan.` } };
      }

      case 'simulation:control': {
        const { operation, speedMultiplier, seed, deltaMs, mode } = payload || {};
        const clock = backendState.clock;
        if (operation === 'pause') { clock.pause(); backendState.simConfig.paused = true; }
        else if (operation === 'resume') { clock.resume(); backendState.simConfig.paused = false; }
        else if (operation === 'step') backendState.tick(deltaMs || 1000);
        else if (operation === 'set_speed' && typeof speedMultiplier === 'number') {
          clock.setSpeedMultiplier(speedMultiplier); backendState.simConfig.speedMultiplier = speedMultiplier;
        } else if (operation === 'set_mode' && mode) {
          clock.setMode(mode); backendState.simConfig.mode = mode;
        } else if (operation === 'reset_seed' && seed !== undefined) {
          backendState.randomRegistry.resetAll(seed); backendState.simConfig.seed = seed;
        } else throw new Error(`Operasi kontrol simulasi '${operation}' tidak valid.`);
        const resultingState = { mode: clock.mode, speedMultiplier: clock.speedMultiplier,
          paused: clock.paused, seed: backendState.simConfig.seed, simTimeMs: clock.now() };
        return { resultingState, previousState: null, newState: resultingState,
          entityId: 'simulation-runtime', domainSequence: backendState.sequence,
          customAudit: { details: `Kontrol simulasi '${operation}' diterapkan.` } };
      }

      case 'emergency:activate': {
        const code = payload.code;
        const route = payload.route;

        const res = backendState.activateEmergencyPriority(code, route, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName,
          commandManaged: true,
          incidentId: payload?.incidentId || payload?.associatedIncidentId
        });

        if (backendState.io) {
          backendState.io.emit('traffic:update', res.state);
          backendState.io.emit('emergency:update', {
            seq: backendState.emergencySequence,
            timestamp: Date.now(),
            source: 'server',
            payload: {
              greenWaveActive: true,
              emergencyItem: res.emergencyItem,
              activeEmergencies: res.state.activeEmergencies
            },
            event: res.domainEvent
          });
          backendState.io.emit('emergency:dispatch-alert', {
            code: res.emergencyItem.vehicleId,
            vehicle: res.emergencyItem.vehicleType,
            route
          });
          backendState.io.emit('system:toast', {
            message: `🚨 Prioritas Darurat Aktif: ${code} di rute ${route.replace('route-', '').toUpperCase()} (Preemption Berpola Aktif).`,
            type: 'alert'
          });
        }

        return {
          resultingState: res.state,
          previousState: null,
          newState: res.emergencyItem,
          entityId: res.emergencyItem.id,
          domainSequence: backendState.emergencySequence,
          customAudit: { details: `Prioritas darurat armada ${code} diaktifkan pada rute ${route}.` }
        };
      }

      case 'emergency:cancel': {
        const id = targetId;

        const existingEmg = (backendState.state.activeEmergencies || []).find(e => String(e.id) === String(id) || String(e.vehicleId) === String(id));
        const previousState = existingEmg ? { ...existingEmg } : null;

        const resultingState = backendState.cancelEmergency(id, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName,
          commandManaged: true
        });

        return {
          resultingState,
          previousState,
          newState: { id, status: EMERGENCY_STATES.CANCELLED },
          entityId: id,
          domainSequence: backendState.emergencySequence,
          customAudit: { details: `Prioritas darurat #${id} dibatalkan.` }
        };
      }

      case 'incident:acknowledge': {
        const id = targetId;

        const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(id));
        const previousState = existingInc ? { ...existingInc } : null;

        const inc = backendState.updateIncidentStatus(id, INCIDENT_STATES.ACKNOWLEDGED, payload?.assignedUnit, payload?.notes, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName, commandManaged: true
        });
        return {
          resultingState: backendState.state,
          previousState,
          newState: inc,
          entityId: id,
          domainSequence: backendState.incidentSequence,
          customAudit: { details: `Insiden #${id} diakui (ACKNOWLEDGED) oleh ${actorName}.` }
        };
      }

      case 'incident:create': {
        const { title, category = 'congestion', severity = 'medium', location, assignedUnit, notes } = payload || {};
        const id = targetId;
        if ((backendState.state.incidents || []).some(item => String(item.id) === String(id))) throw new Error(`Insiden dengan ID #${id} sudah ada di sistem.`);
        const now = new Date().toISOString();
        const incident = {
          id, title: String(title).trim(), category, severity, location: String(location).trim(),
          status: INCIDENT_STATES.ACTIVE,
          priority: severity === 'critical' || severity === 'high' ? 'high' : 'normal',
          source: `Operator (${actorName})`, assignedUnit: assignedUnit || 'Menunggu Disposisi Petugas',
          notes: notes || 'Laporan insiden baru masuk antrean verifikasi SITS.',
          reportedAt: now, updatedAt: now, acknowledgedAt: null, resolvedAt: null
        };
        backendState.state.incidents.unshift(incident);
        backendState.incidentSequence++;
        backendState.sequence++;
        backendState.state.seq = backendState.sequence;
        backendState.state.timestampMs = Date.now();
        try {
          dbManager.upsertIncident(incident, true);
        } catch (err) {
          backendState.state.incidents.splice(backendState.state.incidents.indexOf(incident), 1);
          backendState.incidentSequence--;
          backendState.sequence--;
          backendState.state.seq = backendState.sequence;
          throw new Error(`PERSISTENCE_FAILED: Gagal menyimpan insiden ke SQLite (${err.message})`);
        }
        if (backendState.io) backendState.io.emit('incident:update', {
          id, seq: backendState.incidentSequence, timestamp: Date.now(), source: 'server', payload: incident
        });
        if (backendState.io) backendState.io.emit('system:toast', {
          message: `🚨 Insiden Baru Terdeteksi: #${id} (${incident.title}) pada ${incident.location}.`,
          type: severity === 'critical' ? 'alert' : 'warning'
        });
        return {
          resultingState: backendState.state, previousState: null, newState: incident,
          entityId: id, domainSequence: backendState.incidentSequence,
          customAudit: { details: `Insiden #${id} dibuat: ${incident.title}.` }
        };
      }

      case 'incident:update-status': {
        const id = targetId;
        const existing = (backendState.state.incidents || []).find(item => String(item.id) === String(id));
        const previousState = existing ? { ...existing } : null;
        const status = payload.status;
        const inc = backendState.updateIncidentStatus(id, status, payload.assignedUnit, payload.notes, {
          commandId: finalCommandId, correlationId: finalCorrelationId, actor: actorName, commandManaged: true
        });
        return {
          resultingState: backendState.state, previousState, newState: inc,
          entityId: id, domainSequence: backendState.incidentSequence,
          customAudit: { details: `Status insiden #${id} diubah menjadi ${status}.` }
        };
      }

      case 'incident:dispatch': {
        const id = targetId;

        const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(id));
        const previousState = existingInc ? { ...existingInc } : null;

        const targetStatus = payload.status;
        const assignedUnit = payload?.assignedUnit || 'Patroli Dishub & Tim 112 Surabaya';
        const notes = payload?.notes || 'Tim lapangan telah didisposisikan ke lokasi.';
        const inc = backendState.updateIncidentStatus(id, targetStatus, assignedUnit, notes, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName, commandManaged: true
        });

        return {
          resultingState: backendState.state,
          previousState,
          newState: inc,
          entityId: id,
          domainSequence: backendState.incidentSequence,
          customAudit: { details: `Insiden #${id} didisposisikan ke ${assignedUnit}.` }
        };
      }

      case 'incident:resolve': {
        const id = targetId;

        const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(id));
        const previousState = existingInc ? { ...existingInc } : null;

        const inc = backendState.updateIncidentStatus(id, INCIDENT_STATES.RESOLVED, payload?.assignedUnit, payload?.notes || `Diselesaikan oleh ${actorName}`, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName, commandManaged: true
        });
        
        if (backendState.io) {
          backendState.io.emit('incident:resolved', {
            id,
            seq: backendState.incidentSequence,
            timestamp: Date.now(),
            resolvedBy: actorName,
            correlationId: finalCorrelationId
          });
        }

        return {
          resultingState: backendState.state,
          previousState,
          newState: inc,
          entityId: id,
          domainSequence: backendState.incidentSequence,
          customAudit: { details: `Insiden #${id} telah diselesaikan secara definitif.` }
        };
      }

      case 'siren:mute': {
        const muted = payload.muted;
        backendState.state.isSirenMuted = muted;
        const resultingState = backendState.state;

        if (backendState.io) {
          backendState.io.emit('traffic:update', resultingState);
        }

        return {
          resultingState,
          previousState: null,
          newState: { isSirenMuted: muted },
          entityId: 'global-audio',
          domainSequence: backendState.sequence,
          customAudit: { details: `Sirene Command Center di-${muted ? 'senyapkan' : 'aktifkan kembali'}.` }
        };
      }

      case 'cctv:snapshot': {
        const camId = targetId;
        return {
          resultingState: backendState.state,
          previousState: null,
          newState: { snapshotTaken: true, timestamp: Date.now() },
          entityId: camId,
          domainSequence: backendState.cctvSequence,
          customAudit: { details: `Snapshot rekaman CCTV ${camId} diambil oleh ${actorName}.` }
        };
      }

      default:
        throw new Error(`Aksi '${action}' tidak dikenali oleh Authoritative Command Executor.`);
    }
  }
}

export const commandExecutor = new CommandExecutor();
