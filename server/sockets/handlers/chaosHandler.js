import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';
import { checkSocketRole } from './operatorHandler.js';

export function registerChaosHandlers(io, socket) {
  // Toggle Chaos Mode (ADMIN ONLY)
  socket.on('chaos:toggle', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.ADMIN], 'chaos:toggle', callback)) return;

    const targetActive = data ? data.active : !backendState.state.isChaosMode;
    const newState = backendState.toggleChaos(targetActive);
    io.emit('traffic:update', newState);
    io.emit('system:toast', {
      message: targetActive ? '🔥 MODE KEOS DIAKTIFKAN SERVER: Lonjakan beban jaringan SITS & gridlock!' : 'Sistem ATCS Surabaya pulih dari kondisi darurat.',
      type: targetActive ? 'danger' : 'success'
    });

    if (typeof callback === 'function') {
      callback({
        success: true,
        isChaosMode: newState.isChaosMode,
        chaosLevel: newState.chaosLevel,
        seq: backendState.sequence
      });
    }
  });
}
