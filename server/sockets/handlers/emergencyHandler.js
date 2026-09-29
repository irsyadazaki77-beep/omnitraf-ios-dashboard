import { commandExecutor } from '../../services/commandExecutor.js';

export function registerEmergencyHandlers(_io, socket) {
  const forward = eventName => socket.on(eventName, async (data = {}, callback) => {
    const raw = data || {};
    const payload = raw;
    const commandId = payload.commandId || `CMD-SOCK-EMERGENCY-${Date.now()}`;
    try {
      const outcome = await commandExecutor.executeCommand({
        action: 'emergency:activate', targetId: payload.code ?? payload.vehicleId ?? null, payload, commandId,
        idempotencyKey: payload.idempotencyKey || commandId,
        correlationId: payload.correlationId || `CORR-SOCK-${commandId}`,
        authenticatedUser: socket.user || null, sourceChannel: 'socket'
      });
      if (typeof callback === 'function') callback({ ...outcome, emergencyItem: outcome.newState });
    } catch (error) {
      if (typeof callback === 'function') callback({
        success: false, commandId, action: 'emergency:activate', status: 'REJECTED', result: 'FAILED', timestamp: Date.now(),
        statusCode: error.statusCode || 500, code: error.code || 'EXECUTION_FAIL', message: error.message,
        error: { code: error.code || 'EXECUTION_FAIL', message: error.message, field: error.field || null, expected: error.expected ?? null, actual: error.actual ?? null }
      });
    }
  });

  forward('emergency:activate');
  // Compatibility event used by the current dashboard; both entry points map to the same action.
  forward('emergency:priority');

  socket.on('emergency:cancel', async (data = {}, callback) => {
    const payload = data || {};
    const commandId = payload.commandId || `CMD-SOCK-EMERGENCY-CANCEL-${Date.now()}`;
    try {
      const outcome = await commandExecutor.executeCommand({
        action: 'emergency:cancel', targetId: payload.id ?? payload.vehicleId ?? null, payload, commandId,
        idempotencyKey: payload.idempotencyKey || commandId,
        correlationId: payload.correlationId || `CORR-SOCK-${commandId}`,
        authenticatedUser: socket.user || null, sourceChannel: 'socket'
      });
      if (typeof callback === 'function') callback(outcome);
    } catch (error) {
      if (typeof callback === 'function') callback({
        success: false, commandId, action: 'emergency:cancel', status: 'REJECTED', result: 'FAILED', timestamp: Date.now(),
        statusCode: error.statusCode || 500, code: error.code || 'EXECUTION_FAIL', message: error.message,
        error: { code: error.code || 'EXECUTION_FAIL', message: error.message, field: error.field || null, expected: error.expected ?? null, actual: error.actual ?? null }
      });
    }
  });
}
