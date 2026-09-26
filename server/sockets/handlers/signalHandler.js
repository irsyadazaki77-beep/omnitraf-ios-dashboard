import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';
import { checkSocketRole } from './operatorHandler.js';

export function registerSignalHandlers(io, socket) {
  // Manual Override Sinyal APILL (OPERATOR & ADMIN)
  socket.on('signal:override', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.OPERATOR, ROLES.ADMIN], 'signal:override', callback)) return;

    const intersectionId = data ? data.intersectionId : "node-wonokromo";
    const duration = data ? data.duration : 45;
    const res = backendState.signalOverride(intersectionId, duration);
    
    io.emit('traffic:update', res.state);
    
    backendState.signalSequence++;
    io.emit('signal:update', {
      seq: backendState.signalSequence,
      timestamp: Date.now(),
      source: 'server',
      nodeId: intersectionId,
      signalData: {
        state: "green",
        timer: duration,
        status: "Manual Override"
      }
    });

    io.emit('system:toast', {
      message: `🛠️ Manual Override Aktif: Durasi ${res.nodeName} dikunci ${res.duration}s!`,
      type: 'warning'
    });

    if (typeof callback === 'function') {
      callback({
        success: true,
        nodeName: res.nodeName,
        duration: res.duration,
        seq: backendState.sequence
      });
    }
  });

  // Terapkan Rekomendasi AI SITS (OPERATOR & ADMIN)
  socket.on('ai:apply-recommendation', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.OPERATOR, ROLES.ADMIN], 'ai:apply-recommendation', callback)) return;

    const intersectionId = data ? data.intersectionId : "node-wonokromo";
    const targetSplit = data ? data.targetSplit : null;
    const res = backendState.applyAiRecommendation(intersectionId, targetSplit);
    
    io.emit('traffic:update', res.state);
    
    backendState.signalSequence++;
    io.emit('signal:update', {
      seq: backendState.signalSequence,
      timestamp: Date.now(),
      source: 'server',
      nodeId: intersectionId,
      signalData: {
        greenSplit: res.optimizedSplit,
        pendingGreenSplit: res.optimizedSplit,
        status: "AI Optimization Scheduled"
      }
    });

    io.emit('system:toast', {
      message: `✨ Rekomendasi Webster AI Disetujui: Green Split ${res.nodeName} akan disesuaikan ke ${res.optimizedSplit}s pada siklus berikutnya (Smooth Cycle Transition).`,
      type: 'success'
    });

    if (typeof callback === 'function') {
      callback({
        success: true,
        optimizedSplit: res.optimizedSplit,
        nodeName: res.nodeName,
        smoothTransitionScheduled: true,
        seq: backendState.sequence
      });
    }
  });

  // Update Green Split Slider (OPERATOR & ADMIN)
  socket.on('green-split:update', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.OPERATOR, ROLES.ADMIN], 'green-split:update', callback)) return;

    if (!data) {
      if (typeof callback === 'function') callback({ success: false, error: 'No data' });
      return;
    }
    const newState = backendState.setGreenSplit(data.value, data.intersectionId);
    
    io.emit('traffic:update', newState);
    
    backendState.signalSequence++;
    io.emit('signal:update', {
      seq: backendState.signalSequence,
      timestamp: Date.now(),
      source: 'server',
      nodeId: data.intersectionId,
      signalData: {
        greenSplit: data.value
      }
    });

    if (typeof callback === 'function') {
      callback({
        success: true,
        greenSplit: data.value,
        seq: backendState.sequence
      });
    }
  });

  // Toggle Emergency Green Wave (ADMIN ONLY)
  socket.on('green-wave:toggle', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.ADMIN], 'green-wave:toggle', callback)) return;

    const active = data ? data.active : false;
    const newState = backendState.toggleGreenWave(active);
    
    io.emit('traffic:update', newState);
    
    backendState.emergencySequence++;
    io.emit('emergency:update', {
      seq: backendState.emergencySequence,
      timestamp: Date.now(),
      source: 'server',
      payload: {
        greenWaveActive: active
      }
    });

    io.emit('system:toast', {
      message: active ? '🚨 Emergency Green Wave Aktif! Sinyal A. Yani - Darmo dikunci Hijau.' : 'Green Wave Dinonaktifkan. Sinyal SITS kembali ke mode otomatis.',
      type: active ? 'alert' : 'info'
    });

    if (typeof callback === 'function') {
      callback({
        success: true,
        greenWaveActive: active,
        seq: backendState.sequence
      });
    }
  });
}
