import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';
import { checkSocketRole } from './operatorHandler.js';

export function registerEmergencyHandlers(io, socket) {
  // Aktifkan Sinyal Prioritas (Ambulans/PMK) (OPERATOR & ADMIN)
  socket.on('emergency:activate', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.OPERATOR, ROLES.ADMIN], 'emergency:activate', callback)) return;

    const code = data ? data.code : "AMB-02";
    const route = data ? data.route : "route-soetomo";
    
    try {
      const res = backendState.activateEmergencyPriority(code, route);
      
      io.emit('traffic:update', res.state);
      
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
      
      if (typeof callback === 'function') {
        callback({
          success: true,
          emergencyItem: res.emergencyItem,
          seq: backendState.sequence
        });
      }
    } catch (err) {
      console.warn(`[Socket emergency:activate] Error: ${err.message}`);
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: err.message
        });
      }
    }
  });

  // Batalkan Prioritas Sinyal Darurat (OPERATOR & ADMIN)
  socket.on('emergency:cancel', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.OPERATOR, ROLES.ADMIN], 'emergency:cancel', callback)) return;

    const id = data ? data.id : null;
    if (!id) {
      if (typeof callback === 'function') callback({ success: false, error: 'Missing emergency ID' });
      return;
    }

    try {
      const newState = backendState.cancelEmergency(id);
      
      io.emit('traffic:update', newState);
      
      backendState.emergencySequence++;
      io.emit('emergency:update', {
        seq: backendState.emergencySequence,
        timestamp: Date.now(),
        source: 'server',
        payload: {
          activeEmergencies: newState.activeEmergencies
        }
      });

      if (typeof callback === 'function') {
        callback({
          success: true,
          seq: backendState.sequence
        });
      }
    } catch (err) {
      console.warn(`[Socket emergency:cancel] Error: ${err.message}`);
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: err.message
        });
      }
    }
  });
}
