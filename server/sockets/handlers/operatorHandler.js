import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';

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
  // Centralized Operator Command Gateway
  socket.on('operator:command', (data, callback) => {
    const { cmd, correlationId } = data || {};
    if (!cmd || !cmd.action) {
      if (typeof callback === 'function') callback({ success: false, error: 'Malformed command structure' });
      return;
    }

    const { action, targetId, payload, source } = cmd;

    // RBAC check
    const isAdminAction = ['chaos:toggle', 'green-wave:toggle'].includes(action);
    const requiredRoles = isAdminAction ? [ROLES.ADMIN] : [ROLES.OPERATOR, ROLES.ADMIN];
    if (!checkSocketRole(socket, requiredRoles, action, callback)) {
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
        const res = backendState.applyAiRecommendation(intersectionId);
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
        const inc = backendState.updateIncidentStatus(id, "ACKNOWLEDGED");
        resultingState = backendState.state;
      }
      else if (action === 'incident:resolve') {
        const id = targetId;
        const inc = backendState.updateIncidentStatus(id, "RESOLVED");
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
      } else {
        throw new Error(`Aksi '${action}' tidak dikenali oleh system core.`);
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

      if (typeof callback === 'function') {
        callback({ success: true, resultingState });
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

      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });
}
