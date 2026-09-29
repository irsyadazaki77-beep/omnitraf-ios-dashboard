import { backendState } from '../services/stateManager.js';
import { dbManager } from '../db/database.js';
import { commandExecutor } from '../services/commandExecutor.js';
import { createApiResponse, createApiErrorResponse, createCommandErrorResponse, getCommandErrorStatus } from '../middlewares/errorHandler.js';
import { DEVICE_FAULTS, DEVICE_RESOLUTIONS } from '../config/contracts.js';

export const VALID_RESOLUTIONS = DEVICE_RESOLUTIONS;
export const VALID_FAULTS = DEVICE_FAULTS;

export async function updateDeviceConfig(req, res) {
  const { deviceId, fps, resolution, mode, greenWaveSync } = req.body || {};
  const commandId = req.body?.commandId || `CMD-REST-CFG-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-REST-${Date.now()}`;
  const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-CFG-${deviceId}-${JSON.stringify(req.body)}`;

  try {
    const authenticatedUser = {
      id: req.user.id, role: req.user.role, name: req.user.name
    };

    const outcome = await commandExecutor.executeCommand({
      action: 'device:config',
      targetId: deviceId,
      payload: { deviceId, fps, resolution, mode, greenWaveSync },
      commandId,
      idempotencyKey,
      correlationId,
      authenticatedUser,
      sourceChannel: 'rest'
    });

    res.status(200).json(createApiResponse({
      type: "device_config_updated",
      status: outcome.status,
      commandId: outcome.commandId,
      sequence: backendState.deviceSequence,
      data: {
        actionId: outcome.commandId,
        deviceId,
        status: "APPLIED",
        serverStatus: outcome.status,
        previousState: outcome.previousState,
        newState: outcome.newState,
        completedAt: new Date(outcome.timestamp).toISOString()
      },
      extra: {
        commandId: outcome.commandId,
        status: outcome.status,
        command: outcome
      }
    }));
  } catch (err) {
    const response = createCommandErrorResponse(err);
    return res.status(getCommandErrorStatus(err)).json(response);
  }
}

export async function pingDevice(req, res) {
  const deviceId = req.query.deviceId || req.body?.deviceId;
  const commandId = req.body?.commandId || `CMD-PING-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-PING-${Date.now()}`;

  try {
    const authenticatedUser = req.user;

    const outcome = await commandExecutor.executeCommand({
      action: 'device:ping',
      targetId: deviceId,
      payload: { deviceId },
      commandId,
      correlationId,
      authenticatedUser,
      sourceChannel: 'rest'
    });
    const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);

    res.status(200).json(createApiResponse({
      type: "device_ping_success",
      sequence: backendState.deviceSequence,
      data: {
        deviceId,
        latencyMs: dev.latencyMs,
        packetLossPercent: 0,
        status: dev.status,
        healthScore: dev.healthScore,
        actionId: outcome.commandId,
        command: outcome
      }
    }));
  } catch (err) {
    const response = createCommandErrorResponse(err);
    return res.status(getCommandErrorStatus(err)).json(response);
  }
}

export async function injectDeviceFault(req, res) {
  const { deviceId, type, duration } = req.body || {};
  const commandId = req.body?.commandId || `CMD-FAULT-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-FAULT-${Date.now()}`;
  const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-FAULT-${deviceId}-${type}`;

  try {
    const authenticatedUser = {
      id: req.user.id,
      role: req.user.role,
      name: req.user.name
    };

    const outcome = await commandExecutor.executeCommand({
      action: 'device:fault',
      targetId: deviceId,
      payload: { deviceId, type, duration },
      commandId,
      idempotencyKey,
      correlationId,
      authenticatedUser,
      sourceChannel: 'rest'
    });
    const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);

    res.status(200).json(createApiResponse({
      type: "device_fault_injected",
      sequence: backendState.deviceSequence,
      data: {
        actionId: outcome.commandId,
        deviceId,
        faultType: type,
        deviceData: dev,
        command: outcome
      }
    }));
  } catch (err) {
    const response = createCommandErrorResponse(err);
    return res.status(getCommandErrorStatus(err)).json(response);
  }
}

export function getDeviceAuditTrail(req, res) {
  const deviceId = req.query.deviceId;
  let trail = backendState.deviceAuditTrail || [];
  if (deviceId) {
    trail = trail.filter(t => t.deviceId === deviceId);
  }
  res.status(200).json(createApiResponse({
    type: "device_audit_trail",
    sequence: backendState.deviceSequence,
    data: trail
  }));
}
