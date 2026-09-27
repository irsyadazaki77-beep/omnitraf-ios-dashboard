import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';
import { dbManager } from '../../db/database.js';

export function checkSocketRole(socket, allowedRoles, eventName, callback) {
  const userRole = socket.user?.role || ROLES.VIEWER;
  if (!allowedRoles.includes(userRole)) {
    const errorMsg = `Akses ditolak untuk '${eventName}'. Memerlukan hak akses [${allowedRoles.join('/')}], peran saat ini: '${userRole}'.`;
    console.warn(`🔒 [Socket RBAC Ditolak] ${socket.user?.name || 'Anonymous'} (${userRole}) mencoba memanggil '${eventName}'`);

    socket.emit('system:toast', {
      message: `⛔ AKSES DITOLAK: Role '${userRole}' tidak memiliki izin untuk '${eventName}'.`,
      type: 'danger'
    });

    if (typeof callback === 'function') {
      callback({
        success: false,
        error: errorMsg,
        code: 'FORBIDDEN',
        requiredRoles: allowedRoles,
        currentRole: userRole
      });
    }
    return false;
  }
  return true;
}

export function registerOperatorHandlers(io, socket) {
  // Check the status of a command (reconnection / resync helper)
  socket.on('command:status', (data, callback) => {
    const { commandId, idempotencyKey, correlationId } = data || {};
    const cmds = backendState.processedCommands;
    const cached = cmds && (
      (idempotencyKey && cmds.get(idempotencyKey)) ||
      (commandId && cmds.get(commandId)) ||
      (correlationId && cmds.get(correlationId))
    );

    if (cached) {
      if (typeof callback === 'function') {
        callback({ success: true, status: 'SERVER_APPLIED', resultingState: cached.resultingState });
      }
    } else {
      if (typeof callback === 'function') {
        callback({ success: true, status: 'NOT_FOUND' });
      }
    }
  });

  // Centralized Operator Command Gateway
  socket.on('operator:command', (data, callback) => {
    const { cmd, correlationId } = data || {};
    if (!cmd || !cmd.action) {
      if (typeof callback === 'function') callback({ success: false, error: 'Malformed command structure' });
      return;
    }

    const { action, targetId, payload, source, commandId, idempotencyKey } = cmd;

    // RBAC check: ADMIN required for critical infrastructure modifications
    const isAdminAction = ['chaos:toggle', 'green-wave:toggle', 'device:config', 'device:fault'].includes(action);
    const requiredRoles = isAdminAction ? [ROLES.ADMIN] : [ROLES.OPERATOR, ROLES.ADMIN];
    if (!checkSocketRole(socket, requiredRoles, action, (rejection) => {
      if (typeof callback === 'function') {
        callback({
          success: false,
          commandId: commandId || cmd.commandId,
          correlationId: correlationId || cmd.correlationId,
          status: 'REJECTED',
          result: 'FORBIDDEN',
          timestamp: Date.now(),
          code: 'FORBIDDEN',
          error: {
            code: 'FORBIDDEN',
            message: rejection.message || rejection.error,
            details: { requiredRoles, currentRole: socket.user?.role || ROLES.VIEWER }
          },
          message: rejection.message || rejection.error
        });
      }
    })) {
      return;
    }

    // Idempotency check: if already processed, return the cached state
    const idempKey = idempotencyKey || commandId || `IDEMP-${action}-${targetId || 'global'}-${JSON.stringify(payload)}`;
    if (backendState.processedCommands && backendState.processedCommands.has(idempKey)) {
      console.info(`🔄 [Idempotency Backend] Returning cached response for command: ${idempKey}`);
      const cached = backendState.processedCommands.get(idempKey);
      if (typeof callback === 'function') {
        callback({
          success: true,
          commandId: commandId || cmd.commandId,
          correlationId: correlationId || cmd.correlationId,
          status: 'SERVER_APPLIED',
          result: 'SUCCESS',
          timestamp: Date.now(),
          resultingState: cached.resultingState,
          data: cached.resultingState,
          isIdempotentReplay: true,
          error: null
        });
      }
      return;
    }

    let resultingState = null;
    console.info(`🛡️ [Operator Command] Received: ${action} for ${targetId || 'global'} [CorrID: ${correlationId}]`);

    try {
      if (action === 'chaos:toggle') {
        const targetActive = payload ? payload.active : !backendState.state.isChaosMode;
        resultingState = backendState.toggleChaos(targetActive);
        io.emit('traffic:update', resultingState);
        io.emit('system:toast', {
          message: targetActive ? '🔥 MODE KEOS DIAKTIFKAN SERVER: Lonjakan beban jaringan SITS & gridlock!' : 'Sistem ATCS Surabaya pulih dari kondisi darurat.',
          type: targetActive ? 'danger' : 'success'
        });
      }
      else if (action === 'ai:apply-recommendation') {
        const intersectionId = targetId || "node-wonokromo";
        const targetSplit = payload ? payload.targetSplit : null;
        const res = backendState.applyAiRecommendation(intersectionId, targetSplit);
        resultingState = res.state;
        io.emit('traffic:update', resultingState);
        backendState.signalSequence++;
        io.emit('signal:update', {
          seq: backendState.signalSequence,
          timestamp: Date.now(),
          source: 'server',
          nodeId: intersectionId,
          signalData: { greenSplit: res.optimizedSplit, status: "AI Optimized" }
        });
        io.emit('system:toast', {
          message: `✨ Rekomendasi AI Diterapkan: Green Split ${res.nodeName} dioptimalkan ke ${res.optimizedSplit}s!`,
          type: 'success'
        });
      }
      else if (action === 'signal:override') {
        const intersectionId = targetId || "node-wonokromo";
        const duration = payload ? payload.duration : 45;
        const res = backendState.signalOverride(intersectionId, duration);
        resultingState = res.state;
        io.emit('traffic:update', resultingState);
        backendState.signalSequence++;
        io.emit('signal:update', {
          seq: backendState.signalSequence,
          timestamp: Date.now(),
          source: 'server',
          nodeId: intersectionId,
          signalData: { state: "green", timer: duration, status: "Manual Override" }
        });
        io.emit('system:toast', {
          message: `🛠️ Manual Override Aktif: Durasi ${res.nodeName} dikunci ${res.duration}s!`,
          type: 'warning'
        });
      }
      else if (action === 'emergency:activate') {
        const code = payload ? payload.code : "AMB-02";
        const route = payload ? payload.route : "route-soetomo";
        const res = backendState.activateEmergencyPriority(code, route);
        resultingState = res.state;
        io.emit('traffic:update', resultingState);
        backendState.emergencySequence++;
        io.emit('emergency:update', {
          seq: backendState.emergencySequence,
          timestamp: Date.now(),
          source: 'server',
          payload: {
            greenWaveActive: true,
            emergencyItem: res.emergencyItem,
            activeEmergencies: res.state.activeEmergencies
          }
        });
        io.emit('emergency:dispatch-alert', {
          code: res.emergencyItem.vehicleId,
          vehicle: res.emergencyItem.vehicleType,
          route
        });
        io.emit('system:toast', {
          message: `🚨 Prioritas Darurat Aktif: ${code} di rute ${route.replace('route-', '').toUpperCase()} (Preemption Berpola Aktif).`,
          type: 'alert'
        });
      }
      else if (action === 'emergency:cancel') {
        const id = targetId || payload?.id;
        resultingState = backendState.cancelEmergency(id);
        io.emit('traffic:update', resultingState);
        backendState.emergencySequence++;
        io.emit('emergency:update', {
          seq: backendState.emergencySequence,
          timestamp: Date.now(),
          source: 'server',
          payload: { activeEmergencies: resultingState.activeEmergencies }
        });
      }
      else if (action === 'green-split:update') {
        const value = payload ? payload.value : 35;
        const intersectionId = targetId || "node-wonokromo";
        resultingState = backendState.setGreenSplit(value, intersectionId);
        io.emit('traffic:update', resultingState);
        backendState.signalSequence++;
        io.emit('signal:update', {
          seq: backendState.signalSequence,
          timestamp: Date.now(),
          source: 'server',
          nodeId: intersectionId,
          signalData: { greenSplit: value }
        });
      }
      else if (action === 'green-wave:toggle') {
        const active = payload ? payload.active : false;
        resultingState = backendState.toggleGreenWave(active);
        io.emit('traffic:update', resultingState);
        backendState.emergencySequence++;
        io.emit('emergency:update', {
          seq: backendState.emergencySequence,
          timestamp: Date.now(),
          source: 'server',
          payload: { greenWaveActive: active }
        });
        io.emit('system:toast', {
          message: active ? '🚨 Emergency Green Wave Aktif! Sinyal A. Yani - Darmo dikunci Hijau.' : 'Green Wave Dinonaktifkan. Sinyal SITS kembali ke mode otomatis.',
          type: active ? 'alert' : 'info'
        });
      }
      else if (action === 'incident:acknowledge') {
        const id = targetId;
        const inc = backendState.updateIncidentStatus(id, "ACKNOWLEDGED", payload?.assignedUnit, payload?.notes);
        resultingState = backendState.state;
      }
      else if (action === 'incident:dispatch') {
        const id = targetId;
        const status = payload?.status || "DISPATCHED/RESPONDING";
        const assignedUnit = payload?.assignedUnit || "Patroli Dishub & Tim 112 Surabaya";
        const notes = payload?.notes || "Tim lapangan & armada derek telah didisposisikan ke lokasi.";
        const inc = backendState.updateIncidentStatus(id, status, assignedUnit, notes);
        resultingState = backendState.state;
      }
      else if (action === 'incident:resolve') {
        const id = targetId;
        const inc = backendState.updateIncidentStatus(id, "RESOLVED", payload?.assignedUnit, payload?.notes || "Insiden diselesaikan via Operator Console");
        resultingState = backendState.state;
      }
      else if (action === 'siren:mute') {
        backendState.state.isSirenMuted = payload ? !!payload.muted : false;
        resultingState = backendState.state;
        io.emit('traffic:update', resultingState);
      }
      else if (action === 'cctv:snapshot') {
        backendState.auditLogs.unshift({
          operator: source || socket.user?.name || "Operator SITS",
          action: "CCTV_SNAPSHOT",
          entity: targetId,
          result: "SUCCESS",
          timestamp: new Date().toISOString()
        });
        resultingState = backendState.state;
      }
      else if (action === 'device:config') {
        const { deviceId, fps, resolution, mode, greenWaveSync } = payload || {};
        const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
        if (!dev) {
          throw new Error(`Perangkat dengan ID ${deviceId} tidak ditemukan.`);
        }

        const actionId = `ACT-CFG-${Date.now()}`;
        const previousState = {
          fps: dev.fps,
          resolution: dev.resolution,
          mode: dev.mode || 'Adaptive AI (YOLOv8)',
          greenWaveSync: dev.greenWaveSync ?? true
        };

        if (fps !== undefined) {
          const fpsVal = parseInt(fps, 10);
          if (isNaN(fpsVal) || fpsVal < 5 || fpsVal > 60) {
            throw new Error("Frame Rate Limit (FPS) harus berupa angka antara 5 dan 60.");
          }
          dev.fps = fpsVal;
        }
        if (resolution !== undefined) {
          const validRes = ['720p', '1080p', '4k'];
          if (!validRes.includes(resolution)) {
            throw new Error("Resolusi kamera tidak valid. Harus salah satu dari: 720p, 1080p, 4k.");
          }
          dev.resolution = resolution;
        }
        if (mode !== undefined) dev.mode = mode;
        if (greenWaveSync !== undefined) dev.greenWaveSync = !!greenWaveSync;
        dev.updatedAt = new Date().toISOString();

        try {
          dbManager.upsertDeviceTelemetry(dev, true);
        } catch (persistErr) {
          dev.fps = previousState.fps;
          dev.resolution = previousState.resolution;
          dev.mode = previousState.mode;
          dev.greenWaveSync = previousState.greenWaveSync;
          throw new Error(`Gagal menyimpan konfigurasi perangkat ke SQLite: ${persistErr.message}`);
        }

        backendState.deviceSequence++;
        resultingState = backendState.state;

        const newState = {
          fps: dev.fps,
          resolution: dev.resolution,
          mode: dev.mode,
          greenWaveSync: dev.greenWaveSync
        };

        io.emit('device:config-transition', {
          actionId,
          deviceId,
          status: 'REQUESTED',
          timestamp: Date.now(),
          actor: socket.user?.name || "Operator SITS",
          previousState,
          newState
        });

        io.emit('device:config-transition', {
          actionId,
          deviceId,
          status: 'APPLIED',
          timestamp: Date.now(),
          actor: socket.user?.name || "Operator SITS",
          previousState,
          newState
        });

        io.emit('device:update', {
          seq: backendState.deviceSequence,
          timestamp: Date.now(),
          source: 'server',
          deviceId,
          deviceData: dev
        });

        if (!backendState.deviceAuditTrail) backendState.deviceAuditTrail = [];
        backendState.deviceAuditTrail.unshift({
          actionId,
          deviceId,
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actor: socket.user?.name || "Operator SITS",
          previousState,
          newState,
          result: "SUCCESS",
          status: "APPLIED"
        });
      }
      else if (action === 'device:fault') {
        const { deviceId, type, duration } = payload || {};
        const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
        if (!dev) {
          throw new Error(`Perangkat dengan ID ${deviceId} tidak ditemukan.`);
        }

        const validFaults = ["recover", "clear", "latency_spike", "packet_loss", "low_fps", "thermal_warning", "heartbeat_timeout"];
        if (!validFaults.includes(type)) {
          throw new Error(`Tipe gangguan tidak valid. Harus salah satu dari: ${validFaults.join(", ")}`);
        }

        if (type === "recover" || type === "clear") {
          delete backendState.activeFaults[deviceId];
          dev.consecutiveFailures = 0;
          dev.errorCount = 0;
        } else {
          backendState.activeFaults[deviceId] = {
            type,
            duration: duration || 30000,
            timestamp: Date.now()
          };
        }

        backendState.tickDevices();
        backendState.deviceSequence++;
        resultingState = backendState.state;

        io.emit('device:update', {
          seq: backendState.deviceSequence,
          timestamp: Date.now(),
          source: 'server',
          deviceId,
          deviceData: dev
        });
      } else {
        throw new Error(`Aksi '${action}' tidak dikenali oleh system core.`);
      }

      // Save to processed commands history for idempotency
      if (!backendState.processedCommands) {
        backendState.processedCommands = new Map();
      }
      const record = { success: true, resultingState, commandId, correlationId, action, timestamp: Date.now() };
      backendState.processedCommands.set(idempKey, record);
      if (commandId) backendState.processedCommands.set(commandId, record);
      if (correlationId) backendState.processedCommands.set(correlationId, record);

      // Keep processed commands map bounded
      if (backendState.processedCommands.size > 250) {
        const firstKey = backendState.processedCommands.keys().next().value;
        backendState.processedCommands.delete(firstKey);
      }

      const serverAuditLog = {
        operator: source || socket.user?.name || "Operator SITS",
        action: action.toUpperCase().replace('-', '_'),
        entity: targetId || "SITS Core",
        result: `SUCCESS (CorrelationID: ${correlationId})`,
        timestamp: new Date().toISOString()
      };
      backendState.auditLogs.unshift(serverAuditLog);

      const clientAuditLog = {
        type: `command:acknowledged`,
        timestamp: new Date().toISOString(),
        entity: targetId || "System Core",
        source: source || socket.user?.name || "Operator SITS",
        reasonCode: "EXECUTION_ACK",
        result: "SUCCESS",
        correlationId,
        details: `Perintah [${action}] berhasil dieksekusi.`
      };
      io.emit('audit:log', clientAuditLog);

      const ackResponse = {
        success: true,
        commandId: commandId || cmd.commandId,
        correlationId: correlationId || cmd.correlationId,
        action,
        status: 'SERVER_APPLIED',
        result: 'SUCCESS',
        timestamp: Date.now(),
        resultingState,
        data: resultingState,
        error: null
      };

      io.emit('command:ack', ackResponse);

      if (typeof callback === 'function') {
        callback(ackResponse);
      }
    } catch (err) {
      console.error(`❌ [Command Error]:`, err);
      const errAuditLog = {
        type: `command:failed`,
        timestamp: new Date().toISOString(),
        entity: targetId || "System Core",
        source: source || socket.user?.name || "Operator SITS",
        reasonCode: "EXECUTION_FAIL",
        result: "FAILED",
        correlationId,
        details: `Perintah [${action}] gagal: ${err.message}`
      };
      io.emit('audit:log', errAuditLog);

      const errResponse = {
        success: false,
        commandId: commandId || cmd?.commandId,
        correlationId: correlationId || cmd?.correlationId,
        action,
        status: 'REJECTED',
        result: 'FAILED',
        timestamp: Date.now(),
        code: 'EXECUTION_FAIL',
        message: err.message,
        error: {
          code: 'EXECUTION_FAIL',
          message: err.message,
          details: {}
        }
      };

      io.emit('command:ack', errResponse);

      if (typeof callback === 'function') {
        callback(errResponse);
      }
    }
  });
}
