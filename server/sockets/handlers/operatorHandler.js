import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';
import { commandExecutor } from '../../services/commandExecutor.js';
import { isActionAuthorized, getRequiredRoles } from '../../config/capabilities.js';
import { clusterRuntime } from '../../infrastructure/redis/clusterRuntimeSingleton.js';

export function checkSocketRole(socket, allowedRoles, eventName, callback) {
  const userRole = socket.user?.role || null;
  if (!allowedRoles.includes(userRole)) {
    const errorMsg = `Akses ditolak untuk '${eventName}'. Memerlukan hak akses [${allowedRoles.join('/')}], peran saat ini: '${userRole}'.`;
    console.warn(`🔒 [Socket RBAC Ditolak] ${socket.user?.name || 'Anonymous'} (${userRole}) mencoba memanggil '${eventName}'`);

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
  // Check the authoritative status of a command (reconnection / resync helper)
  socket.on('command:status', async (data, callback) => {
    if (!isActionAuthorized(socket.user?.role, 'command:status')) {
      if (typeof callback === 'function') callback({ success: false, status: 'REJECTED', result: 'FORBIDDEN', code: 'FORBIDDEN' });
      return;
    }
    const { commandId, idempotencyKey, correlationId } = data || {};
    const cmds = backendState.processedCommands;
    const cached = cmds && (
      (idempotencyKey && cmds.get(idempotencyKey)) ||
      (commandId && cmds.get(commandId)) ||
      (correlationId && cmds.get(correlationId))
    );

    let distributed = null;
    if (!cached && clusterRuntime.mode === 'cluster') {
      try { distributed = await clusterRuntime.getIdempotentCommandResult(idempotencyKey || commandId); }
      catch (_) {
        if (typeof callback === 'function') callback({ success: false, status: 'UNAVAILABLE', code: 'CLUSTER_UNAVAILABLE' });
        return;
      }
    }
    const authoritative = cached || (distributed && distributed.status !== 'PROCESSING' ? {
      actorId: distributed.actorId,
      status: distributed.status === 'SUCCEEDED' ? distributed.result?.status || 'SERVER_APPLIED' : 'REJECTED',
      resultingState: distributed.result?.resultingState,
      action: distributed.result?.action,
      timestamp: distributed.result?.timestamp
    } : null);

    if (authoritative) {
      if (authoritative.actorId !== socket.user.id && socket.user.role !== ROLES.ADMIN) {
        if (typeof callback === 'function') callback({ success: false, status: 'REJECTED', result: 'FORBIDDEN', code: 'FORBIDDEN' });
        return;
      }
      if (typeof callback === 'function') {
        callback({
          success: true,
          status: authoritative.status || 'SERVER_APPLIED',
          resultingState: authoritative.resultingState,
          action: authoritative.action,
          timestamp: authoritative.timestamp
        });
      }
    } else {
      // Check if command is currently in-flight
      const isExecuting = distributed?.status === 'PROCESSING' || commandExecutor.inFlightKeys.has(idempotencyKey || commandId || '');
      if (typeof callback === 'function') {
        callback({
          success: true,
          status: isExecuting ? 'EXECUTING' : 'NOT_FOUND'
        });
      }
    }
  });

  // Centralized Authoritative Operator Command Gateway
  socket.on('operator:command', async (data, callback) => {
    const { cmd, correlationId } = data || {};
    if (!cmd || !cmd.action) {
      if (typeof callback === 'function') {
        callback({ success: false, status: 'REJECTED', error: 'Malformed command structure' });
      }
      return;
    }

    const { action, targetId, payload, commandId, idempotencyKey } = cmd;

    // Security: Authenticated principal always from socket.user, never trust client-forged actor field
    const authenticatedUser = socket.user || null;

    console.info(`🛡️ [Operator Command] Gateway received: ${action} for ${targetId || 'global'} from ${authenticatedUser?.name || 'UNAUTHENTICATED'} (${authenticatedUser?.role || 'NONE'})`);

    try {
      const outcome = await commandExecutor.executeCommand({
        action,
        targetId,
        payload,
        commandId: commandId || cmd.commandId,
        idempotencyKey: idempotencyKey || cmd.idempotencyKey,
        correlationId: correlationId || cmd.correlationId,
        authenticatedUser,
        sourceChannel: 'socket'
      });

      if (typeof callback === 'function') {
        callback(outcome);
      }
    } catch (err) {
      const errResponse = {
        success: false,
        commandId: commandId || cmd?.commandId,
        correlationId: correlationId || cmd?.correlationId,
        idempotencyKey: idempotencyKey || cmd?.idempotencyKey,
        action,
        status: 'REJECTED',
        result: 'FAILED',
        timestamp: Date.now(),
        statusCode: err.statusCode || 500,
        code: err.code || 'EXECUTION_FAIL',
        message: err.message,
        error: {
          code: err.code || 'EXECUTION_FAIL',
          message: err.message,
          field: err.field || null,
          expected: err.expected ?? null,
          actual: err.actual ?? null
        }
      };

      if (typeof callback === 'function') {
        callback(errResponse);
      }
    }
  });
}
