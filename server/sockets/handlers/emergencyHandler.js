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
          status: 'SERVER_APPLIED',
          result: 'SUCCESS',
          timestamp: Date.now(),
          emergencyItem: res.emergencyItem,
          seq: backendState.sequence,
          error: null
        });
      }
    } catch (err) {
      console.warn(`[Socket emergency:activate] Error: ${err.message}`);
      if (typeof callback === 'function') {
        callback({
          success: false,
          status: 'REJECTED',
          result: 'FAILED',
          timestamp: Date.now(),
          code: 'EMERGENCY_ACTIVATE_FAILED',
          message: err.message,
          error: {
            code: 'EMERGENCY_ACTIVATE_FAILED',
            message: err.message,
            details: { code, route }
          }
        });
      }
    }
  });

  // Batalkan Prioritas Sinyal Darurat (OPERATOR & ADMIN)
  socket.on('emergency:cancel', (data, callback) => {
    if (!checkSocketRole(socket, [ROLES.OPERATOR, ROLES.ADMIN], 'emergency:cancel', callback)) return;

    const id = data ? data.id : null;
    if (!id) {
      if (typeof callback === 'function') {
        callback({
          success: false,
          status: 'REJECTED',
          result: 'FAILED',
          timestamp: Date.now(),
          code: 'VALIDATION_ERROR',
          message: 'Missing emergency ID',
          error: { code: 'VALIDATION_ERROR', message: 'Missing emergency ID' }
        });
      }
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
          status: 'SERVER_APPLIED',
          result: 'SUCCESS',
          timestamp: Date.now(),
          seq: backendState.sequence,
          error: null
        });
      }
    } catch (err) {
      console.warn(`[Socket emergency:cancel] Error: ${err.message}`);
      if (typeof callback === 'function') {
        callback({
          success: false,
          status: 'REJECTED',
          result: 'FAILED',
          timestamp: Date.now(),
          code: 'EMERGENCY_CANCEL_FAILED',
          message: err.message,
          error: {
            code: 'EMERGENCY_CANCEL_FAILED',
            message: err.message,
            details: { id }
          }
        });
      }
    }
  });
}
