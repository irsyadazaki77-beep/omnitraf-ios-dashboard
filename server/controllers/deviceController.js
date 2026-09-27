import { backendState } from '../services/stateManager.js';
import { dbManager } from '../db/database.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';

export const VALID_RESOLUTIONS = ['720p', '1080p', '4k'];
export const VALID_FAULTS = ["recover", "clear", "latency_spike", "packet_loss", "low_fps", "thermal_warning", "heartbeat_timeout"];

export async function updateDeviceConfig(req, res) {
  const { deviceId, fps, resolution, mode, greenWaveSync, actor } = req.body || {};
  const currentTimestamp = Date.now();
  const act = actor || req.user?.name || "Administrator SITS";

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

  const actionId = `ACT-CFG-${Date.now()}`;
  const previousState = {
    fps: dev.fps,
    resolution: dev.resolution,
    mode: dev.mode || 'Adaptive AI (YOLOv8)',
    greenWaveSync: dev.greenWaveSync ?? true
  };

  const newState = {
    fps: fps !== undefined ? parseInt(fps, 10) : dev.fps,
    resolution: resolution !== undefined ? resolution : dev.resolution,
    mode: mode !== undefined ? mode : (dev.mode || 'Adaptive AI (YOLOv8)'),
    greenWaveSync: greenWaveSync !== undefined ? !!greenWaveSync : (dev.greenWaveSync ?? true)
  };

  backendState.deviceSequence++;
  if (backendState.io) {
    backendState.io.emit('device:config-transition', {
      actionId,
      deviceId,
      status: 'REQUESTED',
      timestamp: Date.now(),
      actor: act,
      previousState,
      newState
    });

    backendState.io.emit('device:config-transition', {
      actionId,
      deviceId,
      status: 'VALIDATING',
      timestamp: Date.now(),
      actor: act,
      previousState,
      newState
    });
  }

  if (fps !== undefined) dev.fps = parseInt(fps, 10);
  if (resolution !== undefined) dev.resolution = resolution;
  if (mode !== undefined) dev.mode = mode;
  if (greenWaveSync !== undefined) dev.greenWaveSync = !!greenWaveSync;
  dev.updatedAt = new Date().toISOString();

  // Persist to SQLite
  try {
    dbManager.upsertDeviceTelemetry(dev, true);
  } catch (persistErr) {
    // Rollback in-memory mutation
    dev.fps = previousState.fps;
    dev.resolution = previousState.resolution;
    dev.mode = previousState.mode;
    dev.greenWaveSync = previousState.greenWaveSync;
    return res.status(500).json(createApiErrorResponse(
      500,
      "PERSISTENCE_FAILED",
      `Gagal menyimpan konfigurasi perangkat ke database SQLite: ${persistErr.message}`
    ));
  }

  const auditRecord = {
    actionId,
    deviceId,
    requestedAt: new Date(currentTimestamp).toISOString(),
    completedAt: new Date().toISOString(),
    actor: act,
    previousState,
    newState,
    result: "SUCCESS",
    errorCode: null,
    status: "APPLIED"
  };

  if (!backendState.deviceAuditTrail) {
    backendState.deviceAuditTrail = [];
  }
  backendState.deviceAuditTrail.unshift(auditRecord);

  if (backendState.io) {
    backendState.io.emit('device:config-transition', {
      actionId,
      deviceId,
      status: 'APPLIED',
      timestamp: Date.now(),
      actor: act,
      previousState,
      newState
    });

    backendState.io.emit('device:update', {
      seq: backendState.deviceSequence,
      timestamp: Date.now(),
      source: 'server',
      deviceId,
      deviceData: dev
    });
  }

  res.status(200).json(createApiResponse({
    type: "device_config_updated",
    sequence: backendState.deviceSequence,
    data: {
      actionId,
      deviceId,
      status: "APPLIED",
      previousState,
      newState,
      completedAt: auditRecord.completedAt
    }
  }));
}

export function pingDevice(req, res) {
  const currentTimestamp = Date.now();
  const deviceId = req.query.deviceId || req.body?.deviceId;
  const actor = req.query.actor || req.body?.actor || req.user?.name || "Operator SITS";

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

  const latency = Math.floor(Math.random() * 5) + 6;
  dev.latencyMs = latency;
  dev.packetLossPercent = 0;
  dev.lastSeenAt = new Date().toISOString();
  dev.lastHeartbeatAt = new Date().toISOString();
  dev.consecutiveFailures = 0;
  dev.updatedAt = new Date().toISOString();

  backendState.tickDevices();

  const actionId = `ACT-PING-${Date.now()}`;
  const auditRecord = {
    actionId,
    deviceId,
    requestedAt: new Date(currentTimestamp).toISOString(),
    completedAt: new Date().toISOString(),
    actor,
    previousState: { latencyMs: dev.latencyMs },
    newState: { latencyMs: latency, status: dev.status },
    result: "SUCCESS",
    errorCode: null
  };

  if (!backendState.deviceAuditTrail) {
    backendState.deviceAuditTrail = [];
  }
  backendState.deviceAuditTrail.unshift(auditRecord);

  backendState.deviceSequence++;
  if (backendState.io) {
    backendState.io.emit('device:update', {
      seq: backendState.deviceSequence,
      timestamp: Date.now(),
      source: 'server',
      deviceId,
      deviceData: dev
    });
  }

  res.status(200).json(createApiResponse({
    type: "device_ping_success",
    sequence: backendState.deviceSequence,
    data: {
      deviceId,
      latencyMs: latency,
      packetLossPercent: 0,
      status: dev.status,
      healthScore: dev.healthScore,
      actionId
    }
  }));
}

export function injectDeviceFault(req, res) {
  const { deviceId, type, duration, actor } = req.body || {};
  const currentTimestamp = Date.now();
  const act = actor || req.user?.name || "Administrator SITS";

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

  const previousState = {
    latencyMs: dev.latencyMs,
    packetLossPercent: dev.packetLossPercent,
    fps: dev.fps,
    temperatureC: dev.temperatureC,
    healthLevel: dev.healthLevel,
    status: dev.status
  };

  if (type === "recover" || type === "clear") {
    delete backendState.activeFaults[deviceId];
    dev.consecutiveFailures = 0;
    dev.errorCount = 0;
  } else {
    if (!VALID_FAULTS.includes(type)) {
      return res.status(422).json(createApiErrorResponse(
        422,
        "UNPROCESSABLE_ENTITY",
        `Tipe gangguan '${type}' tidak valid. Harus salah satu dari: ${VALID_FAULTS.join(", ")}`,
        { allowedFaults: VALID_FAULTS, received: type }
      ));
    }

    backendState.activeFaults[deviceId] = {
      type,
      duration: duration || 30000,
      timestamp: currentTimestamp
    };
  }

  backendState.tickDevices();

  const actionId = `ACT-FAULT-${Date.now()}`;
  const auditRecord = {
    actionId,
    deviceId,
    requestedAt: new Date(currentTimestamp).toISOString(),
    completedAt: new Date().toISOString(),
    actor: act,
    previousState,
    newState: {
      latencyMs: dev.latencyMs,
      packetLossPercent: dev.packetLossPercent,
      fps: dev.fps,
      temperatureC: dev.temperatureC,
      healthLevel: dev.healthLevel,
      status: dev.status
    },
    result: "SUCCESS",
    errorCode: null
  };

  if (!backendState.deviceAuditTrail) {
    backendState.deviceAuditTrail = [];
  }
  backendState.deviceAuditTrail.unshift(auditRecord);

  backendState.deviceSequence++;
  if (backendState.io) {
    backendState.io.emit('device:update', {
      seq: backendState.deviceSequence,
      timestamp: Date.now(),
      source: 'server',
      deviceId,
      deviceData: dev
    });
  }

  res.status(200).json(createApiResponse({
    type: "device_fault_injected",
    sequence: backendState.deviceSequence,
    data: {
      actionId,
      deviceId,
      faultType: type,
      deviceData: dev
    }
  }));
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
