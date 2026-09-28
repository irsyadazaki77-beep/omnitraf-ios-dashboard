import { backendState } from '../services/stateManager.js';
import { dbManager } from '../db/database.js';
import { isActionAuthorized, getRequiredRoles } from '../config/capabilities.js';
import { ROLES } from '../config/constants.js';
import {
  INCIDENT_STATES,
  EMERGENCY_STATES,
  validateIncidentTransition,
  validateEmergencyTransition,
  normalizeIncidentStatus,
  normalizeEmergencyStatus,
  createDomainEventEnvelope
} from '../config/stateMachine.js';

export const VALID_RESOLUTIONS = ['720p', '1080p', '4k'];
export const VALID_FAULTS = ["recover", "clear", "latency_spike", "packet_loss", "low_fps", "thermal_warning", "heartbeat_timeout"];

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
    const actorRole = authenticatedUser?.role || ROLES.VIEWER;
    const actorName = authenticatedUser?.name || 'Anonymous Principal';
    const actorId = authenticatedUser?.id || 'usr-anon';

    // 1. Establish stable identifiers
    const finalCommandId = commandId || `CMD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const finalCorrelationId = correlationId || `CORR-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const finalIdempotencyKey = idempotencyKey || finalCommandId || `IDEMP-${action}-${targetId || 'global'}-${JSON.stringify(payload || {})}`;

    // 2. Strict Server-Side RBAC Enforcement
    if (!isActionAuthorized(actorRole, action)) {
      const requiredRoles = getRequiredRoles(action);
      const errMsg = `Akses ditolak untuk '${action}'. Memerlukan hak akses [${requiredRoles.join('/')}], peran akun Anda: '${actorRole}'.`;
      
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

      if (backendState.io) {
        backendState.io.emit('audit:log', {
          type: 'command:rejected',
          timestamp: new Date().toISOString(),
          entity: targetId || 'System Core',
          source: actorName,
          reasonCode: 'FORBIDDEN',
          result: 'REJECTED',
          correlationId: finalCorrelationId,
          details: errMsg
        });
      }

      return rejectionResult;
    }

    // 3. Idempotency Check & In-Flight Protection
    if (backendState.processedCommands && backendState.processedCommands.has(finalIdempotencyKey)) {
      const cached = backendState.processedCommands.get(finalIdempotencyKey);

      // Verify that key is not colliding with a materially different action or target
      if (cached.action && cached.action !== action) {
        throw new Error(`IDEMPOTENCY_CONFLICT: Key '${finalIdempotencyKey}' telah digunakan untuk aksi '${cached.action}', tidak dapat digunakan kembali untuk '${action}'.`);
      }
      if (cached.targetId !== undefined && cached.targetId !== targetId) {
        throw new Error(`IDEMPOTENCY_CONFLICT: Key '${finalIdempotencyKey}' telah digunakan untuk target '${cached.targetId}', bukan '${targetId}'.`);
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
        isIdempotentReplay: true,
        error: null
      };
    }

    if (this.inFlightKeys.has(finalIdempotencyKey)) {
      throw new Error(`Perintah [${action}] dengan idempotency key '${finalIdempotencyKey}' sedang dalam eksekusi server.`);
    }

    this.inFlightKeys.add(finalIdempotencyKey);


    try {
      // 4. Authoritative Business Logic Execution by Action Domain
      const execOutcome = await this._dispatchBusinessLogic({
        action,
        targetId,
        payload,
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
        resultingState,
        previousState,
        newState,
        actor: actorName,
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
        sequence: domainSequence || backendState.sequence,
        error: null
      };

    } catch (err) {
      console.error(`❌ [CommandExecutor Error] [${action}]:`, err.message);

      if (backendState.io) {
        backendState.io.emit('audit:log', {
          type: 'command:failed',
          timestamp: new Date().toISOString(),
          entity: targetId || 'System Core',
          source: actorName,
          reasonCode: 'EXECUTION_FAIL',
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
          code: 'EXECUTION_FAIL',
          message: err.message,
          error: {
            code: 'EXECUTION_FAIL',
            message: err.message
          }
        });
      }

      throw err;
    } finally {
      this.inFlightKeys.delete(finalIdempotencyKey);
    }
  }

  /**
   * Dispatches business logic with strict atomic persistence and rollback
   */
  async _dispatchBusinessLogic({ action, targetId, payload, actorName, actorRole, finalCommandId, finalCorrelationId }) {
    switch (action) {
      case 'device:config': {
        const { deviceId, fps, resolution, mode, greenWaveSync } = payload || {};
        const devId = deviceId || targetId;
        if (!devId) throw new Error('Parameter deviceId wajib disertakan.');

        const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);
        if (!dev) throw new Error(`Perangkat dengan ID ${devId} tidak ditemukan di registry.`);

        if (fps !== undefined) {
          const fpsVal = parseInt(fps, 10);
          if (isNaN(fpsVal) || fpsVal < 5 || fpsVal > 60) {
            throw new Error('Frame Rate Limit (FPS) harus berupa angka antara 5 dan 60.');
          }
        }
        if (resolution !== undefined) {
          if (!VALID_RESOLUTIONS.includes(resolution)) {
            throw new Error(`Resolusi kamera tidak valid. Harus salah satu dari: ${VALID_RESOLUTIONS.join(', ')}.`);
          }
        }
        if (greenWaveSync !== undefined && typeof greenWaveSync !== 'boolean') {
          throw new Error('greenWaveSync harus berupa boolean (true/false).');
        }

        // Snapshot previous state BEFORE mutation
        const previousState = {
          fps: dev.fps,
          resolution: dev.resolution,
          mode: dev.mode || 'Adaptive AI (YOLOv8)',
          greenWaveSync: dev.greenWaveSync ?? true
        };

        const newState = {
          fps: fps !== undefined ? parseInt(fps, 10) : dev.fps,
          resolution: resolution !== undefined ? resolution : dev.resolution,
          mode: mode !== undefined ? mode : (dev.mode || 'Adaptive AI (YOLOv8)'),
          greenWaveSync: greenWaveSync !== undefined ? !!greenWaveSync : (dev.greenWaveSync ?? true)
        };

        // Mutate in-memory
        if (fps !== undefined) dev.fps = parseInt(fps, 10);
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
        const devId = deviceId || targetId;
        if (!devId) throw new Error('Parameter deviceId wajib disertakan.');

        const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);
        if (!dev) throw new Error(`Perangkat dengan ID ${devId} tidak ditemukan di registry.`);

        if (!VALID_FAULTS.includes(type)) {
          throw new Error(`Tipe gangguan '${type}' tidak valid. Harus salah satu dari: ${VALID_FAULTS.join(', ')}.`);
        }

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
            duration: duration || 30000,
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
        const devId = targetId || payload?.deviceId;
        if (!devId) throw new Error('Parameter deviceId wajib disertakan.');

        const dev = backendState.devicesRegistry.find(d => d.deviceId === devId);
        if (!dev) throw new Error(`Perangkat dengan ID ${devId} tidak ditemukan di registry.`);

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
        const intersectionId = targetId || payload?.intersectionId || 'node-wonokromo';
        const duration = payload?.duration ? parseInt(payload.duration, 10) : 45;
        if (isNaN(duration) || duration < 15 || duration > 90) {
          throw new Error('Durasi override sinyal harus berupa angka antara 15 dan 90 detik.');
        }

        const node = backendState.state.intersections.find(n => n.id === intersectionId) || backendState.state.intersections[0];
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
          newState: { state: 'green', timer: duration, status: 'Manual Override' },
          entityId: intersectionId,
          domainSequence: backendState.signalSequence,
          customAudit: { details: `Manual Override sinyal ${res.nodeName} aktif selama ${duration}s.` }
        };
      }

      case 'green-split:update': {
        const intersectionId = targetId || payload?.intersectionId || 'node-wonokromo';
        const value = parseInt(payload?.value, 10) || 35;
        if (isNaN(value) || value < 15 || value > 90) {
          throw new Error('Nilai green split harus berupa angka antara 15 dan 90 detik.');
        }

        const node = backendState.state.intersections.find(n => n.id === intersectionId);
        const previousState = {
          greenSplit: node ? node.greenSplit : 35,
          pendingGreenSplit: node ? node.pendingGreenSplit : null
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
        const active = payload ? !!payload.active : false;
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
        const intersectionId = targetId || payload?.intersectionId || 'node-wonokromo';
        const targetSplit = payload?.targetSplit || null;

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
          newState: { greenSplit: res.optimizedSplit },
          entityId: intersectionId,
          domainSequence: backendState.signalSequence,
          customAudit: { details: `Rekomendasi AI diterapkan untuk ${res.nodeName} (${res.optimizedSplit}s).` }
        };
      }

      case 'chaos:toggle': {
        const targetActive = payload ? !!payload.active : !backendState.state.isChaosMode;
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

      case 'emergency:activate': {
        const code = payload?.code || targetId || 'AMB-02';
        const route = payload?.route || 'route-soetomo';

        const res = backendState.activateEmergencyPriority(code, route, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName,
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
        const id = targetId || payload?.id;
        if (!id) throw new Error('Parameter ID armada darurat wajib disertakan.');

        const existingEmg = (backendState.state.activeEmergencies || []).find(e => String(e.id) === String(id) || String(e.vehicleId) === String(id));
        const previousState = existingEmg ? { ...existingEmg } : null;

        const resultingState = backendState.cancelEmergency(id, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName
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
        const id = targetId || payload?.id;
        if (!id) throw new Error('Parameter ID insiden wajib disertakan.');

        const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(id));
        const previousState = existingInc ? { ...existingInc } : null;

        const inc = backendState.updateIncidentStatus(id, INCIDENT_STATES.ACKNOWLEDGED, payload?.assignedUnit, payload?.notes, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName
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

      case 'incident:dispatch': {
        const id = targetId || payload?.id;
        if (!id) throw new Error('Parameter ID insiden wajib disertakan.');

        const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(id));
        const previousState = existingInc ? { ...existingInc } : null;

        const targetStatus = payload?.status ? normalizeIncidentStatus(payload.status) : INCIDENT_STATES.DISPATCHED;
        const assignedUnit = payload?.assignedUnit || 'Patroli Dishub & Tim 112 Surabaya';
        const notes = payload?.notes || 'Tim lapangan telah didisposisikan ke lokasi.';
        const inc = backendState.updateIncidentStatus(id, targetStatus, assignedUnit, notes, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName
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
        const id = targetId || payload?.id;
        if (!id) throw new Error('Parameter ID insiden wajib disertakan.');

        const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(id));
        const previousState = existingInc ? { ...existingInc } : null;

        const inc = backendState.updateIncidentStatus(id, INCIDENT_STATES.RESOLVED, payload?.assignedUnit, payload?.notes || `Diselesaikan oleh ${actorName}`, {
          commandId: finalCommandId,
          correlationId: finalCorrelationId,
          actor: actorName
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
        const muted = payload ? !!payload.muted : false;
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
        const camId = targetId || payload?.cameraId || 'CCTV-AYANI-01';
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
