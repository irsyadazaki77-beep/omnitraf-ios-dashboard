import { commandExecutor } from '../../services/commandExecutor.js';

export function registerChaosHandlers(_io, socket) {
  socket.on('chaos:toggle', async (data = {}, callback) => {
    const payload = data || {};
    const commandId = payload.commandId || `CMD-SOCK-CHAOS-${Date.now()}`;
    try {
      const outcome = await commandExecutor.executeCommand({
        action: 'chaos:toggle', targetId: 'global-network', payload,
        commandId, idempotencyKey: payload.idempotencyKey || commandId,
        correlationId: payload.correlationId || `CORR-SOCK-${commandId}`,
        authenticatedUser: socket.user || null, sourceChannel: 'socket'
      });
      if (typeof callback === 'function') callback({
        ...outcome, isChaosMode: outcome.newState?.isChaosMode, chaosLevel: outcome.newState?.chaosLevel
      });
    } catch (error) {
      if (typeof callback === 'function') callback({
        success: false, commandId, action: 'chaos:toggle', status: 'REJECTED', result: 'FAILED', timestamp: Date.now(),
        statusCode: error.statusCode || 500, code: error.code || 'EXECUTION_FAIL', message: error.message,
        error: { code: error.code || 'EXECUTION_FAIL', message: error.message, field: error.field || null, expected: error.expected ?? null, actual: error.actual ?? null }
      });
    }
  });
}
