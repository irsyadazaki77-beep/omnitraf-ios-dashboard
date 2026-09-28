import { backendState } from '../services/stateManager.js';
import { dbManager } from '../db/database.js';
import { commandExecutor } from '../services/commandExecutor.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';

export const VALID_RESOLUTIONS = ['720p', '1080p', '4k'];
export const VALID_FAULTS = ["recover", "clear", "latency_spike", "packet_loss", "low_fps", "thermal_warning", "heartbeat_timeout"];

export async function updateDeviceConfig(req, res) {
  const { deviceId, fps, resolution, mode, greenWaveSync } = req.body || {};
  const commandId = req.body?.commandId || `CMD-REST-CFG-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-REST-${Date.now()}`;
  const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-CFG-${deviceId}-${JSON.stringify(req.body)}`;

  if (!deviceId) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter deviceId wajib disertakan.",
      { field: "deviceId" }
    ));
  }

  const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
  if (!dev) {
    return res.status(404).json(createApiErrorResponse(
      404,
      "NOT_FOUND",
      `Perangkat dengan ID ${deviceId} tidak ditemukan di registry.`,
      { deviceId }
    ));
  }

  if (fps !== undefined) {
    const fpsVal = parseInt(fps, 10);
    if (isNaN(fpsVal) || fpsVal < 5 || fpsVal > 60) {
      return res.status(422).json(createApiErrorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        "Frame Rate Limit (FPS) harus berupa angka bulat antara 5 dan 60.",
        { min: 5, max: 60, received: fps }
      ));
    }
  }

  if (resolution !== undefined) {
    if (!VALID_RESOLUTIONS.includes(resolution)) {
      return res.status(422).json(createApiErrorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        `Resolusi kamera tidak valid. Harus salah satu dari: ${VALID_RESOLUTIONS.join(', ')}.`,
        { allowedResolutions: VALID_RESOLUTIONS, received: resolution }
      ));
    }
  }

  if (greenWaveSync !== undefined && typeof greenWaveSync !== 'boolean') {
    return res.status(422).json(createApiErrorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      "greenWaveSync harus berupa boolean (true/false).",
      { field: "greenWaveSync", receivedType: typeof greenWaveSync }
    ));
  }

  try {
    const authenticatedUser = req.user ? {
      id: req.user.id,
      role: req.user.role,
      name: req.user.name
    } : {
      id: 'usr-admin-rest',
      role: 'ADMIN',
      name: 'Administrator SITS'
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
        status: outcome.status
      }
    }));
  } catch (err) {
    return res.status(500).json(createApiErrorResponse(
      500,
      "PERSISTENCE_FAILED",
      `Gagal menyimpan konfigurasi perangkat ke database SQLite: ${err.message}`
    ));
  }
}

export async function pingDevice(req, res) {
  const deviceId = req.query.deviceId || req.body?.deviceId;
  const commandId = req.body?.commandId || `CMD-PING-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-PING-${Date.now()}`;

  if (!deviceId) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter deviceId wajib disertakan.",
      { field: "deviceId" }
    ));
  }

  const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
  if (!dev) {
    return res.status(404).json(createApiErrorResponse(
      404,
      "NOT_FOUND",
      `Perangkat dengan ID ${deviceId} tidak ditemukan di registry.`,
      { deviceId }
    ));
  }

  try {
    const authenticatedUser = req.user ? {
      id: req.user.id,
      role: req.user.role,
      name: req.user.name
    } : {
      id: 'usr-operator-rest',
      role: 'OPERATOR',
      name: 'Operator SITS'
    };

    const outcome = await commandExecutor.executeCommand({
      action: 'device:ping',
      targetId: deviceId,
      payload: { deviceId },
      commandId,
      correlationId,
      authenticatedUser,
      sourceChannel: 'rest'
    });

    res.status(200).json(createApiResponse({
      type: "device_ping_success",
      sequence: backendState.deviceSequence,
      data: {
        deviceId,
        latencyMs: dev.latencyMs,
        packetLossPercent: 0,
        status: dev.status,
        healthScore: dev.healthScore,
        actionId: outcome.commandId
      }
    }));
  } catch (err) {
    return res.status(500).json(createApiErrorResponse(500, "EXECUTION_FAIL", err.message));
  }
}

export async function injectDeviceFault(req, res) {
  const { deviceId, type, duration } = req.body || {};
  const commandId = req.body?.commandId || `CMD-FAULT-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-FAULT-${Date.now()}`;
  const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-FAULT-${deviceId}-${type}-${Date.now()}`;

  if (!deviceId) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter deviceId wajib disertakan.",
      { field: "deviceId" }
    ));
  }

  const dev = backendState.devicesRegistry.find(d => d.deviceId === deviceId);
  if (!dev) {
    return res.status(404).json(createApiErrorResponse(
      404,
      "NOT_FOUND",
      `Perangkat dengan ID ${deviceId} tidak ditemukan di registry.`,
      { deviceId }
    ));
  }

  if (type !== "recover" && type !== "clear" && !VALID_FAULTS.includes(type)) {
    return res.status(422).json(createApiErrorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      `Tipe gangguan '${type}' tidak valid. Harus salah satu dari: ${VALID_FAULTS.join(", ")}`,
      { allowedFaults: VALID_FAULTS, received: type }
    ));
  }

  try {
    const authenticatedUser = req.user ? {
      id: req.user.id,
      role: req.user.role,
      name: req.user.name
    } : {
      id: 'usr-admin-rest',
      role: 'ADMIN',
      name: 'Administrator SITS'
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

    res.status(200).json(createApiResponse({
      type: "device_fault_injected",
      sequence: backendState.deviceSequence,
      data: {
        actionId: outcome.commandId,
        deviceId,
        faultType: type,
        deviceData: dev
      }
    }));
  } catch (err) {
    return res.status(500).json(createApiErrorResponse(500, "EXECUTION_FAIL", err.message));
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
