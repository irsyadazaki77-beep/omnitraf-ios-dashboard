import { commandExecutor } from '../../services/commandExecutor.js';

/** Socket event adapters. All state changes are delegated to the command gateway. */
export function registerSignalHandlers(_io, socket) {
  const forward = (eventName, action) => {
    socket.on(eventName, async (data = {}, callback) => {
      const payload = data || {};
      const commandId = payload.commandId || `CMD-SOCK-${action.replace(/[^A-Z0-9]/gi, '-')}-${Date.now()}`;
      try {
        const outcome = await commandExecutor.executeCommand({
          action,
          targetId: action === 'green-wave:toggle' ? 'corridor-ayani-darmo' : (payload.targetId ?? payload.intersectionId ?? null),
          payload,
          commandId,
          idempotencyKey: payload.idempotencyKey || commandId,
          correlationId: payload.correlationId || `CORR-SOCK-${commandId}`,
          authenticatedUser: socket.user || null,
          sourceChannel: 'socket'
        });
        if (typeof callback === 'function') callback({
          ...outcome,
          ...(action === 'signal:override' ? { nodeName: outcome.newState?.nodeName, duration: outcome.newState?.timer } : {}),
          ...(action === 'ai:apply-recommendation' ? { optimizedSplit: outcome.newState?.greenSplit, nodeName: outcome.newState?.nodeName, smoothTransitionScheduled: true } : {}),
          ...(action === 'green-split:update' ? { greenSplit: outcome.newState?.greenSplit } : {}),
          ...(action === 'green-wave:toggle' ? { greenWaveActive: outcome.newState?.greenWaveActive } : {})
        });
      } catch (error) {
        if (typeof callback === 'function') callback({
        success: false, commandId, action, status: 'REJECTED', result: 'FAILED',
          timestamp: Date.now(), statusCode: error.statusCode || 500, code: error.code || 'EXECUTION_FAIL', message: error.message,
          error: { code: error.code || 'EXECUTION_FAIL', message: error.message, field: error.field || null, expected: error.expected ?? null, actual: error.actual ?? null }
        });
      }
    });
  };

  forward('signal:override', 'signal:override');
  forward('ai:apply-recommendation', 'ai:apply-recommendation');
  forward('green-split:update', 'green-split:update');
  forward('green-wave:toggle', 'green-wave:toggle');
}
