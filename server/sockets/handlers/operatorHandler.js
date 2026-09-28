import { ROLES } from '../../config/constants.js';
import { backendState } from '../../services/stateManager.js';
import { commandExecutor } from '../../services/commandExecutor.js';
import { isActionAuthorized, getRequiredRoles } from '../../config/capabilities.js';

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
  // Check the authoritative status of a command (reconnection / resync helper)
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
        callback({
          success: true,
          status: cached.status || 'SERVER_APPLIED',
          resultingState: cached.resultingState,
          action: cached.action,
          timestamp: cached.timestamp
        });
      }
    } else {
      // Check if command is currently in-flight
      const isExecuting = commandExecutor.inFlightKeys.has(idempotencyKey || commandId || '');
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
    const authenticatedUser = socket.user || {
      id: 'usr-anonymous',
      username: 'anonymous',
      role: ROLES.VIEWER,
      name: 'Publik / Dishub Viewer'
    };

    console.info(`🛡️ [Operator Command] Gateway received: ${action} for ${targetId || 'global'} from ${authenticatedUser.name} (${authenticatedUser.role})`);

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
        code: 'EXECUTION_FAIL',
        message: err.message,
        error: {
          code: 'EXECUTION_FAIL',
          message: err.message
        }
      };

      if (typeof callback === 'function') {
        callback(errResponse);
      }
    }
  });
}

