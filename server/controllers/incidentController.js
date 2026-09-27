import { backendState } from '../services/stateManager.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';
import { ROUTES_DB } from '../config/constants.js';
import { dbManager } from '../db/database.js';

export const VALID_INCIDENT_STATUSES = [
  "ACTIVE",
  "ACKNOWLEDGED",
  "DISPATCHED",
  "RESPONDING",
  "DISPATCHED/RESPONDING",
  "MITIGATED",
  "RESOLVED",
  "ARCHIVED"
];

export const VALID_INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];

export const VALID_INCIDENT_CATEGORIES = [
  "accident",
  "congestion",
  "roadblock",
  "hazard",
  "weather",
  "infrastructure"
];

export function getIncidents(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json(createApiResponse({
    type: "incident_list",
    sequence: backendState.incidentSequence,
    data: backendState.state.incidents,
    extra: {
      status: "success",
      incidents: backendState.state.incidents
    }
  }));
}

export function createIncident(req, res) {
  const { title, category = "congestion", severity = "medium", location, assignedUnit, notes, source = "API" } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter 'title' wajib diisi berupa teks non-kosong.",
      { field: "title" }
    ));
  }

  if (!location || typeof location !== 'string' || !location.trim()) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter 'location' wajib diisi berupa teks lokasi yang valid.",
      { field: "location" }
    ));
  }

  const cleanSev = (severity || 'medium').toLowerCase();
  if (!VALID_INCIDENT_SEVERITIES.includes(cleanSev)) {
    return res.status(422).json(createApiErrorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      `Severity '${severity}' tidak valid. Harus salah satu dari: ${VALID_INCIDENT_SEVERITIES.join(', ')}`,
      { allowedSeverities: VALID_INCIDENT_SEVERITIES, received: severity }
    ));
  }

  const cleanCat = (category || 'congestion').toLowerCase();
  if (!VALID_INCIDENT_CATEGORIES.includes(cleanCat)) {
    return res.status(422).json(createApiErrorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      `Kategori '${category}' tidak valid. Harus salah satu dari: ${VALID_INCIDENT_CATEGORIES.join(', ')}`,
      { allowedCategories: VALID_INCIDENT_CATEGORIES, received: category }
    ));
  }

  const id = req.body.id || `INC-${Date.now().toString().slice(-4)}`;
  const nowStr = new Date().toISOString();

  // Prevent duplicate ID insertion
  const existing = backendState.state.incidents.find(i => String(i.id) === String(id));
  if (existing) {
    return res.status(409).json(createApiErrorResponse(
      409,
      "CONFLICT",
      `Insiden dengan ID #${id} sudah ada di sistem.`,
      { existingId: id }
    ));
  }

  const newIncident = {
    id,
    title: title.trim(),
    category: cleanCat,
    severity: cleanSev,
    location: location.trim(),
    status: "ACTIVE",
    priority: cleanSev === 'critical' || cleanSev === 'high' ? 'high' : 'normal',
    source: source || (req.user?.name ? `Operator (${req.user.name})` : "AI_VISION"),
    assignedUnit: assignedUnit || "Menunggu Disposisi Petugas",
    notes: notes || "Laporan insiden baru masuk antrean verifikasi SITS.",
    reportedAt: nowStr,
    updatedAt: nowStr,
    acknowledgedAt: null,
    resolvedAt: null
  };

  backendState.state.incidents.unshift(newIncident);
  backendState.incidentSequence++;
  backendState.sequence++;
  backendState.state.seq = backendState.sequence;
  backendState.state.timestampMs = Date.now();

  // Persist SQLite with Rollback Guard
  try {
    dbManager.upsertIncident(newIncident, true);
  } catch (persistErr) {
    // Rollback in-memory mutation
    const idx = backendState.state.incidents.findIndex(i => String(i.id) === String(id));
    if (idx >= 0) backendState.state.incidents.splice(idx, 1);
    backendState.sequence--;
    backendState.incidentSequence--;
    return res.status(500).json(createApiErrorResponse(
      500,
      "PERSISTENCE_FAILED",
      `Gagal menyimpan insiden ke database SQLite: ${persistErr.message}`
    ));
  }

  // Broadcast realtime update
  if (backendState.io) {
    backendState.io.emit('incident:update', {
      id,
      seq: backendState.incidentSequence,
      timestamp: Date.now(),
      source: 'server',
      payload: newIncident
    });

    backendState.io.emit('system:toast', {
      message: `🚨 Insiden Baru Terdeteksi: #${id} (${newIncident.title}) pada ${newIncident.location}.`,
      type: cleanSev === 'critical' ? 'alert' : 'warning'
    });
  }

  backendState.recordAuditLog({
    operator: req.user?.name || "System Vision Agent",
    action: "INCIDENT_CREATED",
    entity: `Incident ${id}`,
    result: `SUCCESS (${newIncident.title})`,
    timestamp: nowStr
  });

  res.status(201).json(createApiResponse({
    type: "incident_created",
    sequence: backendState.incidentSequence,
    data: newIncident,
    extra: {
      status: "success",
      incident: newIncident
    }
  }));
}

export function getEmergencies(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json(createApiResponse({
    type: "emergency_list",
    sequence: backendState.emergencySequence,
    data: backendState.state.activeEmergencies,
    extra: {
      status: "success",
      emergencies: backendState.state.activeEmergencies
    }
  }));
}

export function activateEmergencyRest(req, res) {
  const { code, route, type } = req.body || {};

  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter 'code' (ID Armada Darurat) wajib diisi.",
      { field: "code" }
    ));
  }

  const routeId = route || "route-soetomo";
  if (!ROUTES_DB[routeId]) {
    return res.status(422).json(createApiErrorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      `Rute darurat '${routeId}' tidak valid. Harus salah satu dari: ${Object.keys(ROUTES_DB).join(', ')}`,
      { allowedRoutes: Object.keys(ROUTES_DB), received: routeId }
    ));
  }

  try {
    const result = backendState.activateEmergencyPriority(code.trim(), routeId);

    if (backendState.io) {
      backendState.emergencySequence++;
      backendState.io.emit('emergency:update', {
        seq: backendState.emergencySequence,
        timestamp: Date.now(),
        source: 'server',
        payload: {
          greenWaveActive: true,
          emergencyItem: result.emergencyItem,
          activeEmergencies: result.state.activeEmergencies
        }
      });

      backendState.io.emit('traffic:update', result.state);
      backendState.io.emit('emergency:dispatch-alert', {
        code: result.emergencyItem.vehicleId,
        vehicle: result.emergencyItem.vehicleType,
        route: routeId
      });
    }

    res.status(201).json(createApiResponse({
      type: "emergency_activated",
      sequence: backendState.emergencySequence,
      data: result.emergencyItem,
      extra: {
        status: "success",
        emergencyItem: result.emergencyItem
      }
    }));
  } catch (err) {
    if (err.message.includes("SUDAH DISPATCHED") || err.message.includes("sedang aktif")) {
      return res.status(409).json(createApiErrorResponse(
        409,
        "CONFLICT",
        err.message,
        { vehicleId: code }
      ));
    }
    return res.status(500).json(createApiErrorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      `Gagal mengaktifkan prioritas darurat: ${err.message}`
    ));
  }
}

export function cancelEmergencyRest(req, res) {
  const id = req.params.id || req.body?.id;
  if (!id) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter ID armada darurat wajib disertakan."
    ));
  }

  try {
    const newState = backendState.cancelEmergency(id);

    if (backendState.io) {
      backendState.emergencySequence++;
      backendState.io.emit('emergency:update', {
        seq: backendState.emergencySequence,
        timestamp: Date.now(),
        source: 'server',
        payload: {
          activeEmergencies: newState.activeEmergencies
        }
      });
      backendState.io.emit('traffic:update', newState);
    }

    res.status(200).json(createApiResponse({
      type: "emergency_cancelled",
      sequence: backendState.emergencySequence,
      data: { id, status: "CANCELLED" }
    }));
  } catch (err) {
    return res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json(createApiErrorResponse(
      err.message.includes("tidak ditemukan") ? 404 : 400,
      err.message.includes("tidak ditemukan") ? "NOT_FOUND" : "BAD_REQUEST",
      err.message
    ));
  }
}

export function getAuditLogs(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json(createApiResponse({
    type: "audit_log_list",
    data: backendState.auditLogs,
    extra: {
      status: "success",
      logs: backendState.auditLogs
    }
  }));
}

export function updateIncidentStatus(req, res) {
  const incidentId = req.params.id;
  const { status, assignedUnit, notes } = req.body || {};

  if (!status) {
    return res.status(400).json(createApiErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Parameter status wajib disertakan.",
      { allowedStatuses: VALID_INCIDENT_STATUSES }
    ));
  }

  const cleanStatus = status.trim().toUpperCase();
  if (!VALID_INCIDENT_STATUSES.includes(cleanStatus)) {
    return res.status(422).json(createApiErrorResponse(
      422,
      "UNPROCESSABLE_ENTITY",
      `Status '${status}' tidak valid. Harus salah satu dari: ${VALID_INCIDENT_STATUSES.join(', ')}`,
      { allowedStatuses: VALID_INCIDENT_STATUSES, received: status }
    ));
  }

  const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(incidentId));
  if (!existingInc) {
    return res.status(404).json(createApiErrorResponse(
      404,
      "NOT_FOUND",
      `Insiden dengan ID #${incidentId} tidak ditemukan di sistem.`,
      { incidentId }
    ));
  }

  if (existingInc.status === "RESOLVED" && cleanStatus !== "RESOLVED" && cleanStatus !== "ARCHIVED") {
    return res.status(409).json(createApiErrorResponse(
      409,
      "STATE_CONFLICT",
      `Insiden #${incidentId} sudah berstatus RESOLVED dan tidak dapat diubah kembali ke status aktif.`,
      { currentStatus: existingInc.status, requestedStatus: cleanStatus }
    ));
  }

  try {
    const updated = backendState.updateIncidentStatus(incidentId, cleanStatus, assignedUnit, notes);
    res.status(200).json(createApiResponse({
      type: "incident_status_updated",
      sequence: backendState.incidentSequence,
      data: updated,
      extra: {
        status: "success",
        data: updated
      }
    }));
  } catch (err) {
    console.error('❌ [API Incident Status] Error:', err);
    res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json(createApiErrorResponse(
      err.message.includes("tidak ditemukan") ? 404 : 400,
      err.message.includes("tidak ditemukan") ? "NOT_FOUND" : "BAD_REQUEST",
      err.message
    ));
  }
}

export function resolveIncident(req, res) {
  const incidentId = req.params.id;
  const existingInc = (backendState.state.incidents || []).find(i => String(i.id) === String(incidentId));

  if (!existingInc) {
    return res.status(404).json(createApiErrorResponse(
      404,
      "NOT_FOUND",
      `Insiden dengan ID #${incidentId} tidak ditemukan di sistem.`,
      { incidentId }
    ));
  }

  try {
    const updated = backendState.updateIncidentStatus(incidentId, "RESOLVED");
    const resolverName = req.user?.name || "Operator SITS 112 Surabaya";

    // Emit incident:resolved event specifically for clients listening on that event
    if (backendState.io) {
      backendState.io.emit('incident:resolved', {
        id: incidentId,
        seq: backendState.incidentSequence,
        timestamp: Date.now(),
        resolvedBy: resolverName
      });
    }

    res.status(200).json(createApiResponse({
      type: "incident_resolved",
      sequence: backendState.incidentSequence,
      data: updated,
      extra: {
        statusCode: 200,
        id: incidentId,
        status: "RESOLVED",
        message: `Insiden #${incidentId} telah berhasil ditandai Selesai di Backend SITS.`,
        timestamp: backendState._getWibTimeString(),
        resolvedBy: resolverName
      }
    }));
  } catch (err) {
    console.error('❌ [API Incident Resolve] Error:', err);
    res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json(createApiErrorResponse(
      err.message.includes("tidak ditemukan") ? 404 : 400,
      err.message.includes("tidak ditemukan") ? "NOT_FOUND" : "BAD_REQUEST",
      err.message
    ));
  }
}
